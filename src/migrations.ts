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
  {
    id: "0002_idempotency_keys",
    statements: [
      // Sem coluna de token de propósito: ele é derivado do id do job por HMAC
      // (ver src/access-token.ts), então gravá-lo aqui seria guardar um bearer
      // token em texto claro sem necessidade nenhuma.
      `create table if not exists idempotency_keys (
         scope text primary key,
         fingerprint text not null,
         job_id uuid,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null
       )`,
      `create index if not exists idempotency_keys_expires_idx on idempotency_keys (expires_at)`,
    ],
  },
  {
    id: "0003_users_and_sessions",
    statements: [
      // `provider` + `provider_account_id` em vez de uma coluna `github_id`:
      // somar Google depois não deve exigir migration nova nem outra tabela.
      `create table if not exists users (
         id uuid primary key,
         provider text not null,
         provider_account_id text not null,
         login text not null,
         name text,
         avatar_url text,
         created_at timestamptz not null default now(),
         last_seen_at timestamptz not null default now(),
         unique (provider, provider_account_id)
       )`,
      // O id da sessão é o próprio segredo do cookie, então guarda-se o hash:
      // um vazamento do banco não pode virar sessão válida de ninguém.
      `create table if not exists sessions (
         id text primary key,
         user_id uuid not null references users (id) on delete cascade,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null
       )`,
      `create index if not exists sessions_user_idx on sessions (user_id)`,
      `create index if not exists sessions_expires_idx on sessions (expires_at)`,
      // Nulo = análise anônima, que continua acessível só pelo token. A coluna
      // é de dono, e não de usuário, para virar organização sem migration nova.
      `alter table scan_jobs add column if not exists owner_id uuid references users (id) on delete set null`,
      `create index if not exists scan_jobs_owner_idx on scan_jobs (owner_id, created_at desc)`,
    ],
  },
  {
    id: "0004_password_accounts",
    statements: [
      // A identidade externa sai de `users` e vira tabela própria porque a conta
      // deixou de ser "uma conta do GitHub": agora nasce de um cadastro com
      // e-mail e senha, e o GitHub passa a ser uma forma de entrar nela. Com as
      // colunas antigas no lugar, a mesma pessoa entrando pelos dois caminhos
      // viraria duas contas com históricos separados.
      `create table if not exists user_identities (
         provider text not null,
         provider_account_id text not null,
         user_id uuid not null references users (id) on delete cascade,
         created_at timestamptz not null default now(),
         primary key (provider, provider_account_id)
       )`,
      `create index if not exists user_identities_user_idx on user_identities (user_id)`,
      `insert into user_identities (provider, provider_account_id, user_id)
         select provider, provider_account_id, id from users
         where provider is not null and provider_account_id is not null
         on conflict do nothing`,
      `alter table users add column if not exists email text`,
      `alter table users add column if not exists password_hash text`,
      `alter table users add column if not exists email_verified_at timestamptz`,
      // Índice sobre `lower(email)` em vez de `unique (email)`: sem isso
      // "Ana@x.com" e "ana@x.com" seriam contas diferentes, e quem cadastrou a
      // primeira nunca entenderia por que a senha "não funciona".
      `create unique index if not exists users_email_idx on users (lower(email)) where email is not null`,
      `alter table users drop column if exists provider`,
      `alter table users drop column if exists provider_account_id`,
      // Confirmação de e-mail e redefinição de senha. Guarda-se o hash do
      // segredo enviado, como nas sessões: quem lesse a tabela não pode sair
      // redefinindo a senha de ninguém.
      `create table if not exists user_tokens (
         id text primary key,
         user_id uuid not null references users (id) on delete cascade,
         purpose text not null,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null,
         used_at timestamptz
       )`,
      `create index if not exists user_tokens_user_idx on user_tokens (user_id, purpose)`,
      `create index if not exists user_tokens_expires_idx on user_tokens (expires_at)`,
    ],
  },
  {
    id: "0005_applications",
    statements: [
      `create table if not exists applications (
         id uuid primary key,
         owner_id uuid not null references users (id) on delete cascade,
         name text not null,
         base_url text not null,
         environments jsonb not null default '[]'::jsonb,
         created_at timestamptz not null default now(),
         archived_at timestamptz
       )`,
      // Unicidade sobre `lower(name)`: duas "Loja" na mesma conta não se
      // distinguem numa lista, e a segunda só existiria por engano.
      `create unique index if not exists applications_owner_name_idx on applications (owner_id, lower(name))`,
      `create index if not exists applications_owner_idx on applications (owner_id, created_at desc)`,
      // `set null` e não `cascade`: arquivar ou apagar a aplicação não pode
      // levar junto o histórico de execuções, que é o registro do que aconteceu.
      `alter table scan_jobs add column if not exists application_id uuid references applications (id) on delete set null`,
      `create index if not exists scan_jobs_application_idx on scan_jobs (application_id, created_at desc)`,
    ],
  },
  {
    id: "0006_code_executions",
    statements: [
      // A Jornada é a automação de verdade do produto e era a única coisa que
      // não deixava registro: a execução vivia num Map e num JSON no disco, sem
      // dono e sem aplicação. Aqui ela ganha as duas colunas que a Inspeção já
      // tinha, e passa a sobreviver ao reinício.
      //
      // Não há coluna de diretório de saída: ele é sempre
      // `<resultsDir>/code-<id>`, e gravar o caminho seria guardar uma verdade
      // da máquina que morreu.
      `create table if not exists code_executions (
         id uuid primary key,
         status text not null,
         created_at timestamptz not null default now(),
         expires_at timestamptz not null,
         access_token_hash text not null,
         report jsonb,
         failure_details text,
         owner_id uuid references users (id) on delete set null,
         application_id uuid references applications (id) on delete set null
       )`,
      `create index if not exists code_executions_owner_idx on code_executions (owner_id, created_at desc)`,
      `create index if not exists code_executions_application_idx on code_executions (application_id, created_at desc)`,
      `create index if not exists code_executions_expires_idx on code_executions (expires_at)`,
    ],
  },
  {
    id: "0007_api_collections",
    statements: [
      // As requisições vivem num `jsonb` da própria collection, e não em tabela
      // filha: o cliente lê e grava a collection inteira de uma vez, então uma
      // tabela por requisição só acrescentaria junções para reconstruir o que
      // sempre viaja junto. Tabela filha se paga quando houver permissão por
      // requisição — não é o caso, e o teto de 100 mantém a linha pequena.
      //
      // **Nenhuma credencial entra aqui.** O que pode ser gravado está definido
      // em `src/api-collection.ts`, e a limpeza roda no servidor.
      //
      // `on delete cascade` na aplicação, ao contrário do histórico: uma
      // collection é configuração *da* aplicação, não registro do que
      // aconteceu. Apagada a aplicação, ela não tem mais onde existir.
      `create table if not exists api_collections (
         id uuid primary key,
         owner_id uuid not null references users (id) on delete cascade,
         application_id uuid not null references applications (id) on delete cascade,
         name text not null,
         requests jsonb not null default '[]'::jsonb,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       )`,
      // Mesma razão do índice de aplicações: duas "Smoke" na mesma aplicação
      // não se distinguem numa lista, e a segunda só existiria por engano.
      `create unique index if not exists api_collections_application_name_idx on api_collections (application_id, lower(name))`,
      `create index if not exists api_collections_application_idx on api_collections (application_id, created_at)`,
      `create index if not exists api_collections_owner_idx on api_collections (owner_id)`,
      // O histórico de execuções é metadado, não o conteúdo: método, URL já
      // limpa, status e duração. Corpo de requisição e de resposta ficam fora —
      // é neles que moram token, dado pessoal e payload de cliente.
      `create table if not exists api_runs (
         id uuid primary key,
         owner_id uuid references users (id) on delete set null,
         application_id uuid references applications (id) on delete set null,
         method text not null,
         url text not null,
         status integer,
         status_text text,
         duration_ms integer,
         created_at timestamptz not null default now()
       )`,
      `create index if not exists api_runs_application_idx on api_runs (application_id, created_at desc)`,
      `create index if not exists api_runs_owner_idx on api_runs (owner_id, created_at desc)`,
    ],
  },
  {
    id: "0008_account_settings",
    statements: [
      // Uma linha por conta, não uma tabela de aplicação: são preferências da
      // conta inteira. Toda coluna é opcional — linha ausente ou coluna nula
      // significa "use o padrão do produto", resolvido em
      // `src/account-settings.ts`. `owner_id` é a própria chave primária: não
      // existe "a segunda linha de configurações" de uma conta.
      `create table if not exists account_settings (
         owner_id uuid primary key references users (id) on delete cascade,
         alert_window_days integer,
         alert_threshold_points integer,
         alert_min_sample integer,
         scan_timeout_ms integer,
         scan_settle_ms integer,
         scan_ignored_statuses text,
         scan_screenshot text,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       )`,
    ],
  },
  {
    id: "0009_environments",
    statements: [
      // O seletor de Ambiente na barra superior (Local/Homologação/Produção)
      // não alimentava nenhuma consulta — mudar o valor mudava o rótulo e
      // nada mais, em nenhuma das três origens de execução. É uma coluna
      // nova, e não `options->>'environment'` de scan_jobs (que já existe,
      // mas pertence ao sistema separado de Projeto/Baseline, controlado por
      // `allowHistory`): as duas coisas são conceitos diferentes, e uma
      // reprovaria a outra por engano se dividissem a mesma coluna.
      `alter table scan_jobs add column if not exists environment text`,
      `alter table code_executions add column if not exists environment text`,
      `alter table api_runs add column if not exists environment text`,
      // Sem índice dedicado: o filtro sempre acompanha `owner_id` (a consulta
      // nunca é "todo mundo neste ambiente"), e os índices por dono já
      // existem — Postgres varre por eles e aplica o filtro de ambiente por
      // cima, barato o bastante para o volume de uma conta.
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
