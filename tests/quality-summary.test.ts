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
import { aggregateQualitySummary, computeQualitySummary, MAX_QUALITY_APPLICATIONS, MAX_QUALITY_ENTRIES } from "../src/quality-summary.js";
import type { ExecutionEntry } from "../src/execution-history.js";
import type { PersistedScanJob } from "../src/scan-job-repository.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";
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

describe("aggregateQualitySummary", () => {
  it("soma passados, falhos e em execução, e a taxa ignora o que ainda não terminou", () => {
    const entries = [entry({ outcome: "passed" }), entry({ outcome: "passed" }), entry({ outcome: "failed" }), entry({ outcome: "running" })];
    const summary = aggregateQualitySummary(entries, undefined, undefined);
    assert.deepEqual(summary.current, { total: 4, passed: 2, failed: 1, running: 1, passRate: 67 });
  });

  it("taxa fica indefinida sem nenhuma execução terminada", () => {
    const summary = aggregateQualitySummary([entry({ outcome: "running" })], undefined, undefined);
    assert.equal(summary.current.passRate, undefined);
  });

  it("byKind sempre traz as três origens, mesmo zeradas", () => {
    const summary = aggregateQualitySummary([entry({ kind: "scan" })], undefined, undefined);
    assert.deepEqual(Object.keys(summary.byKind).sort(), ["api", "journey", "scan"]);
    assert.equal(summary.byKind.scan.total, 1);
    assert.equal(summary.byKind.journey.total, 0);
    assert.equal(summary.byKind.api.total, 0);
  });

  it("agrupa por aplicação, com um balde 'sem aplicação' e ordenado pela maior contagem", () => {
    const entries = [
      entry({ applicationId: "app-1", applicationName: "Loja Web" }),
      entry({ applicationId: "app-1", applicationName: "Loja Web" }),
      entry({ applicationId: "app-2", applicationName: "Portal Admin" }),
      entry({ applicationId: undefined, applicationName: undefined }),
    ];
    const [first, second, third] = aggregateQualitySummary(entries, undefined, undefined).byApplication;
    assert.equal(first?.applicationId, "app-1");
    assert.equal(first?.total, 2);
    assert.equal(second?.applicationId, "app-2");
    assert.equal(third?.applicationId, undefined);
    assert.equal(third?.applicationName, undefined);
  });

  it("corta em MAX_QUALITY_APPLICATIONS aplicações", () => {
    const entries = Array.from({ length: MAX_QUALITY_APPLICATIONS + 5 }, (_, index) => entry({ applicationId: `app-${index}`, applicationName: `App ${index}` }));
    assert.equal(aggregateQualitySummary(entries, undefined, undefined).byApplication.length, MAX_QUALITY_APPLICATIONS);
  });

  it("a tendência diária preenche os dias sem execução com zero", () => {
    const since = ago(2 * DAY);
    const entries = [entry({ createdAt: ago(2 * DAY), outcome: "passed" }), entry({ createdAt: ago(0), outcome: "failed" })];
    const daily = aggregateQualitySummary(entries, since, undefined).daily;
    assert.equal(daily.length, 3);
    assert.equal(daily[0]?.total, 1);
    assert.equal(daily[0]?.passed, 1);
    assert.equal(daily[1]?.total, 0);
    assert.equal(daily[2]?.total, 1);
    assert.equal(daily[2]?.failed, 1);
  });

  it("sem período não há tendência nem comparação com o anterior", () => {
    const summary = aggregateQualitySummary([entry()], undefined, undefined);
    assert.deepEqual(summary.daily, []);
    assert.equal(summary.previous, undefined);
  });

  it("compara com o período anterior de igual duração, só quando os dois limites existem", () => {
    // Período atual: últimas 24h. Anterior: as 24h antes disso.
    const currentSince = ago(DAY);
    const previousSince = ago(2 * DAY);
    const entries = [
      entry({ createdAt: ago(10 * MINUTE), outcome: "passed" }), // dentro do atual
      entry({ createdAt: ago(10 * MINUTE), outcome: "passed" }), // dentro do atual
      entry({ createdAt: ago(DAY + 10 * MINUTE), outcome: "failed" }), // dentro do anterior
    ];
    const summary = aggregateQualitySummary(entries, currentSince, previousSince);
    assert.deepEqual(summary.current, { total: 2, passed: 2, failed: 0, running: 0, passRate: 100 });
    assert.deepEqual(summary.previous, { total: 1, passed: 0, failed: 1, running: 0, passRate: 0 });
  });
});

interface Fixture {
  sources: Parameters<typeof computeQualitySummary>[0];
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

describe("computeQualitySummary", () => {
  it("pagina além de uma página de histórico sem perder nem duplicar execuções", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    const total = 230; // mais que MAX_HISTORY_PAGE (100), menos que MAX_QUALITY_ENTRIES
    for (let index = 0; index < total; index += 1) {
      await scans.insert(scanJob({ ownerId: owner, createdAt: ago(index * MINUTE) }));
    }
    const summary = await computeQualitySummary(sources, owner, {});
    assert.equal(summary.current.total, total);
    assert.equal(summary.truncated, false);
  });

  it("marca truncated quando o período tem mais que MAX_QUALITY_ENTRIES execuções", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    const total = MAX_QUALITY_ENTRIES + 40;
    for (let index = 0; index < total; index += 1) {
      await scans.insert(scanJob({ ownerId: owner, createdAt: ago(index * 1000) }));
    }
    const summary = await computeQualitySummary(sources, owner, {});
    assert.equal(summary.truncated, true);
    assert.ok(summary.current.total >= MAX_QUALITY_ENTRIES);
  });

  it("filtra por aplicação", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner, applicationId: "app-1", createdAt: ago(0) }));
    await scans.insert(scanJob({ ownerId: owner, applicationId: "app-2", createdAt: ago(0) }));
    const summary = await computeQualitySummary(sources, owner, { applicationId: "app-1" });
    assert.equal(summary.current.total, 1);
  });
});

describe("GET /api/v1/quality/summary", () => {
  async function startServer() {
    const scans = new InMemoryScanJobRepository();
    const server = createQaRadarServer({
      allowPrivateTargets: true,
      concurrency: 0,
      sessionSecret: SECRET,
      identity: new InMemoryIdentityStore(),
      applications: new InMemoryApplicationRepository(),
      codeExecutions: new InMemoryCodeExecutionRepository(),
      apiCollections: new InMemoryApiCollectionRepository(),
      scanJobs: createScanJobPersistence({ repository: scans, retentionMs: 60 * MINUTE, onError: () => {} }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, scans, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
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
      assert.equal((await fetch(`${baseUrl}/api/v1/quality/summary`)).status, 401);
    } finally {
      await close();
    }
  });

  it("recusa data inválida com 400 e método diferente de GET com 405", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, `dono-${randomUUID()}@exemplo.com`);
      assert.equal((await fetch(`${baseUrl}/api/v1/quality/summary?de=nao-e-data`, { headers: { cookie } })).status, 400);
      assert.equal((await fetch(`${baseUrl}/api/v1/quality/summary`, { method: "DELETE", headers: { cookie } })).status, 405);
    } finally {
      await close();
    }
  });

  it("aplicação de outra conta responde 404", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const dela = await signUp(baseUrl, `dela-${randomUUID()}@exemplo.com`);
      const criada = await fetch(`${baseUrl}/api/v1/applications`, {
        method: "POST",
        headers: { cookie: dela, "content-type": "application/json" },
        body: JSON.stringify({ name: "Loja Web", baseUrl: "https://loja.exemplo.com" }),
      });
      const application = ((await criada.json()) as { application: { id: string } }).application.id;

      const minha = await signUp(baseUrl, `eu-${randomUUID()}@exemplo.com`);
      assert.equal((await fetch(`${baseUrl}/api/v1/quality/summary?aplicacao=${application}`, { headers: { cookie: minha } })).status, 404);
    } finally {
      await close();
    }
  });

  it("soma a execução real que rodou pelo caminho normal", async () => {
    const { baseUrl, close } = await startServer();
    const alvo = (await import("node:http")).createServer((_request, resposta) => {
      resposta.writeHead(200, { "content-type": "text/plain" });
      resposta.end("ok");
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

      const response = await fetch(`${baseUrl}/api/v1/quality/summary`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { current: { total: number }; byKind: { api: { total: number } }; byApplication: unknown[]; daily: unknown[]; truncated: boolean };
      assert.equal(body.current.total, 1);
      assert.equal(body.byKind.api.total, 1);
      assert.equal(body.byApplication.length, 1);
      assert.equal(body.truncated, false);
    } finally {
      await close();
      await new Promise<void>((resolve) => alvo.close(() => resolve()));
    }
  });
});
