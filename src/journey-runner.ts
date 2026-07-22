import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import { isPotentiallyDestructive, parseJourney, type JourneyDefinition, type JourneyStep } from "./journey.js";

export interface JourneyStepResult {
  index: number;
  action: JourneyStep["action"];
  description?: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
  evidence?: {
    before: string;
    after: string;
  };
}

export interface JourneyRunResult {
  schemaVersion: "1.0";
  name: string;
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  steps: JourneyStepResult[];
}

export interface JourneyRunOptions {
  allowedOrigins: string[];
  secrets?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStep?: (result: JourneyStepResult) => void;
  evidenceDir?: string;
  validateNavigationUrl?: (url: string) => Promise<void>;
}

function allowedOrigin(rawUrl: string, allowed: Set<string>): void {
  const origin = new URL(rawUrl).origin;
  if (!allowed.has(origin)) throw new Error(`Navegação para origem não autorizada: ${origin}`);
}

function safeError(error: unknown, secrets: Readonly<Record<string, string | undefined>>): string {
  const message = error instanceof Error ? error.message : String(error);
  return Object.values(secrets)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)
    .reduce((safe, value) => safe.split(value).join("[SECRET]"), message)
    .replace(/QA_RADAR_SECRET_[A-Z0-9_]+/g, "[SECRET]");
}

async function guardNavigation(
  route: Route,
  allowed: Set<string>,
  validateUrl?: (url: string) => Promise<void>,
): Promise<void> {
  const request = route.request();
  if (!request.isNavigationRequest()) {
    await route.fallback();
    return;
  }
  try {
    allowedOrigin(request.url(), allowed);
    await validateUrl?.(request.url());
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()["location"];
    if (location && response.status() >= 300 && response.status() < 400) {
      const redirectUrl = new URL(location, request.url()).toString();
      allowedOrigin(redirectUrl, allowed);
      await validateUrl?.(redirectUrl);
    }
    await route.fulfill({ response });
  } catch {
    await route.abort("blockedbyclient");
  }
}

async function captureMasked(
  page: Page,
  path: string,
  secretSelectors: ReadonlySet<string>,
): Promise<void> {
  const masked: string[] = [];
  try {
    for (const selector of secretSelectors) {
      await page.locator(selector).evaluateAll((elements) => {
        for (const element of elements) {
          const html = element as HTMLElement;
          html.dataset.qaRadarOriginalFilter = html.style.filter;
          html.style.filter = "blur(10px)";
        }
      });
      masked.push(selector);
    }
    await page.screenshot({ path, fullPage: true });
  } finally {
    for (const selector of masked) {
      await page.locator(selector).evaluateAll((elements) => {
        for (const element of elements) {
          const html = element as HTMLElement;
          html.style.filter = html.dataset.qaRadarOriginalFilter ?? "";
          delete html.dataset.qaRadarOriginalFilter;
        }
      }).catch(() => undefined);
    }
  }
}

async function executeStep(
  page: Page,
  step: JourneyStep,
  allowed: Set<string>,
  secrets: Readonly<Record<string, string | undefined>>,
  timeoutMs: number,
): Promise<void> {
  switch (step.action) {
    case "goto":
      allowedOrigin(step.url, allowed);
      await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      allowedOrigin(page.url(), allowed);
      return;
    case "click": {
      const locator = page.locator(step.selector);
      const targetDescription = await locator.evaluate((element) => [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("name"),
        element.getAttribute("value"),
        element.getAttribute("href"),
        element.getAttribute("formaction"),
      ].filter(Boolean).join(" "), { timeout: timeoutMs });
      if (!step.allowDestructive && isPotentiallyDestructive(`${step.selector} ${targetDescription}`)) {
        throw new Error("Clique potencialmente destrutivo exige allowDestructive: true.");
      }
      await locator.click({ timeout: timeoutMs });
      allowedOrigin(page.url(), allowed);
      return;
    }
    case "fill": {
      const value = step.valueFromEnv ? secrets[step.valueFromEnv] : step.value;
      if (value === undefined) throw new Error("Secret obrigatório não foi configurado.");
      await page.locator(step.selector).fill(value, { timeout: timeoutMs });
      return;
    }
    case "select":
      await page.locator(step.selector).selectOption(step.value, { timeout: timeoutMs });
      return;
    case "waitFor":
      await page.locator(step.selector).waitFor({ state: "visible", timeout: step.timeoutMs ?? timeoutMs });
      return;
    case "assertVisible":
      await page.locator(step.selector).waitFor({ state: "visible", timeout: timeoutMs });
      return;
    case "assertText": {
      const content = await page.locator(step.selector).textContent({ timeout: timeoutMs });
      if (!content?.includes(step.text)) throw new Error(`Texto esperado não encontrado em ${step.selector}.`);
      return;
    }
  }
}

export async function runJourney(
  page: Page,
  definition: JourneyDefinition | unknown,
  options: JourneyRunOptions,
): Promise<JourneyRunResult> {
  const journey = parseJourney(definition);
  if (options.allowedOrigins.length < 1) throw new Error("Informe ao menos uma origem autorizada para a jornada.");
  const allowed = new Set(options.allowedOrigins.map((value) => new URL(value).origin));
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("timeoutMs da jornada deve estar entre 100 e 120000.");
  }
  const startedAt = new Date();
  const results: JourneyStepResult[] = [];
  const secretSelectors = new Set<string>();
  const secrets = options.secrets ?? {};
  if (options.evidenceDir) await mkdir(options.evidenceDir, { recursive: true });

  const navigationGuard = (route: Route) => guardNavigation(route, allowed, options.validateNavigationUrl);
  await page.context().route("**/*", navigationGuard);

  try {
  for (let index = 0; index < journey.steps.length; index += 1) {
    const step = journey.steps[index];
    if (!step) continue;
    options.signal?.throwIfAborted();
    const stepStarted = Date.now();
    const prefix = `${String(index + 1).padStart(3, "0")}-${step.action}`;
    const evidence = options.evidenceDir ? {
      before: join(options.evidenceDir, `${prefix}-before.png`),
      after: join(options.evidenceDir, `${prefix}-after.png`),
    } : undefined;
    try {
      if (evidence) await captureMasked(page, evidence.before, secretSelectors);
      await executeStep(page, step, allowed, secrets, timeoutMs);
      if (step.action === "fill" && step.valueFromEnv) secretSelectors.add(step.selector);
      if (evidence) await captureMasked(page, evidence.after, secretSelectors);
      options.signal?.throwIfAborted();
      const result: JourneyStepResult = {
        index,
        action: step.action,
        ...(step.description ? { description: step.description } : {}),
        status: "passed",
        durationMs: Date.now() - stepStarted,
        ...(evidence ? { evidence } : {}),
      };
      results.push(result);
      options.onStep?.(result);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (evidence) {
        if (step.action === "fill" && step.valueFromEnv) secretSelectors.add(step.selector);
        await captureMasked(page, evidence.after, secretSelectors).catch(() => undefined);
      }
      const result: JourneyStepResult = {
        index,
        action: step.action,
        ...(step.description ? { description: step.description } : {}),
        status: "failed",
        durationMs: Date.now() - stepStarted,
        error: safeError(error, secrets),
        ...(evidence ? { evidence } : {}),
      };
      results.push(result);
      options.onStep?.(result);
      return {
        schemaVersion: "1.0",
        name: journey.name,
        status: "failed",
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        steps: results,
      };
    }
  }

  return {
    schemaVersion: "1.0",
    name: journey.name,
    status: "passed",
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    steps: results,
  };
  } finally {
    await page.context().unroute("**/*", navigationGuard).catch(() => undefined);
  }
}
