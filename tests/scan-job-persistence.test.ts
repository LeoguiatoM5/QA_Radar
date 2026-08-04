import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryScanJobRepository, type ScanJobRepository } from "../src/scan-job-repository.js";
import { NO_SCAN_JOB_PERSISTENCE, createScanJobPersistence, toPersistedScanJob } from "../src/scan-job-persistence.js";
import type { ScanJob } from "../src/job-queue.js";
import { InMemoryIdempotencyKeys } from "../src/idempotency-store.js";
import { createDerivedAccessTokenIssuer } from "../src/access-token.js";

function persistence(repository: ScanJobRepository, onError: (operation: string, error: unknown) => void = () => {}) {
  return createScanJobPersistence({ repository, retentionMs: 3_600_000, onError });
}

/**
 * Repositório que falha nas escritas escolhidas.
 *
 * Subclasse, e não spread da instância: `{ ...new InMemoryScanJobRepository() }`
 * copia só as propriedades próprias e deixa todos os métodos para trás.
 */
class BrokenRepository extends InMemoryScanJobRepository {
  constructor(private readonly failing: { insert?: boolean; update?: boolean; counts?: boolean }) {
    super();
  }

  override async counts(): Promise<{ active: number; queued: number; jobs: number }> {
    if (this.failing.counts) throw new Error("banco fora");
    return super.counts();
  }

  override async insert(job: Parameters<ScanJobRepository["insert"]>[0]): Promise<void> {
    if (this.failing.insert) throw new Error("banco fora");
    return super.insert(job);
  }

  override async update(job: Parameters<ScanJobRepository["update"]>[0]): Promise<void> {
    if (this.failing.update) throw new Error("banco fora");
    return super.update(job);
  }
}

function runtimeJob(overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    id: randomUUID(),
    status: "queued",
    createdAt: new Date().toISOString(),
    options: {
      url: "https://example.com",
      browser: "chromium",
      headed: false,
      timeoutMs: 30_000,
      settleMs: 0,
      outputDir: "saida",
      format: "json",
      screenshot: "never",
      failOn: "error",
      ignoredStatuses: new Set<number>(),
      ignoredUrlPatterns: [],
    },
    report: undefined,
    error: undefined,
    progress: { discoveredPages: 0, completedPages: 0, currentUrl: undefined, percent: 0, stage: "queued" },
    controller: new AbortController(),
    cancelRequested: false,
    accessTokenHash: "b".repeat(64),
    ownerId: undefined,
    applicationId: undefined,
    ...overrides,
  };
}

describe("scan job persistence", () => {
  it("não faz nada e não quebra quando não há banco", async () => {
    // É o caminho padrão do produto: CLI e dashboard local sem banco nenhum.
    const job = runtimeJob();
    await NO_SCAN_JOB_PERSISTENCE.created(job);
    await NO_SCAN_JOB_PERSISTENCE.updated(job);
    await NO_SCAN_JOB_PERSISTENCE.removed(job.id);
    assert.equal(await NO_SCAN_JOB_PERSISTENCE.load(job.id), undefined);
    assert.deepEqual(await NO_SCAN_JOB_PERSISTENCE.recoverOrphans(), []);
    assert.deepEqual(await NO_SCAN_JOB_PERSISTENCE.pending(), []);
    assert.equal(await NO_SCAN_JOB_PERSISTENCE.status(), "disabled");
  });

  it("relata o banco como inacessível em vez de lançar no readiness", async () => {
    // O /ready reprova com isto; lançar aqui derrubaria a própria sondagem.
    const store = persistence(new BrokenRepository({ counts: true }));
    assert.equal(await store.status(), "unreachable");
    assert.equal(await persistence(new InMemoryScanJobRepository()).status(), "ok");
  });

  it("descarta o AbortController ao gravar, que não faz sentido fora do processo", () => {
    const job = runtimeJob();
    const stored = toPersistedScanJob(job, 1000);
    assert.equal("controller" in stored, false);
    assert.equal(stored.accessTokenHash, job.accessTokenHash);
    assert.ok(new Date(stored.expiresAt) > new Date(stored.createdAt));
  });

  it("propaga falha na criação, mas engole falha na atualização", async () => {
    // Falhar ao criar precisa aparecer: o cliente sairia com o id de um job que
    // o banco nunca viu. Falhar ao atualizar não pode derrubar uma análise que
    // já está rodando — o resultado vale mais que o registro dele.
    const failures: string[] = [];
    const store = persistence(new BrokenRepository({ insert: true, update: true }), (operation) => failures.push(operation));
    await assert.rejects(store.created(runtimeJob()), /banco fora/);
    await store.updated(runtimeJob());
    assert.deepEqual(failures, ["update"]);
  });

  it("encerra análises presas em execução por uma instância que morreu", async () => {
    const repository = new InMemoryScanJobRepository();
    const store = persistence(repository);
    const orphan = runtimeJob();
    await store.created(orphan);
    await repository.transition(orphan.id, "running");

    const recovered = await store.recoverOrphans();
    assert.deepEqual(recovered, [orphan.id]);
    const loaded = await repository.get(orphan.id);
    assert.equal(loaded?.status, "failed");
    assert.match(loaded?.error ?? "", /encerrada antes de concluí-la/);
    // Rodar de novo não tem o que recuperar.
    assert.deepEqual(await store.recoverOrphans(), []);
  });

  it("deixa em paz uma análise ainda enfileirada", async () => {
    // Ela nunca começou: continua válida para a nova instância executar.
    const repository = new InMemoryScanJobRepository();
    const store = persistence(repository);
    const queued = runtimeJob();
    await store.created(queued);
    assert.deepEqual(await store.recoverOrphans(), []);
    assert.equal((await repository.get(queued.id))?.status, "queued");
  });

  it("responde por uma análise que o processo não tem mais em memória", async () => {
    // O ponto da persistência: o registro sobrevive ao reinício. O primeiro
    // servidor cria a análise; o segundo, com a memória zerada, responde por ela.
    const repository = new InMemoryScanJobRepository();
    const scanJobs = persistence(repository);

    const first = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true, scanJobs });
    await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
    const firstUrl = `http://127.0.0.1:${(first.address() as AddressInfo).port}`;
    let created: { id: string; accessToken: string };
    try {
      created = (await (
        await fetch(`${firstUrl}/api/v1/scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: firstUrl }),
        })
      ).json()) as { id: string; accessToken: string };
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }

    // Instância nova: fila vazia, nada em memória, mesmo repositório.
    const second = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true, scanJobs });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    const secondUrl = `http://127.0.0.1:${(second.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${secondUrl}/api/v1/scans/${created.id}`, {
        headers: { authorization: `Bearer ${created.accessToken}` },
      });
      assert.equal(response.status, 200);
      const job = (await response.json()) as { id: string; status: string };
      assert.equal(job.id, created.id);
      assert.equal(job.status, "queued");

      // O token continua sendo exigido: persistir não afrouxa o acesso.
      assert.equal((await fetch(`${secondUrl}/api/v1/scans/${created.id}`)).status, 401);
      assert.equal((await fetch(`${secondUrl}/api/v1/scans/${created.id}`, { headers: { authorization: "Bearer errado" } })).status, 403);
    } finally {
      await new Promise<void>((resolve) => second.close(() => resolve()));
    }
  });

  it("executa a análise que ficou na fila quando o processo reiniciou", async () => {
    // A lacuna que isto fecha: o registro sobrevivia ao reinício, mas o
    // trabalho não. A análise ficava `queued` no banco para sempre e quem
    // consultava via "na fila" indefinidamente — pior do que falhar.
    const repository = new InMemoryScanJobRepository();
    const scanJobs = persistence(repository);

    // Instância 1: concorrência zero deixa a análise parada na fila.
    const first = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true, scanJobs });
    await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
    const firstUrl = `http://127.0.0.1:${(first.address() as AddressInfo).port}`;
    let created: { id: string; accessToken: string };
    try {
      created = (await (
        await fetch(`${firstUrl}/api/v1/scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: firstUrl }),
        })
      ).json()) as { id: string; accessToken: string };
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }
    assert.equal((await repository.get(created.id))?.status, "queued");

    // Instância 2: já com capacidade, e um runner que não toca em navegador.
    let executed = "";
    const second = createQaRadarServer({
      concurrency: 1,
      allowPrivateTargets: true,
      scanJobs,
      scanRunner: async (options) => {
        executed = options.url;
        throw new Error("parou aqui de propósito: o que importa é ter começado");
      },
    });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    try {
      for (let attempt = 0; attempt < 60 && !executed; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(executed, "a análise enfileirada deveria ter sido retomada");
      // As opções vieram do banco, não de memória nenhuma.
      assert.match(executed, /^http:\/\/127\.0\.0\.1:/);
      assert.equal((await repository.get(created.id))?.status, "failed");
    } finally {
      await new Promise<void>((resolve) => second.close(() => resolve()));
    }
  });

  it("reemite o token na repetição depois de o processo reiniciar", async () => {
    // A razão de o token ser derivado do id: aqui a primeira instância morreu,
    // e mesmo assim a repetição devolve um token que abre a mesma análise.
    const repository = new InMemoryScanJobRepository();
    const scanJobs = persistence(repository);
    const idempotencyKeys = new InMemoryIdempotencyKeys(3_600_000);
    const accessTokens = createDerivedAccessTokenIssuer("segredo-de-servidor-com-32-bytes");
    const options = { concurrency: 0, allowPrivateTargets: true, scanJobs, idempotencyKeys, accessTokens };

    const first = createQaRadarServer(options);
    await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
    const firstUrl = `http://127.0.0.1:${(first.address() as AddressInfo).port}`;
    let created: { id: string; accessToken: string };
    try {
      created = (await (
        await fetch(`${firstUrl}/api/v1/scans`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "chave-que-atravessa" },
          body: JSON.stringify({ url: firstUrl }),
        })
      ).json()) as { id: string; accessToken: string };
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }

    // Instância nova, memória zerada, mesmas chaves e mesmo segredo.
    const second = createQaRadarServer({ ...options, concurrency: 0 });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    const secondUrl = `http://127.0.0.1:${(second.address() as AddressInfo).port}`;
    try {
      const replay = await fetch(`${secondUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "chave-que-atravessa" },
        body: JSON.stringify({ url: firstUrl }),
      });
      assert.equal(replay.status, 200, "a repetição não podia criar uma segunda análise");
      const replayed = (await replay.json()) as { id: string; accessToken: string };
      assert.equal(replayed.id, created.id);
      assert.equal(replayed.accessToken, created.accessToken, "o token reemitido tem de ser o mesmo");

      // E ele realmente abre a análise.
      const consulted = await fetch(`${secondUrl}/api/v1/scans/${created.id}`, {
        headers: { authorization: `Bearer ${replayed.accessToken}` },
      });
      assert.equal(consulted.status, 200);
    } finally {
      await new Promise<void>((resolve) => second.close(() => resolve()));
    }
  });

  it("recusa criar a análise quando a gravação falha", async () => {
    // Sem isto o cliente receberia 202 com o id de uma análise que só existe na
    // memória daquela instância.
    const server = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true, scanJobs: persistence(new BrokenRepository({ insert: true })) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const originalError = console.error;
    console.error = () => {};
    try {
      const response = await fetch(`${baseUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: baseUrl }),
      });
      assert.equal(response.status, 500);
      assert.equal(((await response.json()) as { code: string }).code, "internal_error");
    } finally {
      console.error = originalError;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
