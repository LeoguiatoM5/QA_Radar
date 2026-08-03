import type { Database } from "./database.js";
import type { JobStatus } from "./job-state.js";
import { canTransitionJob } from "./job-state.js";
import type { ScanOptions, ScanProgress, ScanReport } from "./types.js";

/**
 * Um job como ele existe no armazenamento: só dados, sem `AbortController` nem
 * nada preso a um processo. O que controla a execução em curso continua vivendo
 * em memória, porque não faz sentido em outra instância.
 */
export interface PersistedScanJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  options: ScanOptions;
  progress: ScanProgress;
  report: ScanReport | undefined;
  error: string | undefined;
  cancelRequested: boolean;
  accessTokenHash: string;
}

export interface ScanJobRepository {
  insert(job: PersistedScanJob): Promise<void>;
  get(id: string): Promise<PersistedScanJob | undefined>;
  update(job: PersistedScanJob): Promise<void>;
  /**
   * Toma o próximo da fila e o marca como `running` numa operação só.
   *
   * Precisa ser atômico: com mais de uma instância, duas que lessem "o próximo
   * enfileirado" ao mesmo tempo rodariam a mesma análise em paralelo.
   */
  claimNext(): Promise<PersistedScanJob | undefined>;
  transition(id: string, to: JobStatus): Promise<PersistedScanJob | undefined>;
  /** Posição na fila, 1 para o próximo. `undefined` se o job não está na fila. */
  position(id: string): Promise<number | undefined>;
  counts(): Promise<{ active: number; queued: number; jobs: number }>;
  /** Remove o que passou da retenção e devolve os ids removidos. */
  deleteExpired(now: Date): Promise<string[]>;
}

/* --------------------------------------------------------------------------
 * Serialização
 *
 * `ScanOptions` tem dois campos que JSON.stringify destrói em silêncio:
 * `ignoredStatuses` é um Set (vira `{}`) e `ignoredUrlPatterns` é um RegExp[]
 * (cada item vira `{}`). Um job persistido voltaria sem nenhum filtro de
 * ignore, mudando o resultado da análise sem erro nenhum aparecer.
 * -------------------------------------------------------------------------- */

interface StoredOptions extends Omit<ScanOptions, "ignoredStatuses" | "ignoredUrlPatterns"> {
  ignoredStatuses: number[];
  ignoredUrlPatterns: Array<{ source: string; flags: string }>;
}

export function serializeOptions(options: ScanOptions): StoredOptions {
  return {
    ...options,
    ignoredStatuses: [...options.ignoredStatuses],
    ignoredUrlPatterns: options.ignoredUrlPatterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
  };
}

export function deserializeOptions(stored: StoredOptions): ScanOptions {
  return {
    ...stored,
    ignoredStatuses: new Set(stored.ignoredStatuses),
    ignoredUrlPatterns: stored.ignoredUrlPatterns.map((pattern) => new RegExp(pattern.source, pattern.flags)),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Implementação em memória. É o comportamento padrão do produto sem banco, e
 * não um dublê de teste: roda a mesma bateria de contrato que a do Postgres.
 */
export class InMemoryScanJobRepository implements ScanJobRepository {
  readonly #jobs = new Map<string, PersistedScanJob>();
  /** Ordem de chegada; o Postgres usa `created_at` para o mesmo fim. */
  readonly #order: string[] = [];

  async insert(job: PersistedScanJob): Promise<void> {
    this.#jobs.set(job.id, { ...job });
    this.#order.push(job.id);
  }

  async get(id: string): Promise<PersistedScanJob | undefined> {
    const job = this.#jobs.get(id);
    return job ? { ...job } : undefined;
  }

  async update(job: PersistedScanJob): Promise<void> {
    if (!this.#jobs.has(job.id)) return;
    this.#jobs.set(job.id, { ...job, updatedAt: new Date().toISOString() });
  }

  async claimNext(): Promise<PersistedScanJob | undefined> {
    for (const id of this.#order) {
      const job = this.#jobs.get(id);
      if (job?.status !== "queued") continue;
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      return { ...job };
    }
    return undefined;
  }

  async transition(id: string, to: JobStatus): Promise<PersistedScanJob | undefined> {
    const job = this.#jobs.get(id);
    if (!job || !canTransitionJob(job.status, to)) return undefined;
    job.status = to;
    job.updatedAt = new Date().toISOString();
    return { ...job };
  }

  async position(id: string): Promise<number | undefined> {
    let position = 0;
    for (const queuedId of this.#order) {
      if (this.#jobs.get(queuedId)?.status !== "queued") continue;
      position += 1;
      if (queuedId === id) return position;
    }
    return undefined;
  }

  async counts(): Promise<{ active: number; queued: number; jobs: number }> {
    let active = 0;
    let queued = 0;
    for (const job of this.#jobs.values()) {
      if (job.status === "running") active += 1;
      if (job.status === "queued") queued += 1;
    }
    return { active, queued, jobs: this.#jobs.size };
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const removed: string[] = [];
    for (const [id, job] of this.#jobs) {
      if (new Date(job.expiresAt) > now) continue;
      this.#jobs.delete(id);
      removed.push(id);
    }
    for (const id of removed) {
      const index = this.#order.indexOf(id);
      if (index >= 0) this.#order.splice(index, 1);
    }
    return removed;
  }
}

interface ScanJobRow {
  id: string;
  status: JobStatus;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  options: StoredOptions;
  progress: ScanProgress;
  report: ScanReport | null;
  error: string | null;
  cancel_requested: boolean;
  access_token_hash: string;
}

function fromRow(row: ScanJobRow): PersistedScanJob {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    options: deserializeOptions(row.options),
    progress: row.progress,
    report: row.report ?? undefined,
    error: row.error ?? undefined,
    cancelRequested: row.cancel_requested,
    accessTokenHash: row.access_token_hash,
  };
}

const COLUMNS = "id, status, created_at, updated_at, expires_at, options, progress, report, error, cancel_requested, access_token_hash";

export class PostgresScanJobRepository implements ScanJobRepository {
  constructor(private readonly database: Database) {}

  async insert(job: PersistedScanJob): Promise<void> {
    await this.database.query(
      `insert into scan_jobs (id, status, created_at, updated_at, expires_at, options, progress, report, error, cancel_requested, access_token_hash, queued_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, case when $2 = 'queued' then $3::timestamptz else null end)`,
      [
        job.id,
        job.status,
        job.createdAt,
        job.updatedAt,
        job.expiresAt,
        JSON.stringify(serializeOptions(job.options)),
        JSON.stringify(job.progress),
        job.report === undefined ? null : JSON.stringify(job.report),
        job.error ?? null,
        job.cancelRequested,
        job.accessTokenHash,
      ],
    );
  }

  async get(id: string): Promise<PersistedScanJob | undefined> {
    const rows = await this.database.query<ScanJobRow>(`select ${COLUMNS} from scan_jobs where id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async update(job: PersistedScanJob): Promise<void> {
    await this.database.query(
      `update scan_jobs set status = $2, updated_at = now(), expires_at = $3, progress = $4, report = $5, error = $6, cancel_requested = $7,
         queued_at = case when $2 = 'queued' then queued_at else null end
       where id = $1`,
      [job.id, job.status, job.expiresAt, JSON.stringify(job.progress), job.report === undefined ? null : JSON.stringify(job.report), job.error ?? null, job.cancelRequested],
    );
  }

  async claimNext(): Promise<PersistedScanJob | undefined> {
    // `for update skip locked` na subconsulta é o que torna isto seguro com mais
    // de uma instância: quem chega depois pula a linha travada em vez de
    // esperar por ela e receber um job que já foi tomado.
    const rows = await this.database.query<ScanJobRow>(
      `update scan_jobs set status = 'running', updated_at = now(), queued_at = null
       where id = (select id from scan_jobs where status = 'queued' order by queued_at for update skip locked limit 1)
       returning ${COLUMNS}`,
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async transition(id: string, to: JobStatus): Promise<PersistedScanJob | undefined> {
    // A máquina de estados é aplicada no próprio UPDATE, com a lista de origens
    // válidas: assim duas instâncias não conseguem concluir o mesmo job duas
    // vezes, coisa que uma leitura seguida de escrita permitiria.
    const allowedFrom = (["queued", "running", "completed", "failed", "cancelled"] as JobStatus[]).filter((from) => canTransitionJob(from, to));
    if (allowedFrom.length === 0) return undefined;
    const rows = await this.database.query<ScanJobRow>(`update scan_jobs set status = $2, updated_at = now(), queued_at = null where id = $1 and status = any($3::text[]) returning ${COLUMNS}`, [
      id,
      to,
      allowedFrom,
    ]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async position(id: string): Promise<number | undefined> {
    const rows = await this.database.query<{ position: string }>(
      `select position from (
         select id, row_number() over (order by queued_at) as position from scan_jobs where status = 'queued'
       ) ranked where id = $1`,
      [id],
    );
    return rows[0] ? Number(rows[0].position) : undefined;
  }

  async counts(): Promise<{ active: number; queued: number; jobs: number }> {
    const rows = await this.database.query<{ active: string; queued: string; jobs: string }>(
      `select count(*) filter (where status = 'running') as active,
              count(*) filter (where status = 'queued') as queued,
              count(*) as jobs
       from scan_jobs`,
    );
    const row = rows[0];
    return { active: Number(row?.active ?? 0), queued: Number(row?.queued ?? 0), jobs: Number(row?.jobs ?? 0) };
  }

  async deleteExpired(now: Date): Promise<string[]> {
    const rows = await this.database.query<{ id: string }>(`delete from scan_jobs where expires_at <= $1 returning id`, [now.toISOString()]);
    return rows.map((row) => row.id);
  }
}
