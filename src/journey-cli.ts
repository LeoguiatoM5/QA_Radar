import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { runJourney, type JourneyRunResult } from "./journey-runner.js";
import type { ScanOptions } from "./types.js";
import { PublicNetworkGuard } from "./security.js";

function browserType(name: ScanOptions["browser"]): BrowserType {
  return { chromium, firefox, webkit }[name];
}

function journeySecrets(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => entry[0].startsWith("QA_RADAR_SECRET_") && entry[1] !== undefined),
  );
}

export async function runJourneyFile(options: ScanOptions): Promise<{ report: JourneyRunResult; reportPath: string }> {
  if (!options.journeyPath) throw new Error("Arquivo de jornada não informado.");
  let definition: unknown;
  try {
    definition = JSON.parse(await readFile(options.journeyPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível carregar a jornada "${options.journeyPath}": ${detail}`);
  }

  return runJourneyDefinition(options, definition, process.env);
}

export async function runJourneyDefinition(
  options: ScanOptions,
  definition: unknown,
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<{ report: JourneyRunResult; reportPath: string }> {
  signal?.throwIfAborted();
  await mkdir(options.outputDir, { recursive: true });
  const browser = await browserType(options.browser).launch({ headless: !options.headed });
  const abort = (): void => { void browser.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const networkGuard = options.publicNetworkOnly ? new PublicNetworkGuard() : undefined;
    if (options.publicNetworkOnly) {
      await networkGuard?.assert(options.url);
      await page.route("**/*", async (route) => {
        try {
          await networkGuard?.assert(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
    }
    const report = await runJourney(page, definition, {
      allowedOrigins: [options.url],
      secrets: journeySecrets(environment),
      timeoutMs: options.timeoutMs,
      ...(signal ? { signal } : {}),
      evidenceDir: join(options.outputDir, "journey-evidence"),
      ...(networkGuard ? { validateNavigationUrl: (url: string) => networkGuard.assert(url) } : {}),
    });
    const reportPath = join(options.outputDir, "journey-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { report, reportPath };
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
}
