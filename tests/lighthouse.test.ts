import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lighthouseAuditsToIssues } from "../src/scanner-lighthouse.js";

describe("Lighthouse adapter", () => {
  it("explica auditorias específicas com referência e sem alerta genérico de categoria", () => {
    const issues = lighthouseAuditsToIssues([{
      id: "seo", score: 0.82, auditRefs: [
        { id: "meta-description", weight: 1 },
        { id: "largest-contentful-paint", weight: 25 },
        { id: "errors-in-console", weight: 1 },
      ],
    }, {
      id: "performance", score: 0.36, auditRefs: [{ id: "total-blocking-time", weight: 30 }],
    }], {
      "meta-description": {
        id: "meta-description",
        title: "Documento não tem uma meta description",
        description: "As meta descriptions podem ser incluídas nos resultados de pesquisa. [Saiba mais](https://developer.chrome.com/docs/lighthouse/seo/meta-description/).",
        score: 0,
        scoreDisplayMode: "binary",
        details: { items: [{ node: { selector: "html", snippet: "<html>" } }] },
      },
      "largest-contentful-paint": {
        id: "largest-contentful-paint", title: "LCP", description: "Métrica rápida",
        score: 0.5, scoreDisplayMode: "numeric", displayValue: "3 s",
      },
      "errors-in-console": {
        id: "errors-in-console", title: "Console errors", description: "Duplicado pelo scanner",
        score: 0, scoreDisplayMode: "binary",
      },
      "total-blocking-time": {
        id: "total-blocking-time", title: "Total Blocking Time", description: "Long tasks blocked the main thread.",
        score: 0.4, scoreDisplayMode: "numeric", displayValue: "780 ms",
      },
    }, "https://www.cantinhodasqas.com.br/");

    assert.equal(issues.length, 2);
    const meta = issues.find((issue) => issue.ruleId === "lighthouse.meta-description");
    const blocking = issues.find((issue) => issue.ruleId === "lighthouse.total-blocking-time");
    assert.equal(meta?.category, "seo");
    assert.equal(meta?.title, "Documento não possui meta description");
    assert.match(meta?.impact ?? "", /Mecanismos de busca/);
    assert.match(meta?.recommendation ?? "", /<meta name="description">/);
    assert.equal(meta?.referenceUrl, "https://developer.chrome.com/docs/lighthouse/seo/meta-description/");
    assert.equal(meta?.evidence?.selector, "html");
    assert.equal(blocking?.title, "A página permaneceu bloqueada por tarefas longas");
    assert.equal(blocking?.category, "performance");
    assert.match(blocking?.message ?? "", /780 ms/);
    assert.doesNotMatch(JSON.stringify(issues), /SEO: 82\/100|categoria SEO/);
  });
});
