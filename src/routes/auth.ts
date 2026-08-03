import { json, jsonError } from "../http-helpers.js";
import { issueOAuthState, verifyOAuthState } from "../oauth.js";
import { invalidRequest } from "../api-error.js";
import type { RouteHandler } from "./context.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE = "qa_radar_session";

/** Duração da sessão. Longa o bastante para não pedir login toda semana. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

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

/** A URL de retorno tem de bater com a cadastrada no provedor. */
function callbackUrl(request: IncomingMessage, trustProxy: boolean): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const encrypted = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
  const protocol = encrypted || (trustProxy && forwardedProto === "https") ? "https" : "http";
  const forwardedHost = trustProxy ? request.headers["x-forwarded-host"] : undefined;
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host ?? "127.0.0.1";
  return `${protocol}://${host}/api/v1/auth/github/callback`;
}

export const tryHandleAuth: RouteHandler = async (context, request, response, url) => {
  const { config, identity, oauthProvider } = context;

  // Quem a requisição é, se for alguém. Sempre disponível, mesmo sem provedor:
  // é o que a interface consulta para decidir entre "Entrar" e o perfil.
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await context.currentUser(request);
    json(response, 200, {
      authenticated: Boolean(user),
      loginAvailable: Boolean(oauthProvider),
      ...(user ? { user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl } } : {}),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = sessionTokenFrom(request);
    if (token && identity) await identity.destroySession(token);
    response.setHeader("set-cookie", clearedSessionCookie());
    json(response, 200, { authenticated: false });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github") {
    if (!oauthProvider || !identity) {
      jsonError(response, "feature_disabled", "Login não está configurado neste servidor.");
      return true;
    }
    const state = issueOAuthState(config.sessionSecret);
    redirect(response, oauthProvider.authorizationUrl(state, callbackUrl(request, config.trustProxy)));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/github/callback") {
    if (!oauthProvider || !identity) {
      jsonError(response, "feature_disabled", "Login não está configurado neste servidor.");
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
    const user = await identity.upsertUser({
      provider: oauthProvider.name,
      providerAccountId: profile.providerAccountId,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    });
    const session = await identity.createSession(user.id, SESSION_TTL_MS);
    redirect(response, "/", sessionCookie(request, session.token, Math.floor(SESSION_TTL_MS / 1000), config.trustProxy));
    return true;
  }

  return false;
};
