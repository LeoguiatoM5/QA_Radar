import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { ApplicationNameTakenError, InMemoryApplicationRepository, PostgresApplicationRepository, normalizeApplicationName, type ApplicationRepository } from "../src/application-repository.js";

/**
 * Estes testes compartilham um banco com os outros arquivos da suíte de
 * persistência, e cada um limpa as tabelas para começar do zero. Por isso
 * `test:persistence` roda com `--test-concurrency=1`: o runner do Node executa
 * arquivos em paralelo por padrão, e o `delete from users` de um apagava, no
 * meio do caminho, o dono que o outro tinha acabado de semear — a falha aparecia
 * como violação de chave estrangeira em um subconjunto aleatório dos casos.
 */
interface Fixture {
  repository: ApplicationRepository;
  /** Dono real: no Postgres `owner_id` tem chave estrangeira para `users`. */
  owner: string;
  other: string;
}

function contractFor(name: string, create: () => Promise<Fixture>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`application repository (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("cadastra uma aplicação da conta", async () => {
      const { repository, owner } = await create();
      const application = await repository.create({ ownerId: owner, name: "Loja Web", baseUrl: "https://loja.exemplo.com", environments: ["staging"] });
      assert.ok(application.id);
      assert.equal(application.ownerId, owner);
      assert.equal(application.name, "Loja Web");
      assert.deepEqual(application.environments, ["staging"]);
      assert.equal(application.archivedAt, undefined);
    });

    it("recusa duas aplicações de mesmo nome na mesma conta, ignorando maiúsculas e espaço", async () => {
      const { repository, owner } = await create();
      await repository.create({ ownerId: owner, name: "Loja Web", baseUrl: "https://loja.exemplo.com", environments: [] });
      await assert.rejects(() => repository.create({ ownerId: owner, name: "  loja   web ", baseUrl: "https://outra.exemplo.com", environments: [] }), ApplicationNameTakenError);
    });

    it("deixa contas diferentes usarem o mesmo nome", async () => {
      // O nome é único dentro da conta, não no produto inteiro: duas empresas
      // podem ter uma aplicação chamada "Checkout".
      const { repository, owner, other } = await create();
      await repository.create({ ownerId: owner, name: "Checkout", baseUrl: "https://a.exemplo.com", environments: [] });
      const daOutra = await repository.create({ ownerId: other, name: "Checkout", baseUrl: "https://b.exemplo.com", environments: [] });
      assert.equal(daOutra.name, "Checkout");
    });

    it("lista só as aplicações da própria conta", async () => {
      const { repository, owner, other } = await create();
      const minha = await repository.create({ ownerId: owner, name: "Minha", baseUrl: "https://a.exemplo.com", environments: [] });
      await repository.create({ ownerId: other, name: "Alheia", baseUrl: "https://b.exemplo.com", environments: [] });
      const lista = await repository.listByOwner(owner);
      assert.deepEqual(
        lista.map((application) => application.id),
        [minha.id],
      );
    });

    it("não entrega a aplicação de outra conta nem por id direto", async () => {
      // Autorização horizontal: o dono entra na consulta, então a aplicação
      // alheia é indistinguível de uma que não existe.
      const { repository, owner, other } = await create();
      const alheia = await repository.create({ ownerId: other, name: "Alheia", baseUrl: "https://b.exemplo.com", environments: [] });
      assert.equal(await repository.get(owner, alheia.id), undefined);
      assert.equal(await repository.update(owner, alheia.id, { name: "Sequestrada" }), undefined);
      assert.equal(await repository.archive(owner, alheia.id), false);
      // E continua intacta para quem é dono de verdade.
      assert.equal((await repository.get(other, alheia.id))?.name, "Alheia");
    });

    it("devolve indefinido para id que não existe, sem lançar", async () => {
      const { repository, owner } = await create();
      assert.equal(await repository.get(owner, randomUUID()), undefined);
      assert.equal(await repository.update(owner, randomUUID(), { name: "X" }), undefined);
      assert.equal(await repository.archive(owner, randomUUID()), false);
    });

    it("altera nome, URL e ambientes, e deixa o resto quieto", async () => {
      const { repository, owner } = await create();
      const criada = await repository.create({ ownerId: owner, name: "Loja", baseUrl: "https://loja.exemplo.com", environments: ["staging"] });
      const soONome = await repository.update(owner, criada.id, { name: "Loja Nova" });
      assert.equal(soONome?.name, "Loja Nova");
      assert.equal(soONome?.baseUrl, "https://loja.exemplo.com", "mudar o nome não pode mexer na URL");
      assert.deepEqual(soONome?.environments, ["staging"]);

      const comAmbientes = await repository.update(owner, criada.id, { environments: [] });
      assert.deepEqual(comAmbientes?.environments, [], "lista vazia é uma mudança, não uma ausência");
    });

    it("recusa renomear para o nome de outra aplicação da mesma conta", async () => {
      const { repository, owner } = await create();
      await repository.create({ ownerId: owner, name: "Loja", baseUrl: "https://a.exemplo.com", environments: [] });
      const segunda = await repository.create({ ownerId: owner, name: "Checkout", baseUrl: "https://b.exemplo.com", environments: [] });
      await assert.rejects(() => repository.update(owner, segunda.id, { name: "loja" }), ApplicationNameTakenError);
    });

    it("arquiva sem apagar: some da lista mas ainda é alcançável por id", async () => {
      const { repository, owner } = await create();
      const criada = await repository.create({ ownerId: owner, name: "Antiga", baseUrl: "https://a.exemplo.com", environments: [] });
      assert.equal(await repository.archive(owner, criada.id), true);
      assert.deepEqual(await repository.listByOwner(owner), []);
      const arquivadas = await repository.listByOwner(owner, { includeArchived: true });
      assert.equal(arquivadas.length, 1);
      assert.ok(arquivadas[0]?.archivedAt, "a arquivada precisa dizer quando foi arquivada");
      // Continua alcançável porque o histórico dela ainda aponta para cá.
      assert.ok(await repository.get(owner, criada.id));
    });

    it("arquivar duas vezes não muda a data da primeira", async () => {
      const { repository, owner } = await create();
      const criada = await repository.create({ ownerId: owner, name: "Antiga", baseUrl: "https://a.exemplo.com", environments: [] });
      await repository.archive(owner, criada.id);
      const primeira = (await repository.get(owner, criada.id))?.archivedAt;
      await repository.archive(owner, criada.id);
      assert.equal((await repository.get(owner, criada.id))?.archivedAt, primeira);
    });

    it("ordena da mais recente para a mais antiga", async () => {
      const { repository, owner } = await create();
      const primeira = await repository.create({ ownerId: owner, name: "Primeira", baseUrl: "https://a.exemplo.com", environments: [] });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const segunda = await repository.create({ ownerId: owner, name: "Segunda", baseUrl: "https://b.exemplo.com", environments: [] });
      const lista = await repository.listByOwner(owner);
      assert.deepEqual(
        lista.map((application) => application.id),
        [segunda.id, primeira.id],
      );
    });
  });
}

describe("nome de aplicação", () => {
  it("colapsa espaço repetido e apara as pontas", () => {
    assert.equal(normalizeApplicationName("  Loja   Web  "), "Loja Web");
  });
});

contractFor("memória", async () => ({ repository: new InMemoryApplicationRepository(), owner: randomUUID(), other: randomUUID() }));

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from applications");
      await database.query("delete from users");
      // `owner_id` tem chave estrangeira: sem usuário real o insert nem chega
      // a testar a regra de negócio.
      const owner = randomUUID();
      const other = randomUUID();
      for (const id of [owner, other]) {
        await database.query("insert into users (id, login) values ($1,$2)", [id, `conta-${id.slice(0, 8)}`]);
      }
      return { repository: new PostgresApplicationRepository(database), owner, other };
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

  describe("aplicações e histórico no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
      await database.query("delete from applications");
      await database.query("delete from users");
    });
    after(async () => {
      await database.close();
    });

    it("apagar a aplicação não leva o histórico junto", async () => {
      // `on delete set null`: o registro do que aconteceu sobrevive à aplicação.
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "dono"]);
      const repository = new PostgresApplicationRepository(database);
      const application = await repository.create({ ownerId: owner, name: "Com histórico", baseUrl: "https://a.exemplo.com", environments: [] });

      const jobId = randomUUID();
      await database.query(
        `insert into scan_jobs (id, status, created_at, updated_at, expires_at, options, progress, access_token_hash, owner_id, application_id)
         values ($1,'completed',now(),now(),now() + interval '1 hour','{}'::jsonb,'{}'::jsonb,'hash',$2,$3)`,
        [jobId, owner, application.id],
      );

      await database.query("delete from applications where id = $1", [application.id]);
      const rows = await database.query<{ application_id: string | null }>("select application_id from scan_jobs where id = $1", [jobId]);
      assert.equal(rows.length, 1, "a análise não pode desaparecer com a aplicação");
      assert.equal(rows[0]?.application_id, null);
    });

    it("apagar a conta leva as aplicações dela", async () => {
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "some-junto"]);
      const repository = new PostgresApplicationRepository(database);
      await repository.create({ ownerId: owner, name: "Some junto", baseUrl: "https://a.exemplo.com", environments: [] });
      await database.query("delete from users where id = $1", [owner]);
      assert.deepEqual(await repository.listByOwner(owner), []);
    });
  });
}
