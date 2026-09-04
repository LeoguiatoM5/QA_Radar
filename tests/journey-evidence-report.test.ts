import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStepDescriptionOverrides, createJourneyEvidenceHtml, parseJourneyEvidenceMetadata, parseStepDescriptionOverrides } from "../src/journey-evidence-report.js";

const readFakeAsset = async (relativePath: string): Promise<Buffer> => Buffer.from(`conteudo-de-${relativePath}`);

describe("journey evidence HTML", () => {
  it("valida os metadados informados no modal", () => {
    assert.deepEqual(parseJourneyEvidenceMetadata({ testerName: "QA Ana", testType: "regression" }), {
      testerName: "QA Ana",
      testType: "regression",
    });
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "", testType: "smoke" }), /responsável/);
    assert.throws(() => parseJourneyEvidenceMetadata({ testerName: "QA", testType: "security" }), /válido/);
  });

  it("gera relatório escapado com passo, descrição e evidências embutidas em base64", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Login <script>",
        status: "passed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 1200,
        steps: [
          {
            index: 0,
            action: "click",
            description: "Entrar no sistema",
            status: "passed",
            durationMs: 300,
            evidence: { before: "001-click-before.png", after: "001-click-after.png", video: { path: "journey.webm", startMs: 100, endMs: 420 } },
          },
          {
            index: 1,
            action: "assertVisible",
            description: "Confirmar painel",
            status: "passed",
            durationMs: 200,
            evidence: { before: "002-assertVisible-before.png", after: "002-assertVisible-after.png", video: { path: "journey.webm", startMs: 420, endMs: 900 } },
          },
        ],
      },
      { testerName: "QA <Ana>", testType: "functional" },
      readFakeAsset,
      new Date("2026-07-22T12:00:00Z"),
    );
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

  it("não repete a mesma imagem quando só há evidência 'depois' (execução de código)", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Teste Playwright (.spec.ts)",
        status: "passed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 100,
        steps: [
          { index: 0, action: "goto", description: "Abrir página https://example.com", status: "passed", durationMs: 50 },
          { index: 1, action: "click", description: "Clicar em heading", status: "passed", durationMs: 50, evidence: { after: "test-results/qa-radar-teste/final.png" } },
        ],
      },
      { testerName: "QA", testType: "smoke" },
      readFakeAsset,
      new Date("2026-07-22T12:00:00Z"),
    );
    assert.match(html, /Nenhuma imagem foi gerada para este passo\./);
    assert.equal(html.match(/<img/g)?.length, 1);
    assert.doesNotMatch(html, /Antes<\/figcaption>/);
    assert.doesNotMatch(html, /Depois<\/figcaption>/);
  });

  it("mostra uma mensagem quando o artefato não está mais disponível", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Jornada expirada",
        status: "passed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 100,
        steps: [{ index: 0, action: "click", status: "passed", durationMs: 100, evidence: { before: "sumiu-before.png", after: "sumiu-after.png" } }],
      },
      { testerName: "QA", testType: "smoke" },
      async () => {
        throw new Error("arquivo removido");
      },
    );
    assert.match(html, /não estão mais disponíveis/);
  });

  it("renderiza evidência de passo de API com método, URL, status e corpos escapados", async () => {
    const readApiAsset = async (relativePath: string): Promise<Buffer> => {
      assert.equal(relativePath, "test-results/qa-radar-steps/001.json");
      return Buffer.from(
        JSON.stringify({
          method: "POST",
          url: "https://api.exemplo.com/login",
          status: 401,
          requestBody: '{"user":"<script>"}',
          responseBody: '{"error":"unauthorized"}',
        }),
      );
    };
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Teste Playwright (.spec.ts)",
        status: "failed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 100,
        steps: [
          {
            index: 0,
            action: "apiRequest",
            description: "Requisição POST https://api.exemplo.com/login",
            status: "failed",
            durationMs: 100,
            evidence: { api: "test-results/qa-radar-steps/001.json" },
          },
        ],
      },
      { testerName: "QA", testType: "smoke" },
      readApiAsset,
      new Date("2026-07-22T12:00:00Z"),
    );
    assert.match(html, /class="api-evidence"/);
    assert.match(html, /class="api-method">POST</);
    assert.match(html, /https:\/\/api\.exemplo\.com\/login/);
    assert.match(html, /class="api-status error">401/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img/);
  });

  it("mostra uma mensagem quando a evidência de API não está mais disponível", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Jornada expirada",
        status: "failed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 100,
        steps: [{ index: 0, action: "apiRequest", status: "failed", durationMs: 100, evidence: { api: "sumiu.json" } }],
      },
      { testerName: "QA", testType: "smoke" },
      async () => {
        throw new Error("arquivo removido");
      },
    );
    assert.match(html, /dados desta requisição não estão mais disponíveis/);
  });

  // BUG-06 do relatório de 04/09/2026: "Gerado em" usava o fuso do processo
  // Node (UTC em produção), enquanto o resto do app mostra horário local
  // (BRT) renderizado no navegador — um relatório que serve de prova
  // "datado" 3h à frente do resto da conta.
  it("mostra 'Gerado em' no horário de Brasília, não no fuso do servidor", async () => {
    const html = await createJourneyEvidenceHtml(
      { schemaVersion: "1.0", name: "Jornada", status: "passed", startedAt: "2026-07-22T00:00:00Z", durationMs: 100, steps: [] },
      { testerName: "QA", testType: "smoke" },
      readFakeAsset,
      // 12:00 UTC = 09:00 em America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
      new Date("2026-07-22T12:00:00Z"),
    );
    assert.match(html, /09:00/);
    assert.doesNotMatch(html, /\b12:00\b/);
  });

  // BUG-05 do relatório de 04/09/2026: o passo reprovado só mostrava uma
  // mensagem genérica por tipo de ação, descartando o `error.message` real do
  // Playwright — exatamente a informação que explica por que o passo falhou.
  it("mostra a mensagem de erro real do passo reprovado, não só uma genérica", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Jornada reprovada",
        status: "failed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 100,
        steps: [
          {
            index: 0,
            action: "assertText",
            description: "Confirmar título",
            status: "failed",
            durationMs: 50,
            error: 'Expected substring: "Nao Existe"\nReceived string:   "Example Domain"',
          },
        ],
      },
      { testerName: "QA", testType: "smoke" },
      readFakeAsset,
      new Date("2026-07-22T12:00:00Z"),
    );
    assert.match(html, /Expected substring: &quot;Nao Existe&quot;/);
    assert.match(html, /Received string:\s*&quot;Example Domain&quot;/);
    // A mensagem amigável continua, como orientação de leitura — só não é mais a única coisa mostrada.
    assert.match(html, /texto esperado não foi encontrado/);
  });

  // BUG-04 do relatório de 04/09/2026: os passos sintéticos do Modo Código
  // mostravam a duração total dividida igualmente entre eles, uma média
  // inventada apresentada como se fosse medição real.
  it("omite a duração do passo quando ela não foi medida de verdade, em vez de inventar uma média", async () => {
    const html = await createJourneyEvidenceHtml(
      {
        schemaVersion: "1.0",
        name: "Teste Playwright (.spec.ts)",
        status: "passed",
        startedAt: "2026-07-22T00:00:00Z",
        durationMs: 37_086,
        steps: [
          { index: 0, action: "goto", description: "Abrir página", status: "passed" },
          { index: 1, action: "assertText", description: "Confirmar texto", status: "passed" },
        ],
      },
      { testerName: "QA", testType: "smoke" },
      readFakeAsset,
      new Date("2026-07-22T12:00:00Z"),
    );
    assert.doesNotMatch(html, /undefined ms/);
    assert.doesNotMatch(html, /NaN ms/);
    assert.doesNotMatch(html, / ms<\/p>/);
    assert.match(html, /Ação: <code>goto<\/code><\/p>/);
  });

  it("valida e aplica descrições de passo informadas pelo usuário", () => {
    assert.equal(parseStepDescriptionOverrides(undefined), undefined);
    assert.deepEqual(parseStepDescriptionOverrides(["Clicar no botão de busca", "", "  "]), ["Clicar no botão de busca", undefined, undefined]);
    assert.throws(() => parseStepDescriptionOverrides("não é lista" as unknown), /lista/);
    assert.throws(() => parseStepDescriptionOverrides([123] as unknown as unknown[]), /texto/);
    assert.throws(() => parseStepDescriptionOverrides(["a".repeat(201)]), /200 caracteres/);
    assert.throws(() => parseStepDescriptionOverrides(new Array(201).fill("x")), /no máximo 200 passos/);

    const report = {
      schemaVersion: "1.0" as const,
      name: "Jornada",
      status: "passed" as const,
      startedAt: "2026-07-22T00:00:00Z",
      durationMs: 100,
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
