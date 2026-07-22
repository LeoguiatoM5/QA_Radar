import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
} from "playwright";
import { deduplicateIssues, passesQualityGate, summarizeIssues } from "./quality.js";
import { identifyIssue } from "./fingerprint.js";
import type {
  IssueInput,
  PerformanceMetrics,
  LighthouseSummary,
  ScanControl,
  ScanOptions,
  ScanReport,
} from "./types.js";
import { VERSION } from "./version.js";
import { PublicNetworkGuard } from "./security.js";
import { compareWithBaseline, emptyBaseline, loadBaseline } from "./baseline.js";
import { performanceIssues } from "./performance.js";
import { attachListeners, cleanMessage } from "./scanner-events.js";
import { collectPerformanceMetrics, installPerformanceObservers } from "./scanner-performance.js";
import { annotateEvidence, correlateIssues } from "./scanner-evidence.js";
import { inspectStablePage } from "./scanner-dom.js";
import { auditAccessibility } from "./scanner-accessibility.js";
import { auditLighthouse } from "./scanner-lighthouse.js";

function browserType(name: ScanOptions["browser"]): BrowserType {
  return { chromium, firefox, webkit }[name];
}

async function safeTitle(page: Page): Promise<string> {
  try {
    return await page.title();
  } catch {
    return "";
  }
}

export async function scan(options: ScanOptions, control: ScanControl = {}): Promise<ScanReport> {
  const startedAt = new Date();
  const issues: IssueInput[] = [];
  let browser: Browser | undefined;
  let page: Page | undefined;
  let mainStatus: number | undefined;
  let screenshotPath: string | undefined;
  let performance: PerformanceMetrics | undefined;
  let lighthouse: LighthouseSummary | undefined;
  let scanStatus: ScanReport["scanStatus"] = "completed";
  const abort = (): void => {
    void browser?.close();
  };

  try {
    control.signal?.throwIfAborted();
    control.signal?.addEventListener("abort", abort, { once: true });
    control.onStage?.("launching-browser");
    browser = await browserType(options.browser).launch({ headless: !options.headed });
    control.signal?.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: false,
    });
    page = await context.newPage();
    await installPerformanceObservers(page);
    if (options.publicNetworkOnly) {
      const networkGuard = new PublicNetworkGuard();
      await networkGuard.assert(options.url);
      await page.route("**/*", async (route) => {
        try {
          await networkGuard.assert(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
    }
    attachListeners(page, issues, options);

    try {
      control.onStage?.("navigating");
      const response = await page.goto(options.url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      mainStatus = response?.status();
      if (options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    } catch (error) {
      control.signal?.throwIfAborted();
      scanStatus = "partial";
      issues.push({
        ruleId: "navigation.failed",
        category: "navigation",
        severity: "error",
        title: "A página não pôde ser aberta",
        impact: "Nenhum conteúdo confiável pôde ser analisado pelo scanner.",
        recommendation: "Confirme a URL, disponibilidade, certificado e tempo de resposta da aplicação.",
        message: cleanMessage(error instanceof Error ? error.message : String(error)),
        method: "GET",
        status: undefined,
        url: options.url,
        resourceType: "document",
        source: undefined,
        occurrences: 1,
      });
    }

    control.signal?.throwIfAborted();
    control.onStage?.("inspecting");
    const inspection = await inspectStablePage(page, options.url);
    issues.push(...inspection.issues);
    if (inspection.partial) scanStatus = "partial";
    if (scanStatus === "completed") {
      if (options.accessibility) issues.push(...await auditAccessibility(page, options.url));
      performance = await collectPerformanceMetrics(page);
      if (performance) issues.push(...performanceIssues(performance, page.url() || options.url));
      if (options.lighthouse) {
        if (options.publicNetworkOnly) throw new Error("Lighthouse ainda não está habilitado no servidor público.");
        const audit = await auditLighthouse(options.url, options.outputDir, options.timeoutMs);
        lighthouse = audit.summary;
        issues.push(...audit.issues);
      }
    }

    const uniqueIssues = deduplicateIssues(correlateIssues(issues).map(identifyIssue));
    const summary = summarizeIssues(uniqueIssues);
    const comparison = options.baselinePath
      ? compareWithBaseline(uniqueIssues, await loadBaseline(options.baselinePath))
      : options.regressionsOnly ? compareWithBaseline(uniqueIssues, emptyBaseline()) : undefined;
    const gateSummary = options.regressionsOnly && comparison ? comparison.newSummary : summary;
    const passed = passesQualityGate(gateSummary, options.failOn);
    const shouldCapture = scanStatus === "completed" &&
      (options.screenshot === "always" || (options.screenshot === "on-failure" && !passed));

    if (shouldCapture) {
      control.signal?.throwIfAborted();
      control.onStage?.("capturing-evidence");
      await mkdir(options.outputDir, { recursive: true });
      screenshotPath = join(options.outputDir, "screenshot.png");
      try {
        await annotateEvidence(page, uniqueIssues);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        screenshotPath = undefined;
      }
    } else {
      await rm(join(options.outputDir, "screenshot.png"), { force: true });
    }

    return {
      tool: "QA Radar",
      schemaVersion: "1.0",
      version: VERSION,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scanStatus,
      targetUrl: options.url,
      finalUrl: page.url() || options.url,
      title: await safeTitle(page),
      mainStatus,
      browser: options.browser,
      ...(options.project ? { project: options.project } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      passed,
      failOn: options.failOn,
      gateScope: options.regressionsOnly ? "regressions" : "all",
      summary,
      ...(performance ? { performance } : {}),
      ...(lighthouse ? { lighthouse } : {}),
      ...(comparison ? { comparison } : {}),
      issues: uniqueIssues,
      screenshotPath,
    };
  } finally {
    control.signal?.removeEventListener("abort", abort);
    await browser?.close();
  }
}
