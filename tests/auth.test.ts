import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { issueOAuthState, verifyOAuthState, OAUTH_STATE_TTL_MS, type OAuthProvider } from "../src/oauth.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";

/** Provedor falso: o fluxo inteiro sem depender do GitHub estar no ar. */
function fakeProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    name: "github",
    authorizationUrl: (state, redirectUri) => `https://provedor.exemplo/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    profileFor: async (code) => {
      if (code !== "codigo-bom") throw new Error("código inválido");
      return { providerAccountId: "42", login: "leo", name: "Leo", avatarUrl: undefined };
    },
    ...overrides,
  };
}

async function startServer(overrides: Parameters<typeof createQaRadarServer>[0] = {}) {
  const server = createQaRadarServer({ allowPrivateTargets: true, sessionSecret: SECRET, ...overrides });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, baseUrl, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("oauth state", () => {
  it("aceita o próprio estado e recusa o de outro segredo", () => {
    // É o que impede alguém de forjar um retorno de login.
    const state = issueOAuthState(SECRET);
    assert.equal(verifyOAuthState(SECRET, state), true);
    assert.equal(verifyOAuthState("outro-segredo-de-32-bytes-aqui!!", state), false);
  });

  it("recusa estado adulterado ou malformado", () => {
    const state = issueOAuthState(SECRET);
    assert.equal(verifyOAuthState(SECRET, `${state}x`), false);
    assert.equal(verifyOAuthState(SECRET, "qualquer-coisa"), false);
    assert.equal(verifyOAuthState(SECRET, ""), false);
  });

  it("expira, para um retorno antigo não valer para sempre", () => {
    const emitido = Date.now();
    const state = issueOAuthState(SECRET, emitido);
    assert.equal(verifyOAuthState(SECRET, state, emitido + OAUTH_STATE_TTL_MS - 1000), true);
    assert.equal(verifyOAuthState(SECRET, state, emitido + OAUTH_STATE_TTL_MS + 1000), false);
  });
});

describe("login", () => {
  it("declara login indisponível quando não há provedor", async () => {
    // O produto continua inteiro sem login; a interface só não oferece entrada.
    const { baseUrl, close } = await startServer();
    try {
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`)).json()) as { authenticated: boolean; loginAvailable: boolean };
      assert.deepEqual(me, { authenticated: false, loginAvailable: false });
      const start = await fetch(`${baseUrl}/api/v1/auth/github`, { redirect: "manual" });
      assert.equal(start.status, 403);
      assert.equal(((await start.json()) as { code: string }).code, "feature_disabled");
    } finally {
      await close();
    }
  });

  it("leva ao provedor com estado assinado", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), oauthProvider: fakeProvider() });
    try {
      const start = await fetch(`${baseUrl}/api/v1/auth/github`, { redirect: "manual" });
      assert.equal(start.status, 302);
      const location = new URL(start.headers.get("location") ?? "");
      assert.equal(location.origin, "https://provedor.exemplo");
      assert.equal(verifyOAuthState(SECRET, location.searchParams.get("state") ?? ""), true);
      assert.match(location.searchParams.get("redirect_uri") ?? "", /\/api\/v1\/auth\/github\/callback$/);
    } finally {
      await close();
    }
  });

  it("completa o login e devolve a sessão num cookie", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), oauthProvider: fakeProvider() });
    try {
      const state = issueOAuthState(SECRET);
      const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      assert.equal(callback.status, 302);
      const cookie = callback.headers.get("set-cookie") ?? "";
      assert.match(cookie, /^qa_radar_session=/);
      assert.match(cookie, /HttpOnly/);
      // Lax e não Strict: o retorno do provedor é navegação vinda de outro site
      // e com Strict o cookie não acompanharia — voltaria deslogado.
      assert.match(cookie, /SameSite=Lax/);

      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: cookie.split(";")[0] ?? "" } })).json()) as { authenticated: boolean; user?: { login: string } };
      assert.equal(me.authenticated, true);
      assert.equal(me.user?.login, "leo");
    } finally {
      await close();
    }
  });

  it("recusa o retorno sem estado válido", async () => {
    // Sem isto, qualquer site poderia disparar um retorno e logar a vítima
    // numa conta escolhida por ele.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), oauthProvider: fakeProvider() });
    try {
      const semEstado = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom`, { redirect: "manual" });
      assert.equal(semEstado.status, 400);
      const forjado = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=inventado`, { redirect: "manual" });
      assert.equal(forjado.status, 400);
      assert.equal(((await forjado.json()) as { code: string }).code, "invalid_request");
    } finally {
      await close();
    }
  });

  it("encerra a sessão no logout", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), oauthProvider: fakeProvider() });
    try {
      const state = issueOAuthState(SECRET);
      const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      const cookie = (callback.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { cookie } });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);

      // O cookie antigo não vale mais nem se for reenviado.
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } })).json()) as { authenticated: boolean };
      assert.equal(me.authenticated, false);
    } finally {
      await close();
    }
  });
});

describe("jornada e autenticação", () => {
  const remoteHeaders = { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" };
  const codeMode = { allowCodeMode: true, trustProxy: true, codeModeAdminToken: "token-administrativo-com-32-bytes" };

  it("pede para entrar quando ninguém está autenticado", async () => {
    // A mensagem passou a ser sobre entrar, não sobre token administrativo:
    // token continua existindo, mas para automação.
    const { baseUrl, close } = await startServer({ ...codeMode, identity: new InMemoryIdentityStore(), oauthProvider: fakeProvider() });
    try {
      const response = await fetch(`${baseUrl}/api/v1/code-execution`, {
        method: "POST",
        headers: remoteHeaders,
        body: JSON.stringify({ code: "test('x', () => {});" }),
      });
      assert.equal(response.status, 401);
      assert.match(((await response.json()) as { error: string }).error, /Entre com sua conta/);
    } finally {
      await close();
    }
  });

  it("deixa quem entrou rodar a jornada sem token administrativo", async () => {
    const identity = new InMemoryIdentityStore();
    let executed = false;
    const { baseUrl, close } = await startServer({
      ...codeMode,
      identity,
      oauthProvider: fakeProvider(),
      hostedCodeRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
    });
    try {
      const state = issueOAuthState(SECRET);
      const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      const cookie = (callback.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const response = await fetch(`${baseUrl}/api/v1/code-execution`, {
        method: "POST",
        headers: { ...remoteHeaders, cookie },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('x', async () => {});" }),
      });
      assert.equal(response.status, 200, "logado deveria rodar a jornada");
      assert.equal(executed, true);
    } finally {
      await close();
    }
  });

  it("mantém o token administrativo funcionando para automação", async () => {
    let executed = false;
    const { baseUrl, close } = await startServer({
      ...codeMode,
      identity: new InMemoryIdentityStore(),
      oauthProvider: fakeProvider(),
      hostedCodeRunner: async () => {
        executed = true;
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
    });
    try {
      const response = await fetch(`${baseUrl}/api/v1/code-execution`, {
        method: "POST",
        headers: { ...remoteHeaders, authorization: "Bearer token-administrativo-com-32-bytes" },
        body: JSON.stringify({ code: "import { test } from '@playwright/test'; test('x', async () => {});" }),
      });
      assert.equal(response.status, 200);
      assert.equal(executed, true);
    } finally {
      await close();
    }
  });
});
