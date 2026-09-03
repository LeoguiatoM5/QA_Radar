import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { InMemoryCodeExecutionRepository, PostgresCodeExecutionRepository, type CodeExecutionRepository, type PersistedCodeExecution } from "../src/code-execution-repository.js";

/**
 * Mesma bateria nas duas implementações, como no repositório das análises: o
 * que vale é o contrato, e um comportamento que só a de memória cumpre é um
 * comportamento que produção não tem.
 *
 * Roda junto com os outros arquivos de persistência, que compartilham o mesmo
 * banco e limpam as tabelas — daí o `--test-concurrency=1` do `test:persistence`.
 */
interface Fixture {
  repository: CodeExecutionRepository;
  /** Donos reais: no Postgres `owner_id` tem chave estrangeira para `users`. */
  owner: string;
  other: string;
  /** Aplicação do primeiro dono, para o histórico por aplicação. */
  application: string;
}

const HOUR = 60 * 60 * 1000;

function execution(overrides: Partial<PersistedCodeExecution> = {}): PersistedCodeExecution {
  return {
    id: randomUUID(),
    status: "passed",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + HOUR).toISOString(),
    accessTokenHash: "a".repeat(64),
    report: { stats: { duration: 1234, expected: 1, unexpected: 0 } },
    failureDetails: undefined,
    ownerId: undefined,
    applicationId: undefined,
    ...overrides,
  };
}

function contractFor(name: string, create: () => Promise<Fixture>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`code execution repository (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("grava e devolve a execução inteira", async () => {
      const { repository, owner, application } = await create();
      const gravada = execution({ ownerId: owner, applicationId: application, failureDetails: "contexto do erro" });
      await repository.insert(gravada);
      const lida = await repository.get(gravada.id);
      assert.equal(lida?.id, gravada.id);
      assert.equal(lida?.status, "passed");
      assert.equal(lida?.ownerId, owner);
      assert.equal(lida?.applicationId, application);
      assert.equal(lida?.failureDetails, "contexto do erro");
      assert.deepEqual(lida?.report, gravada.report);
    });

    it("guarda execução anônima sem dono nem aplicação", async () => {
      const { repository } = await create();
      const anonima = execution();
      await repository.insert(anonima);
      const lida = await repository.get(anonima.id);
      assert.equal(lida?.ownerId, undefined);
      assert.equal(lida?.applicationId, undefined);
    });

    it("lista só o histórico da própria conta", async () => {
      const { repository, owner, other } = await create();
      const minha = execution({ ownerId: owner });
      await repository.insert(minha);
      await repository.insert(execution({ ownerId: other }));
      await repository.insert(execution());
      const lista = await repository.listByOwner(owner, 50);
      assert.deepEqual(
        lista.map((item) => item.id),
        [minha.id],
      );
    });

    it("lista o histórico de uma aplicação com o dono dentro da consulta", async () => {
      // O ponto do teste: passar o id certo da aplicação com a conta errada não
      // pode devolver nada. Sem o dono na consulta, um id vazado abriria o
      // histórico de outra pessoa.
      const { repository, owner, other, application } = await create();
      const daAplicacao = execution({ ownerId: owner, applicationId: application });
      await repository.insert(daAplicacao);
      await repository.insert(execution({ ownerId: owner }));
      assert.deepEqual(
        (await repository.listByApplication(owner, application, 50)).map((item) => item.id),
        [daAplicacao.id],
      );
      assert.deepEqual(await repository.listByApplication(other, application, 50), []);
    });

    it("ordena da mais recente para a mais antiga e respeita o limite", async () => {
      const { repository, owner } = await create();
      const antiga = execution({ ownerId: owner, createdAt: new Date(Date.now() - 2 * HOUR).toISOString() });
      const recente = execution({ ownerId: owner, createdAt: new Date().toISOString() });
      await repository.insert(antiga);
      await repository.insert(recente);
      assert.deepEqual(
        (await repository.listByOwner(owner, 50)).map((item) => item.id),
        [recente.id, antiga.id],
      );
      assert.deepEqual(
        (await repository.listByOwner(owner, 1)).map((item) => item.id),
        [recente.id],
      );
    });

    it("apaga uma execução por id", async () => {
      const { repository, owner } = await create();
      const alvo = execution({ ownerId: owner });
      await repository.insert(alvo);
      await repository.delete(alvo.id);
      assert.equal(await repository.get(alvo.id), undefined);
    });

    it("apaga o histórico da conta e devolve os ids, sem tocar no das outras", async () => {
      const { repository, owner, other } = await create();
      const minha = execution({ ownerId: owner });
      const alheia = execution({ ownerId: other });
      const anonima = execution();
      for (const item of [minha, alheia, anonima]) await repository.insert(item);
      const removidas = await repository.deleteByOwner(owner);
      assert.deepEqual(removidas, [minha.id]);
      assert.equal(await repository.get(minha.id), undefined);
      assert.ok(await repository.get(alheia.id));
      assert.ok(await repository.get(anonima.id));
    });

    it("remove o que passou da retenção e devolve os ids", async () => {
      const { repository, owner } = await create();
      const vencida = execution({ ownerId: owner, expiresAt: new Date(Date.now() - HOUR).toISOString() });
      const viva = execution({ ownerId: owner });
      await repository.insert(vencida);
      await repository.insert(viva);
      const removidas = await repository.deleteExpired(new Date());
      assert.deepEqual(removidas, [vencida.id]);
      assert.equal(await repository.get(vencida.id), undefined);
      assert.ok(await repository.get(viva.id));
    });

    it("gravar o mesmo id duas vezes não duplica nem derruba", async () => {
      const { repository, owner } = await create();
      const original = execution({ ownerId: owner });
      await repository.insert(original);
      await repository.insert({ ...original, status: "failed" });
      assert.equal((await repository.listByOwner(owner, 50)).length, 1);
    });
  });
}

contractFor("memória", async () => ({
  repository: new InMemoryCodeExecutionRepository(),
  owner: randomUUID(),
  other: randomUUID(),
  application: randomUUID(),
}));

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from code_executions");
      await database.query("delete from applications");
      await database.query("delete from users");
      const owner = randomUUID();
      const other = randomUUID();
      for (const id of [owner, other]) {
        await database.query("insert into users (id, login) values ($1,$2)", [id, `conta-${id.slice(0, 8)}`]);
      }
      const application = randomUUID();
      await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,$4)", [application, owner, "App", "https://app.exemplo.com"]);
      return { repository: new PostgresCodeExecutionRepository(database), owner, other, application };
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

  describe("execuções da Jornada no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
    });
    after(async () => {
      await database.close();
    });

    it("apagar a aplicação deixa a execução de pé, sem vínculo", async () => {
      // `on delete set null`, não `cascade`: arquivar ou apagar a aplicação não
      // pode levar junto o registro do que aconteceu.
      await database.query("delete from code_executions");
      await database.query("delete from applications");
      await database.query("delete from users");
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "dono"]);
      const application = randomUUID();
      await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,$4)", [application, owner, "App", "https://app.exemplo.com"]);
      const repository = new PostgresCodeExecutionRepository(database);
      const gravada = execution({ ownerId: owner, applicationId: application });
      await repository.insert(gravada);

      await database.query("delete from applications where id = $1", [application]);

      const lida = await repository.get(gravada.id);
      assert.ok(lida, "a execução não pode sumir junto com a aplicação");
      assert.equal(lida?.applicationId, undefined);
      assert.equal(lida?.ownerId, owner);
    });

    it("apagar a conta deixa a execução anônima em vez de apagá-la", async () => {
      await database.query("delete from code_executions");
      await database.query("delete from users");
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "dono"]);
      const repository = new PostgresCodeExecutionRepository(database);
      const gravada = execution({ ownerId: owner });
      await repository.insert(gravada);

      await database.query("delete from users where id = $1", [owner]);

      const lida = await repository.get(gravada.id);
      assert.ok(lida);
      assert.equal(lida?.ownerId, undefined);
    });

    it("a tabela não guarda o diretório de saída", async () => {
      // O caminho é sempre `<resultsDir>/code-<id>` e o `resultsDir` muda de uma
      // instância para outra: uma coluna aqui seria uma verdade da máquina que
      // morreu, e este teste trava isso.
      const colunas = await database.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'code_executions'");
      const nomes = colunas.map((coluna) => coluna.column_name);
      assert.equal(
        nomes.some((nome) => nome.includes("dir") || nome.includes("path")),
        false,
        `colunas: ${nomes.join(", ")}`,
      );
    });
  });
}
