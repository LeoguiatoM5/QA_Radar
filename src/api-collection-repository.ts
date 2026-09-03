import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { MAX_API_RUNS_PER_APPLICATION, type ApiRequestDefinition } from "./api-collection.js";
import { compareHistory, historyClauses, matchesHistory, type HistoryQuery } from "./history-query.js";

/**
 * Collections de Testes de API e o histórico de execuções, por aplicação.
 *
 * Como nos demais repositórios do produto, **o dono entra na própria consulta**.
 * Aqui isso pesa mais do que em qualquer outro: uma collection descreve os
 * endpoints internos de quem a cadastrou, então um vazamento horizontal aqui é
 * um mapa da API alheia.
 *
 * O que pode ser gravado está definido em `src/api-collection.ts` — este módulo
 * grava o que recebe, e quem chama é responsável por passar pela limpeza antes.
 */
export interface ApiCollection {
  id: string;
  ownerId: string;
  applicationId: string;
  name: string;
  requests: ApiRequestDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface NewApiCollection {
  ownerId: string;
  applicationId: string;
  name: string;
  requests: ApiRequestDefinition[];
}

/** Uma execução registrada: metadado apenas, sem corpo de requisição ou resposta. */
export interface ApiRun {
  id: string;
  ownerId: string | undefined;
  applicationId: string | undefined;
  method: string;
  url: string;
  status: number | undefined;
  statusText: string | undefined;
  durationMs: number | undefined;
  createdAt: string;
}

export interface NewApiRun {
  ownerId: string;
  applicationId: string;
  method: string;
  url: string;
  status: number | undefined;
  statusText: string | undefined;
  durationMs: number | undefined;
}

export class ApiCollectionNameTakenError extends Error {
  constructor() {
    super("Esta aplicação já tem uma collection com esse nome.");
    this.name = "ApiCollectionNameTakenError";
  }
}

export interface ApiCollectionRepository {
  create(input: NewApiCollection): Promise<ApiCollection>;
  /** Collections de uma aplicação da conta, da mais antiga para a mais nova. */
  listByApplication(ownerId: string, applicationId: string): Promise<ApiCollection[]>;
  /** `undefined` também quando a collection existe mas é de outra conta. */
  get(ownerId: string, id: string): Promise<ApiCollection | undefined>;
  /** Substitui nome e requisições. `undefined` se não era da conta. */
  replace(ownerId: string, id: string, changes: { name?: string | undefined; requests?: ApiRequestDefinition[] | undefined }): Promise<ApiCollection | undefined>;
  /** Apaga de vez: collection é configuração, não registro do que aconteceu. */
  remove(ownerId: string, id: string): Promise<boolean>;

  recordRun(run: NewApiRun): Promise<ApiRun>;
  /** Histórico de execuções da conta, com o recorte pedido. */
  listRunHistory(ownerId: string, query: HistoryQuery): Promise<ApiRun[]>;
  /** Apaga o histórico de execuções da conta e devolve quantos saíram. */
  removeRunsForOwner(ownerId: string): Promise<number>;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export class InMemoryApiCollectionRepository implements ApiCollectionRepository {
  readonly #collections = new Map<string, ApiCollection>();
  readonly #runs: ApiRun[] = [];

  async create(input: NewApiCollection): Promise<ApiCollection> {
    for (const existing of this.#collections.values()) {
      if (existing.applicationId === input.applicationId && sameName(existing.name, input.name)) throw new ApiCollectionNameTakenError();
    }
    const now = new Date().toISOString();
    const created: ApiCollection = {
      id: randomUUID(),
      ownerId: input.ownerId,
      applicationId: input.applicationId,
      name: input.name.trim(),
      requests: [...input.requests],
      createdAt: now,
      updatedAt: now,
    };
    this.#collections.set(created.id, created);
    return { ...created };
  }

  async listByApplication(ownerId: string, applicationId: string): Promise<ApiCollection[]> {
    return [...this.#collections.values()]
      .filter((collection) => collection.ownerId === ownerId && collection.applicationId === applicationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((collection) => ({ ...collection }));
  }

  async get(ownerId: string, id: string): Promise<ApiCollection | undefined> {
    const collection = this.#collections.get(id);
    return collection?.ownerId === ownerId ? { ...collection } : undefined;
  }

  async replace(ownerId: string, id: string, changes: { name?: string | undefined; requests?: ApiRequestDefinition[] | undefined }): Promise<ApiCollection | undefined> {
    const collection = this.#collections.get(id);
    if (collection?.ownerId !== ownerId) return undefined;
    if (changes.name !== undefined) {
      for (const other of this.#collections.values()) {
        if (other.id !== id && other.applicationId === collection.applicationId && sameName(other.name, changes.name)) throw new ApiCollectionNameTakenError();
      }
      collection.name = changes.name.trim();
    }
    if (changes.requests !== undefined) collection.requests = [...changes.requests];
    collection.updatedAt = new Date().toISOString();
    return { ...collection };
  }

  async remove(ownerId: string, id: string): Promise<boolean> {
    const collection = this.#collections.get(id);
    if (collection?.ownerId !== ownerId) return false;
    this.#collections.delete(id);
    return true;
  }

  async recordRun(run: NewApiRun): Promise<ApiRun> {
    const created: ApiRun = { id: randomUUID(), createdAt: new Date().toISOString(), ...run };
    this.#runs.unshift(created);
    // Mesmo corte do Postgres: o histórico é conveniência, não arquivo legal.
    const daAplicacao = this.#runs.filter((item) => item.applicationId === run.applicationId);
    for (const excedente of daAplicacao.slice(MAX_API_RUNS_PER_APPLICATION)) {
      this.#runs.splice(this.#runs.indexOf(excedente), 1);
    }
    return { ...created };
  }

  async listRunHistory(ownerId: string, query: HistoryQuery): Promise<ApiRun[]> {
    return this.#runs
      .filter((run) => matchesHistory(run, ownerId, query))
      .sort(compareHistory)
      .slice(0, query.limit)
      .map((run) => ({ ...run }));
  }

  async removeRunsForOwner(ownerId: string): Promise<number> {
    let removed = 0;
    for (let index = this.#runs.length - 1; index >= 0; index -= 1) {
      if (this.#runs[index]?.ownerId !== ownerId) continue;
      this.#runs.splice(index, 1);
      removed += 1;
    }
    return removed;
  }
}

interface CollectionRow {
  id: string;
  owner_id: string;
  application_id: string;
  name: string;
  requests: ApiRequestDefinition[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunRow {
  id: string;
  owner_id: string | null;
  application_id: string | null;
  method: string;
  url: string;
  status: number | null;
  status_text: string | null;
  duration_ms: number | null;
  created_at: Date | string;
}

function collectionFromRow(row: CollectionRow): ApiCollection {
  return {
    id: row.id,
    ownerId: row.owner_id,
    applicationId: row.application_id,
    name: row.name,
    requests: row.requests ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function runFromRow(row: RunRow): ApiRun {
  return {
    id: row.id,
    ownerId: row.owner_id ?? undefined,
    applicationId: row.application_id ?? undefined,
    method: row.method,
    url: row.url,
    status: row.status ?? undefined,
    statusText: row.status_text ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const COLLECTION_COLUMNS = "id, owner_id, application_id, name, requests, created_at, updated_at";
const RUN_COLUMNS = "id, owner_id, application_id, method, url, status, status_text, duration_ms, created_at";

/** `23505` é violação de unicidade; aqui só o índice de nome por aplicação dispara. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "23505";
}

export class PostgresApiCollectionRepository implements ApiCollectionRepository {
  constructor(private readonly database: Database) {}

  async create(input: NewApiCollection): Promise<ApiCollection> {
    try {
      const rows = await this.database.query<CollectionRow>(
        `insert into api_collections (id, owner_id, application_id, name, requests)
         values ($1,$2,$3,$4,$5)
         returning ${COLLECTION_COLUMNS}`,
        [randomUUID(), input.ownerId, input.applicationId, input.name.trim(), JSON.stringify(input.requests)],
      );
      return collectionFromRow(rows[0] as CollectionRow);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiCollectionNameTakenError();
      throw error;
    }
  }

  async listByApplication(ownerId: string, applicationId: string): Promise<ApiCollection[]> {
    const rows = await this.database.query<CollectionRow>(`select ${COLLECTION_COLUMNS} from api_collections where owner_id = $1 and application_id = $2 order by created_at`, [
      ownerId,
      applicationId,
    ]);
    return rows.map(collectionFromRow);
  }

  async get(ownerId: string, id: string): Promise<ApiCollection | undefined> {
    const rows = await this.database.query<CollectionRow>(`select ${COLLECTION_COLUMNS} from api_collections where id = $1 and owner_id = $2`, [id, ownerId]);
    return rows[0] ? collectionFromRow(rows[0]) : undefined;
  }

  async replace(ownerId: string, id: string, changes: { name?: string | undefined; requests?: ApiRequestDefinition[] | undefined }): Promise<ApiCollection | undefined> {
    try {
      const rows = await this.database.query<CollectionRow>(
        `update api_collections set
           name = coalesce($3, name),
           requests = coalesce($4, requests),
           updated_at = now()
         where id = $1 and owner_id = $2
         returning ${COLLECTION_COLUMNS}`,
        [id, ownerId, changes.name === undefined ? null : changes.name.trim(), changes.requests === undefined ? null : JSON.stringify(changes.requests)],
      );
      return rows[0] ? collectionFromRow(rows[0]) : undefined;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiCollectionNameTakenError();
      throw error;
    }
  }

  async remove(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>("delete from api_collections where id = $1 and owner_id = $2 returning id", [id, ownerId]);
    return rows.length > 0;
  }

  async recordRun(run: NewApiRun): Promise<ApiRun> {
    const rows = await this.database.query<RunRow>(
      `insert into api_runs (id, owner_id, application_id, method, url, status, status_text, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning ${RUN_COLUMNS}`,
      [randomUUID(), run.ownerId, run.applicationId, run.method, run.url, run.status ?? null, run.statusText ?? null, run.durationMs ?? null],
    );
    // O histórico é conveniência, não arquivo legal: a poda vai junto com a
    // escrita porque não há processo de manutenção rodando neste produto, e um
    // teto que só é aplicado "algum dia" não é teto.
    await this.database.query(
      `delete from api_runs where application_id = $1 and id not in (
         select id from api_runs where application_id = $1 order by created_at desc limit $2
       )`,
      [run.applicationId, MAX_API_RUNS_PER_APPLICATION],
    );
    return runFromRow(rows[0] as RunRow);
  }

  async listRunHistory(ownerId: string, query: HistoryQuery): Promise<ApiRun[]> {
    const { where, values, limitPlaceholder } = historyClauses(ownerId, query);
    const rows = await this.database.query<RunRow>(`select ${RUN_COLUMNS} from api_runs where ${where} order by created_at desc, id desc limit ${limitPlaceholder}`, values);
    return rows.map(runFromRow);
  }

  async removeRunsForOwner(ownerId: string): Promise<number> {
    const rows = await this.database.query<{ id: string }>("delete from api_runs where owner_id = $1 returning id", [ownerId]);
    return rows.length;
  }
}
