import { json, jsonError, readJson, textField } from "../http-helpers.js";
import { issueOAuthState, verifyOAuthState } from "../oauth.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { passwordResetEmail, verificationEmail } from "../email.js";
import { assertPasswordAcceptable, burnPasswordTime, hashPassword, verifyPassword, WeakPasswordError } from "../password.js";
import { EmailAlreadyRegisteredError, isEmailShaped, loginFromEmail, normalizeEmail, type IdentityStore, type User, type UserTokenPurpose } from "../identity.js";
import type { RequestContext, RouteHandler } from "./context.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE = "qa_radar_session";

/** Duração da sessão. Longa o bastante para não pedir login toda semana. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60_000;
export const PASSWORD_RESET_TTL_MS = 60 * 60_000;

/** Teto do corpo: nenhuma requisição de conta precisa de mais que isso. */
const MAX_AUTH_BODY_BYTES = 4 * 1024;

/**
 * Mensagem única para e-mail inexistente e senha errada.
 *
 * Duas mensagens distintas transformariam a tela de login numa consulta de quem
 * tem conta aqui — junto com o tempo de resposta igualado em `burnPasswordTime`,
 * é o que impede descobrir cadastros por tentativa.
 */
const INVALID_CREDENTIALS = "E-mail ou senha incorretos.";

export function sessionCookie(request: IncomingMessage, token: string, maxAgeSeconds: number, trustProxy: boolean): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const secure = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted) || (trustProxy && forwardedProto === "https");
  // Lax, e não Strict: o retorno do provedor é uma navegação vinda de outro
  // site, e com Strict o cookie não acompanharia — a pessoa voltaria deslogada.
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sessionTokenFrom(request: IncomingMessage): string | undefined {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : undefined;
}

function redirect(response: ServerResponse, location: string, cookie?: string): void {
  response.writeHead(302, {
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    ...(cookie ? { "set-cookie": cookie } : {}),
  });
  response.end();
}

/** Origem pública desta instância, para montar link de e-mail e retorno do OAuth. */
function originFor(request: IncomingMessage, trustProxy: boolean): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const encrypted = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
  const protocol = encrypted || (trustProxy && forwardedProto === "https") ? "https" : "http";
  const forwardedHost = trustProxy ? request.headers["x-forwarded-host"] : undefined;
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host ?? "127.0.0.1";
  return `${protocol}://${host}`;
}

/** A URL de retorno tem de bater com a cadastrada no provedor. */
function callbackUrl(request: IncomingMessage, trustProxy: boolean): string {
  return `${originFor(request, trustProxy)}/api/v1/auth/github/callback`;
}

function publicUser(user: User): Record<string, unknown> {
  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    email: user.email,
    emailVerified: user.emailVerified,
    hasPassword: user.hasPassword,
  };
}

/**
 * Tentativas por janela.
 *
 * Contadas por IP **e** por e-mail: só por IP, quem tem muitos endereços de
 * origem segue tentando a mesma conta; só por e-mail, um atacante varre contas
 * diferentes sem nunca estourar o limite.
 */
function enforceAuthRate(context: RequestContext, request: IncomingMessage, action: string, email: string | undefined): void {
  const scopes = [`${action}|ip|${context.clientAddress(request)}`];
  if (email) scopes.push(`${action}|email|${normalizeEmail(email)}`);
  for (const scope of scopes) {
    const decision = context.authRateLimiter.consume(scope);
    if (decision.allowed) continue;
    throw new ApiError("rate_limited", "Tentativas demais. Espere um pouco e tente de novo.", {
      "retry-after": decision.retryAfterSeconds ?? 60,
    });
  }
}

function requireIdentity(context: RequestContext): IdentityStore {
  if (!context.identity) {
    throw new ApiError("feature_disabled", "Contas não estão disponíveis neste servidor.");
  }
  return context.identity;
}

/**
 * O envio nunca derruba a operação que o disparou.
 *
 * Um cadastro recusado porque o provedor de e-mail piscou seria pior do que uma
 * conta criada sem a mensagem de confirmação, que a pessoa pode reenviar.
 */
async function sendQuietly(context: RequestContext, message: Parameters<RequestContext["emailSender"]["send"]>[0]): Promise<boolean> {
  try {
    await context.emailSender.send(message);
    return context.emailSender.delivers;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ source: "qa-radar", event: "email.failed", timestamp: new Date().toISOString(), subject: message.subject, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return false;
  }
}

async function issueEmailLink(context: RequestContext, request: IncomingMessage, identity: IdentityStore, user: User, purpose: UserTokenPurpose): Promise<boolean> {
  if (!user.email) return false;
  const ttlMs = purpose === "email_verification" ? EMAIL_VERIFICATION_TTL_MS : PASSWORD_RESET_TTL_MS;
  const secret = await identity.createUserToken(user.id, purpose, ttlMs);
  const origin = originFor(request, context.config.trustProxy);
  if (purpose === "email_verification") {
    const url = `${origin}/api/v1/auth/verify?token=${encodeURIComponent(secret)}`;
    return sendQuietly(context, verificationEmail(user.email, url, ttlMs / 3_600_000));
  }
  const url = `${origin}/entrar?redefinir=${encodeURIComponent(secret)}`;
  return sendQuietly(context, passwordResetEmail(user.email, url, ttlMs / 60_000));
}

async function startSession(context: RequestContext, request: IncomingMessage, response: ServerResponse, identity: IdentityStore, userId: string): Promise<void> {
  const session = await identity.createSession(userId, SESSION_TTL_MS);
  response.setHeader("set-cookie", sessionCookie(request, session.token, Math.floor(SESSION_TTL_MS / 1000), context.config.trustProxy));
}

export const tryHandleAuth: RouteHandler = async (context, request, response, url) => {
  const { config, identity, oauthProvider } = context;

  // Quem a requisição é, se for alguém. Sempre disponível, mesmo sem provedor:
  // é o que a interface consulta para decidir entre "Entrar" e o perfil.
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await context.currentUser(request);
    json(response, 200, {
      authenticated: Boolean(user),
      // Passou a significar "dá para entrar de alguma forma", e não mais só
      // GitHub: com cadastro por senha o provedor externo virou um dos caminhos.
      loginAvailable: Boolean(identity),
      githubAvailable: Boolean(oauthProvider),
      // Sem provedor de e-mail não há como devolver acesso a quem esquecer a
      // senha, então a interface não pode oferecer o link.
      passwordResetAvailable: Boolean(identity) && context.emailSender.delivers,
      ...(user ? { user: publicUser(user) } : {}),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const store = requireIdentity(context);
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const email = textField(body, "email");
    const password = typeof body.password === "string" ? body.password : undefined;
    if (!email || !isEmailShaped(email)) throw invalidRequest("Informe um e-mail válido.");
    enforceAuthRate(context, request, "register", email);
    if (!password) throw invalidRequest("Informe uma senha.");
    try {
      assertPasswordAcceptable(password, email);
    } catch (error) {
      if (error instanceof WeakPasswordError) throw invalidRequest(error.message);
      throw error;
    }

    const name = textField(body, "name");
    let user: User;
    try {
      user = await store.createPasswordUser({ email: normalizeEmail(email), passwordHash: await hashPassword(password), login: loginFromEmail(email), name });
    } catch (error) {
      // Conflito explícito, e não mensagem neutra: aqui a pessoa está tentando
      // criar a própria conta e precisa saber que já tem uma para entrar nela.
      if (error instanceof EmailAlreadyRegisteredError) throw new ApiError("conflict", "Este e-mail já tem cadastro. Entre com sua senha.");
      throw error;
    }

    await startSession(context, request, response, store, user.id);
    const emailSent = await issueEmailLink(context, request, store, user, "email_verification");
    json(response, 201, { authenticated: true, user: publicUser(user), verificationEmailSent: emailSent });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const store = requireIdentity(context);
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const email = textField(body, "email");
    const password = typeof body.password === "string" ? body.password : undefined;
    enforceAuthRate(context, request, "login", email);
    if (!email || !password) throw invalidRequest("Informe e-mail e senha.");

    const credentials = await store.credentialsByEmail(email);
    if (!credentials) {
      // Gasta o mesmo tempo do caminho válido antes de recusar.
      await burnPasswordTime(password);
      throw new ApiError("unauthorized", INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(password, credentials.passwordHash))) {
      throw new ApiError("unauthorized", INVALID_CREDENTIALS);
    }

    await startSession(context, request, response, store, credentials.user.id);
    json(response, 200, { authenticated: true, user: publicUser(credentials.user) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = sessionTokenFrom(request);
    if (token && identity) await identity.destroySession(token);
    response.setHeader("set-cookie", clearedSessionCookie());
    json(response, 200, { authenticated: false });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/verify/request") {
    const store = requireIdentity(context);
    const user = await context.currentUser(request);
    if (!user) throw new ApiError("unauthorized", "Entre para reenviar a confirmação.");
    if (!user.email) throw invalidRequest("Sua conta não tem e-mail cadastrado.");
    if (user.emailVerified) {
      json(response, 200, { verified: true, sent: false });
      return true;
    }
    enforceAuthRate(context, request, "verify", user.email);
    const sent = await issueEmailLink(context, request, store, user, "email_verification");
    json(response, 202, { verified: false, sent });
    return true;
  }

  // Link de e-mail: precisa ser GET porque é o que um cliente de e-mail abre. O
  // token é de uso único, então abrir duas vezes não concede nada duas vezes.
  if (request.method === "GET" && url.pathname === "/api/auth/verify") {
    const store = requireIdentity(context);
    const token = url.searchParams.get("token");
    if (!token) throw invalidRequest("Link de confirmação incompleto.");
    const user = await store.consumeUserToken(token, "email_verification");
    if (!user) {
      redirect(response, "/entrar?erro=confirmacao");
      return true;
    }
    await store.markEmailVerified(user.id);
    // Confirmar já deixa a pessoa dentro: ela acabou de provar que é dona do
    // endereço, e mandá-la para uma tela de login seria pedir a mesma prova duas
    // vezes. A sessão anterior, se houver, é substituída.
    await startSession(context, request, response, store, user.id);
    redirect(response, "/?confirmado=1");
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password/forgot") {
    const store = requireIdentity(context);
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const email = textField(body, "email");
    if (!email || !isEmailShaped(email)) throw invalidRequest("Informe um e-mail válido.");
    enforceAuthRate(context, request, "forgot", email);
    if (!context.emailSender.delivers) {
      throw new ApiError("feature_disabled", "Este servidor não envia e-mail, então não há como redefinir a senha por aqui.");
    }
    const user = await store.userByEmail(email);
    // Resposta idêntica exista ou não a conta: o contrário publicaria quem tem
    // cadastro para qualquer um que digitasse um endereço.
    if (user?.email) await issueEmailLink(context, request, store, user, "password_reset");
    json(response, 202, { requested: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password/reset") {
    const store = requireIdentity(context);
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    const token = textField(body, "token");
    const password = typeof body.password === "string" ? body.password : undefined;
    if (!token) throw invalidRequest("Link de redefinição incompleto.");
    enforceAuthRate(context, request, "reset", undefined);
    if (!password) throw invalidRequest("Informe a nova senha.");

    const user = await store.consumeUserToken(token, "password_reset");
    if (!user) throw new ApiError("unauthorized", "Este link de redefinição expirou ou já foi usado. Peça outro.");
    try {
      assertPasswordAcceptable(password, user.email);
    } catch (error) {
      if (error instanceof WeakPasswordError) throw invalidRequest(error.message);
      throw error;
    }

    await store.setPassword(user.id, await hashPassword(password));
    // Receber o link prova a posse do endereço; confirmar aqui evita pedir a
    // mesma prova de novo depois.
    await store.markEmailVerified(user.id);
    // Toda sessão antiga cai: se a senha foi redefinida porque alguém entrou na
    // conta, deixar a sessão dele viva tornaria a redefinição inútil.
    await store.destroySessionsFor(user.id);
    await startSession(context, request, response, store, user.id);
    json(response, 200, { authenticated: true, user: publicUser({ ...user, hasPassword: true, emailVerified: true }) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github") {
    if (!oauthProvider || !identity) {
      jsonError(response, "feature_disabled", "Login por GitHub não está configurado neste servidor.");
      return true;
    }
    const state = issueOAuthState(config.sessionSecret);
    redirect(response, oauthProvider.authorizationUrl(state, callbackUrl(request, config.trustProxy)));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github/callback") {
    if (!oauthProvider || !identity) {
      jsonError(response, "feature_disabled", "Login por GitHub não está configurado neste servidor.");
      return true;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // Sem estado válido a requisição não veio de um início de login deste
    // servidor: é exatamente o CSRF que o parâmetro existe para barrar.
    if (!state || !verifyOAuthState(config.sessionSecret, state)) {
      throw invalidRequest("O login expirou ou não começou aqui. Tente novamente.");
    }
    if (!code) throw invalidRequest("O provedor não devolveu o código de autorização.");

    const profile = await oauthProvider.profileFor(code, callbackUrl(request, config.trustProxy));
    const user = await identity.userForIdentity({
      provider: oauthProvider.name,
      providerAccountId: profile.providerAccountId,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      verifiedEmail: profile.verifiedEmail,
    });
    const session = await identity.createSession(user.id, SESSION_TTL_MS);
    redirect(response, "/", sessionCookie(request, session.token, Math.floor(SESSION_TTL_MS / 1000), config.trustProxy));
    return true;
  }

  return false;
};
