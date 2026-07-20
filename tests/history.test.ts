import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { findHistoryBaseline, listProjectHistory, storeRun } from "../src/history.js";
import type { ScanOptions, ScanReport } from "../src/types.js";

function options(historyDir: string): ScanOptions {
  return {
    url: "https://example.com/",
    browser: "chromium",
    headed: false,
    timeoutMs: 1_000,
    settleMs: 0,
    outputDir: resolve("qa-radar-report"),
    format: "json",
    screenshot: "never",
    failOn: "error",
    ignoredStatuses: new Set(),
    ignoredUrlPatterns: [],
    regressionsOnly: true,
    project: "loja",
    environment: "staging",
    historyDir,
  };
}

function report(startedAt: string, passed: boolean, scanStatus: ScanReport["scanStatus"] = "completed"): ScanReport {
  return {
    tool: "QA Radar",
    schemaVersion: "1.0",
    version: "3.0.0",
    startedAt,
    durationMs: 10,
    scanStatus,
    targetUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Teste",
    mainStatus: 200,
    browser: "chromium",
    project: "loja",
    environment: "staging",
    passed,
    failOn: "error",
    gateScope: "regressions",
    summary: { warnings: 0, errors: passed ? 0 : 1, total: passed ? 0 : 1 },
    issues: [],
    screenshotPath: undefined,
  };
}

describe("scan history", () => {
  it("promove somente execuções aprovadas e preserva o baseline anterior", async () => {
    const historyDir = resolve("qa-radar-results", `.history-test-${process.pid}-${Date.now()}`);
    const scanOptions = options(historyDir);
    try {
      const approved = await storeRun(report("2026-07-19T10:00:00.000Z", true), scanOptions);
      assert.equal(approved?.promoted, true);
      const baselinePath = await findHistoryBaseline(scanOptions);
      assert.ok(baselinePath);
      const firstBaseline = await readFile(baselinePath, "utf8");

      const failed = await storeRun(report("2026-07-19T11:00:00.000Z", false), scanOptions);
      assert.equal(failed?.promoted, false);
      assert.equal(await readFile(baselinePath, "utf8"), firstBaseline);

      const partial = await storeRun(
        report("2026-07-19T11:30:00.000Z", false, "partial"),
        { ...scanOptions, acceptBaseline: true },
      );
      assert.equal(partial?.promoted, false);
      assert.equal(await readFile(baselinePath, "utf8"), firstBaseline);

      const accepted = await storeRun(
        report("2026-07-19T12:00:00.000Z", false),
        { ...scanOptions, acceptBaseline: true },
      );
      assert.equal(accepted?.promoted, true);
      assert.notEqual(await readFile(join(historyDir, "loja", "staging", "baseline.json"), "utf8"), firstBaseline);

      const history = await listProjectHistory(historyDir, "loja", "staging");
      assert.equal(history.runs.length, 4);
      assert.equal(history.runs[0]?.startedAt, "2026-07-19T12:00:00.000Z");
      assert.equal(history.baselineStartedAt, "2026-07-19T12:00:00.000Z");
      assert.ok(history.runs.some((run) => run.scanStatus === "partial"));
    } finally {
      await rm(historyDir, { recursive: true, force: true });
    }
  });
});
