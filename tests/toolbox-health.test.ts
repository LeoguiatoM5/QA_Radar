import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateHealth, formatEnvironmentReport, summarizeHealth, type HealthCheckOutcome } from "../src/toolbox/health.js";

const expectation = { expectedStatus: 200, maxResponseTimeMs: 1000 };

function outcome(name: string, state: HealthCheckOutcome["state"], status: number | undefined, durationMs: number | undefined): HealthCheckOutcome {
  return { name, url: `https://${name.toLowerCase()}.example.com/health`, status, statusText: "OK", contentType: "application/json", durationMs, state, reason: undefined };
}

describe("toolbox · api health · avaliação", () => {
  it("aprova quando o status bate e a resposta chega no prazo", () => {
    assert.deepEqual(evaluateHealth({ status: 200, durationMs: 184 }, expectation), { state: "healthy", reason: undefined });
  });

  it("marca como degradado o serviço que responde certo, porém devagar", () => {
    const result = evaluateHealth({ status: 200, durationMs: 2148 }, expectation);

    assert.equal(result.state, "degraded");
    assert.match(result.reason ?? "", /2148 ms, acima do limite de 1000 ms/);
  });

  it("marca como falho o status inesperado", () => {
    for (const status of [404, 500, 503]) {
      const result = evaluateHealth({ status, durationMs: 40 }, expectation);
      assert.equal(result.state, "failed");
      assert.match(result.reason ?? "", new RegExp(`recebido ${status}`));
    }
  });

  it("não chama de degradado um erro que voltou rápido", () => {
    // Um 500 em 20 ms é falha, não "degradação por lentidão": a ordem das
    // regras é o que garante isso.
    assert.equal(evaluateHealth({ status: 500, durationMs: 20 }, expectation).state, "failed");
  });

  it("respeita um status esperado diferente de 200", () => {
    assert.equal(evaluateHealth({ status: 204, durationMs: 10 }, { expectedStatus: 204, maxResponseTimeMs: 1000 }).state, "healthy");
    assert.equal(evaluateHealth({ status: 200, durationMs: 10 }, { expectedStatus: 204, maxResponseTimeMs: 1000 }).state, "failed");
  });

  it("aceita a resposta que chega exatamente no limite", () => {
    assert.equal(evaluateHealth({ status: 200, durationMs: 1000 }, expectation).state, "healthy");
    assert.equal(evaluateHealth({ status: 200, durationMs: 1001 }, expectation).state, "degraded");
  });
});

describe("toolbox · api health · resumo do ambiente", () => {
  const outcomes = [
    outcome("Frontend", "healthy", 200, 231),
    outcome("Auth", "healthy", 200, 118),
    outcome("Users", "healthy", 200, 320),
    outcome("Orders", "failed", 500, 841),
    outcome("Payments", "degraded", 200, 2148),
  ];

  it("faz o ambiente valer o pior dos seus serviços", () => {
    assert.equal(summarizeHealth(outcomes).state, "failed");
    assert.equal(summarizeHealth(outcomes.slice(0, 3).concat(outcomes[4] as HealthCheckOutcome)).state, "degraded");
    assert.equal(summarizeHealth(outcomes.slice(0, 3)).state, "healthy");
  });

  it("conta cada categoria", () => {
    assert.deepEqual(summarizeHealth(outcomes), { state: "failed", checked: 5, healthy: 3, degraded: 1, failed: 1 });
  });

  it("gera um relatório em texto puro, colável em qualquer ferramenta", () => {
    const report = formatEnvironmentReport(outcomes);

    assert.match(report, /^Environment Status: FAILED/);
    assert.match(report, /Frontend\s+200\s+231ms\s+HEALTHY/);
    assert.match(report, /Payments\s+200\s+2148ms\s+DEGRADED/);
    assert.match(report, /5 services checked/);
    assert.match(report, /3 healthy/);
    assert.match(report, /1 degraded/);
    assert.match(report, /1 failed/);
    // Sem Markdown: é o que sobrevive igual no Slack, no Teams e no Jira.
    assert.equal(report.includes("|"), false);
    assert.equal(report.includes("**"), false);
  });

  it("mostra traço no lugar do que não foi medido", () => {
    const report = formatEnvironmentReport([outcome("Offline", "failed", undefined, undefined)]);

    assert.match(report, /Offline\s+---\s+---\s+FAILED/);
  });

  it("resume ambiente vazio como saudável e sem serviços", () => {
    assert.deepEqual(summarizeHealth([]), { state: "healthy", checked: 0, healthy: 0, degraded: 0, failed: 0 });
  });
});
