import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResultRow } from "pg";
import type { Database } from "../src/database.js";
import { sslOptionsFor } from "../src/database.js";
import { MIGRATIONS, runMigrations, type Migration } from "../src/migrations.js";

/** Banco falso que registra o SQL executado e finge uma tabela de migrations. */
function fakeDatabase(applied: string[] = []) {
  const statements: string[] = [];
  const rolledBack: string[] = [];
  const recorded = new Set(applied);
  let failOn: string | undefined;

  const query = async <T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> => {
    statements.push(text.trim().split(/\s+/).slice(0, 6).join(" "));
    if (failOn && text.includes(failOn)) throw new Error(`falha simulada em ${failOn}`);
    if (text.startsWith("select id from schema_migrations")) {
      const id = String(values?.[0]);
      return (recorded.has(id) ? [{ id }] : []) as unknown as T[];
    }
    if (text.startsWith("insert into schema_migrations")) recorded.add(String(values?.[0]));
    return [] as T[];
  };

  const database: Database = {
    query,
    async transaction(run) {
      try {
        return await run({ query });
      } catch (error) {
        rolledBack.push("rollback");
        throw error;
      }
    },
    close: async () => {},
  };
  return { database, statements, rolledBack, recorded, setFailure: (needle: string) => (failOn = needle) };
}

const SAMPLE: Migration[] = [
  { id: "0001_a", statements: ["create table a ()"] },
  { id: "0002_b", statements: ["create table b ()", "create index b_idx on b (id)"] },
];

describe("migrations", () => {
  it("aplica em ordem e grava cada uma como aplicada", async () => {
    const { database, statements } = fakeDatabase();
    const result = await runMigrations(database, SAMPLE);
    assert.deepEqual(result.applied, ["0001_a", "0002_b"]);
    assert.deepEqual(result.alreadyApplied, []);
    assert.ok(statements.some((s) => s.startsWith("create table a")));
    assert.ok(statements.some((s) => s.startsWith("create index b_idx")));
  });

  it("não reaplica o que já está gravado", async () => {
    const { database, statements } = fakeDatabase(["0001_a"]);
    const result = await runMigrations(database, SAMPLE);
    assert.deepEqual(result.applied, ["0002_b"]);
    assert.deepEqual(result.alreadyApplied, ["0001_a"]);
    assert.ok(!statements.some((s) => s.startsWith("create table a")));
  });

  it("é idempotente: rodar de novo não aplica nada", async () => {
    const { database } = fakeDatabase();
    await runMigrations(database, SAMPLE);
    const second = await runMigrations(database, SAMPLE);
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.alreadyApplied, ["0001_a", "0002_b"]);
  });

  it("toma o lock antes de olhar o que falta", async () => {
    // Sem o lock, duas instâncias subindo juntas tentam criar a mesma tabela.
    const { database, statements } = fakeDatabase();
    await runMigrations(database, SAMPLE);
    const lock = statements.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const check = statements.findIndex((s) => s.startsWith("select id from schema_migrations"));
    assert.ok(lock >= 0, "o lock consultivo não foi tomado");
    assert.ok(lock < check, "o lock precisa vir antes da verificação");
  });

  it("reverte a migration inteira quando um comando falha", async () => {
    const { database, rolledBack, recorded, setFailure } = fakeDatabase();
    setFailure("create index b_idx");
    await assert.rejects(runMigrations(database, SAMPLE), /falha simulada/);
    // A 0002 falhou no segundo comando e não pode contar como aplicada.
    assert.equal(recorded.has("0002_b"), false);
    assert.equal(recorded.has("0001_a"), true);
    assert.equal(rolledBack.length, 1);
  });

  it("mantém ids únicos e ordenados na lista real de migrations", () => {
    const ids = MIGRATIONS.map((migration) => migration.id);
    assert.deepEqual(ids, [...new Set(ids)], "há id de migration repetido");
    assert.deepEqual(ids, [...ids].sort(), "as migrations não estão em ordem de id");
    for (const migration of MIGRATIONS) assert.ok(migration.statements.length > 0, `${migration.id} não tem comando`);
  });
});

describe("database ssl", () => {
  it("exige TLS verificado em host remoto", () => {
    assert.deepEqual(sslOptionsFor("postgresql://user:pw@ep-teste.sa-east-1.aws.neon.tech/qa"), { rejectUnauthorized: true });
  });

  it("dispensa TLS no Postgres local, que normalmente não tem certificado", () => {
    assert.equal(sslOptionsFor("postgresql://postgres:postgres@localhost:5432/qa"), false);
    assert.equal(sslOptionsFor("postgresql://postgres@127.0.0.1:5432/qa"), false);
  });

  it("deixa o sslmode explícito da URL decidir", () => {
    assert.equal(sslOptionsFor("postgresql://u@remoto.example.com/qa?sslmode=disable"), false);
    assert.deepEqual(sslOptionsFor("postgresql://u@localhost/qa?sslmode=require"), { rejectUnauthorized: true });
    assert.deepEqual(sslOptionsFor("postgresql://u@remoto.example.com/qa?sslmode=no-verify"), { rejectUnauthorized: false });
  });
});
