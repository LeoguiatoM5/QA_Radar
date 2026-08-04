import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database, DatabaseClient } from "./database.js";

/**
 * Identidade, credencial e sessão.
 *
 * A conta nasce de um cadastro com e-mail e senha; o GitHub é uma forma de
 * entrar nela, não um tipo de conta à parte. Por isso a identidade externa vive
 * em `user_identities` e não em colunas de `users`: a mesma pessoa entrando
 * pelos dois caminhos precisa cair na mesma conta, senão o histórico se parte
 * em duas sem que ela entenda o motivo.
 *
 * Continua opcional por desenho: sem banco e sem provedor, nada disso aparece e
 * o produto roda anônimo, como a CLI e o dashboard local exigem.
 */
export interface User {
  id: string;
  /** Ausente só em conta criada por provedor que não expôs e-mail verificado. */
  email: string | undefined;
  emailVerified: boolean;
  /** Identificador curto de exibição. Não é credencial e não é único. */
  login: string;
  name: string | undefined;
  avatarUrl: string | undefined;
  /** `false` em conta que só entra pelo provedor externo. */
  hasPassword: boolean;
}

export interface Session {
  /** Segredo enviado no cookie. Só existe em claro aqui e no navegador. */
  token: string;
  userId: string;
  expiresAt: string;
}

export interface PasswordCredentials {
  user: User;
  passwordHash: string;
}

export type UserTokenPurpose = "email_verification" | "password_reset";

export interface NewPasswordUser {
  email: string;
  passwordHash: string;
  login: string;
  name: string | undefined;
}

export interface ExternalIdentity {
  provider: string;
  providerAccountId: string;
  login: string;
  name: string | undefined;
  avatarUrl: string | undefined;
  /**
   * Só preencher com e-mail que o provedor garante ter verificado.
   *
   * É por este campo que uma entrada pelo GitHub encontra a conta criada por
   * cadastro. Aceitar e-mail não verificado aqui deixaria qualquer pessoa
   * declarar o endereço alheio no provedor e cair na conta de outro.
   */
  verifiedEmail: string | undefined;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("Este e-mail já tem cadastro.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export interface IdentityStore {
  createPasswordUser(input: NewPasswordUser): Promise<User>;
  userById(id: string): Promise<User | undefined>;
  userByEmail(email: string): Promise<User | undefined>;
  /** Usuário mais o hash da senha, para a verificação do login. */
  credentialsByEmail(email: string): Promise<PasswordCredentials | undefined>;
  /**
   * Resolve a entrada por provedor externo: acha pela identidade, senão vincula
   * à conta do e-mail verificado, senão cria.
   */
  userForIdentity(identity: ExternalIdentity): Promise<User>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  createSession(userId: string, ttlMs: number): Promise<Session>;
  /** Usuário de uma sessão válida. `undefined` se expirada ou inexistente. */
  userForSession(token: string, now?: Date): Promise<User | undefined>;
  destroySession(token: string): Promise<void>;
  /** Encerra toda sessão da conta. Usado depois de trocar a senha. */
  destroySessionsFor(userId: string): Promise<void>;
  /** Remove sessões vencidas. Devolve quantas saíram. */
  purgeExpiredSessions(now?: Date): Promise<number>;
  /** Emite o segredo de confirmação/redefinição. Só o hash é guardado. */
  createUserToken(userId: string, purpose: UserTokenPurpose, ttlMs: number): Promise<string>;
  /** Gasta o token: devolve o dono na primeira vez e `undefined` daí em diante. */
  consumeUserToken(secret: string, purpose: UserTokenPurpose, now?: Date): Promise<User | undefined>;
}

/**
 * O id da sessão que vai para o banco é o hash do segredo do cookie.
 *
 * Sem isto, quem lesse a tabela `sessions` teria o cookie de todo mundo e
 * poderia assumir qualquer conta — o mesmo raciocínio de nunca guardar senha em
 * claro. Vale igual para os tokens de e-mail, que também são credenciais.
 */
export function sessionId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Comparação e unicidade de e-mail são sempre sobre esta forma. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validação deliberadamente frouxa: a prova de que o endereço existe é o e-mail
 * de confirmação chegar, não uma expressão regular. O que se barra aqui é o que
 * não pode entrar no banco nem no cabeçalho de um e-mail.
 */
export function isEmailShaped(email: string): boolean {
  if (email.length < 6 || email.length > 254) return false;
  if (/[\s<>",;\\]/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local.length === 0 || domain.length < 3) return false;
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !domain.includes("..");
}

/** Apelido de exibição a partir do e-mail, quando não há nome do provedor. */
export function loginFromEmail(email: string): string {
  // O sufixo depois do "+" é endereçamento, não nome: "leo+qa" deve exibir
  // "leo", senão o apelido vira o rótulo interno que a pessoa usou no cadastro.
  const local = (normalizeEmail(email).split("@")[0] ?? "").split("+")[0] ?? "";
  const cleaned = local.replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  return cleaned.length >= 2 ? cleaned : "usuario";
}

interface StoredUser {
  id: string;
  email: string | undefined;
  emailVerifiedAt: Date | undefined;
  login: string;
  name: string | undefined;
  avatarUrl: string | undefined;
  passwordHash: string | undefined;
}

function toUser(stored: StoredUser): User {
  return {
    id: stored.id,
    email: stored.email,
    emailVerified: stored.emailVerifiedAt !== undefined,
    login: stored.login,
    name: stored.name,
    avatarUrl: stored.avatarUrl,
    hasPassword: stored.passwordHash !== undefined,
  };
}

export class InMemoryIdentityStore implements IdentityStore {
  readonly #users = new Map<string, StoredUser>();
  readonly #identities = new Map<string, string>();
  readonly #sessions = new Map<string, { userId: string; expiresAt: number }>();
  readonly #tokens = new Map<string, { userId: string; purpose: UserTokenPurpose; expiresAt: number; used: boolean }>();

  #findByEmail(email: string): StoredUser | undefined {
    const normalized = normalizeEmail(email);
    for (const user of this.#users.values()) {
      if (user.email !== undefined && normalizeEmail(user.email) === normalized) return user;
    }
    return undefined;
  }

  async createPasswordUser(input: NewPasswordUser): Promise<User> {
    const email = normalizeEmail(input.email);
    if (this.#findByEmail(email)) throw new EmailAlreadyRegisteredError();
    const created: StoredUser = {
      id: randomUUID(),
      email,
      emailVerifiedAt: undefined,
      login: input.login,
      name: input.name,
      avatarUrl: undefined,
      passwordHash: input.passwordHash,
    };
    this.#users.set(created.id, created);
    return toUser(created);
  }

  async userById(id: string): Promise<User | undefined> {
    const stored = this.#users.get(id);
    return stored ? toUser(stored) : undefined;
  }

  async userByEmail(email: string): Promise<User | undefined> {
    const stored = this.#findByEmail(email);
    return stored ? toUser(stored) : undefined;
  }

  async credentialsByEmail(email: string): Promise<PasswordCredentials | undefined> {
    const stored = this.#findByEmail(email);
    if (!stored?.passwordHash) return undefined;
    return { user: toUser(stored), passwordHash: stored.passwordHash };
  }

  async userForIdentity(identity: ExternalIdentity): Promise<User> {
    const key = `${identity.provider}:${identity.providerAccountId}`;
    const linkedId = this.#identities.get(key);
    const linked = linkedId ? this.#users.get(linkedId) : undefined;
    if (linked) {
      linked.login = identity.login;
      linked.name = identity.name ?? linked.name;
      linked.avatarUrl = identity.avatarUrl ?? linked.avatarUrl;
      if (linked.email === undefined && identity.verifiedEmail !== undefined && !this.#findByEmail(identity.verifiedEmail)) {
        linked.email = normalizeEmail(identity.verifiedEmail);
        linked.emailVerifiedAt = new Date();
      }
      return toUser(linked);
    }

    const existing = identity.verifiedEmail ? this.#findByEmail(identity.verifiedEmail) : undefined;
    if (existing) {
      this.#identities.set(key, existing.id);
      existing.avatarUrl = existing.avatarUrl ?? identity.avatarUrl;
      // Entrar pelo provedor com o mesmo endereço prova a posse dele; a conta
      // que ainda não tinha confirmado o e-mail passa a ter.
      existing.emailVerifiedAt = existing.emailVerifiedAt ?? new Date();
      return toUser(existing);
    }

    const created: StoredUser = {
      id: randomUUID(),
      email: identity.verifiedEmail ? normalizeEmail(identity.verifiedEmail) : undefined,
      emailVerifiedAt: identity.verifiedEmail ? new Date() : undefined,
      login: identity.login,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      passwordHash: undefined,
    };
    this.#users.set(created.id, created);
    this.#identities.set(key, created.id);
    return toUser(created);
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const stored = this.#users.get(userId);
    if (stored) stored.passwordHash = passwordHash;
  }

  async markEmailVerified(userId: string): Promise<void> {
    const stored = this.#users.get(userId);
    if (stored) stored.emailVerifiedAt = stored.emailVerifiedAt ?? new Date();
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
    const stored = this.#users.get(session.userId);
    return stored ? toUser(stored) : undefined;
  }

  async destroySession(token: string): Promise<void> {
    this.#sessions.delete(sessionId(token));
  }

  async destroySessionsFor(userId: string): Promise<void> {
    for (const [id, session] of this.#sessions) {
      if (session.userId === userId) this.#sessions.delete(id);
    }
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

  async createUserToken(userId: string, purpose: UserTokenPurpose, ttlMs: number): Promise<string> {
    const secret = createSessionToken();
    this.#tokens.set(sessionId(secret), { userId, purpose, expiresAt: Date.now() + ttlMs, used: false });
    return secret;
  }

  async consumeUserToken(secret: string, purpose: UserTokenPurpose, now = new Date()): Promise<User | undefined> {
    const token = this.#tokens.get(sessionId(secret));
    if (!token || token.used || token.purpose !== purpose) return undefined;
    if (token.expiresAt <= now.getTime()) return undefined;
    token.used = true;
    const stored = this.#users.get(token.userId);
    return stored ? toUser(stored) : undefined;
  }
}

interface UserRow {
  id: string;
  email: string | null;
  email_verified_at: Date | string | null;
  login: string;
  name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
}

function fromRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email ?? undefined,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : undefined,
    login: row.login,
    name: row.name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    passwordHash: row.password_hash ?? undefined,
  };
}

const USER_COLUMNS = "id, email, email_verified_at, login, name, avatar_url, password_hash";
const PREFIXED_USER_COLUMNS = USER_COLUMNS.split(", ")
  .map((column) => `u.${column}`)
  .join(", ");

/** `23505` é violação de unicidade; aqui só o índice de e-mail pode disparar. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "23505";
}

export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly database: Database) {}

  async createPasswordUser(input: NewPasswordUser): Promise<User> {
    try {
      const rows = await this.database.query<UserRow>(
        `insert into users (id, email, login, name, password_hash)
         values ($1,$2,$3,$4,$5)
         returning ${USER_COLUMNS}`,
        [randomUUID(), normalizeEmail(input.email), input.login, input.name ?? null, input.passwordHash],
      );
      return toUser(fromRow(rows[0] as UserRow));
    } catch (error) {
      // A checagem prévia não basta: dois cadastros simultâneos com o mesmo
      // e-mail passariam os dois pelo `select` e só o índice separaria.
      if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError();
      throw error;
    }
  }

  async userById(id: string): Promise<User | undefined> {
    const rows = await this.database.query<UserRow>(`select ${USER_COLUMNS} from users where id = $1`, [id]);
    return rows[0] ? toUser(fromRow(rows[0])) : undefined;
  }

  async userByEmail(email: string): Promise<User | undefined> {
    const rows = await this.database.query<UserRow>(`select ${USER_COLUMNS} from users where lower(email) = $1`, [normalizeEmail(email)]);
    return rows[0] ? toUser(fromRow(rows[0])) : undefined;
  }

  async credentialsByEmail(email: string): Promise<PasswordCredentials | undefined> {
    const rows = await this.database.query<UserRow>(`select ${USER_COLUMNS} from users where lower(email) = $1 and password_hash is not null`, [normalizeEmail(email)]);
    if (!rows[0]) return undefined;
    const stored = fromRow(rows[0]);
    return { user: toUser(stored), passwordHash: stored.passwordHash as string };
  }

  /**
   * Numa transação só: achar a identidade, vincular pelo e-mail verificado ou
   * criar são passos que decidem se a pessoa entra na conta certa. Em paralelo,
   * dois retornos do provedor ao mesmo tempo poderiam criar duas contas.
   */
  async userForIdentity(identity: ExternalIdentity): Promise<User> {
    const verifiedEmail = identity.verifiedEmail ? normalizeEmail(identity.verifiedEmail) : undefined;
    return this.database.transaction(async (client: DatabaseClient) => {
      const linked = await client.query<UserRow>(
        `select ${PREFIXED_USER_COLUMNS}
         from user_identities i join users u on u.id = i.user_id
         where i.provider = $1 and i.provider_account_id = $2
         for update of u`,
        [identity.provider, identity.providerAccountId],
      );
      if (linked[0]) {
        const rows = await client.query<UserRow>(
          `update users set
             login = $2,
             name = coalesce($3, name),
             avatar_url = coalesce($4, avatar_url),
             email = case when email is null then $5 else email end,
             email_verified_at = case when email is null and $5 is not null then now() else email_verified_at end,
             last_seen_at = now()
           where id = $1
           returning ${USER_COLUMNS}`,
          [linked[0].id, identity.login, identity.name ?? null, identity.avatarUrl ?? null, verifiedEmail ?? null],
        );
        return toUser(fromRow(rows[0] as UserRow));
      }

      if (verifiedEmail) {
        const existing = await client.query<UserRow>(`select ${USER_COLUMNS} from users where lower(email) = $1 for update`, [verifiedEmail]);
        if (existing[0]) {
          await client.query("insert into user_identities (provider, provider_account_id, user_id) values ($1,$2,$3) on conflict do nothing", [
            identity.provider,
            identity.providerAccountId,
            existing[0].id,
          ]);
          const rows = await client.query<UserRow>(
            `update users set
               avatar_url = coalesce(avatar_url, $2),
               email_verified_at = coalesce(email_verified_at, now()),
               last_seen_at = now()
             where id = $1
             returning ${USER_COLUMNS}`,
            [existing[0].id, identity.avatarUrl ?? null],
          );
          return toUser(fromRow(rows[0] as UserRow));
        }
      }

      const rows = await client.query<UserRow>(
        `insert into users (id, email, email_verified_at, login, name, avatar_url)
         values ($1,$2,$3,$4,$5,$6)
         returning ${USER_COLUMNS}`,
        [randomUUID(), verifiedEmail ?? null, verifiedEmail ? new Date().toISOString() : null, identity.login, identity.name ?? null, identity.avatarUrl ?? null],
      );
      const created = rows[0] as UserRow;
      await client.query("insert into user_identities (provider, provider_account_id, user_id) values ($1,$2,$3)", [identity.provider, identity.providerAccountId, created.id]);
      return toUser(fromRow(created));
    });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.database.query("update users set password_hash = $2 where id = $1", [userId, passwordHash]);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.database.query("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]);
  }

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.database.query("insert into sessions (id, user_id, expires_at) values ($1,$2,$3)", [sessionId(token), userId, expiresAt.toISOString()]);
    return { token, userId, expiresAt: expiresAt.toISOString() };
  }

  async userForSession(token: string, now = new Date()): Promise<User | undefined> {
    const rows = await this.database.query<UserRow>(
      `select ${PREFIXED_USER_COLUMNS}
       from sessions s join users u on u.id = s.user_id
       where s.id = $1 and s.expires_at > $2`,
      [sessionId(token), now.toISOString()],
    );
    return rows[0] ? toUser(fromRow(rows[0])) : undefined;
  }

  async destroySession(token: string): Promise<void> {
    await this.database.query("delete from sessions where id = $1", [sessionId(token)]);
  }

  async destroySessionsFor(userId: string): Promise<void> {
    await this.database.query("delete from sessions where user_id = $1", [userId]);
  }

  async purgeExpiredSessions(now = new Date()): Promise<number> {
    const rows = await this.database.query<{ id: string }>("delete from sessions where expires_at <= $1 returning id", [now.toISOString()]);
    return rows.length;
  }

  async createUserToken(userId: string, purpose: UserTokenPurpose, ttlMs: number): Promise<string> {
    const secret = createSessionToken();
    await this.database.query("insert into user_tokens (id, user_id, purpose, expires_at) values ($1,$2,$3,$4)", [sessionId(secret), userId, purpose, new Date(Date.now() + ttlMs).toISOString()]);
    return secret;
  }

  /**
   * A marcação de uso vai na mesma instrução que seleciona, com `used_at is
   * null` na condição: dois cliques no mesmo link de redefinição não podem
   * conceder duas vezes.
   */
  async consumeUserToken(secret: string, purpose: UserTokenPurpose, now = new Date()): Promise<User | undefined> {
    const rows = await this.database.query<{ user_id: string }>(
      `update user_tokens set used_at = now()
       where id = $1 and purpose = $2 and used_at is null and expires_at > $3
       returning user_id`,
      [sessionId(secret), purpose, now.toISOString()],
    );
    return rows[0] ? this.userById(rows[0].user_id) : undefined;
  }
}
