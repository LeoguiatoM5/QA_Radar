import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJourneyEvidenceHtml, parseJourneyEvidenceMetadata } from "../src/journey-evidence-report.js";

describe("journey evidence HTML", () => {
  it("valida os metadados informados no modal", () => {
    assert.deepEqual(parseJourneyEvidenceMetadata({ testerName: "QA Ana", testType: "regression" }), {
      testerName: "QA Ana", testType: "regression",
    });
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "", testType: "smoke" }), /responsável/);
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "QA", testType: "security" }), /válido/);
  });

  it("gera relatório escapado com passo, descrição e evidências", () => {
    const html = createJourneyEvidenceHtml({
      schemaVersion: "1.0", name: "Login <script>", status: "passed", startedAt: "2026-07-22T00:00:00Z", durationMs: 1200,
      steps: [{ index: 0, action: "click", description: "Entrar no sistema", status: "passed", durationMs: 300,
        evidence: { before: "001-click-before.png", after: "001-click-after.png" } }],
    }, { testerName: "QA <Ana>", testType: "functional" }, new Date("2026-07-22T12:00:00Z"));
    assert.match(html, /Entrar no sistema/);
    assert.match(html, /QA RADAR/);
    assert.match(html, /href="\/journeys"/);
    assert.match(html, /Voltar para Jornadas/);
    assert.match(html, /QA &lt;Ana&gt;/);
    assert.match(html, /001-click-before\.png/);
    assert.doesNotMatch(html, /<script>/);
  });
});
