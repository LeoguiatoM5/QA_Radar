import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { InMemoryApplicationRepository } from "../src/application-repository.js";
import { InMemoryCodeExecutionRepository } from "../src/code-execution-repository.js";
import { InMemoryApiCollectionRepository } from "../src/api-collection-repository.js";
import { InMemoryScanJobRepository } from "../src/scan-job-repository.js";
import { createScanJobPersistence } from "../src/scan-job-persistence.js";
import { aggregateQualitySummary, MAX_QUALITY_ENTRIES } from "../src/quality-summary.js";
import { ALERT_WINDOW_DAYS, computeAlerts, evaluateRegression, MAX_ALERT_FAILURES, REGRESSION_MIN_SAMPLE, REGRESSION_THRESHOLD_POINTS } from "../src/alerts.js";
import type { ExecutionEntry } from "../src/execution-history.js";
import type { PersistedScanJob } from "../src/scan-job-repository.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function entry(overrides: Partial<ExecutionEntry> = {}): ExecutionEntry {
  return {
    id: randomUUID(),
    kind: "scan",
    createdAt: ago(0),
    title: "loja.exemplo.com",
    detail: "0 erro(s)",
    outcome: "passed",
    durationMs: 1000,
    applicationId: undefined,
    applicationName: undefined,
    href: "/scanner",
    ...overrides,
  };
}

function scanJob(overrides: Partial<PersistedScanJob> = {}): PersistedScanJob {
  return {
    id: randomUUID(),
    status: "completed",
    createdAt: ago(0),
    updatedAt: ago(0),
    expiresAt: new Date(Date.now() + 60 * MINUTE).toISOString(),
    options: { url: "https://loja.exemplo.com/checkout" } as PersistedScanJob["options"],
    progress: {} as PersistedScanJob["progress"],
    report: { targetUrl: "https://loja.exemplo.com/checkout", passed: true, durationMs: 2500, summary: { errors: 0, warnings: 0 } } as PersistedScanJob["report"],
    error: undefined,
    cancelRequested: false,
    accessTokenHash: "a".repeat(64),
    ownerId: undefined,
    applicationId: undefined,
    ...overrides,
  };
}

/** Monta entradas passadas/falhas para bater exatamente na taxa de sucesso pedida. */
function entriesWithRate(total: number, passRate: number, createdAt: string): ExecutionEntry[] {
  const passed = Math.round((passRate / 100) * total);
  return Array.from({ length: total }, (_, index) => entry({ createdAt, outcome: index < passed ? "passed" : "failed" }));
}

describe("evaluateRegression", () => {
  it("sem período anterior não há alerta", () => {
    const summary = aggregateQualitySummary([entry()], undefined, undefined);
    assert.equal(evaluateRegression(summary), undefined);
  });

  it("queda abaixo do limite não vira alerta", () => {
    const currentSince = ago(DAY);
    const previousSince = ago(2 * DAY);
    // 20 elementos dos dois lados para caírem em número inteiro: 17/20 = 85%,
    // 19/20 = 95% — dropou 10pp, abaixo do limite de 15pp.
    const entries = [...entriesWithRate(20, 85, ago(10 * MINUTE)), ...entriesWithRate(20, 95, ago(DAY + 10 * MINUTE))];
    const summary = aggregateQualitySummary(entries, currentSince, previousSince);
    assert.equal(evaluateRegression(summary), undefined);
  });

  it("amostra anterior pequena demais não vira alerta, mesmo com queda grande", () => {
    const currentSince = ago(DAY);
    const previousSince = ago(2 * DAY);
    const entries = [...entriesWithRate(10, 100, ago(10 * MINUTE)), ...entriesWithRate(REGRESSION_MIN_SAMPLE - 1, 0, ago(DAY + 10 * MINUTE))];
    const summary = aggregateQualitySummary(entries, currentSince, previousSince);
    assert.equal(evaluateRegression(summary), undefined);
  });

  it("queda igual ou maior que o limite, com amostra suficiente, vira alerta", () => {
    const currentSince = ago(DAY);
    const previousSince = ago(2 * DAY);
    // 20 elementos nos dois lados: a taxa cai em número inteiro exato, sem
    // arredondamento — 17/20 = 85%, 20/20 = 100%. O período anterior é quem
    // tinha a taxa mais alta; o atual é quem caiu.
    const entries = [...entriesWithRate(20, 100 - REGRESSION_THRESHOLD_POINTS, ago(10 * MINUTE)), ...entriesWithRate(20, 100, ago(DAY + 10 * MINUTE))];
    const summary = aggregateQualitySummary(entries, currentSince, previousSince);
    const alert = evaluateRegression(summary);
    assert.equal(alert?.currentPassRate, 100 - REGRESSION_THRESHOLD_POINTS);
    assert.equal(alert?.previousPassRate, 100);
    assert.equal(alert?.droppedPoints, REGRESSION_THRESHOLD_POINTS);
  });
});

interface Fixture {
  sources: Parameters<typeof computeAlerts>[0];
  scans: InMemoryScanJobRepository;
}

function fixture(): Fixture {
  const scans = new InMemoryScanJobRepository();
  return {
    scans,
    sources: {
      scanJobs: createScanJobPersistence({ repository: scans, retentionMs: 60 * MINUTE, onError: () => {} }),
      codeExecutions: new InMemoryCodeExecutionRepository(),
      apiCollections: new InMemoryApiCollectionRepository(),
      applications: new InMemoryApplicationRepository(),
    },
  };
}

describe("computeAlerts", () => {
  it("lista só falhas, da mais recente para a mais antiga, cortando em MAX_ALERT_FAILURES", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    for (let index = 0; index < MAX_ALERT_FAILURES + 5; index += 1) {
      await scans.insert(
        scanJob({
          ownerId: owner,
          createdAt: ago(index * MINUTE),
          report: { targetUrl: "https://x", passed: false, durationMs: 1, summary: { errors: 1, warnings: 0 } } as PersistedScanJob["report"],
        }),
      );
    }
    await scans.insert(scanJob({ ownerId: owner, createdAt: ago(0) })); // passou, não deve aparecer

    const summary = await computeAlerts(sources, owner);
    assert.equal(summary.failures.length, MAX_ALERT_FAILURES);
    assert.ok(summary.failures.every((failure) => failure.outcome === "failed"));
    const timestamps = summary.failures.map((failure) => failure.createdAt);
    assert.deepEqual(
      [...timestamps].sort((a, b) => b.localeCompare(a)),
      timestamps,
    );
  });

  it("marca truncated quando a janela tem mais que MAX_QUALITY_ENTRIES execuções", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    const total = MAX_QUALITY_ENTRIES + 40;
    for (let index = 0; index < total; index += 1) {
      await scans.insert(scanJob({ ownerId: owner, createdAt: ago(index * 1000) }));
    }
    const summary = await computeAlerts(sources, owner);
    assert.equal(summary.truncated, true);
  });

  it("sem falha e sem regressão, devolve os dois vazios", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner, createdAt: ago(0) }));
    const summary = await computeAlerts(sources, owner);
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.regression, undefined);
  });
});

describe("GET /api/v1/alerts", () => {
  async function startServer() {
    const scans = new InMemoryScanJobRepository();
    const server = createQaRadarServer({
      allowPrivateTargets: true,
      concurrency: 0,
      sessionSecret: "segredo-de-sessao-com-32-bytes-x",
      identity: new InMemoryIdentityStore(),
      applications: new InMemoryApplicationRepository(),
      codeExecutions: new InMemoryCodeExecutionRepository(),
      apiCollections: new InMemoryApiCollectionRepository(),
      scanJobs: createScanJobPersistence({ repository: scans, retentionMs: 60 * MINUTE, onError: () => {} }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  async function signUp(baseUrl: string, email: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "uma-senha-bem-comprida" }),
    });
    assert.equal(response.status, 201);
    return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  it("exige conta", async () => {
    const { baseUrl, close } = await startServer();
    try {
      assert.equal((await fetch(`${baseUrl}/api/v1/alerts`)).status, 401);
    } finally {
      await close();
    }
  });

  it("recusa método diferente de GET com 405", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, `dono-${randomUUID()}@exemplo.com`);
      assert.equal((await fetch(`${baseUrl}/api/v1/alerts`, { method: "DELETE", headers: { cookie } })).status, 405);
    } finally {
      await close();
    }
  });

  it("uma falha real que rodou pelo caminho normal aparece em failures", async () => {
    const { baseUrl, close } = await startServer();
    const alvo = (await import("node:http")).createServer((_request, resposta) => {
      resposta.writeHead(500, { "content-type": "text/plain" });
      resposta.end("erro");
    });
    await new Promise<void>((resolve) => alvo.listen(0, "127.0.0.1", resolve));
    try {
      const cookie = await signUp(baseUrl, `dono-${randomUUID()}@exemplo.com`);
      const criada = await fetch(`${baseUrl}/api/v1/applications`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Loja Web", baseUrl: "https://loja.exemplo.com" }),
      });
      const application = ((await criada.json()) as { application: { id: string } }).application.id;

      const alvoPort = (alvo.address() as AddressInfo).port;
      await fetch(`${baseUrl}/api/v1/http-request`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", url: `http://127.0.0.1:${alvoPort}/`, applicationId: application }),
      });

      const response = await fetch(`${baseUrl}/api/v1/alerts`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { failures: Array<{ outcome: string }>; windowDays: number; truncated: boolean };
      assert.equal(body.failures.length, 1);
      assert.equal(body.failures[0]?.outcome, "failed");
      assert.equal(body.windowDays, ALERT_WINDOW_DAYS);
      assert.equal(body.truncated, false);
    } finally {
      await close();
      await new Promise<void>((resolve) => alvo.close(() => resolve()));
    }
  });
});
