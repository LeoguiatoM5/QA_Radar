import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStepDescriptionOverrides,
  createJourneyEvidenceHtml,
  parseJourneyEvidenceMetadata,
  parseStepDescriptionOverrides,
} from "../src/journey-evidence-report.js";

const readFakeAsset = async (relativePath: string): Promise<Buffer> => Buffer.from(`conteudo-de-${relativePath}`);

describe("journey evidence HTML", () => {
  it("valida os metadados informados no modal", () => {
    assert.deepEqual(parseJourneyEvidenceMetadata({ testerName: "QA Ana", testType: "regression" }), {
      testerName: "QA Ana", testType: "regression",
    });
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "", testType: "smoke" }), /responsável/);
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "QA", testType: "security" }), /válido/);
  });

  it("gera relatório escapado com passo, descrição e evidências embutidas em base64", async () => {
    const html = await createJourneyEvidenceHtml({
      schemaVersion: "1.0", name: "Login <script>", status: "passed", startedAt: "2026-07-22T00:00:00Z", durationMs: 1200,
      steps: [
        { index: 0, action: "click", description: "Entrar no sistema", status: "passed", durationMs: 300,
          evidence: { before: "001-click-before.png", after: "001-click-after.png", video: { path: "journey.webm", startMs: 100, endMs: 420 } } },
        { index: 1, action: "assertVisible", description: "Confirmar painel", status: "passed", durationMs: 200,
          evidence: { before: "002-assertVisible-before.png", after: "002-assertVisible-after.png", video: { path: "journey.webm", startMs: 420, endMs: 900 } } },
      ],
    }, { testerName: "QA <Ana>", testType: "functional" }, readFakeAsset, new Date("2026-07-22T12:00:00Z"));
    assert.match(html, /Entrar no sistema/);
    assert.match(html, /QA RADAR/);
    assert.match(html, /href="\/journeys"/);
    assert.match(html, /Voltar para Jornadas/);
    assert.match(html, /QA &lt;Ana&gt;/);
    assert.match(html, /Vídeo da jornada/);
    assert.doesNotMatch(html, /#t=/);
    assert.doesNotMatch(html, /001-click-before\.png/);
    assert.match(html, /src="data:image\/png;base64,/);
    assert.match(html, /src="data:video\/webm;base64,/);
    assert.equal(html.match(/<video/g)?.length, 1);
    assert.doesNotMatch(html, /<script>/);
  });

  it("mostra uma mensagem quando o artefato não está mais disponível", async () => {
    const html = await createJourneyEvidenceHtml({
      schemaVersion: "1.0", name: "Jornada expirada", status: "passed", startedAt: "2026-07-22T00:00:00Z", durationMs: 100,
      steps: [{ index: 0, action: "click", status: "passed", durationMs: 100,
        evidence: { before: "sumiu-before.png", after: "sumiu-after.png" } }],
    }, { testerName: "QA", testType: "smoke" }, async () => { throw new Error("arquivo removido"); });
    assert.match(html, /não estão mais disponíveis/);
  });

  it("valida e aplica descrições de passo informadas pelo usuário", () => {
    assert.equal(parseStepDescriptionOverrides(undefined), undefined);
    assert.deepEqual(parseStepDescriptionOverrides(["Clicar no botão de busca", "", "  "]), ["Clicar no botão de busca", undefined, undefined]);
    assert.throws(() => parseStepDescriptionOverrides("não é lista" as unknown), /lista/);
    assert.throws(() => parseStepDescriptionOverrides([123] as unknown as unknown[]), /texto/);
    assert.throws(() => parseStepDescriptionOverrides(["a".repeat(201)]), /200 caracteres/);
    assert.throws(() => parseStepDescriptionOverrides(new Array(201).fill("x")), /no máximo 200 passos/);

    const report = {
      schemaVersion: "1.0" as const, name: "Jornada", status: "passed" as const, startedAt: "2026-07-22T00:00:00Z", durationMs: 100,
      steps: [
        { index: 0, action: "click" as const, description: "Clicar em await page.getByRole('button')", status: "passed" as const, durationMs: 100 },
        { index: 1, action: "goto" as const, description: "Abrir página", status: "passed" as const, durationMs: 100 },
      ],
    };
    const overridden = applyStepDescriptionOverrides(report, ["Clicar em Estou com sorte", undefined]);
    assert.equal(overridden.steps[0]?.description, "Clicar em Estou com sorte");
    assert.equal(overridden.steps[1]?.description, "Abrir página");
    assert.equal(applyStepDescriptionOverrides(report, undefined), report);
  });
});
