import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHtmlReport } from "../src/reporters.js";
import type { ScanReport } from "../src/types.js";

describe("HTML reporter", () => {
  it("escapa conteúdo vindo da página", () => {
    const report: ScanReport = {
      tool: "QA Radar",
      version: "1.1.0",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 10,
      targetUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "<script>alert(1)</script>",
      mainStatus: 200,
      browser: "chromium",
      passed: true,
      failOn: "error",
      summary: { warnings: 0, errors: 0, total: 0 },
      issues: [],
      screenshotPath: undefined,
    };
    const html = createHtmlReport(report);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!html.includes("<script>alert(1)</script>"));
  });
});
