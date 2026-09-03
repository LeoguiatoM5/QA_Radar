import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { MAX_API_RUNS_PER_APPLICATION, shareableRequest, type ApiRequestDefinition } from "../src/api-collection.js";
import { ApiCollectionNameTakenError, InMemoryApiCollectionRepository, PostgresApiCollectionRepository, type ApiCollectionRepository } from "../src/api-collection-repository.js";

interface Fixture {
  repository: ApiCollectionRepository;
  owner: string;
  other: string;
  application: string;
  otherApplication: string;
}

function request(name: string): ApiRequestDefinition {
  return shareableRequest({ name, method: "GET", url: "https://api.exemplo.com/x", auth: {} }) as ApiRequestDefinition;
}

function contractFor(name: string, create: () => Promise<Fixture>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`api collection repository (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("cria e lista a collection da aplicação", async () => {
      const { repository, owner, application } = await create();
      const criada = await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [request("Listar pedidos")] });
      assert.equal(criada.name, "Smoke");
      assert.equal(criada.requests.length, 1);
      assert.deepEqual(
        (await repository.listByApplication(owner, application)).map((collection) => collection.id),
        [criada.id],
      );
    });

    it("recusa duas collections de mesmo nome na mesma aplicação, ignorando caixa", async () => {
      const { repository, owner, application } = await create();
      await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [] });
      await assert.rejects(() => repository.create({ ownerId: owner, applicationId: application, name: "  smoke ", requests: [] }), ApiCollectionNameTakenError);
    });

    it("deixa aplicações diferentes usarem o mesmo nome", async () => {
      const { repository, owner, application, otherApplication } = await create();
      await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [] });
      const outra = await repository.create({ ownerId: owner, applicationId: otherApplication, name: "Smoke", requests: [] });
      assert.equal(outra.name, "Smoke");
    });

    it("não entrega a collection de outra conta", async () => {
      // Uma collection descreve os endpoints internos de quem a cadastrou: um
      // vazamento horizontal aqui é um mapa da API alheia.
      const { repository, owner, other, application } = await create();
      const minha = await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [] });
      assert.equal(await repository.get(other, minha.id), undefined);
      assert.deepEqual(await repository.listByApplication(other, application), []);
      assert.equal(await repository.replace(other, minha.id, { name: "Roubada" }), undefined);
      assert.equal(await repository.remove(other, minha.id), false);
      assert.ok(await repository.get(owner, minha.id), "a collection tem de continuar de pé depois das tentativas");
    });

    it("substitui nome e requisições e move o updatedAt", async () => {
      const { repository, owner, application } = await create();
      const criada = await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [request("Antiga")] });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const atualizada = await repository.replace(owner, criada.id, { name: "Regressão", requests: [request("Nova"), request("Outra")] });
      assert.equal(atualizada?.name, "Regressão");
      assert.deepEqual(
        atualizada?.requests.map((item) => item.name),
        ["Nova", "Outra"],
      );
      assert.ok((atualizada?.updatedAt ?? "") > criada.updatedAt, "updatedAt precisa avançar");
    });

    it("campo ausente no replace não é alterado", async () => {
      const { repository, owner, application } = await create();
      const criada = await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [request("Fica")] });
      const atualizada = await repository.replace(owner, criada.id, { name: "Outro nome" });
      assert.deepEqual(
        atualizada?.requests.map((item) => item.name),
        ["Fica"],
      );
    });

    it("apaga a collection de vez", async () => {
      const { repository, owner, application } = await create();
      const criada = await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [] });
      assert.equal(await repository.remove(owner, criada.id), true);
      assert.equal(await repository.get(owner, criada.id), undefined);
    });

    it("registra a execução e lista só as da própria conta", async () => {
      const { repository, owner, other, application } = await create();
      const registrada = await repository.recordRun({ ownerId: owner, applicationId: application, method: "GET", url: "https://api.exemplo.com/x", status: 200, statusText: "OK", durationMs: 120 });
      assert.equal(registrada.status, 200);
      assert.deepEqual(
        (await repository.listRunHistory(owner, { applicationId: application, limit: 50 })).map((run) => run.id),
        [registrada.id],
      );
      assert.deepEqual(await repository.listRunHistory(other, { applicationId: application, limit: 50 }), []);
    });

    it("guarda a execução que nem chegou a receber status", async () => {
      // Falha de conexão é justamente o que se quer ver no histórico depois.
      const { repository, owner, application } = await create();
      await repository.recordRun({ ownerId: owner, applicationId: application, method: "GET", url: "https://api.exemplo.com/x", status: undefined, statusText: undefined, durationMs: undefined });
      const [run] = await repository.listRunHistory(owner, { applicationId: application, limit: 50 });
      assert.equal(run?.status, undefined);
      assert.equal(run?.durationMs, undefined);
    });

    it("poda o histórico no teto por aplicação", async () => {
      const { repository, owner, application } = await create();
      for (let index = 0; index < MAX_API_RUNS_PER_APPLICATION + 5; index += 1) {
        await repository.recordRun({ ownerId: owner, applicationId: application, method: "GET", url: `https://api.exemplo.com/${index}`, status: 200, statusText: "OK", durationMs: 10 });
      }
      const runs = await repository.listRunHistory(owner, { applicationId: application, limit: MAX_API_RUNS_PER_APPLICATION + 50 });
      assert.equal(runs.length, MAX_API_RUNS_PER_APPLICATION);
    });

    it("apaga o histórico de execuções da conta sem tocar no das outras", async () => {
      const { repository, owner, other, application } = await create();
      await repository.recordRun({ ownerId: owner, applicationId: application, method: "GET", url: "https://x", status: 200, statusText: "OK", durationMs: 10 });
      await repository.recordRun({ ownerId: other, applicationId: application, method: "GET", url: "https://x", status: 200, statusText: "OK", durationMs: 10 });
      assert.equal(await repository.removeRunsForOwner(owner), 1);
      assert.deepEqual(await repository.listRunHistory(owner, { applicationId: application, limit: 50 }), []);
      assert.equal((await repository.listRunHistory(other, { applicationId: application, limit: 50 })).length, 1);
    });
  });
}

contractFor("memória", async () => ({
  repository: new InMemoryApiCollectionRepository(),
  owner: randomUUID(),
  other: randomUUID(),
  application: randomUUID(),
  otherApplication: randomUUID(),
}));

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from api_runs");
      await database.query("delete from api_collections");
      await database.query("delete from applications");
      await database.query("delete from users");
      const owner = randomUUID();
      const other = randomUUID();
      for (const id of [owner, other]) {
        await database.query("insert into users (id, login) values ($1,$2)", [id, `conta-${id.slice(0, 8)}`]);
      }
      const application = randomUUID();
      const otherApplication = randomUUID();
      await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,$4)", [application, owner, "App", "https://app.exemplo.com"]);
      await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,$4)", [otherApplication, owner, "Outra", "https://outra.exemplo.com"]);
      return { repository: new PostgresApiCollectionRepository(database), owner, other, application, otherApplication };
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

  describe("collections de API no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
    });
    after(async () => {
      await database.close();
    });

    async function semear(): Promise<{ owner: string; application: string }> {
      await database.query("delete from api_runs");
      await database.query("delete from api_collections");
      await database.query("delete from applications");
      await database.query("delete from users");
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "dono"]);
      const application = randomUUID();
      await database.query("insert into applications (id, owner_id, name, base_url) values ($1,$2,$3,$4)", [application, owner, "App", "https://app.exemplo.com"]);
      return { owner, application };
    }

    it("apagar a aplicação leva as collections junto, ao contrário do histórico", async () => {
      // Escolha deliberada: collection é configuração *da* aplicação; execução
      // é registro do que aconteceu e sobrevive à aplicação sumir.
      const { owner, application } = await semear();
      const repository = new PostgresApiCollectionRepository(database);
      await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [] });
      await repository.recordRun({ ownerId: owner, applicationId: application, method: "GET", url: "https://x", status: 200, statusText: "OK", durationMs: 5 });

      await database.query("delete from applications where id = $1", [application]);

      assert.deepEqual(await repository.listByApplication(owner, application), []);
      const restantes = await database.query<{ id: string; application_id: string | null }>("select id, application_id from api_runs");
      assert.equal(restantes.length, 1, "a execução tem de continuar registrada");
      assert.equal(restantes[0]?.application_id, null);
    });

    it("nenhuma credencial chega à tabela, mesmo mandada de propósito", async () => {
      // O teste de ponta: o repositório grava o que recebe, então quem chama é
      // obrigado a passar por `shareableRequest`. Aqui isso é exercido junto,
      // conferindo a linha crua no banco.
      const { owner, application } = await semear();
      const repository = new PostgresApiCollectionRepository(database);
      const suja = shareableRequest({
        name: "Pedidos",
        method: "POST",
        url: "https://api.exemplo.com/pedidos?api_key=chave-de-verdade",
        headers: [{ key: "Authorization", value: "Bearer token-de-verdade" }],
        auth: { type: "basic", username: "ana", password: "senha-de-verdade" },
        body: "{}",
      }) as ApiRequestDefinition;
      await repository.create({ ownerId: owner, applicationId: application, name: "Smoke", requests: [suja] });

      const [linha] = await database.query<{ requests: unknown }>("select requests from api_collections");
      const cru = JSON.stringify(linha?.requests);
      for (const segredo of ["chave-de-verdade", "token-de-verdade", "senha-de-verdade"]) {
        assert.equal(cru.includes(segredo), false, `${segredo} chegou ao banco`);
      }
      assert.ok(cru.includes("Authorization"), "o nome do header fica");
      assert.ok(cru.includes("ana"), "o usuário do basic auth não é segredo e fica");
    });

    it("a tabela de execuções não tem coluna de corpo", async () => {
      // Corpo de requisição e de resposta ficam fora de propósito: é neles que
      // moram token, dado pessoal e payload de cliente.
      const colunas = await database.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'api_runs'");
      const nomes = colunas.map((coluna) => coluna.column_name);
      assert.equal(
        nomes.some((nome) => nome.includes("body") || nome.includes("header") || nome.includes("payload")),
        false,
        `colunas: ${nomes.join(", ")}`,
      );
    });
  });
}
