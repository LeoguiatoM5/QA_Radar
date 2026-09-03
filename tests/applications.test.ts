import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { InMemoryApplicationRepository } from "../src/application-repository.js";
import { InMemoryScanJobRepository } from "../src/scan-job-repository.js";
import { createScanJobPersistence } from "../src/scan-job-persistence.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";

async function startServer(overrides: Parameters<typeof createQaRadarServer>[0] = {}) {
  const server = createQaRadarServer({ allowPrivateTargets: true, concurrency: 0, sessionSecret: SECRET, ...overrides });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Cria uma conta pelo cadastro e devolve o cookie de sessão. */
async function signUp(baseUrl: string, email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "uma-senha-bem-comprida" }),
  });
  assert.equal(response.status, 201, `cadastro de ${email} falhou`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createApplication(baseUrl: string, cookie: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/v1/applications`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function withAccounts() {
  return { identity: new InMemoryIdentityStore(), applications: new InMemoryApplicationRepository() };
}

describe("aplicações", () => {
  it("cadastra e lista a aplicação da conta", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = await createApplication(baseUrl, cookie, { name: "Loja Web", baseUrl: "https://loja.exemplo.com", environments: ["staging", "produção"] });
      assert.equal(criada.status, 201);
      const body = (await criada.json()) as { application: { id: string; name: string; environments: string[]; archived: boolean } };
      assert.equal(body.application.name, "Loja Web");
      assert.deepEqual(body.application.environments, ["staging", "produção"]);
      assert.equal(body.application.archived, false);

      const lista = (await (await fetch(`${baseUrl}/api/v1/applications`, { headers: { cookie } })).json()) as { applications: Array<{ id: string }> };
      assert.deepEqual(
        lista.applications.map((application) => application.id),
        [body.application.id],
      );
    } finally {
      await close();
    }
  });

  it("exige conta para qualquer coisa em aplicações", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      for (const [method, path] of [
        ["GET", "/api/v1/applications"],
        ["POST", "/api/v1/applications"],
        ["GET", `/api/v1/applications/${randomUUID()}`],
        ["PATCH", `/api/v1/applications/${randomUUID()}`],
        ["DELETE", `/api/v1/applications/${randomUUID()}`],
      ] as const) {
        const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, ...(method === "POST" || method === "PATCH" ? { body: "{}" } : {}) });
        assert.equal(response.status, 401, `${method} ${path} deveria exigir conta`);
      }
    } finally {
      await close();
    }
  });

  it("não entrega, altera nem arquiva a aplicação de outra conta", async () => {
    // Autorização horizontal: é o teste que separa isolamento de intenção.
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookieA = await signUp(baseUrl, "a@exemplo.com");
      const cookieB = await signUp(baseUrl, "b@exemplo.com");
      const daA = (await (await createApplication(baseUrl, cookieA, { name: "Da conta A", baseUrl: "https://a.exemplo.com" })).json()) as { application: { id: string } };
      const alvo = `${baseUrl}/api/v1/applications/${daA.application.id}`;

      // 404 e não 403: responder "proibido" confirmaria que o id existe.
      assert.equal((await fetch(alvo, { headers: { cookie: cookieB } })).status, 404);
      assert.equal((await fetch(alvo, { method: "PATCH", headers: { "content-type": "application/json", cookie: cookieB }, body: JSON.stringify({ name: "Sequestrada" }) })).status, 404);
      assert.equal((await fetch(alvo, { method: "DELETE", headers: { cookie: cookieB } })).status, 404);

      const listaB = (await (await fetch(`${baseUrl}/api/v1/applications`, { headers: { cookie: cookieB } })).json()) as { applications: unknown[] };
      assert.deepEqual(listaB.applications, [], "a conta B não pode ver nada da conta A");

      // E a da conta A continua intacta.
      const aindaLa = (await (await fetch(alvo, { headers: { cookie: cookieA } })).json()) as { application: { name: string } };
      assert.equal(aindaLa.application.name, "Da conta A");
    } finally {
      await close();
    }
  });

  it("recusa nome repetido na mesma conta e aceita em contas diferentes", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookieA = await signUp(baseUrl, "a@exemplo.com");
      const cookieB = await signUp(baseUrl, "b@exemplo.com");
      assert.equal((await createApplication(baseUrl, cookieA, { name: "Checkout", baseUrl: "https://a.exemplo.com" })).status, 201);
      const repetida = await createApplication(baseUrl, cookieA, { name: "checkout", baseUrl: "https://outra.exemplo.com" });
      assert.equal(repetida.status, 409);
      assert.equal(((await repetida.json()) as { code: string }).code, "conflict");
      assert.equal((await createApplication(baseUrl, cookieB, { name: "Checkout", baseUrl: "https://b.exemplo.com" })).status, 201);
    } finally {
      await close();
    }
  });

  it("recusa URL base local, privada ou com credencial", async () => {
    // Mesma política de destino do scanner, aplicada já no cadastro.
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      for (const alvo of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.0.10", "https://usuario:senha@exemplo.com", "ftp://exemplo.com", "nem-url"]) {
        const response = await createApplication(baseUrl, cookie, { name: `App ${alvo}`, baseUrl: alvo });
        assert.equal(response.status, 400, `${alvo} deveria ser recusada`);
        assert.equal(((await response.json()) as { code: string }).code, "invalid_target");
      }
    } finally {
      await close();
    }
  });

  it("arquiva sem sumir com a aplicação", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = (await (await createApplication(baseUrl, cookie, { name: "Antiga", baseUrl: "https://a.exemplo.com" })).json()) as { application: { id: string } };
      assert.equal((await fetch(`${baseUrl}/api/v1/applications/${criada.application.id}`, { method: "DELETE", headers: { cookie } })).status, 200);

      const lista = (await (await fetch(`${baseUrl}/api/v1/applications`, { headers: { cookie } })).json()) as { applications: unknown[] };
      assert.deepEqual(lista.applications, []);
      const comArquivadas = (await (await fetch(`${baseUrl}/api/v1/applications?arquivadas=1`, { headers: { cookie } })).json()) as { applications: Array<{ archived: boolean }> };
      assert.equal(comArquivadas.applications.length, 1);
      assert.equal(comArquivadas.applications[0]?.archived, true);
    } finally {
      await close();
    }
  });

  it("valida o corpo antes de gravar", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      assert.equal((await createApplication(baseUrl, cookie, { baseUrl: "https://a.exemplo.com" })).status, 400);
      assert.equal((await createApplication(baseUrl, cookie, { name: "Sem URL" })).status, 400);
      assert.equal((await createApplication(baseUrl, cookie, { name: "x".repeat(61), baseUrl: "https://a.exemplo.com" })).status, 400);
      assert.equal((await createApplication(baseUrl, cookie, { name: "Lista errada", baseUrl: "https://a.exemplo.com", environments: "staging" })).status, 400);
      assert.equal(
        (await createApplication(baseUrl, cookie, { name: "Ambientes demais", baseUrl: "https://a.exemplo.com", environments: Array.from({ length: 11 }, (_, i) => `amb-${i}`) })).status,
        400,
      );
    } finally {
      await close();
    }
  });

  it("descarta ambiente repetido em vez de reclamar", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = await createApplication(baseUrl, cookie, { name: "Com repetidos", baseUrl: "https://a.exemplo.com", environments: ["staging", " Staging ", "produção", ""] });
      assert.equal(criada.status, 201);
      const body = (await criada.json()) as { application: { environments: string[] } };
      assert.deepEqual(body.application.environments, ["staging", "produção"]);
    } finally {
      await close();
    }
  });

  it("altera só o campo enviado", async () => {
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = (await (await createApplication(baseUrl, cookie, { name: "Original", baseUrl: "https://a.exemplo.com", environments: ["staging"] })).json()) as { application: { id: string } };
      const alterada = await fetch(`${baseUrl}/api/v1/applications/${criada.application.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Renomeada" }),
      });
      assert.equal(alterada.status, 200);
      const body = (await alterada.json()) as { application: { name: string; baseUrl: string; environments: string[] } };
      assert.equal(body.application.name, "Renomeada");
      assert.match(body.application.baseUrl, /a\.exemplo\.com/);
      assert.deepEqual(body.application.environments, ["staging"]);

      const semNada = await fetch(`${baseUrl}/api/v1/applications/${criada.application.id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie }, body: "{}" });
      assert.equal(semNada.status, 400);
    } finally {
      await close();
    }
  });

  it("some inteira quando o servidor não tem banco", async () => {
    // Mesma degradação do resto: sem onde guardar, o recurso não é anunciado.
    const { baseUrl, close } = await startServer({ identity: new InMemoryIdentityStore() });
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const response = await fetch(`${baseUrl}/api/v1/applications`, { headers: { cookie } });
      assert.equal(response.status, 403);
      assert.equal(((await response.json()) as { code: string }).code, "feature_disabled");
    } finally {
      await close();
    }
  });
});

describe("instalação que exige conta", () => {
  it("recusa executar análise e teste de API sem conta, mas deixa navegar", async () => {
    const { baseUrl, close } = await startServer({ ...withAccounts(), requireAccount: true });
    try {
      const scan = await fetch(`${baseUrl}/api/v1/scans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: baseUrl }) });
      assert.equal(scan.status, 401);
      assert.equal(((await scan.json()) as { code: string }).code, "unauthorized");

      const api = await fetch(`${baseUrl}/api/v1/http-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: baseUrl, method: "GET" }) });
      assert.equal(api.status, 401);

      // Ler as páginas continua livre: o pedido de conta acontece na execução.
      for (const path of ["/", "/scanner", "/aplicacoes", "/docs", "/entrar"]) {
        assert.equal((await fetch(`${baseUrl}${path}`)).status, 200, `${path} deveria continuar aberta`);
      }
    } finally {
      await close();
    }
  });

  it("deixa quem entrou executar normalmente", async () => {
    const { baseUrl, close } = await startServer({ ...withAccounts(), requireAccount: true });
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const scan = await fetch(`${baseUrl}/api/v1/scans`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ url: baseUrl }) });
      assert.equal(scan.status, 202);
    } finally {
      await close();
    }
  });

  it("mantém o caminho anônimo quando a chave está desligada", async () => {
    // O padrão é desligado: a CLI e o dashboard local não podem passar a exigir
    // cadastro, e o comportamento anterior continua sendo o padrão do pacote.
    const { baseUrl, close } = await startServer(withAccounts());
    try {
      const scan = await fetch(`${baseUrl}/api/v1/scans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: baseUrl }) });
      assert.equal(scan.status, 202);
    } finally {
      await close();
    }
  });
});

describe("análise vinculada a uma aplicação", () => {
  function withPersistence() {
    return {
      ...withAccounts(),
      scanJobs: createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} }),
    };
  }

  it("guarda a aplicação na análise de quem é dono dela", async () => {
    const options = withPersistence();
    const { baseUrl, close } = await startServer(options);
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const criada = (await (await createApplication(baseUrl, cookie, { name: "Loja", baseUrl: "https://loja.exemplo.com" })).json()) as { application: { id: string } };
      const scan = await fetch(`${baseUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ url: baseUrl, applicationId: criada.application.id }),
      });
      assert.equal(scan.status, 202);
      const { id } = (await scan.json()) as { id: string };
      assert.equal((await options.scanJobs.load(id))?.applicationId, criada.application.id);
    } finally {
      await close();
    }
  });

  it("não deixa apontar a análise para a aplicação de outra conta", async () => {
    // Sem esta checagem, qualquer conta despejaria execuções no histórico alheio.
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const cookieA = await signUp(baseUrl, "a@exemplo.com");
      const cookieB = await signUp(baseUrl, "b@exemplo.com");
      const daA = (await (await createApplication(baseUrl, cookieA, { name: "Da A", baseUrl: "https://a.exemplo.com" })).json()) as { application: { id: string } };

      const invasao = await fetch(`${baseUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieB },
        body: JSON.stringify({ url: baseUrl, applicationId: daA.application.id }),
      });
      assert.equal(invasao.status, 404);
    } finally {
      await close();
    }
  });

  it("exige conta para vincular, mas não para analisar sem aplicação", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const anonimaComApp = await fetch(`${baseUrl}/api/v1/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: baseUrl, applicationId: randomUUID() }),
      });
      assert.equal(anonimaComApp.status, 401);

      // O caminho anônimo de sempre continua funcionando.
      const anonima = await fetch(`${baseUrl}/api/v1/scans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: baseUrl }) });
      assert.equal(anonima.status, 202);
    } finally {
      await close();
    }
  });
});

/**
 * Fica aqui, e não em `server.test.ts`, porque a bateria de contas já mora
 * neste arquivo: cadastro, cookie de sessão e persistência em memória. Duplicar
 * esse arranjo em outro lugar custaria mais do que a vizinhança imperfeita.
 */
describe("histórico da conta", () => {
  function withPersistence() {
    return {
      ...withAccounts(),
      scanJobs: createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} }),
    };
  }

  async function startScan(baseUrl: string, cookie: string) {
    const response = await fetch(`${baseUrl}/api/v1/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: baseUrl }),
    });
    assert.equal(response.status, 202);
  }

  async function historyOf(baseUrl: string, cookie: string): Promise<number> {
    const body = (await (await fetch(`${baseUrl}/api/v1/scans`, { headers: { cookie } })).json()) as { scans: unknown[] };
    return body.scans.length;
  }

  // "Limpar histórico" na Visão geral apaga três cópias, e esta é a que fazia
  // tudo voltar: sem ela, recarregar a página trazia as execuções de novo, com
  // o índice de qualidade e os sinais junto.
  it("apaga o histórico da conta e não deixa nada voltar", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      await startScan(baseUrl, cookie);
      await startScan(baseUrl, cookie);
      assert.equal(await historyOf(baseUrl, cookie), 2);

      const limpeza = await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE", headers: { cookie } });
      assert.equal(limpeza.status, 200);
      // `journeys` entra na conta porque limpar o histórico passou a alcançar
      // também as execuções da Jornada; aqui não houve nenhuma.
      assert.deepEqual(await limpeza.json(), { removed: 2, journeys: 0, apiRuns: 0 });
      assert.equal(await historyOf(baseUrl, cookie), 0);

      // Repetir converge para o mesmo estado, então não é conflito.
      const denovo = await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE", headers: { cookie } });
      assert.equal(denovo.status, 200);
      assert.deepEqual(await denovo.json(), { removed: 0, journeys: 0, apiRuns: 0 });
    } finally {
      await close();
    }
  });

  it("não alcança o histórico de outra conta", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const cookieA = await signUp(baseUrl, "a@exemplo.com");
      const cookieB = await signUp(baseUrl, "b@exemplo.com");
      await startScan(baseUrl, cookieA);
      await startScan(baseUrl, cookieB);

      await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE", headers: { cookie: cookieA } });
      assert.equal(await historyOf(baseUrl, cookieA), 0);
      assert.equal(await historyOf(baseUrl, cookieB), 1);
    } finally {
      await close();
    }
  });

  it("exige conta para apagar", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const anonima = await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE" });
      assert.equal(anonima.status, 401);
    } finally {
      await close();
    }
  });
});

describe("histórico da aplicação", () => {
  function withPersistence() {
    return {
      ...withAccounts(),
      scanJobs: createScanJobPersistence({ repository: new InMemoryScanJobRepository(), retentionMs: 3_600_000, onError: () => {} }),
    };
  }

  async function scanFor(baseUrl: string, cookie: string, applicationId?: string) {
    const response = await fetch(`${baseUrl}/api/v1/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ url: baseUrl, ...(applicationId ? { applicationId } : {}) }),
    });
    assert.equal(response.status, 202);
  }

  async function historyOf(baseUrl: string, cookie: string, applicationId: string) {
    const response = await fetch(`${baseUrl}/api/v1/applications/${applicationId}/scans`, { headers: { cookie } });
    return { status: response.status, body: (await response.json()) as { scans?: unknown[] } };
  }

  // A coluna `application_id` era gravada desde que Aplicações existe e nunca
  // lida por consulta nenhuma: o vínculo ia para o banco e não aparecia em
  // lugar algum do produto.
  it("lista só as análises daquela aplicação", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const loja = (await (await createApplication(baseUrl, cookie, { name: "Loja", baseUrl: "https://loja.exemplo.com" })).json()) as { application: { id: string } };
      const checkout = (await (await createApplication(baseUrl, cookie, { name: "Checkout", baseUrl: "https://checkout.exemplo.com" })).json()) as { application: { id: string } };

      await scanFor(baseUrl, cookie, loja.application.id);
      await scanFor(baseUrl, cookie, loja.application.id);
      await scanFor(baseUrl, cookie, checkout.application.id);
      // Sem aplicação: entra no histórico da conta, não no de nenhuma delas.
      await scanFor(baseUrl, cookie);

      assert.equal((await historyOf(baseUrl, cookie, loja.application.id)).body.scans?.length, 2);
      assert.equal((await historyOf(baseUrl, cookie, checkout.application.id)).body.scans?.length, 1);
    } finally {
      await close();
    }
  });

  it("não entrega o histórico da aplicação de outra conta", async () => {
    const { baseUrl, close } = await startServer(withPersistence());
    try {
      const cookieA = await signUp(baseUrl, "a@exemplo.com");
      const cookieB = await signUp(baseUrl, "b@exemplo.com");
      const daA = (await (await createApplication(baseUrl, cookieA, { name: "Da A", baseUrl: "https://a.exemplo.com" })).json()) as { application: { id: string } };
      await scanFor(baseUrl, cookieA, daA.application.id);

      // 404 e não 403: "proibido" confirmaria que o id existe em outra conta.
      assert.equal((await historyOf(baseUrl, cookieB, daA.application.id)).status, 404);
      assert.equal((await fetch(`${baseUrl}/api/v1/applications/${daA.application.id}/scans`)).status, 401);
    } finally {
      await close();
    }
  });
});
