import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadBaseline } from "../src/baseline.js";
import { writeReports } from "../src/reporters.js";
import type { ScanOptions, ScanReport } from "../src/types.js";

function options(outputDir: string): ScanOptions {
  return {
    url: "https://example.com/",
    browser: "chromium",
    headed: false,
    timeoutMs: 30_000,
    settleMs: 1_000,
    outputDir,
    format: "json",
    screenshot: "never",
    failOn: "error",
    ignoredStatuses: new Set(),
    ignoredUrlPatterns: [],
  };
}

function report(): ScanReport {
  return {
    tool: "QA Radar",
    schemaVersion: "1.0",
    version: "3.0.1",
    startedAt: "2026-07-21T00:00:00.000Z",
    durationMs: 123,
    scanStatus: "completed",
    targetUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Example Domain",
    mainStatus: 200,
    browser: "chromium",
    passed: false,
    failOn: "error",
    gateScope: "all",
    summary: { warnings: 0, errors: 1, total: 1 },
    issues: [{
      ruleId: "http.document.error",
      fingerprint: "a".repeat(64),
      category: "http",
      severity: "error",
      message: "Falha de exemplo",
      method: "GET",
      status: 500,
      url: "https://example.com/",
      resourceType: "document",
      source: undefined,
      occurrences: 1,
    }],
    screenshotPath: undefined,
  };
}

describe("schema JSON 1.0", () => {
  it("preserva os campos obrigatórios no relatório serializado", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-schema-"));
    try {
      await writeReports(report(), options(outputDir));
      const parsed = JSON.parse(await readFile(join(outputDir, "report.json"), "utf8")) as Record<string, unknown>;
      assert.equal(parsed.schemaVersion, "1.0");
      assert.equal(parsed.tool, "QA Radar");
      assert.equal(parsed.scanStatus, "completed");
      assert.deepEqual(parsed.summary, { warnings: 0, errors: 1, total: 1 });
      const issues = parsed.issues as Array<Record<string, unknown>>;
      assert.equal(issues[0]?.ruleId, "http.document.error");
      assert.match(String(issues[0]?.fingerprint), /^[a-f0-9]{64}$/);
      assert.equal(issues[0]?.occurrences, 1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("rejeita baseline de schema anterior com orientação de migração", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-baseline-schema-"));
    const baselinePath = join(outputDir, "baseline.json");
    try {
      await writeFile(baselinePath, JSON.stringify({
        schemaVersion: "0.9",
        startedAt: "2026-07-21T00:00:00.000Z",
        issues: [],
      }));
      await assert.rejects(loadBaseline(baselinePath), /schema 1\.0/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
