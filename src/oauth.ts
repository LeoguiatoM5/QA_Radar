import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Login por OAuth.
 *
 * Opcional como o resto: sem `clientId`/`clientSecret` o provedor não existe, a
 * interface não mostra entrada e o produto segue anônimo.
 *
 * A troca do código por perfil vive atrás de `OAuthProvider` para que o fluxo
 * inteiro — estado, cookie, sessão, redirecionamento — seja testável sem
 * depender do GitHub estar no ar.
 */
export interface OAuthProfile {
  providerAccountId: string;
  login: string;
  name: string | undefined;
  avatarUrl: string | undefined;
}

export interface OAuthProvider {
  readonly name: string;
  /** Para onde mandar a pessoa, já com o estado anti-CSRF embutido. */
  authorizationUrl(state: string, redirectUri: string): string;
  /** Troca o código pelo perfil. Lança se o código for inválido. */
  profileFor(code: string, redirectUri: string): Promise<OAuthProfile>;
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Janela do estado: curta porque o usuário vai e volta do provedor na hora. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

/**
 * O estado é assinado em vez de guardado.
 *
 * Assim não há tabela nem memória de estados pendentes para expirar ou crescer,
 * e o servidor consegue validar o retorno mesmo tendo reiniciado no meio do
 * fluxo. O valor carrega o instante de emissão, então também expira sozinho.
 */
export function issueOAuthState(secret: string, now = Date.now()): string {
  const payload = `${now}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyOAuthState(secret: string, state: string, now = Date.now()): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${issuedAt}.${nonce}`).digest("base64url");
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  // Comparação em tempo constante: o estado é uma credencial de curta duração.
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) return false;
  const timestamp = Number(issuedAt);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= OAUTH_STATE_TTL_MS;
}

export function createGitHubOAuthProvider(config: GitHubOAuthConfig, fetchImpl: typeof fetch = fetch): OAuthProvider {
  return {
    name: "github",

    authorizationUrl(state, redirectUri) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      // Só a identidade pública: o QA Radar não precisa ler repositório nenhum,
      // e pedir menos é o que faz a tela de autorização não assustar.
      url.searchParams.set("scope", "read:user");
      return url.toString();
    },

    async profileFor(code, redirectUri) {
      const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
      });
      const token = (await tokenResponse.json()) as { access_token?: string; error_description?: string };
      if (!tokenResponse.ok || !token.access_token) {
        throw new Error(token.error_description ?? "O GitHub recusou o código de autorização.");
      }
      const userResponse = await fetchImpl("https://api.github.com/user", {
        headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "qa-radar" },
      });
      if (!userResponse.ok) throw new Error("Não foi possível ler o perfil no GitHub.");
      const profile = (await userResponse.json()) as { id?: number; login?: string; name?: string | null; avatar_url?: string | null };
      if (profile.id === undefined || !profile.login) throw new Error("O GitHub devolveu um perfil incompleto.");
      return {
        providerAccountId: String(profile.id),
        login: profile.login,
        name: profile.name ?? undefined,
        avatarUrl: profile.avatar_url ?? undefined,
      };
    },
  };
}
