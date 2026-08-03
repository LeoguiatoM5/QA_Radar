import type { Database, DatabaseClient } from "./database.js";

/**
 * Migrations versionadas.
 *
 * Escritas aqui como SQL em código, e não lidas de arquivos `.sql`, porque o
 * pacote publicado no npm e a imagem Docker só levam o que o `tsc` compila —
 * um diretório de SQL solto teria de ser copiado à mão nos dois lugares, e o
 * primeiro esquecimento só apareceria em produção, no boot.
 *
 * Regra: **migration aplicada nunca é editada.** Corrigir um erro significa
 * acrescentar a próxima. A ordem é a do array e o `id` é o que fica gravado.
 */
export interface Migration {
  id: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_scan_jobs",
    statements: [
      `create table if not exists scan_jobs (
         id uuid primary key,
         status text not null,
         created_at timestamptz not null,
         updated_at timestamptz not null,
         expires_at timestamptz not null,
         options jsonb not null,
         progress jsonb not null,
         report jsonb,
         error text,
         cancel_requested boolean not null default false,
         access_token_hash text not null,
         queued_at timestamptz
       )`,
      // A fila lê "os enfileirados na ordem de chegada"; sem este índice a
      // consulta vira varredura completa conforme a tabela cresce.
      `create index if not exists scan_jobs_queue_idx on scan_jobs (queued_at) where status = 'queued'`,
      // A limpeza por retenção varre por vencimento.
      `create index if not exists scan_jobs_expires_idx on scan_jobs (expires_at)`,
    ],
  },
];

const CREATE_MIGRATIONS_TABLE = `create table if not exists schema_migrations (
   id text primary key,
   applied_at timestamptz not null default now()
 )`;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Aplica o que falta, em ordem, cada migration na sua própria transação.
 *
 * O lock consultivo impede que duas instâncias subindo ao mesmo tempo tentem
 * criar a mesma tabela — cenário normal quando a hospedagem faz deploy sem
 * derrubar a instância antiga antes.
 */
export async function runMigrations(database: Database, migrations: Migration[] = MIGRATIONS): Promise<MigrationResult> {
  await database.query(CREATE_MIGRATIONS_TABLE);
  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  for (const migration of migrations) {
    await database.transaction(async (client: DatabaseClient) => {
      // 8_675_309 é um identificador arbitrário mas fixo: o lock só precisa ser
      // o mesmo entre instâncias deste mesmo produto.
      await client.query("select pg_advisory_xact_lock($1)", [8_675_309]);
      const existing = await client.query<{ id: string }>("select id from schema_migrations where id = $1", [migration.id]);
      if (existing.length > 0) {
        result.alreadyApplied.push(migration.id);
        return;
      }
      for (const statement of migration.statements) await client.query(statement);
      await client.query("insert into schema_migrations (id) values ($1)", [migration.id]);
      result.applied.push(migration.id);
    });
  }
  return result;
}
