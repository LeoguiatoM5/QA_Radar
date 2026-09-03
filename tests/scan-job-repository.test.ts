import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { InMemoryScanJobRepository, PostgresScanJobRepository, deserializeOptions, serializeOptions, type PersistedScanJob, type ScanJobRepository } from "../src/scan-job-repository.js";
import type { ScanOptions } from "../src/types.js";
import { PostgresIdempotencyKeys, idempotencyScope } from "../src/idempotency-store.js";

/**
 * Donos fixos. No Postgres `owner_id` tem chave estrangeira para `users`, então
 * a implementação de lá precisa desses usuários existindo de verdade.
 */
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

/** Aplicações fixas, uma por dono. No Postgres `application_id` tem chave
 * estrangeira para `applications`, então elas também precisam existir. */
const APPLICATION_A = "33333333-3333-4333-8333-333333333333";
const APPLICATION_B = "44444444-4444-4444-8444-444444444444";

function options(overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    url: "https://example.com",
    browser: "chromium",
    headed: false,
    timeoutMs: 30_000,
    settleMs: 0,
    outputDir: "saida",
    format: "json",
    screenshot: "never",
    failOn: "error",
    ignoredStatuses: new Set([401, 404]),
    ignoredUrlPatterns: [/analytics/i, /telemetry/],
    ...overrides,
  };
}

function job(overrides: Partial<PersistedScanJob> = {}): PersistedScanJob {
  const now = new Date();
  return {
    id: randomUUID(),
    status: "queued",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    options: options(),
    progress: { discoveredPages: 0, completedPages: 0, currentUrl: undefined, percent: 0, stage: "queued" },
    report: undefined,
    error: undefined,
    cancelRequested: false,
    accessTokenHash: "a".repeat(64),
    ownerId: undefined,
    applicationId: undefined,
    ...overrides,
  };
}

/** A mesma bateria roda contra as duas implementações: são intercambiáveis. */
function contractFor(name: string, create: () => Promise<ScanJobRepository>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`scan job repository (${name})`, () => {
    // Os hooks vivem DENTRO deste describe de propósito: num describe irmão e
    // vazio, o after fecharia a conexão antes de a bateria começar.
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("devolve o job gravado com os campos intactos", async () => {
      const repository = await create();
      const saved = job();
      await repository.insert(saved);
      const loaded = await repository.get(saved.id);
      assert.equal(loaded?.id, saved.id);
      assert.equal(loaded?.status, "queued");
      assert.equal(loaded?.accessTokenHash, saved.accessTokenHash);
      assert.equal(loaded?.options.url, "https://example.com");
    });

    it("preserva Set e RegExp das opções, que JSON puro destruiria", async () => {
      // Sem serialização explícita, ignoredStatuses volta como {} e o job
      // reexecutaria sem nenhum filtro de ignore, mudando o resultado em
      // silêncio.
      const repository = await create();
      const saved = job();
      await repository.insert(saved);
      const loaded = await repository.get(saved.id);
      assert.ok(loaded?.options.ignoredStatuses instanceof Set);
      assert.deepEqual([...(loaded?.options.ignoredStatuses ?? [])], [401, 404]);
      assert.equal(loaded?.options.ignoredUrlPatterns.length, 2);
      assert.ok(loaded?.options.ignoredUrlPatterns[0] instanceof RegExp);
      assert.equal(loaded?.options.ignoredUrlPatterns[0]?.source, "analytics");
      assert.equal(loaded?.options.ignoredUrlPatterns[0]?.flags, "i");
      assert.equal(loaded?.options.ignoredUrlPatterns[1]?.flags, "");
    });

    it("não devolve nada para id inexistente", async () => {
      const repository = await create();
      assert.equal(await repository.get(randomUUID()), undefined);
    });

    it("entrega um job por vez, na ordem de chegada", async () => {
      const repository = await create();
      const first = job();
      const second = job();
      await repository.insert(first);
      await repository.insert(second);

      assert.equal((await repository.claimNext())?.id, first.id);
      assert.equal((await repository.claimNext())?.id, second.id);
      // Nada mais enfileirado: o terceiro pedido não pode ressuscitar ninguém.
      assert.equal(await repository.claimNext(), undefined);
      assert.equal((await repository.get(first.id))?.status, "running");
    });

    it("nunca entrega o mesmo job duas vezes", async () => {
      // É a garantia que impede duas instâncias de rodarem a mesma análise.
      const repository = await create();
      const only = job();
      await repository.insert(only);
      const claims = await Promise.all([repository.claimNext(), repository.claimNext(), repository.claimNext()]);
      assert.deepEqual(claims.map((claim) => claim?.id).filter(Boolean), [only.id]);
    });

    it("aplica a máquina de estados na transição", async () => {
      const repository = await create();
      const saved = job();
      await repository.insert(saved);
      // queued não vai direto para completed.
      assert.equal(await repository.transition(saved.id, "completed"), undefined);
      assert.equal((await repository.get(saved.id))?.status, "queued");

      assert.equal((await repository.transition(saved.id, "running"))?.status, "running");
      assert.equal((await repository.transition(saved.id, "completed"))?.status, "completed");
      // Estado final não sai mais.
      assert.equal(await repository.transition(saved.id, "running"), undefined);
    });

    it("cancela um job que ainda está na fila", async () => {
      const repository = await create();
      const saved = job();
      await repository.insert(saved);
      assert.equal((await repository.transition(saved.id, "cancelled"))?.status, "cancelled");
      // Cancelado não pode voltar a ser entregue pela fila.
      assert.equal(await repository.claimNext(), undefined);
    });

    it("informa a posição na fila e a perde quando o job sai dela", async () => {
      const repository = await create();
      const first = job();
      const second = job();
      await repository.insert(first);
      await repository.insert(second);
      assert.equal(await repository.position(first.id), 1);
      assert.equal(await repository.position(second.id), 2);

      await repository.claimNext();
      assert.equal(await repository.position(first.id), undefined, "job em execução não está na fila");
      assert.equal(await repository.position(second.id), 1, "a fila anda quando o da frente sai");
    });

    it("conta ativos, enfileirados e o total", async () => {
      const repository = await create();
      await repository.insert(job());
      await repository.insert(job());
      await repository.claimNext();
      assert.deepEqual(await repository.counts(), { active: 1, queued: 1, jobs: 2 });
    });

    it("persiste progresso, relatório e erro na atualização", async () => {
      const repository = await create();
      const saved = job();
      await repository.insert(saved);
      const running = { ...saved, status: "running" as const, error: "estourou o tempo", progress: { ...saved.progress, percent: 42, stage: "inspecting" as const } };
      await repository.update(running);
      const loaded = await repository.get(saved.id);
      assert.equal(loaded?.progress.percent, 42);
      assert.equal(loaded?.progress.stage, "inspecting");
      assert.equal(loaded?.error, "estourou o tempo");
    });

    it("lista só o histórico do dono, do mais novo para o mais antigo", async () => {
      // A listagem é onde um vazamento entre contas seria mais fácil de
      // acontecer e mais difícil de perceber.
      const repository = await create();
      const daContaA = job({ ownerId: OWNER_A, createdAt: "2026-08-01T10:00:00.000Z" });
      const outraDaContaA = job({ ownerId: OWNER_A, createdAt: "2026-08-02T10:00:00.000Z" });
      const daContaB = job({ ownerId: OWNER_B });
      const anonima = job();
      for (const entry of [daContaA, outraDaContaA, daContaB, anonima]) await repository.insert(entry);

      const historico = await repository.listHistory(OWNER_A, { limit: 50 });
      assert.deepEqual(
        historico.map((entry) => entry.id),
        [outraDaContaA.id, daContaA.id],
        "só as da conta A, mais recente primeiro",
      );
    });

    it("respeita o teto do histórico", async () => {
      const repository = await create();
      for (let i = 0; i < 5; i += 1) await repository.insert(job({ ownerId: OWNER_A, createdAt: `2026-08-0${i + 1}T10:00:00.000Z` }));
      assert.equal((await repository.listHistory(OWNER_A, { limit: 2 })).length, 2);
    });

    it("não devolve nada para uma conta sem análises", async () => {
      const repository = await create();
      await repository.insert(job({ ownerId: OWNER_A }));
      assert.deepEqual(await repository.listHistory(OWNER_B, { limit: 50 }), []);
    });

    it("lista o histórico de uma aplicação, e só dela", async () => {
      // O dono entra na própria consulta: com a checagem só no chamador, um id
      // de aplicação vazado devolveria o histórico de outra conta.
      const repository = await create();
      const daLoja = job({ ownerId: OWNER_A, applicationId: APPLICATION_A, createdAt: "2026-08-01T10:00:00.000Z" });
      const outraDaLoja = job({ ownerId: OWNER_A, applicationId: APPLICATION_A, createdAt: "2026-08-02T10:00:00.000Z" });
      const semAplicacao = job({ ownerId: OWNER_A });
      const deOutraConta = job({ ownerId: OWNER_B, applicationId: APPLICATION_B });
      for (const entry of [daLoja, outraDaLoja, semAplicacao, deOutraConta]) await repository.insert(entry);

      assert.deepEqual(
        (await repository.listHistory(OWNER_A, { applicationId: APPLICATION_A, limit: 50 })).map((entry) => entry.id),
        [outraDaLoja.id, daLoja.id],
        "só as da aplicação, mais recente primeiro",
      );
      assert.deepEqual(await repository.listHistory(OWNER_B, { applicationId: APPLICATION_A, limit: 50 }), [], "o dono errado não alcança a aplicação alheia");
      assert.equal((await repository.listHistory(OWNER_A, { applicationId: APPLICATION_A, limit: 1 })).length, 1, "o teto vale");
    });

    it("apaga o histórico de uma conta sem tocar no das outras", async () => {
      // "Limpar histórico" na Visão geral chega aqui. Alcançar a análise de
      // outra conta seria a pior falha possível desta operação.
      const repository = await create();
      const daContaA = job({ ownerId: OWNER_A });
      const outraDaContaA = job({ ownerId: OWNER_A });
      const daContaB = job({ ownerId: OWNER_B });
      const anonima = job();
      for (const entry of [daContaA, outraDaContaA, daContaB, anonima]) await repository.insert(entry);

      const removidos = await repository.deleteByOwner(OWNER_A);
      assert.deepEqual([...removidos].sort(), [daContaA.id, outraDaContaA.id].sort());
      assert.deepEqual(await repository.listHistory(OWNER_A, { limit: 50 }), []);
      assert.equal((await repository.listHistory(OWNER_B, { limit: 50 })).length, 1);
      assert.ok(await repository.get(anonima.id), "análise anônima não tem dono e não entra na limpeza");
    });

    it("apagar o histórico de uma conta vazia não é erro", async () => {
      const repository = await create();
      await repository.insert(job({ ownerId: OWNER_A }));
      assert.deepEqual(await repository.deleteByOwner(OWNER_B), []);
      assert.equal((await repository.listHistory(OWNER_A, { limit: 50 })).length, 1);
    });

    it("preserva o dono na volta do armazenamento", async () => {
      const repository = await create();
      const comDono = job({ ownerId: OWNER_A });
      const semDono = job();
      await repository.insert(comDono);
      await repository.insert(semDono);
      assert.equal((await repository.get(comDono.id))?.ownerId, OWNER_A);
      assert.equal((await repository.get(semDono.id))?.ownerId, undefined, "anônima não pode ganhar dono");
    });

    it("remove só o que passou da retenção", async () => {
      const repository = await create();
      const now = new Date("2026-08-03T12:00:00.000Z");
      const expired = job({ expiresAt: new Date(now.getTime() - 1000).toISOString() });
      const alive = job({ expiresAt: new Date(now.getTime() + 60_000).toISOString() });
      await repository.insert(expired);
      await repository.insert(alive);

      assert.deepEqual(await repository.deleteExpired(now), [expired.id]);
      assert.equal(await repository.get(expired.id), undefined);
      assert.ok(await repository.get(alive.id));
    });
  });
}

contractFor("memória", async () => new InMemoryScanJobRepository());

/**
 * Contra Postgres de verdade só quando houver um: a suíte não pode exigir
 * servidor externo. Suba um com
 * `docker run -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine`
 * e exporte QA_RADAR_TEST_DATABASE_URL.
 */
const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      // Cada caso começa com a tabela limpa: os testes de contagem e de ordem
      // de fila descrevem o repositório inteiro, não um pedaço dele.
      await database.query("delete from scan_jobs");
      for (const [id, login] of [
        [OWNER_A, "dono-a"],
        [OWNER_B, "dono-b"],
      ]) {
        // `on conflict (id)`: a identidade externa saiu de `users` para
        // `user_identities`, então não há mais par (provedor, conta) para
        // reconciliar aqui — o dono destes testes é o próprio id fixo.
        await database.query("insert into users (id, login) values ($1,$2) on conflict (id) do nothing", [id, login]);
      }
      for (const [id, owner, name] of [
        [APPLICATION_A, OWNER_A, "Loja da conta A"],
        [APPLICATION_B, OWNER_B, "Loja da conta B"],
      ]) {
        await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,'https://exemplo.com') on conflict (id) do nothing", [id, owner, name]);
      }
      return new PostgresScanJobRepository(database);
    },
    {
      setUp: async () => {
        database = createDatabase(TEST_DATABASE_URL);
        await runMigrations(database);
      },
      tearDown: async () => {
        await database.close();
      },
    },
  );
}

if (TEST_DATABASE_URL) {
  describe("idempotency keys (postgres)", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
      await database.query("delete from idempotency_keys");
    });
    after(async () => {
      await database.close();
    });

    it("guarda a reserva e a completa, sem nunca gravar token", async () => {
      const keys = new PostgresIdempotencyKeys(database, 3_600_000);
      const scope = idempotencyScope("10.0.0.1", `chave-${randomUUID()}`);
      await keys.reserve(scope, "impressao");
      assert.equal((await keys.get(scope))?.jobId, undefined);

      const jobId = randomUUID();
      await database.query(
        "insert into scan_jobs (id, status, created_at, updated_at, expires_at, options, progress, access_token_hash) values ($1,'queued',now(),now(),now() + interval '1 hour','{}','{}','x')",
        [jobId],
      );
      await keys.complete(scope, jobId);
      const stored = await keys.get(scope);
      assert.equal(stored?.jobId, jobId);
      // O token é derivado do id, então não tem por que estar aqui — e um
      // bearer token em texto claro seria pior que a situação anterior.
      assert.equal(stored?.accessToken, undefined);
      const columns = await database.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='idempotency_keys'");
      assert.equal(
        columns.some((column) => /token/i.test(column.column_name)),
        false,
        "a tabela não pode ter coluna de token",
      );
    });

    it("some quando vence, em vez de prender a chave", async () => {
      const keys = new PostgresIdempotencyKeys(database, 1000);
      const scope = idempotencyScope("10.0.0.2", `chave-${randomUUID()}`);
      await keys.reserve(scope, "impressao");
      assert.ok(await keys.get(scope));
      assert.equal(await keys.get(scope, Date.now() + 2000), undefined);
    });

    it("libera a chave e permite reservá-la de novo", async () => {
      const keys = new PostgresIdempotencyKeys(database, 3_600_000);
      const scope = idempotencyScope("10.0.0.3", `chave-${randomUUID()}`);
      await keys.reserve(scope, "impressao-a");
      await keys.release(scope);
      assert.equal(await keys.get(scope), undefined);
      // Reservar de novo depois de liberar não pode colidir com a chave antiga.
      await keys.reserve(scope, "impressao-b");
      assert.equal((await keys.get(scope))?.fingerprint, "impressao-b");
    });
  });
}

describe("serialização de opções", () => {
  it("faz a volta completa sem perder nada", () => {
    const original = options({ ignoredStatuses: new Set([500]), ignoredUrlPatterns: [/^https:\/\/cdn\./gu] });
    const restored = deserializeOptions(JSON.parse(JSON.stringify(serializeOptions(original))) as ReturnType<typeof serializeOptions>);
    assert.deepEqual([...restored.ignoredStatuses], [500]);
    assert.equal(restored.ignoredUrlPatterns[0]?.source, "^https:\\/\\/cdn\\.");
    assert.equal(restored.ignoredUrlPatterns[0]?.flags, "gu");
    assert.equal(restored.url, original.url);
    assert.equal(restored.browser, original.browser);
  });

  it("mostra por que a serialização precisa existir", () => {
    // JSON puro descarta os dois campos sem erro nenhum.
    const naive = JSON.parse(JSON.stringify(options())) as { ignoredStatuses: unknown; ignoredUrlPatterns: unknown[] };
    assert.deepEqual(naive.ignoredStatuses, {});
    assert.deepEqual(naive.ignoredUrlPatterns, [{}, {}]);
  });
});
