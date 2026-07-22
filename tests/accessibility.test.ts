import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { axeViolationsToIssues } from "../src/scanner-accessibility.js";

describe("axe-core accessibility adapter", () => {
  it("agrupa elementos afetados pela mesma regra do axe", () => {
    const issues = axeViolationsToIssues([{
      id: "image-alt",
      impact: "critical",
      description: "Ensure images have alternative text",
      help: "Images must have alternative text",
      helpUrl: "https://dequeuniversity.com/rules/axe/image-alt",
      nodes: [
        { html: '<img src="a.png">', target: "img", failureSummary: "Fix the image alt text" },
        { html: '<input type="image">', target: "input[type=image]" },
      ],
    }], "https://example.com/");

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "axe.image-alt");
    assert.equal(issues[0]?.severity, "error");
    assert.equal(issues[0]?.source, "axe-core");
    assert.equal(issues[0]?.occurrences, 2);
    assert.equal(issues[0]?.evidence?.selector, "img");
  });

  it("trata impactos moderados e ausentes como avisos", () => {
    const base = {
      description: "Description",
      help: "Help",
      helpUrl: "https://example.com/help",
      nodes: [{ html: "<main></main>", target: "main" }],
    };
    const issues = axeViolationsToIssues([
      { ...base, id: "moderate", impact: "moderate" },
      { ...base, id: "unknown", impact: null },
    ], "https://example.com/");
    assert.ok(issues.every((issue) => issue.severity === "warning"));
  });
});
