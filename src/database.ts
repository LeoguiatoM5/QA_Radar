import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Conexão com o Postgres.
 *
 * A persistência é **opcional por desenho**: sem `QA_RADAR_DATABASE_URL` o
 * produto inteiro continua funcionando em memória, como sempre funcionou. A CLI
 * e o dashboard local não podem passar a exigir um banco para rodar, e a suíte
 * de testes existente não pode depender de um servidor externo.
 */
export interface Database {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
  /** Executa dentro de uma transação, revertendo se o callback lançar. */
  transaction<T>(run: (client: DatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseClient {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
}

/**
 * O Neon e a maioria dos Postgres gerenciados exigem TLS, mas o Postgres em
 * container local normalmente não tem certificado. A URL decide: `sslmode`
 * explícito manda, senão liga TLS para host remoto e desliga para local.
 */
export function sslOptionsFor(connectionString: string): { rejectUnauthorized: boolean } | false {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return false;
  }
  const mode = url.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (mode) return { rejectUnauthorized: mode !== "no-verify" };
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  return isLocal ? false : { rejectUnauthorized: true };
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    ssl: sslOptionsFor(connectionString),
    // O plano gratuito do Neon corta conexões ociosas; um pool pequeno com
    // reciclagem curta evita entregar à aplicação uma conexão já morta.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sem este handler, um erro numa conexão ociosa do pool derruba o processo:
  // o 'error' do Pool é um EventEmitter sem listener padrão.
  pool.on("error", (error) => {
    console.error(JSON.stringify({ source: "qa-radar", event: "database.idle_error", timestamp: new Date().toISOString(), error: error.message }));
  });

  const runQuery = async <T extends QueryResultRow>(executor: Pool | PoolClient, text: string, values?: unknown[]): Promise<T[]> => {
    const result = await executor.query<T>(text, values as never[]);
    return result.rows;
  };

  return {
    query: (text, values) => runQuery(pool, text, values),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await run({ query: (text, values) => runQuery(client, text, values) });
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {
          /* A conexão já pode ter caído; o erro original é o que importa. */
        });
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
