import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deduplicateIssues, passesQualityGate, summarizeIssues } from "../src/quality.js";
import type { Issue } from "../src/types.js";

function issue(severity: Issue["severity"], message = "falha"): Issue {
  return {
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
