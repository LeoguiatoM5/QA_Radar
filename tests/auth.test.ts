import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { issueOAuthState, verifyOAuthState, OAUTH_STATE_TTL_MS, type OAuthProvider } from "../src/oauth.js";
import { InMemoryScanJobRepository } from "../src/scan-job-repository.js";
import { createScanJobPersistence } from "../src/scan-job-persistence.js";
import type { EmailMessage, EmailSender } from "../src/email.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";

/** Provedor falso: o fluxo inteiro sem depender do GitHub estar no ar. */
function fakeProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
  return {
    name: "github",
    authorizationUrl: (state, redirectUri) => `https://provedor.exemplo/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    profileFor: async (code) => {
      if (code !== "codigo-bom") throw new Error("código inválido");
      return { providerAccountId: "42", login: "leo", name: "Leo", avatarUrl: undefined, verifiedEmail: undefined };
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
  it("declara conta indisponível quando não há onde guardá-la", async () => {
    // O produto continua inteiro sem contas; a interface só não oferece entrada.
    const { baseUrl, close } = await startServer();
    try {
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`)).json()) as Record<string, unknown>;
      assert.deepEqual(me, { authenticated: false, loginAvailable: false, githubAvailable: false, passwordResetAvailable: false });
      const start = await fetch(`${baseUrl}/api/v1/auth/github`, { redirect: "manual" });
      assert.equal(start.status, 403);
      assert.equal(((await start.json()) as { code: string }).code, "feature_disabled");
      // Cadastro também some junto: sem banco não há conta nenhuma.
      const cadastro = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@exemplo.com", password: "senha-bem-comprida" }),
      });
      assert.equal(cadastro.status, 403);
      assert.equal(((await cadastro.json()) as { code: string }).code, "feature_disabled");
    } finally {
      await close();
    }
  });

  it("anuncia a entrada por senha mesmo sem provedor externo configurado", async () => {
    // Cadastro por e-mail não pode depender do GitHub estar configurado.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`)).json()) as { loginAvailable: boolean; githubAvailable: boolean };
      assert.equal(me.loginAvailable, true);
      assert.equal(me.githubAvailable, false);
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

describe("cadastro e entrada por senha", () => {
  /** Provedor de e-mail falso: guarda o que teria sido enviado. */
  function fakeEmail(): EmailSender & { sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      name: "fake",
      delivers: true,
      sent,
      async send(message) {
        sent.push(message);
      },
    };
  }

  /** Extrai o segredo do link que foi para o e-mail. */
  function tokenFrom(message: EmailMessage, parameter: string): string {
    const match = new RegExp(`[?&]${parameter}=([^\\s"&<]+)`).exec(message.text);
    assert.ok(match, `o e-mail deveria trazer o parâmetro ${parameter}`);
    return decodeURIComponent(match[1] as string);
  }

  async function register(baseUrl: string, email: string, password: string, name?: string) {
    return fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
  }

  async function login(baseUrl: string, email: string, password: string) {
    return fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  }

  it("cria a conta, já entra e manda o e-mail de confirmação", async () => {
    const emailSender = fakeEmail();
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), emailSender });
    try {
      const response = await register(baseUrl, "Pessoa@Exemplo.com", "uma-senha-comprida", "Pessoa");
      assert.equal(response.status, 201);
      const body = (await response.json()) as { user: { email: string; emailVerified: boolean; hasPassword: boolean } };
      assert.equal(body.user.email, "pessoa@exemplo.com", "o e-mail é guardado normalizado");
      assert.equal(body.user.emailVerified, false);
      assert.equal(body.user.hasPassword, true);

      const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      assert.match(cookie, /^qa_radar_session=/, "cadastrar já deixa a pessoa dentro");
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } })).json()) as { authenticated: boolean };
      assert.equal(me.authenticated, true);

      assert.equal(emailSender.sent.length, 1);
      assert.equal(emailSender.sent[0]?.to, "pessoa@exemplo.com");
    } finally {
      await close();
    }
  });

  it("recusa o segundo cadastro com o mesmo e-mail", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      assert.equal((await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida")).status, 201);
      const repetido = await register(baseUrl, "PESSOA@exemplo.com", "outra-senha-comprida");
      assert.equal(repetido.status, 409);
      assert.equal(((await repetido.json()) as { code: string }).code, "conflict");
    } finally {
      await close();
    }
  });

  it("recusa e-mail malformado e senha fraca antes de criar qualquer coisa", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      assert.equal((await register(baseUrl, "sem-arroba", "uma-senha-comprida")).status, 400);
      const curta = await register(baseUrl, "pessoa@exemplo.com", "curta");
      assert.equal(curta.status, 400);
      assert.match(((await curta.json()) as { error: string }).error, /pelo menos 10 caracteres/);
      // A senha não pode ser o próprio e-mail: é o primeiro palpite de quem tenta.
      assert.equal((await register(baseUrl, "pessoa@exemplo.com", "pessoa@exemplo.com")).status, 400);
      // Nenhuma delas pode ter criado conta.
      assert.equal((await login(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida")).status, 401);
    } finally {
      await close();
    }
  });

  it("entra com a senha certa e recusa a errada", async () => {
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
      const certa = await login(baseUrl, "PESSOA@Exemplo.com", "uma-senha-comprida");
      assert.equal(certa.status, 200);
      assert.match(certa.headers.get("set-cookie") ?? "", /^qa_radar_session=/);

      const errada = await login(baseUrl, "pessoa@exemplo.com", "senha-errada-mas-longa");
      assert.equal(errada.status, 401);
    } finally {
      await close();
    }
  });

  it("dá a mesma resposta para e-mail inexistente e senha errada", async () => {
    // Mensagens diferentes transformariam a tela de login numa consulta de quem
    // tem conta no produto.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      await register(baseUrl, "existe@exemplo.com", "uma-senha-comprida");
      const senhaErrada = await login(baseUrl, "existe@exemplo.com", "outra-coisa-comprida");
      const semConta = await login(baseUrl, "naoexiste@exemplo.com", "outra-coisa-comprida");
      assert.equal(senhaErrada.status, semConta.status);
      assert.deepEqual(await senhaErrada.json(), await semConta.json());
    } finally {
      await close();
    }
  });

  it("confirma o e-mail pelo link e o token não serve duas vezes", async () => {
    const emailSender = fakeEmail();
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), emailSender });
    try {
      const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
      const cookie = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const token = tokenFrom(emailSender.sent[0] as EmailMessage, "token");

      const confirmacao = await fetch(`${baseUrl}/api/v1/auth/verify?token=${encodeURIComponent(token)}`, { redirect: "manual" });
      assert.equal(confirmacao.status, 302);
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } })).json()) as { user?: { emailVerified: boolean } };
      assert.equal(me.user?.emailVerified, true);

      const repetido = await fetch(`${baseUrl}/api/v1/auth/verify?token=${encodeURIComponent(token)}`, { redirect: "manual" });
      assert.match(repetido.headers.get("location") ?? "", /erro=confirmacao/);
    } finally {
      await close();
    }
  });

  it("redefine a senha pelo link, derruba as sessões antigas e invalida a senha anterior", async () => {
    const emailSender = fakeEmail();
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), emailSender });
    try {
      const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
      const cookieAntigo = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const pedido = await fetch(`${baseUrl}/api/v1/auth/password/forgot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@exemplo.com" }),
      });
      assert.equal(pedido.status, 202);
      const reset = emailSender.sent.at(-1) as EmailMessage;
      const token = tokenFrom(reset, "redefinir");

      const troca = await fetch(`${baseUrl}/api/v1/auth/password/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: "senha-nova-comprida" }),
      });
      assert.equal(troca.status, 200);

      // A sessão que existia antes da troca não vale mais: se a redefinição
      // aconteceu porque alguém entrou na conta, ele tem de cair junto.
      const antiga = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: cookieAntigo } })).json()) as { authenticated: boolean };
      assert.equal(antiga.authenticated, false);

      assert.equal((await login(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida")).status, 401, "a senha antiga tem de morrer");
      assert.equal((await login(baseUrl, "pessoa@exemplo.com", "senha-nova-comprida")).status, 200);
    } finally {
      await close();
    }
  });

  it("responde igual a quem pede redefinição para e-mail sem cadastro", async () => {
    const emailSender = fakeEmail();
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), emailSender });
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/password/forgot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ninguem@exemplo.com" }),
      });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { requested: true });
      assert.equal(emailSender.sent.length, 0, "não existe conta, então nada é enviado — mas a resposta é a mesma");
    } finally {
      await close();
    }
  });

  it("não oferece redefinição quando o servidor não envia e-mail", async () => {
    // Sem provedor, prometer o link seria mandar a pessoa esperar para sempre.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      const me = (await (await fetch(`${baseUrl}/api/v1/auth/me`)).json()) as { passwordResetAvailable: boolean };
      assert.equal(me.passwordResetAvailable, false);
      const response = await fetch(`${baseUrl}/api/v1/auth/password/forgot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "pessoa@exemplo.com" }),
      });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { code: string }).code, "feature_disabled");
    } finally {
      await close();
    }
  });

  it("recusa o token de confirmação como token de redefinição", async () => {
    // Os dois viajam por e-mail, mas só o de redefinição pode trocar a senha.
    const emailSender = fakeEmail();
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore(), emailSender });
    try {
      await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
      const confirmacao = tokenFrom(emailSender.sent[0] as EmailMessage, "token");
      const troca = await fetch(`${baseUrl}/api/v1/auth/password/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: confirmacao, password: "senha-nova-comprida" }),
      });
      assert.equal(troca.status, 401);
    } finally {
      await close();
    }
  });

  it("corta tentativas de senha em série", async () => {
    // Sem limite, a tela de login vira oráculo de força bruta.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      await register(baseUrl, "alvo@exemplo.com", "uma-senha-comprida");
      let bloqueado = false;
      for (let attempt = 0; attempt < 15 && !bloqueado; attempt += 1) {
        const response = await login(baseUrl, "alvo@exemplo.com", `palpite-numero-${attempt}`);
        if (response.status === 429) bloqueado = true;
        else await response.json();
      }
      assert.equal(bloqueado, true, "as tentativas repetidas deveriam ser cortadas");
    } finally {
      await close();
    }
  });

  it("entrar pelo GitHub com o mesmo e-mail cai na conta já cadastrada", async () => {
    // O que impede a pessoa de terminar com duas contas e um histórico partido.
    const identity = new InMemoryIdentityStore();
    const provider = fakeProvider({
      profileFor: async () => ({ providerAccountId: "42", login: "leo", name: "Leo", avatarUrl: undefined, verifiedEmail: "Pessoa@Exemplo.com" }),
    });
    const { baseUrl, close } = await startServer({ identity, oauthProvider: provider });
    try {
      const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
      const cookieCadastro = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const antes = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: cookieCadastro } })).json()) as { user?: { email: string } };

      const state = issueOAuthState(SECRET);
      const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: "manual" });
      const cookieGithub = (callback.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      const depois = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: cookieGithub } })).json()) as { user?: { email: string; hasPassword: boolean; emailVerified: boolean } };

      assert.equal(depois.user?.email, antes.user?.email);
      assert.equal(depois.user?.hasPassword, true, "a senha cadastrada continua valendo");
      assert.equal(depois.user?.emailVerified, true, "entrar pelo provedor prova a posse do endereço");
    } finally {
      await close();
    }
  });

  describe("trocar senha logado", () => {
    async function changePassword(baseUrl: string, cookie: string, body: Record<string, unknown>) {
      return fetch(`${baseUrl}/api/v1/auth/password/change`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    }

    it("exige sessão", async () => {
      const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
      try {
        const response = await fetch(`${baseUrl}/api/v1/auth/password/change`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword: "outra-senha-comprida" }),
        });
        assert.equal(response.status, 401);
      } finally {
        await close();
      }
    });

    it("recusa senha atual errada e não mexe na senha", async () => {
      const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
      try {
        const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
        const cookie = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        const troca = await changePassword(baseUrl, cookie, { currentPassword: "senha-errada-mas-longa", newPassword: "senha-nova-comprida" });
        assert.equal(troca.status, 401);
        assert.equal((await login(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida")).status, 200, "a senha antiga continua valendo");
      } finally {
        await close();
      }
    });

    it("troca a senha, derruba outras sessões e a nova senha já vale", async () => {
      const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
      try {
        const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
        const cookieAntigo = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

        const troca = await changePassword(baseUrl, cookieAntigo, { currentPassword: "uma-senha-comprida", newPassword: "senha-nova-comprida" });
        assert.equal(troca.status, 200);
        // Uma sessão nova vem no cookie da própria resposta.
        const cookieNovo = (troca.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        assert.match(cookieNovo, /^qa_radar_session=/);

        const antiga = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie: cookieAntigo } })).json()) as { authenticated: boolean };
        assert.equal(antiga.authenticated, false, "a sessão anterior à troca cai");

        assert.equal((await login(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida")).status, 401, "a senha antiga tem de morrer");
        assert.equal((await login(baseUrl, "pessoa@exemplo.com", "senha-nova-comprida")).status, 200);
      } finally {
        await close();
      }
    });

    it("recusa senha nova fraca com 400", async () => {
      const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
      try {
        const cadastro = await register(baseUrl, "pessoa@exemplo.com", "uma-senha-comprida");
        const cookie = (cadastro.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        const troca = await changePassword(baseUrl, cookie, { currentPassword: "uma-senha-comprida", newPassword: "curta" });
        assert.equal(troca.status, 400);
      } finally {
        await close();
      }
    });

    it("conta só do GitHub define uma senha sem precisar da atual", async () => {
      const identity = new InMemoryIdentityStore();
      const provider = fakeProvider({
        profileFor: async () => ({ providerAccountId: "42", login: "leo", name: "Leo", avatarUrl: undefined, verifiedEmail: "leo@exemplo.com" }),
      });
      const { baseUrl, close } = await startServer({ identity, oauthProvider: provider });
      try {
        const state = issueOAuthState(SECRET);
        const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: "manual" });
        const cookie = (callback.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        const antes = (await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } })).json()) as { user?: { hasPassword: boolean } };
        assert.equal(antes.user?.hasPassword, false);

        const definir = await changePassword(baseUrl, cookie, { newPassword: "senha-definida-agora" });
        assert.equal(definir.status, 200);
        assert.equal((await login(baseUrl, "leo@exemplo.com", "senha-definida-agora")).status, 200);
      } finally {
        await close();
      }
    });
  });
});

describe("isolamento entre contas", () => {
  /** Loga uma conta do provedor e devolve o cookie de sessão. */
  async function signIn(baseUrl: string, accountId: string, login: string): Promise<string> {
    const state = issueOAuthState(SECRET);
    const callback = await fetch(`${baseUrl}/api/v1/auth/github/callback?code=${accountId}&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    assert.equal(callback.status, 302, `login de ${login} falhou`);
    return (callback.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  /** Provedor que devolve uma conta diferente conforme o código recebido. */
  const multiAccount = fakeProvider({
    profileFor: async (code) => ({ providerAccountId: code, login: `usuario-${code}`, name: undefined, avatarUrl: undefined, verifiedEmail: undefined }),
  });

  async function createScan(baseUrl: string, cookie?: string) {
    const response = await fetch(`${baseUrl}/api/v1/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ url: baseUrl }),
    });
    assert.equal(response.status, 202);
    return (await response.json()) as { id: string; accessToken: string };
  }

  it("deixa o dono abrir a própria análise sem apresentar o token", async () => {
    const identity = new InMemoryIdentityStore();
    const scanJobs = createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} });
    const { baseUrl, close } = await startServer({ concurrency: 0, identity, oauthProvider: multiAccount, scanJobs });
    try {
      const cookie = await signIn(baseUrl, "conta-a", "a");
      const scan = await createScan(baseUrl, cookie);
      const semToken = await fetch(`${baseUrl}/api/v1/scans/${scan.id}`, { headers: { cookie } });
      assert.equal(semToken.status, 200);
      assert.equal(((await semToken.json()) as { id: string }).id, scan.id);
    } finally {
      await close();
    }
  });

  it("não deixa uma conta abrir a análise de outra", async () => {
    // Autorização horizontal: é o teste que separa isolamento de intenção.
    const identity = new InMemoryIdentityStore();
    const scanJobs = createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} });
    const { baseUrl, close } = await startServer({ concurrency: 0, identity, oauthProvider: multiAccount, scanJobs });
    try {
      const cookieA = await signIn(baseUrl, "conta-a", "a");
      const scanDeA = await createScan(baseUrl, cookieA);
      const cookieB = await signIn(baseUrl, "conta-b", "b");

      const invasao = await fetch(`${baseUrl}/api/v1/scans/${scanDeA.id}`, { headers: { cookie: cookieB } });
      assert.equal(invasao.status, 401, "a conta B não pode abrir a análise da conta A");
    } finally {
      await close();
    }
  });

  it("mantém a análise anônima fora do alcance de quem está logado", async () => {
    // Sem dono ela não pertence a ninguém: só o token abre, mesmo para contas.
    const identity = new InMemoryIdentityStore();
    const scanJobs = createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} });
    const { baseUrl, close } = await startServer({ concurrency: 0, identity, oauthProvider: multiAccount, scanJobs });
    try {
      const anonima = await createScan(baseUrl);
      const cookie = await signIn(baseUrl, "conta-a", "a");
      assert.equal((await fetch(`${baseUrl}/api/v1/scans/${anonima.id}`, { headers: { cookie } })).status, 401);
      // O token dela continua funcionando, que é o caminho anônimo de sempre.
      const comToken = await fetch(`${baseUrl}/api/v1/scans/${anonima.id}`, { headers: { authorization: `Bearer ${anonima.accessToken}` } });
      assert.equal(comToken.status, 200);
    } finally {
      await close();
    }
  });

  it("lista no histórico só o que é da própria conta", async () => {
    const identity = new InMemoryIdentityStore();
    const scanJobs = createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} });
    const { baseUrl, close } = await startServer({ concurrency: 0, identity, oauthProvider: multiAccount, scanJobs });
    try {
      const cookieA = await signIn(baseUrl, "conta-a", "a");
      const daContaA = await createScan(baseUrl, cookieA);
      const cookieB = await signIn(baseUrl, "conta-b", "b");
      const daContaB = await createScan(baseUrl, cookieB);
      await createScan(baseUrl);

      const listaB = (await (await fetch(`${baseUrl}/api/v1/scans`, { headers: { cookie: cookieB } })).json()) as { scans: Array<{ id: string }> };
      assert.deepEqual(
        listaB.scans.map((scan) => scan.id),
        [daContaB.id],
        "a listagem só pode conter as análises de quem pediu",
      );
      const listaA = (await (await fetch(`${baseUrl}/api/v1/scans`, { headers: { cookie: cookieA } })).json()) as { scans: Array<{ id: string }> };
      assert.deepEqual(
        listaA.scans.map((scan) => scan.id),
        [daContaA.id],
      );
    } finally {
      await close();
    }
  });

  it("exige conta para consultar histórico", async () => {
    const { baseUrl, close } = await startServer({ concurrency: 0, identity: new InMemoryIdentityStore(), oauthProvider: multiAccount });
    try {
      const response = await fetch(`${baseUrl}/api/v1/scans`);
      assert.equal(response.status, 401);
      assert.equal(((await response.json()) as { code: string }).code, "unauthorized");
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
