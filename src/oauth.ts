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
  /**
   * Só é preenchido quando o provedor afirma que o endereço está **verificado**.
   *
   * É por ele que quem já se cadastrou com e-mail e senha cai na própria conta
   * ao entrar pelo GitHub, em vez de ganhar uma segunda conta vazia. Por isso o
   * e-mail apenas declarado no perfil público não serve: qualquer pessoa pode
   * escrever o endereço de outra ali.
   */
  verifiedEmail: string | undefined;
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

/**
 * O e-mail principal e verificado, quando houver.
 *
 * Falhar aqui não pode impedir a entrada: quem revoga `user:email` ou tem só
 * endereços não verificados continua entrando, apenas sem o vínculo automático
 * com uma conta de mesmo e-mail. Por isso a falha vira `undefined` e não exceção.
 */
async function primaryVerifiedEmail(fetchImpl: typeof fetch, accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetchImpl("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "qa-radar" },
    });
    if (!response.ok) return undefined;
    const emails = (await response.json()) as { email?: string; primary?: boolean; verified?: boolean }[];
    if (!Array.isArray(emails)) return undefined;
    const verified = emails.filter((entry) => entry.verified === true && typeof entry.email === "string");
    return (verified.find((entry) => entry.primary === true) ?? verified[0])?.email;
  } catch {
    return undefined;
  }
}

export function createGitHubOAuthProvider(config: GitHubOAuthConfig, fetchImpl: typeof fetch = fetch): OAuthProvider {
  return {
    name: "github",

    authorizationUrl(state, redirectUri) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      // Identidade e e-mail, nada além: o QA Radar não lê repositório nenhum.
      // `user:email` entrou porque sem ele não há como saber que quem está
      // entrando é a mesma pessoa que já se cadastrou com e-mail e senha.
      url.searchParams.set("scope", "read:user user:email");
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
        verifiedEmail: await primaryVerifiedEmail(fetchImpl, token.access_token),
      };
    },
  };
}
