import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { InMemoryIdentityStore, PostgresIdentityStore, sessionId, createSessionToken, type IdentityStore } from "../src/identity.js";

const ACCOUNT = { provider: "github", providerAccountId: "12345", login: "leo", name: "Leo", avatarUrl: "https://exemplo/a.png" };

function contractFor(name: string, create: () => Promise<IdentityStore>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`identity store (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("cria o usuário no primeiro login", async () => {
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      assert.ok(user.id);
      assert.equal(user.login, "leo");
      assert.equal(user.provider, "github");
    });

    it("reaproveita a mesma conta no segundo login, atualizando o perfil", async () => {
      // Sem isto, cada login criaria um usuário novo e o histórico da pessoa se
      // perderia a cada entrada.
      const store = await create();
      const first = await store.upsertUser(ACCOUNT);
      const second = await store.upsertUser({ ...ACCOUNT, login: "leo-novo", name: "Leo Guiato" });
      assert.equal(second.id, first.id, "a mesma conta do provedor tem de dar o mesmo usuário");
      assert.equal(second.login, "leo-novo");
      assert.equal(second.name, "Leo Guiato");
    });

    it("separa contas diferentes do mesmo provedor", async () => {
      const store = await create();
      const one = await store.upsertUser(ACCOUNT);
      const other = await store.upsertUser({ ...ACCOUNT, providerAccountId: "99999", login: "outra" });
      assert.notEqual(other.id, one.id);
    });

    it("separa a mesma conta em provedores diferentes", async () => {
      // O par (provedor, conta) é a identidade: o id 12345 do GitHub não é a
      // mesma pessoa que o id 12345 do Google.
      const store = await create();
      const github = await store.upsertUser(ACCOUNT);
      const google = await store.upsertUser({ ...ACCOUNT, provider: "google" });
      assert.notEqual(google.id, github.id);
    });

    it("resolve a sessão de volta para o usuário", async () => {
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      const session = await store.createSession(user.id, 60_000);
      assert.equal((await store.userForSession(session.token))?.id, user.id);
    });

    it("recusa sessão vencida", async () => {
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      const session = await store.createSession(user.id, 60_000);
      assert.equal(await store.userForSession(session.token, new Date(Date.now() + 61_000)), undefined);
    });

    it("recusa token que não existe, sem lançar", async () => {
      const store = await create();
      assert.equal(await store.userForSession(createSessionToken()), undefined);
    });

    it("encerra a sessão no logout", async () => {
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      const session = await store.createSession(user.id, 60_000);
      await store.destroySession(session.token);
      assert.equal(await store.userForSession(session.token), undefined);
    });

    it("mantém as outras sessões da pessoa ao encerrar uma", async () => {
      // Sair num navegador não pode derrubar a sessão do outro.
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      const laptop = await store.createSession(user.id, 60_000);
      const celular = await store.createSession(user.id, 60_000);
      await store.destroySession(laptop.token);
      assert.equal((await store.userForSession(celular.token))?.id, user.id);
    });

    it("limpa só as sessões vencidas", async () => {
      const store = await create();
      const user = await store.upsertUser(ACCOUNT);
      const curta = await store.createSession(user.id, 1000);
      const longa = await store.createSession(user.id, 600_000);
      assert.equal(await store.purgeExpiredSessions(new Date(Date.now() + 2000)), 1);
      assert.equal(await store.userForSession(curta.token), undefined);
      assert.ok(await store.userForSession(longa.token));
    });
  });
}

contractFor("memória", async () => new InMemoryIdentityStore());

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from sessions");
      await database.query("delete from users");
      return new PostgresIdentityStore(database);
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

  describe("sessões no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
      await database.query("delete from sessions");
      await database.query("delete from users");
    });
    after(async () => {
      await database.close();
    });

    it("nunca grava o token da sessão em claro", async () => {
      // Um vazamento da tabela não pode virar sessão válida de ninguém.
      const store = new PostgresIdentityStore(database);
      const user = await store.upsertUser(ACCOUNT);
      const session = await store.createSession(user.id, 60_000);
      const rows = await database.query<{ id: string }>("select id from sessions");
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0]?.id, session.token, "o token do cookie não pode estar na tabela");
      assert.equal(rows[0]?.id, sessionId(session.token));
    });

    it("leva as sessões junto quando o usuário some", async () => {
      const store = new PostgresIdentityStore(database);
      const user = await store.upsertUser({ ...ACCOUNT, providerAccountId: "para-apagar" });
      const session = await store.createSession(user.id, 60_000);
      await database.query("delete from users where id = $1", [user.id]);
      assert.equal(await store.userForSession(session.token), undefined);
    });
  });
}
