import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "./database.js";

/**
 * Identidade e sessão.
 *
 * O login é **opcional por desenho**, como o banco e o armazenamento. Sem
 * provedor configurado nada aparece na interface e o produto segue funcionando
 * anônimo: roda a análise, recebe o token, e o token é o que dá acesso ao
 * resultado. Entrar não substitui esse caminho — acrescenta dono e histórico.
 *
 * O Modo Jornada continua com o gate do token administrativo próprio: login não
 * o substitui nem o afrouxa.
 */
export interface User {
  id: string;
  /** `github` hoje; a coluna existe para somar outros sem migration nova. */
  provider: string;
  providerAccountId: string;
  login: string;
  name: string | undefined;
  avatarUrl: string | undefined;
}

export interface Session {
  /** Segredo enviado no cookie. Só existe em claro aqui e no navegador. */
  token: string;
  userId: string;
  expiresAt: string;
}

export interface IdentityStore {
  /** Cria ou atualiza o usuário do provedor e devolve o registro. */
  upsertUser(user: Omit<User, "id">): Promise<User>;
  createSession(userId: string, ttlMs: number): Promise<Session>;
  /** Usuário de uma sessão válida. `undefined` se expirada ou inexistente. */
  userForSession(token: string, now?: Date): Promise<User | undefined>;
  destroySession(token: string): Promise<void>;
  /** Remove sessões vencidas. Devolve quantas saíram. */
  purgeExpiredSessions(now?: Date): Promise<number>;
}

/**
 * O id da sessão que vai para o banco é o hash do segredo do cookie.
 *
 * Sem isto, quem lesse a tabela `sessions` teria o cookie de todo mundo e
 * poderia assumir qualquer conta — o mesmo raciocínio de nunca guardar senha em
 * claro.
 */
export function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export class InMemoryIdentityStore implements IdentityStore {
  readonly #users = new Map<string, User>();
  readonly #sessions = new Map<string, { userId: string; expiresAt: number }>();

  async upsertUser(user: Omit<User, "id">): Promise<User> {
    for (const existing of this.#users.values()) {
      if (existing.provider === user.provider && existing.providerAccountId === user.providerAccountId) {
        const updated = { ...existing, ...user };
        this.#users.set(existing.id, updated);
        return updated;
      }
    }
    const created = { ...user, id: randomUUID() };
    this.#users.set(created.id, created);
    return created;
  }

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const token = createSessionToken();
    const expiresAt = Date.now() + ttlMs;
    this.#sessions.set(sessionId(token), { userId, expiresAt });
    return { token, userId, expiresAt: new Date(expiresAt).toISOString() };
  }

  async userForSession(token: string, now = new Date()): Promise<User | undefined> {
    const session = this.#sessions.get(sessionId(token));
    if (!session) return undefined;
    if (session.expiresAt <= now.getTime()) {
      this.#sessions.delete(sessionId(token));
      return undefined;
    }
    return this.#users.get(session.userId);
  }

  async destroySession(token: string): Promise<void> {
    this.#sessions.delete(sessionId(token));
  }

  async purgeExpiredSessions(now = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt > now.getTime()) continue;
      this.#sessions.delete(id);
      removed += 1;
    }
    return removed;
  }
}

interface UserRow {
  id: string;
  provider: string;
  provider_account_id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    login: row.login,
    name: row.name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
  };
}

const USER_COLUMNS = "id, provider, provider_account_id, login, name, avatar_url";

export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly database: Database) {}

  async upsertUser(user: Omit<User, "id">): Promise<User> {
    const rows = await this.database.query<UserRow>(
      `insert into users (id, provider, provider_account_id, login, name, avatar_url)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (provider, provider_account_id) do update
         set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, last_seen_at = now()
       returning ${USER_COLUMNS}`,
      [randomUUID(), user.provider, user.providerAccountId, user.login, user.name ?? null, user.avatarUrl ?? null],
    );
    return toUser(rows[0] as UserRow);
  }

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.database.query("insert into sessions (id, user_id, expires_at) values ($1,$2,$3)", [sessionId(token), userId, expiresAt.toISOString()]);
    return { token, userId, expiresAt: expiresAt.toISOString() };
  }

  async userForSession(token: string, now = new Date()): Promise<User | undefined> {
    const rows = await this.database.query<UserRow>(
      `select ${USER_COLUMNS.split(", ")
        .map((column) => `u.${column}`)
        .join(", ")}
       from sessions s join users u on u.id = s.user_id
       where s.id = $1 and s.expires_at > $2`,
      [sessionId(token), now.toISOString()],
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async destroySession(token: string): Promise<void> {
    await this.database.query("delete from sessions where id = $1", [sessionId(token)]);
  }

  async purgeExpiredSessions(now = new Date()): Promise<number> {
    const rows = await this.database.query<{ id: string }>("delete from sessions where expires_at <= $1 returning id", [now.toISOString()]);
    return rows.length;
  }
}
