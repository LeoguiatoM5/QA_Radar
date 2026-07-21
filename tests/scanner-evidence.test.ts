import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { correlateIssues } from "../src/scanner-evidence.js";
import type { IssueInput } from "../src/types.js";

function issue(overrides: Partial<IssueInput>): IssueInput {
  return {
    ruleId: "test.issue",
    category: "console",
    severity: "error",
    message: "Falha",
    method: undefined,
    status: undefined,
    url: undefined,
    resourceType: undefined,
    source: undefined,
    occurrences: 1,
    ...overrides,
  };
}

describe("correlação de evidências", () => {
  it("remove sintomas de console e DOM quando já existe falha de transporte", () => {
    const url = "https://example.com/broken.png";
    const transport = issue({ category: "http", url, message: "404" });
    const consoleSymptom = issue({ category: "console", url, message: "Failed to load resource" });
    const domSymptom = issue({ category: "element", url, title: "Imagem quebrada na página" });

    assert.deepEqual(correlateIssues([transport, consoleSymptom, domSymptom]), [transport]);
  });

  it("agrupa bloqueios repetidos do mesmo cookie", () => {
    const first = issue({
      severity: "warning",
      title: "Cookie de terceiro bloqueado pelo navegador",
      message: 'Cookie "session" rejected',
      url: "https://cdn.example.com/a",
    });
    const repeated = issue({
      severity: "warning",
      title: "Cookie de terceiro bloqueado pelo navegador",
      message: 'Cookie "session" rejected',
      url: "https://cdn.example.com/b",
      occurrences: 2,
    });

    const result = correlateIssues([first, repeated]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.occurrences, 3);
    assert.equal(result[0]?.title, "Cookie “session” bloqueado na integração externa");
    assert.match(result[0]?.message ?? "", /cdn\.example\.com\/b/);
  });
});
