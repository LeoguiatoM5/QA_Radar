import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import { InMemoryAccountSettingsRepository, PostgresAccountSettingsRepository, type AccountSettingsRepository } from "../src/account-settings-repository.js";

/**
 * Mesma razão de `--test-concurrency=1` em `test:persistence` que
 * `tests/application-repository.test.ts` documenta: os arquivos compartilham
 * um banco, e um `delete from users` de um apagaria o dono que o outro acabou
 * de semear.
 */
interface Fixture {
  repository: AccountSettingsRepository;
  owner: string;
  other: string;
}

function contractFor(name: string, create: () => Promise<Fixture>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`account settings repository (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("sem linha, get devolve indefinido", async () => {
      const { repository, owner } = await create();
      assert.equal(await repository.get(owner), undefined);
    });

    it("update cria a linha na primeira vez", async () => {
      const { repository, owner } = await create();
      const stored = await repository.update(owner, { alertWindowDays: 14 });
      assert.equal(stored.alertWindowDays, 14);
      assert.deepEqual(await repository.get(owner), stored);
    });

    it("update mescla: campo ausente do patch não apaga o que já estava", async () => {
      const { repository, owner } = await create();
      await repository.update(owner, { alertWindowDays: 14, alertThresholdPoints: 20 });
      const depois = await repository.update(owner, { scanTimeoutMs: 60_000 });
      assert.equal(depois.alertWindowDays, 14, "o campo de um patch anterior precisa sobreviver");
      assert.equal(depois.alertThresholdPoints, 20);
      assert.equal(depois.scanTimeoutMs, 60_000);
    });

    it("update substitui um campo já gravado quando ele volta a ser enviado", async () => {
      const { repository, owner } = await create();
      await repository.update(owner, { alertMinSample: 5 });
      const depois = await repository.update(owner, { alertMinSample: 10 });
      assert.equal(depois.alertMinSample, 10);
    });

    it("isola contas: update de uma não aparece na outra", async () => {
      const { repository, owner, other } = await create();
      await repository.update(owner, { scanIgnoredStatuses: "401,404" });
      assert.equal(await repository.get(other), undefined);
    });

    it("grava e devolve o modo de screenshot como texto", async () => {
      const { repository, owner } = await create();
      const stored = await repository.update(owner, { scanScreenshot: "always" });
      assert.equal(stored.scanScreenshot, "always");
    });
  });
}

contractFor("memória", async () => ({ repository: new InMemoryAccountSettingsRepository(), owner: randomUUID(), other: randomUUID() }));

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from account_settings");
      await database.query("delete from users");
      const owner = randomUUID();
      const other = randomUUID();
      for (const id of [owner, other]) {
        await database.query("insert into users (id, login) values ($1,$2)", [id, `conta-${id.slice(0, 8)}`]);
      }
      return { repository: new PostgresAccountSettingsRepository(database), owner, other };
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

  describe("account settings e a conta no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
      await database.query("delete from account_settings");
      await database.query("delete from users");
    });
    after(async () => {
      await database.close();
    });

    it("apagar a conta leva as configurações dela", async () => {
      const owner = randomUUID();
      await database.query("insert into users (id, login) values ($1,$2)", [owner, "some-junto"]);
      const repository = new PostgresAccountSettingsRepository(database);
      await repository.update(owner, { alertWindowDays: 30 });
      await database.query("delete from users where id = $1", [owner]);
      assert.equal(await repository.get(owner), undefined);
    });
  });
}
