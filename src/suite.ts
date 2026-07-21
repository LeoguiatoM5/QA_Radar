import { rm } from "node:fs/promises";
import { join } from "node:path";
import { compareWithBaseline, emptyBaseline, loadBaseline } from "./baseline.js";
import { deduplicateIssues, passesQualityGate, summarizeIssues } from "./quality.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import { discoverSitemapUrls } from "./sitemap.js";
import type { ScanControl, ScanOptions, ScanPageResult, ScanReport } from "./types.js";

function pageDirectory(index: number, rawUrl: string): string {
  const url = new URL(rawUrl);
  const name = `${url.hostname}${url.pathname}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "page";
  return `${String(index + 1).padStart(3, "0")}-${name}`;
}

function pageResult(report: ScanReport, outputDir: string): ScanPageResult {
  return {
    url: report.targetUrl,
    finalUrl: report.finalUrl,
    title: report.title,
    mainStatus: report.mainStatus,
    durationMs: report.durationMs,
    scanStatus: report.scanStatus,
    summary: report.summary,
    performance: report.performance,
    outputDir,
  };
}

export async function scanSitemap(
  options: ScanOptions,
  control: ScanControl = {},
): Promise<ScanReport> {
  const startedAt = new Date();
  control.signal?.throwIfAborted();
  const urls = await discoverSitemapUrls(options, control);
  const reports: ScanReport[] = [];
  const pages: ScanPageResult[] = [];
  control.onProgress?.({
    discoveredPages: urls.length,
    completedPages: 0,
    currentUrl: urls[0],
    percent: 0,
  });

  for (const [index, url] of urls.entries()) {
    control.signal?.throwIfAborted();
    control.onProgress?.({
      discoveredPages: urls.length,
      completedPages: index,
      currentUrl: url,
      percent: Math.floor((index / urls.length) * 100),
    });
    const directoryName = pageDirectory(index, url);
    const outputDir = join(options.outputDir, "pages", directoryName);
    const childOptions: ScanOptions = {
      ...options,
      url,
      outputDir,
      sitemap: false,
      regressionsOnly: false,
    };
    delete childOptions.baselinePath;
    delete childOptions.acceptBaseline;
    const report = await scan(childOptions, control);
    await writeReports(report, childOptions);
    reports.push(report);
    pages.push(pageResult(report, join("pages", directoryName)));
    control.onProgress?.({
      discoveredPages: urls.length,
      completedPages: index + 1,
      currentUrl: urls[index + 1],
      percent: Math.floor(((index + 1) / urls.length) * 100),
    });
  }

  const issues = deduplicateIssues(reports.flatMap((report) => report.issues.map((issue) => ({ ...issue }))));
  const summary = summarizeIssues(issues);
  const comparison = options.baselinePath
    ? compareWithBaseline(issues, await loadBaseline(options.baselinePath))
    : options.regressionsOnly ? compareWithBaseline(issues, emptyBaseline()) : undefined;
  const gateSummary = options.regressionsOnly && comparison ? comparison.newSummary : summary;
  const scanStatus = reports.some((report) => report.scanStatus === "partial") ? "partial" : "completed";
  const first = reports[0];
  if (!first) throw new Error("O sitemap não produziu páginas para análise.");
  await rm(join(options.outputDir, "screenshot.png"), { force: true });

  return {
    tool: "QA Radar",
    schemaVersion: "1.0",
    version: first.version,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    scanStatus,
    targetUrl: options.url,
    finalUrl: options.url,
    title: `Cobertura de ${pages.length} páginas · ${new URL(options.url).hostname}`,
    mainStatus: first.mainStatus,
    browser: options.browser,
    ...(options.project ? { project: options.project } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    passed: scanStatus === "completed" && passesQualityGate(gateSummary, options.failOn),
    failOn: options.failOn,
    gateScope: options.regressionsOnly ? "regressions" : "all",
    summary,
    ...(comparison ? { comparison } : {}),
    pages,
    issues,
    screenshotPath: undefined,
  };
}
