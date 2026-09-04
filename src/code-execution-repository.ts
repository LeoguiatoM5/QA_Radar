import type { Database } from "./database.js";
import { compareHistory, historyClauses, matchesHistory, type HistoryQuery } from "./history-query.js";

/**
 * Execuções do Modo Jornada de Playwright como registro durável.
 *
 * Até aqui elas viviam num `Map` e num `code-report.json` no disco: sem dono,
 * sem aplicação, e no Render — onde o disco é efêmero — sumindo no deploy
 * seguinte. A Inspeção já tinha tudo isso; a Jornada, que é a automação de
 * verdade do produto, não tinha nada.
 *
 * Como no repositório das análises, **o dono entra na própria consulta** e não
 * numa checagem na rota: isolamento conferido fora do armazenamento é
 * isolamento que a próxima rota esquece de conferir.
 *
 * O diretório de saída **não** é gravado. Ele é sempre
 * `<resultsDir>/code-<id>`, e o `resultsDir` muda de uma instância para outra —
 * persistir o caminho seria guardar uma verdade da máquina que morreu.
 */
export interface PersistedCodeExecution {
  id: string;
  /** `passed` ou `failed`: a execução é síncrona, não existe estado no meio. */
  status: "passed" | "failed";
  createdAt: string;
  expiresAt: string;
  accessTokenHash: string;
  /** Relatório JSON do Playwright, já normalizado pela rota. */
  report: unknown;
  /** Contexto do erro lido de `error-context.md`, quando a execução falhou. */
  failureDetails: string | undefined;
  /** Nulo = execução anônima: só o token abre. */
  ownerId: string | undefined;
  /** Aplicação a que a execução pertence. Nulo = avulsa, ou aplicação apagada. */
  applicationId: string | undefined;
  /** Slug do ambiente selecionado na barra superior no momento da criação. */
  environment: string | undefined;
}

export interface CodeExecutionRepository {
  insert(execution: PersistedCodeExecution): Promise<void>;
  get(id: string): Promise<PersistedCodeExecution | undefined>;
  /** Histórico da conta, com o recorte pedido, do mais recente para o mais antigo. */
  listHistory(ownerId: string, query: HistoryQuery): Promise<PersistedCodeExecution[]>;
  delete(id: string): Promise<void>;
  /**
   * Apaga o histórico inteiro de uma conta e devolve os ids removidos.
   *
   * Os ids importam: quem chama ainda precisa apagar o diretório de saída e os
   * artefatos de cada execução, senão "apagar o histórico" deixaria as
   * evidências acessíveis por link.
   */
  deleteByOwner(ownerId: string): Promise<string[]>;
  /** Remove o que passou da retenção e devolve os ids removidos. */
  deleteExpired(now: Date): Promise<string[]>;
}

export class InMemoryCodeExecutionRepository implements CodeExecutionRepository {
  readonly #executions = new Map<string, PersistedCodeExecution>();

  async insert(execution: PersistedCodeExecution): Promise<void> {
    this.#executions.set(execution.id, { ...execution });
  }

  async get(id: string): Promise<PersistedCodeExecution | undefined> {
    const found = this.#executions.get(id);
    return found ? { ...found } : undefined;
  }

  async listHistory(ownerId: string, query: HistoryQuery): Promise<PersistedCodeExecution[]> {
    return [...this.#executions.values()]
      .filter((execution) => matchesHistory(execution, ownerId, query))
      .sort(compareHistory)
      .slice(0, query.limit)
      .map((execution) => ({ ...execution }));
  }

  async delete(id: string): Promise<void> {
    this.#executions.delete(id);
  }

  async deleteByOwner(ownerId: string): Promise<string[]> {
    const removed: string[] = [];
    for (const [id, execution] of this.#executions) {
      if (execution.ownerId !== ownerId) continue;
      this.#executions.delete(id);
      removed.push(id);
    }
    return removed;
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const removed: string[] = [];
    for (const [id, execution] of this.#executions) {
      if (new Date(execution.expiresAt).getTime() > now.getTime()) continue;
      this.#executions.delete(id);
      removed.push(id);
    }
    return removed;
  }
}

interface CodeExecutionRow {
  id: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  access_token_hash: string;
  report: unknown;
  failure_details: string | null;
  owner_id: string | null;
  application_id: string | null;
  environment: string | null;
}

function fromRow(row: CodeExecutionRow): PersistedCodeExecution {
  return {
    id: row.id,
    // A coluna é `text` e não um enum: o banco aceita o que for gravado, então
    // qualquer coisa fora dos dois valores conhecidos é lida como falha em vez
    // de virar um status inventado circulando pela interface.
    status: row.status === "passed" ? "passed" : "failed",
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    accessTokenHash: row.access_token_hash,
    report: row.report ?? undefined,
    failureDetails: row.failure_details ?? undefined,
    ownerId: row.owner_id ?? undefined,
    applicationId: row.application_id ?? undefined,
    environment: row.environment ?? undefined,
  };
}

const COLUMNS = "id, status, created_at, expires_at, access_token_hash, report, failure_details, owner_id, application_id, environment";

export class PostgresCodeExecutionRepository implements CodeExecutionRepository {
  constructor(private readonly database: Database) {}

  async insert(execution: PersistedCodeExecution): Promise<void> {
    await this.database.query(
      `insert into code_executions (id, status, created_at, expires_at, access_token_hash, report, failure_details, owner_id, application_id, environment)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do nothing`,
      [
        execution.id,
        execution.status,
        execution.createdAt,
        execution.expiresAt,
        execution.accessTokenHash,
        // O relatório é `jsonb`: precisa ir serializado, não como objeto solto.
        execution.report === undefined ? null : JSON.stringify(execution.report),
        execution.failureDetails ?? null,
        execution.ownerId ?? null,
        execution.applicationId ?? null,
        execution.environment ?? null,
      ],
    );
  }

  async get(id: string): Promise<PersistedCodeExecution | undefined> {
    const rows = await this.database.query<CodeExecutionRow>(`select ${COLUMNS} from code_executions where id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async listHistory(ownerId: string, query: HistoryQuery): Promise<PersistedCodeExecution[]> {
    const { where, values, limitPlaceholder } = historyClauses(ownerId, query);
    const rows = await this.database.query<CodeExecutionRow>(`select ${COLUMNS} from code_executions where ${where} order by created_at desc, id desc limit ${limitPlaceholder}`, values);
    return rows.map(fromRow);
  }

  async delete(id: string): Promise<void> {
    await this.database.query("delete from code_executions where id = $1", [id]);
  }

  async deleteByOwner(ownerId: string): Promise<string[]> {
    const rows = await this.database.query<{ id: string }>("delete from code_executions where owner_id = $1 returning id", [ownerId]);
    return rows.map((row) => row.id);
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const rows = await this.database.query<{ id: string }>("delete from code_executions where expires_at <= $1 returning id", [now.toISOString()]);
    return rows.map((row) => row.id);
  }
}
