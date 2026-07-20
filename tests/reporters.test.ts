import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGitHubAnnotations, createHtmlReport, createJunitReport, createSarifReport } from "../src/reporters.js";
import type { ScanReport } from "../src/types.js";

describe("HTML reporter", () => {
  it("escapa conteúdo vindo da página", () => {
    const report: ScanReport = {
      tool: "QA Radar",
      schemaVersion: "1.0",
      version: "1.1.0",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 10,
      scanStatus: "completed",
      targetUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "<script>alert(1)</script>",
      mainStatus: 200,
      browser: "chromium",
      passed: true,
      failOn: "error",
      gateScope: "all",
      summary: { warnings: 0, errors: 0, total: 0 },
      issues: [],
      screenshotPath: undefined,
    };
    const html = createHtmlReport(report);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!html.includes("<script>alert(1)</script>"));
  });
});

describe("CI reporters", () => {
  const report: ScanReport = {
    tool: "QA Radar",
    schemaVersion: "1.0",
    version: "3.0.0",
    startedAt: "2026-07-19T00:00:00.000Z",
    durationMs: 1250,
    scanStatus: "completed",
    targetUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    title: "Aplicação",
    mainStatus: 200,
    browser: "chromium",
    passed: false,
    failOn: "error",
    gateScope: "regressions",
    summary: { warnings: 0, errors: 2, total: 2 },
    issues: [
      {
        ruleId: "javascript.uncaught-error",
        fingerprint: "existing-fingerprint",
        baselineStatus: "existing",
        category: "javascript",
        severity: "error",
        title: "Erro <antigo>",
        message: "Falha & conhecida",
        method: undefined,
        status: undefined,
        url: "https://example.com/app.js",
        resourceType: "script",
        source: undefined,
        occurrences: 1,
      },
      {
        ruleId: "http.response.error",
        fingerprint: "new-fingerprint",
        baselineStatus: "new",
        category: "http",
        severity: "error",
        title: "API: indisponível, agora",
        message: "500 Internal\nServer Error",
        method: "GET",
        status: 500,
        url: "https://example.com/api",
        resourceType: "fetch",
        source: undefined,
        occurrences: 1,
      },
    ],
    screenshotPath: undefined,
  };

  it("gera JUnit válido e falha somente para a regressão", () => {
    const junit = createJunitReport(report);
    assert.match(junit, /tests="2" failures="1"/);
    assert.match(junit, /Erro &lt;antigo&gt;/);
    assert.match(junit, /Falha &amp; conhecida/);
    assert.equal((junit.match(/<failure /g) ?? []).length, 1);
  });

  it("gera SARIF 2.1 com regras, fingerprints e baseline state", () => {
    const sarif = JSON.parse(createSarifReport(report)) as {
      version: string;
      runs: Array<{ results: Array<Record<string, unknown>>; tool: { driver: { rules: unknown[] } } }>;
    };
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.tool.driver.rules.length, 2);
    assert.equal(sarif.runs[0]?.results[0]?.baselineState, "unchanged");
    assert.equal(sarif.runs[0]?.results[1]?.baselineState, "new");
    assert.deepEqual(sarif.runs[0]?.results[1]?.partialFingerprints, {
      qaRadarFingerprint: "new-fingerprint",
    });
  });

  it("emite anotação GitHub somente para regressões e escapa comandos", () => {
    const annotations = createGitHubAnnotations(report);
    assert.equal(annotations.length, 1);
    assert.match(annotations[0] ?? "", /^::error title=QA Radar · http\.response\.error::/);
    assert.ok(!(annotations[0] ?? "").includes("javascript.uncaught-error"));
    assert.ok(!(annotations[0] ?? "").includes("\n"));
  });
});
