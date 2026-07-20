import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deduplicateIssues, passesQualityGate, summarizeIssues } from "../src/quality.js";
import { identifyIssue } from "../src/fingerprint.js";
import { compareWithBaseline } from "../src/baseline.js";
import { performanceIssues } from "../src/performance.js";
import type { Issue } from "../src/types.js";

function issue(severity: Issue["severity"], message = "falha"): Issue {
  return {
    ruleId: "http.response.error",
    fingerprint: "test-" + severity + "-" + message,
    category: "http",
    severity,
    message,
    method: "GET",
    status: severity === "error" ? 500 : 404,
    url: "https://example.com/api",
    resourceType: "fetch",
    source: undefined,
    occurrences: 1,
  };
}

describe("quality gate", () => {
  it("contabiliza ocorrências e respeita o nível configurado", () => {
    const summary = summarizeIssues([{ ...issue("warning"), occurrences: 2 }, issue("error")]);
    assert.deepEqual(summary, { warnings: 1, errors: 1, total: 2 });
    assert.equal(passesQualityGate(summary, "none"), true);
    assert.equal(passesQualityGate(summary, "warning"), false);
    assert.equal(passesQualityGate(summary, "error"), false);
  });

  it("não reprova por avisos quando fail-on é error", () => {
    assert.equal(passesQualityGate(summarizeIssues([issue("warning")]), "error"), true);
  });

  it("deduplica problemas idênticos sem perder a contagem", () => {
    const result = deduplicateIssues([issue("error"), issue("error"), issue("warning", "outro")]);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.occurrences, 2);
  });
});

describe("issue fingerprint", () => {
  it("permanece estável para IDs, timestamps e ordem dos parâmetros", () => {
    const base = {
      ...issue("error"),
      ruleId: "javascript.uncaught-error",
      url: "https://example.com/app?b=2&a=1#section",
      message: "Falha 123 em 2026-07-19T12:30:00.000Z para 550e8400-e29b-41d4-a716-446655440000",
    };
    const first = identifyIssue(base);
    const second = identifyIssue({
      ...base,
      url: "https://example.com/app?a=1&b=2",
      message: "Falha 999 em 2026-07-20T10:00:00.000Z para 123e4567-e89b-12d3-a456-426614174000",
    });
    assert.equal(first.fingerprint, second.fingerprint);
  });

  it("distingue regras e recursos diferentes", () => {
    const base = issue("error");
    const first = identifyIssue(base);
    const second = identifyIssue({ ...base, ruleId: "network.request.failed" });
    assert.notEqual(first.fingerprint, second.fingerprint);
  });
});

describe("baseline comparison", () => {
  it("classifica problemas novos, existentes e resolvidos", () => {
    const existing = issue("error", "existente");
    const currentNew = issue("warning", "novo");
    const resolved = issue("error", "resolvido");
    const current = [existing, currentNew];
    const comparison = compareWithBaseline(current, {
      schemaVersion: "1.0",
      startedAt: "2026-07-18T00:00:00.000Z",
      issues: [existing, resolved],
    });

    assert.equal(existing.baselineStatus, "existing");
    assert.equal(currentNew.baselineStatus, "new");
    assert.equal(comparison.newIssues, 1);
    assert.equal(comparison.existingIssues, 1);
    assert.deepEqual(comparison.newSummary, { warnings: 1, errors: 0, total: 1 });
    assert.deepEqual(comparison.resolvedIssues, [resolved]);
  });
});

describe("performance rules", () => {
  it("não alerta métricas dentro dos limites recomendados", () => {
    const issues = performanceIssues({
      ttfbMs: 800,
      fcpMs: 1_000,
      lcpMs: 2_500,
      cls: 0.1,
      domContentLoadedMs: 1_200,
      loadMs: 1_500,
    }, "https://example.com/");
    assert.deepEqual(issues, []);
  });

  it("cria regras estáveis para TTFB, LCP e CLS fora do recomendado", () => {
    const issues = performanceIssues({
      ttfbMs: 801,
      fcpMs: 1_000,
      lcpMs: 2_501,
      cls: 0.101,
      domContentLoadedMs: 2_000,
      loadMs: 3_000,
    }, "https://example.com/");
    assert.deepEqual(issues.map((item) => item.ruleId), [
      "performance.ttfb.slow",
      "performance.lcp.slow",
      "performance.cls.unstable",
    ]);
    assert.ok(issues.every((item) => item.severity === "warning"));
  });
});
