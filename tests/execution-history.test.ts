import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { InMemoryApplicationRepository } from "../src/application-repository.js";
import { InMemoryCodeExecutionRepository } from "../src/code-execution-repository.js";
import { InMemoryApiCollectionRepository } from "../src/api-collection-repository.js";
import { InMemoryScanJobRepository } from "../src/scan-job-repository.js";
import { createScanJobPersistence } from "../src/scan-job-persistence.js";
import { readExecutionHistory, MAX_HISTORY_PAGE } from "../src/execution-history.js";
import { historyClauses, matchesHistory } from "../src/history-query.js";
import type { PersistedScanJob } from "../src/scan-job-repository.js";
import type { PersistedCodeExecution } from "../src/code-execution-repository.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";
const MINUTE = 60_000;

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

function scanJob(overrides: Partial<PersistedScanJob> = {}): PersistedScanJob {
  return {
    id: randomUUID(),
    status: "completed",
    createdAt: ago(10),
    updatedAt: ago(10),
    expiresAt: new Date(Date.now() + 60 * MINUTE).toISOString(),
    options: { url: "https://loja.exemplo.com/checkout" } as PersistedScanJob["options"],
    progress: {} as PersistedScanJob["progress"],
    report: { targetUrl: "https://loja.exemplo.com/checkout", passed: true, durationMs: 2500, summary: { errors: 0, warnings: 2 } } as PersistedScanJob["report"],
    error: undefined,
    cancelRequested: false,
    accessTokenHash: "a".repeat(64),
    ownerId: undefined,
    applicationId: undefined,
    environment: undefined,
    ...overrides,
  };
}

function codeExecution(overrides: Partial<PersistedCodeExecution> = {}): PersistedCodeExecution {
  return {
    id: randomUUID(),
    status: "passed",
    createdAt: ago(20),
    expiresAt: new Date(Date.now() + 60 * MINUTE).toISOString(),
    accessTokenHash: "b".repeat(64),
    report: { stats: { duration: 4321, expected: 3, unexpected: 0 }, suites: [{ specs: [{ title: "checkout com cartão" }] }] },
    failureDetails: undefined,
    ownerId: undefined,
    applicationId: undefined,
    environment: undefined,
    ...overrides,
  };
}

interface Fixture {
  sources: Parameters<typeof readExecutionHistory>[0];
  scans: InMemoryScanJobRepository;
  journeys: InMemoryCodeExecutionRepository;
  api: InMemoryApiCollectionRepository;
  applications: InMemoryApplicationRepository;
}

function fixture(): Fixture {
  const scans = new InMemoryScanJobRepository();
  const journeys = new InMemoryCodeExecutionRepository();
  const api = new InMemoryApiCollectionRepository();
  const applications = new InMemoryApplicationRepository();
  return {
    scans,
    journeys,
    api,
    applications,
    sources: { scanJobs: createScanJobPersistence({ repository: scans, retentionMs: 60 * MINUTE, onError: () => {} }), codeExecutions: journeys, apiCollections: api, applications },
  };
}

describe("recorte de histórico", () => {
  it("monta o where com o dono sempre em $1 e só o que foi pedido", () => {
    assert.deepEqual(historyClauses("dono", { limit: 10 }), { where: "owner_id = $1", values: ["dono", 10], limitPlaceholder: "$2" });
    const completo = historyClauses("dono", { applicationId: "app", since: "2026-01-01T00:00:00.000Z", before: { createdAt: "2026-02-01T00:00:00.000Z", id: "abc" }, limit: 5 });
    assert.equal(completo.where, "owner_id = $1 and application_id = $2 and created_at >= $3 and (created_at, id) < ($4::timestamptz, $5::uuid)");
    assert.equal(completo.limitPlaceholder, "$6");
    assert.deepEqual(completo.values, ["dono", "app", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "abc", 5]);
  });

  it("a versão em memória aplica o mesmo recorte do SQL", () => {
    const linha = { ownerId: "dono", applicationId: "app", createdAt: "2026-01-15T00:00:00.000Z", id: "b" };
    assert.equal(matchesHistory(linha, "dono", { limit: 1 }), true);
    assert.equal(matchesHistory(linha, "outro", { limit: 1 }), false);
    assert.equal(matchesHistory(linha, "dono", { applicationId: "outra", limit: 1 }), false);
    assert.equal(matchesHistory(linha, "dono", { since: "2026-02-01T00:00:00.000Z", limit: 1 }), false);
    // `before` é exclusivo: a própria linha do cursor não pode voltar na página
    // seguinte, senão a lista repete um item a cada "carregar mais".
    assert.equal(matchesHistory({ ...linha, id: "b" }, "dono", { before: { createdAt: "2026-01-15T00:00:00.000Z", id: "b" }, limit: 1 }), false);
    assert.equal(matchesHistory({ ...linha, id: "b" }, "dono", { before: { createdAt: "2026-01-16T00:00:00.000Z", id: "b" }, limit: 1 }), true);
    // Empate no mesmo instante: o id desempata, e a linha "menor" ainda vem.
    assert.equal(matchesHistory({ ...linha, id: "a" }, "dono", { before: { createdAt: "2026-01-15T00:00:00.000Z", id: "b" }, limit: 1 }), true);
    assert.equal(matchesHistory({ ...linha, id: "c" }, "dono", { before: { createdAt: "2026-01-15T00:00:00.000Z", id: "b" }, limit: 1 }), false);
  });
});

describe("linha do tempo das três origens", () => {
  it("intercala as três por data, da mais recente para a mais antiga", async () => {
    const { sources, scans, journeys, api } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner, createdAt: ago(30) }));
    await journeys.insert(codeExecution({ ownerId: owner, createdAt: ago(20) }));
    await api.recordRun({ ownerId: owner, applicationId: randomUUID(), method: "GET", url: "https://api.exemplo.com/pedidos", status: 200, statusText: "OK", durationMs: 90, environment: undefined });

    const page = await readExecutionHistory(sources, owner, { limit: 10 });
    assert.deepEqual(
      page.entries.map((entry) => entry.kind),
      ["api", "journey", "scan"],
    );
  });

  it("descreve cada origem com o que ela tem de próprio", async () => {
    const { sources, scans, journeys, api, applications } = fixture();
    const owner = randomUUID();
    const application = await applications.create({ ownerId: owner, name: "Loja Web", baseUrl: "https://loja.exemplo.com", environments: [] });
    await scans.insert(scanJob({ ownerId: owner, applicationId: application.id, createdAt: ago(30) }));
    await journeys.insert(codeExecution({ ownerId: owner, applicationId: application.id, createdAt: ago(20) }));
    await api.recordRun({
      ownerId: owner,
      applicationId: application.id,
      method: "POST",
      url: "https://api.exemplo.com/pedidos",
      status: 500,
      statusText: "Server Error",
      durationMs: 900,
      environment: undefined,
    });

    const entries = (await readExecutionHistory(sources, owner, { limit: 10 })).entries;
    const byKind = new Map(entries.map((entry) => [entry.kind, entry]));

    assert.equal(byKind.get("scan")?.title, "loja.exemplo.com/checkout");
    assert.equal(byKind.get("scan")?.detail, "0 erro(s) · 2 aviso(s)");
    assert.equal(byKind.get("scan")?.outcome, "passed");

    assert.equal(byKind.get("journey")?.title, "checkout com cartão");
    assert.equal(byKind.get("journey")?.detail, "3 teste(s) OK");
    assert.equal(byKind.get("journey")?.durationMs, 4321);

    assert.equal(byKind.get("api")?.title, "POST api.exemplo.com/pedidos");
    assert.equal(byKind.get("api")?.detail, "500 Server Error");
    // 500 é falha mesmo tendo respondido: quem olha o relatório quer ver isso
    // vermelho, não "respondeu, logo passou".
    assert.equal(byKind.get("api")?.outcome, "failed");

    // O nome da aplicação vem de uma consulta só, não de um join por linha.
    for (const entry of entries) assert.equal(entry.applicationName, "Loja Web");
  });

  it("marca como em andamento o que ainda não terminou", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner, status: "running", report: undefined }));
    const [entry] = (await readExecutionHistory(sources, owner, { limit: 10 })).entries;
    assert.equal(entry?.outcome, "running");
  });

  it("não mistura o histórico de outra conta", async () => {
    const { sources, scans, journeys, api } = fixture();
    const owner = randomUUID();
    const other = randomUUID();
    await scans.insert(scanJob({ ownerId: other }));
    await journeys.insert(codeExecution({ ownerId: other }));
    await api.recordRun({ ownerId: other, applicationId: randomUUID(), method: "GET", url: "https://x", status: 200, statusText: "OK", durationMs: 5, environment: undefined });
    await scans.insert(scanJob({ ownerId: owner }));

    const page = await readExecutionHistory(sources, owner, { limit: 10 });
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0]?.kind, "scan");
  });

  it("deixa de fora a execução anônima, que não pertence a conta nenhuma", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: undefined }));
    assert.deepEqual((await readExecutionHistory(sources, owner, { limit: 10 })).entries, []);
  });

  it("filtra por origem sem nem consultar as outras", async () => {
    const { sources, scans, journeys } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner }));
    await journeys.insert(codeExecution({ ownerId: owner }));
    const page = await readExecutionHistory(sources, owner, { kinds: ["journey"], limit: 10 });
    assert.deepEqual(
      page.entries.map((entry) => entry.kind),
      ["journey"],
    );
  });

  it("filtra por aplicação e por período", async () => {
    const { sources, scans, applications } = fixture();
    const owner = randomUUID();
    const application = await applications.create({ ownerId: owner, name: "Loja", baseUrl: "https://loja.exemplo.com", environments: [] });
    const daAplicacao = scanJob({ ownerId: owner, applicationId: application.id, createdAt: ago(5) });
    await scans.insert(daAplicacao);
    await scans.insert(scanJob({ ownerId: owner, createdAt: ago(5) }));
    await scans.insert(scanJob({ ownerId: owner, applicationId: application.id, createdAt: ago(60 * 24 * 40) }));

    assert.deepEqual((await readExecutionHistory(sources, owner, { applicationId: application.id, limit: 10 })).entries.length, 2);
    const recentes = await readExecutionHistory(sources, owner, { applicationId: application.id, since: ago(60), limit: 10 });
    assert.deepEqual(
      recentes.entries.map((entry) => entry.id),
      [daAplicacao.id],
    );
  });

  it("filtra pelo ambiente escolhido na barra de contexto, nas três origens", async () => {
    const { sources, scans, journeys, api } = fixture();
    const owner = randomUUID();
    const producao = scanJob({ ownerId: owner, environment: "producao" });
    await scans.insert(producao);
    await scans.insert(scanJob({ ownerId: owner, environment: "local" }));
    await scans.insert(scanJob({ ownerId: owner, environment: undefined }));
    await journeys.insert(codeExecution({ ownerId: owner, environment: "producao" }));
    await journeys.insert(codeExecution({ ownerId: owner, environment: "local" }));
    await api.recordRun({ ownerId: owner, applicationId: randomUUID(), method: "GET", url: "https://api.exemplo.com/x", status: 200, statusText: "OK", durationMs: 10, environment: "producao" });
    await api.recordRun({ ownerId: owner, applicationId: randomUUID(), method: "GET", url: "https://api.exemplo.com/y", status: 200, statusText: "OK", durationMs: 10, environment: "local" });

    const page = await readExecutionHistory(sources, owner, { environment: "producao", limit: 10 });
    assert.equal(page.entries.length, 3);
    assert.ok(page.entries.every((entry) => entry.environment === "producao"));
    assert.ok(page.entries.some((entry) => entry.id === producao.id));
  });

  it("pagina pelo cursor sem repetir nem pular linha", async () => {
    // O ponto do cursor por data: a paginação tem de continuar correta com as
    // três origens intercaladas, e nenhuma linha pode aparecer duas vezes.
    const { sources, scans, journeys, api } = fixture();
    const owner = randomUUID();
    const application = randomUUID();
    for (let index = 0; index < 4; index += 1) {
      await scans.insert(scanJob({ ownerId: owner, createdAt: ago(100 - index * 10) }));
      await journeys.insert(codeExecution({ ownerId: owner, createdAt: ago(95 - index * 10) }));
      await api.recordRun({
        ownerId: owner,
        applicationId: application,
        method: "GET",
        url: `https://api.exemplo.com/${index}`,
        status: 200,
        statusText: "OK",
        durationMs: 10,
        environment: undefined,
      });
    }

    const vistos: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const page = await readExecutionHistory(sources, owner, { limit: 3, ...(cursor ? { before: cursor } : {}) });
      vistos.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    assert.equal(new Set(vistos).size, vistos.length, "nenhuma linha pode vir duas vezes");
    const inteiro = await readExecutionHistory(sources, owner, { limit: 100 });
    assert.equal(vistos.length, inteiro.entries.length, "paginar tem de cobrir a lista inteira");
  });

  it("não oferece próxima página quando a lista acabou", async () => {
    const { sources, scans } = fixture();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner }));
    assert.equal((await readExecutionHistory(sources, owner, { limit: 10 })).nextCursor, undefined);
  });

  it("respeita o teto de página mesmo se pedirem mais", async () => {
    const { sources } = fixture();
    const page = await readExecutionHistory(sources, randomUUID(), { limit: MAX_HISTORY_PAGE + 500 });
    assert.deepEqual(page.entries, []);
  });

  it("funciona sem Jornada e sem Testes de API configurados", async () => {
    // Sem banco as duas ficam ausentes; a linha do tempo continua mostrando o
    // que existe em vez de quebrar.
    const scans = new InMemoryScanJobRepository();
    const owner = randomUUID();
    await scans.insert(scanJob({ ownerId: owner }));
    const page = await readExecutionHistory(
      { scanJobs: createScanJobPersistence({ repository: scans, retentionMs: 60 * MINUTE, onError: () => {} }), codeExecutions: undefined, apiCollections: undefined, applications: undefined },
      owner,
      { limit: 10 },
    );
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0]?.applicationName, undefined);
  });
});

describe("GET /api/v1/executions", () => {
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
      assert.equal((await fetch(`${baseUrl}/api/v1/executions`)).status, 401);
    } finally {
      await close();
    }
  });

  it("devolve a linha do tempo da conta", async () => {
    // A execução entra pelo caminho real — uma chamada dos Testes de API
    // apontada para uma aplicação — em vez de ser semeada no repositório: assim
    // o teste cobre gravar e consultar, e não só consultar.
    const { baseUrl, close } = await startServer();
    const alvo = createServer((_request, resposta) => {
      resposta.writeHead(200, { "content-type": "application/json" });
      resposta.end("{}");
    });
    await new Promise<void>((resolve) => alvo.listen(0, "127.0.0.1", resolve));
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = await fetch(`${baseUrl}/api/v1/applications`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Loja", baseUrl: "https://loja.exemplo.com", environments: [] }),
      });
      const application = ((await criada.json()) as { application: { id: string } }).application.id;
      await fetch(`${baseUrl}/api/v1/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ method: "GET", url: `http://127.0.0.1:${(alvo.address() as AddressInfo).port}/pedidos`, applicationId: application }),
      });

      const body = (await (await fetch(`${baseUrl}/api/v1/executions`, { headers: { cookie } })).json()) as {
        executions: Array<{ kind: string; applicationName?: string }>;
        nextCursor?: string;
      };
      assert.equal(body.executions.length, 1);
      assert.equal(body.executions[0]?.kind, "api");
      assert.equal(body.executions[0]?.applicationName, "Loja");
      assert.equal(body.nextCursor, undefined);

      // O filtro por origem tem de tirar essa mesma linha da lista.
      const semApi = (await (await fetch(`${baseUrl}/api/v1/executions?tipo=scan`, { headers: { cookie } })).json()) as { executions: unknown[] };
      assert.deepEqual(semApi.executions, []);
    } finally {
      await new Promise<void>((resolve) => alvo.close(() => resolve()));
      await close();
    }
  });

  it("recusa filtro inválido em vez de ignorá-lo em silêncio", async () => {
    // Ignorar um filtro que a pessoa escreveu devolve uma lista que parece
    // filtrada e não está — pior do que responder erro.
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      for (const query of ["tipo=inexistente", "de=ontem", "limite=0", "limite=9999", "limite=abc", "cursor=nao-e-data"]) {
        assert.equal((await fetch(`${baseUrl}/api/v1/executions?${query}`, { headers: { cookie } })).status, 400, `${query} deveria reprovar`);
      }
    } finally {
      await close();
    }
  });

  it("responde 404 para aplicação de outra conta", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const dela = await signUp(baseUrl, "dela@exemplo.com");
      const criada = await fetch(`${baseUrl}/api/v1/applications`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: dela },
        body: JSON.stringify({ name: "Dela", baseUrl: "https://dela.exemplo.com", environments: [] }),
      });
      const application = ((await criada.json()) as { application: { id: string } }).application.id;
      const minha = await signUp(baseUrl, "eu@exemplo.com");
      assert.equal((await fetch(`${baseUrl}/api/v1/executions?aplicacao=${application}`, { headers: { cookie: minha } })).status, 404);
    } finally {
      await close();
    }
  });

  it("recusa método que não é GET", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      assert.equal((await fetch(`${baseUrl}/api/v1/executions`, { method: "DELETE", headers: { cookie } })).status, 405);
    } finally {
      await close();
    }
  });
});
