import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

/**
 * Aplicações de uma conta.
 *
 * É o que dá nome ao que se testa: sem isso o histórico é uma lista de URLs
 * soltas e não há onde pendurar ambiente, preferência nem baseline. A entidade
 * pertence a uma conta desde o primeiro campo — `ownerId` entra em **todo**
 * método e vai para a própria consulta, e não só para uma checagem na rota,
 * porque isolamento conferido fora do armazenamento é isolamento que a próxima
 * rota esquece de conferir.
 */
export interface Application {
  id: string;
  ownerId: string;
  name: string;
  baseUrl: string;
  /** Rótulos livres: "staging", "produção". Vazio é normal. */
  environments: string[];
  createdAt: string;
  /** Preenchido = arquivada: some das listas mas o histórico continua de pé. */
  archivedAt: string | undefined;
}

export interface NewApplication {
  ownerId: string;
  name: string;
  baseUrl: string;
  environments: string[];
}

/** `undefined` significa "não mexer neste campo", e não "apagar". */
export interface ApplicationChanges {
  name?: string | undefined;
  baseUrl?: string | undefined;
  environments?: string[] | undefined;
}

export class ApplicationNameTakenError extends Error {
  constructor() {
    super("Você já tem uma aplicação com esse nome.");
    this.name = "ApplicationNameTakenError";
  }
}

export interface ApplicationRepository {
  create(input: NewApplication): Promise<Application>;
  /** Só as da conta, mais recentes primeiro. Arquivadas ficam de fora por padrão. */
  listByOwner(ownerId: string, options?: { includeArchived?: boolean }): Promise<Application[]>;
  /** `undefined` também quando a aplicação existe mas é de outra conta. */
  get(ownerId: string, id: string): Promise<Application | undefined>;
  update(ownerId: string, id: string, changes: ApplicationChanges): Promise<Application | undefined>;
  /** Arquiva em vez de apagar. Devolve `false` se não era da conta. */
  archive(ownerId: string, id: string): Promise<boolean>;
}

/** Nome é comparado sem diferenciar maiúsculas nem espaço em volta. */
export function normalizeApplicationName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function sameName(a: string, b: string): boolean {
  return normalizeApplicationName(a).toLowerCase() === normalizeApplicationName(b).toLowerCase();
}

export class InMemoryApplicationRepository implements ApplicationRepository {
  readonly #applications = new Map<string, Application>();

  async create(input: NewApplication): Promise<Application> {
    const name = normalizeApplicationName(input.name);
    for (const existing of this.#applications.values()) {
      if (existing.ownerId === input.ownerId && sameName(existing.name, name)) throw new ApplicationNameTakenError();
    }
    const created: Application = {
      id: randomUUID(),
      ownerId: input.ownerId,
      name,
      baseUrl: input.baseUrl,
      environments: [...input.environments],
      createdAt: new Date().toISOString(),
      archivedAt: undefined,
    };
    this.#applications.set(created.id, created);
    return { ...created };
  }

  async listByOwner(ownerId: string, options: { includeArchived?: boolean } = {}): Promise<Application[]> {
    return [...this.#applications.values()]
      .filter((application) => application.ownerId === ownerId && (options.includeArchived || !application.archivedAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((application) => ({ ...application }));
  }

  async get(ownerId: string, id: string): Promise<Application | undefined> {
    const application = this.#applications.get(id);
    return application?.ownerId === ownerId ? { ...application } : undefined;
  }

  async update(ownerId: string, id: string, changes: ApplicationChanges): Promise<Application | undefined> {
    const application = this.#applications.get(id);
    if (application?.ownerId !== ownerId) return undefined;
    if (changes.name !== undefined) {
      const name = normalizeApplicationName(changes.name);
      for (const other of this.#applications.values()) {
        if (other.id !== id && other.ownerId === ownerId && sameName(other.name, name)) throw new ApplicationNameTakenError();
      }
      application.name = name;
    }
    if (changes.baseUrl !== undefined) application.baseUrl = changes.baseUrl;
    if (changes.environments !== undefined) application.environments = [...changes.environments];
    return { ...application };
  }

  async archive(ownerId: string, id: string): Promise<boolean> {
    const application = this.#applications.get(id);
    if (application?.ownerId !== ownerId) return false;
    application.archivedAt = application.archivedAt ?? new Date().toISOString();
    return true;
  }
}

interface ApplicationRow {
  id: string;
  owner_id: string;
  name: string;
  base_url: string;
  environments: string[] | null;
  created_at: Date | string;
  archived_at: Date | string | null;
}

function fromRow(row: ApplicationRow): Application {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    baseUrl: row.base_url,
    environments: row.environments ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
  };
}

const COLUMNS = "id, owner_id, name, base_url, environments, created_at, archived_at";

/** `23505` é violação de unicidade; aqui só o índice de nome por dono dispara. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "23505";
}

export class PostgresApplicationRepository implements ApplicationRepository {
  constructor(private readonly database: Database) {}

  async create(input: NewApplication): Promise<Application> {
    try {
      const rows = await this.database.query<ApplicationRow>(
        `insert into applications (id, owner_id, name, base_url, environments)
         values ($1,$2,$3,$4,$5)
         returning ${COLUMNS}`,
        [randomUUID(), input.ownerId, normalizeApplicationName(input.name), input.baseUrl, JSON.stringify(input.environments)],
      );
      return fromRow(rows[0] as ApplicationRow);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApplicationNameTakenError();
      throw error;
    }
  }

  async listByOwner(ownerId: string, options: { includeArchived?: boolean } = {}): Promise<Application[]> {
    const rows = await this.database.query<ApplicationRow>(
      `select ${COLUMNS} from applications
       where owner_id = $1 ${options.includeArchived ? "" : "and archived_at is null"}
       order by created_at desc`,
      [ownerId],
    );
    return rows.map(fromRow);
  }

  async get(ownerId: string, id: string): Promise<Application | undefined> {
    // O dono entra na cláusula, e não numa comparação depois: assim a aplicação
    // de outra conta é indistinguível de uma que não existe.
    const rows = await this.database.query<ApplicationRow>(`select ${COLUMNS} from applications where id = $1 and owner_id = $2`, [id, ownerId]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async update(ownerId: string, id: string, changes: ApplicationChanges): Promise<Application | undefined> {
    try {
      const rows = await this.database.query<ApplicationRow>(
        `update applications set
           name = coalesce($3, name),
           base_url = coalesce($4, base_url),
           environments = coalesce($5, environments)
         where id = $1 and owner_id = $2
         returning ${COLUMNS}`,
        [
          id,
          ownerId,
          changes.name === undefined ? null : normalizeApplicationName(changes.name),
          changes.baseUrl ?? null,
          changes.environments === undefined ? null : JSON.stringify(changes.environments),
        ],
      );
      return rows[0] ? fromRow(rows[0]) : undefined;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApplicationNameTakenError();
      throw error;
    }
  }

  async archive(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>("update applications set archived_at = coalesce(archived_at, now()) where id = $1 and owner_id = $2 returning id", [id, ownerId]);
    return rows.length > 0;
  }
}
