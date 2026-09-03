import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { InMemoryIdentityStore } from "../src/identity.js";
import { InMemoryApplicationRepository } from "../src/application-repository.js";
import { InMemoryApiCollectionRepository } from "../src/api-collection-repository.js";
import { MAX_COLLECTIONS_PER_APPLICATION } from "../src/api-collection.js";
import { createApiTestsPage } from "../src/web-page.js";

const SECRET = "segredo-de-sessao-com-32-bytes-x";

async function startServer() {
  const server = createQaRadarServer({
    allowPrivateTargets: true,
    concurrency: 0,
    sessionSecret: SECRET,
    identity: new InMemoryIdentityStore(),
    applications: new InMemoryApplicationRepository(),
    apiCollections: new InMemoryApiCollectionRepository(),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function signUp(baseUrl: string, email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "uma-senha-bem-comprida" }),
  });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function createApplication(baseUrl: string, cookie: string, name: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/applications`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, baseUrl: "https://app.exemplo.com", environments: [] }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { application: { id: string } }).application.id;
}

interface CollectionBody {
  collection?: { id: string; name: string; requests: Array<Record<string, unknown>> };
  error?: string;
}

async function saveCollection(baseUrl: string, cookie: string, applicationId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/applications/${applicationId}/collections`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("collections de API · a promessa impressa", () => {
  it("a página diz o que sobe e o que não sobe", async () => {
    // A página prometia por escrito que nada saía do navegador. Agora parte sai,
    // então o texto precisa dizer exatamente qual parte — senão a promessa vira
    // mentira impressa, que é pior do que não prometer nada.
    const html = createApiTestsPage();
    assert.match(html, /credenciais e variáveis nunca sobem/i);
    assert.match(html, /Sem aplicação escolhida, tudo fica somente neste navegador/i);
    assert.match(html, /id="api-application-picker"/);
  });

  it("o servidor tira a credencial mesmo quando o cliente a manda", async () => {
    // A limpeza roda no servidor de propósito: feita só no navegador, é uma
    // limpeza que um `curl` direto na API não faz. Este teste é esse `curl`.
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      const response = await saveCollection(baseUrl, cookie, application, {
        name: "Smoke",
        requests: [
          {
            name: "Pedidos",
            method: "POST",
            url: "https://api.exemplo.com/pedidos?loja=3&api_key=chave-de-verdade",
            headers: [
              { key: "Content-Type", value: "application/json" },
              { key: "Authorization", value: "Bearer token-de-verdade" },
            ],
            params: [{ key: "access_token", value: "outro-de-verdade" }],
            body: '{"item":7}',
            auth: { type: "bearer", bearerToken: "token-secreto", username: "ana", password: "senha-de-verdade", apiKeyName: "X-Key", apiKeyValue: "valor-secreto", apiKeyLocation: "header" },
          },
        ],
      });
      assert.equal(response.status, 201);
      const devolvido = JSON.stringify(await response.json());
      for (const segredo of ["chave-de-verdade", "token-de-verdade", "outro-de-verdade", "token-secreto", "senha-de-verdade", "valor-secreto"]) {
        assert.equal(devolvido.includes(segredo), false, `${segredo} sobreviveu`);
      }
      // E o que não é credencial continua lá, senão a collection não serve.
      assert.ok(devolvido.includes("application/json"));
      assert.ok(devolvido.includes('{\\"item\\":7}'));
      assert.ok(devolvido.includes("loja=3"));
      assert.ok(devolvido.includes("ana"));

      // A releitura confirma que o gravado é o mesmo que foi devolvido.
      const lida = await fetch(`${baseUrl}/api/v1/applications/${application}/collections`, { headers: { cookie } });
      const cru = JSON.stringify(await lida.json());
      for (const segredo of ["chave-de-verdade", "token-de-verdade", "token-secreto"]) {
        assert.equal(cru.includes(segredo), false, `${segredo} ficou guardado`);
      }
    } finally {
      await close();
    }
  });
});

describe("collections de API · isolamento", () => {
  it("não deixa alcançar a collection de outra conta", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const dela = await signUp(baseUrl, "dela@exemplo.com");
      const application = await createApplication(baseUrl, dela, "Dela");
      const criada = ((await (await saveCollection(baseUrl, dela, application, { name: "Smoke", requests: [] })).json()) as CollectionBody).collection;

      const minha = await signUp(baseUrl, "eu@exemplo.com");
      // 404 na aplicação inteira: responder outra coisa confirmaria que aquele
      // id existe na conta de outra pessoa.
      assert.equal((await fetch(`${baseUrl}/api/v1/applications/${application}/collections`, { headers: { cookie: minha } })).status, 404);
      assert.equal(
        (
          await fetch(`${baseUrl}/api/v1/applications/${application}/collections/${criada?.id}`, {
            method: "DELETE",
            headers: { cookie: minha },
          })
        ).status,
        404,
      );

      const aindaLa = ((await (await fetch(`${baseUrl}/api/v1/applications/${application}/collections`, { headers: { cookie: dela } })).json()) as { collections: unknown[] }).collections;
      assert.equal(aindaLa.length, 1, "a collection tem de continuar de pé");
    } finally {
      await close();
    }
  });

  it("exige conta", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const response = await fetch(`${baseUrl}/api/v1/applications/00000000-0000-4000-8000-000000000000/collections`);
      assert.equal(response.status, 401);
    } finally {
      await close();
    }
  });

  it("responde 409 no nome repetido e no teto por aplicação", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      await saveCollection(baseUrl, cookie, application, { name: "Smoke", requests: [] });
      assert.equal((await saveCollection(baseUrl, cookie, application, { name: " smoke ", requests: [] })).status, 409);

      for (let index = 1; index < MAX_COLLECTIONS_PER_APPLICATION; index += 1) {
        assert.equal((await saveCollection(baseUrl, cookie, application, { name: `Coleção ${index}`, requests: [] })).status, 201);
      }
      assert.equal((await saveCollection(baseUrl, cookie, application, { name: "Uma a mais", requests: [] })).status, 409);
    } finally {
      await close();
    }
  });
});

describe("histórico de Testes de API na aplicação", () => {
  /** Alvo local que responde algo previsível, para o proxy ter o que chamar. */
  async function startTarget(): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
    const server = createServer((_request, response) => {
      response.writeHead(201, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/pedidos`, close: () => new Promise<void>((resolve) => server.close(() => resolve())), server };
  }

  it("registra a execução na aplicação e a mostra na linha do tempo", async () => {
    const { baseUrl, close } = await startServer();
    const target = await startTarget();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      const enviada = await fetch(`${baseUrl}/api/v1/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ method: "POST", url: `${target.url}?api_key=chave-de-verdade`, headers: { Authorization: "Bearer token-de-verdade" }, body: "{}", applicationId: application }),
      });
      assert.equal(enviada.status, 200);

      const historico = (await (await fetch(`${baseUrl}/api/v1/applications/${application}/scans`, { headers: { cookie } })).json()) as {
        apiRuns?: Array<{ method: string; url: string; status: number }>;
      };
      assert.equal(historico.apiRuns?.length, 1);
      assert.equal(historico.apiRuns?.[0]?.method, "POST");
      assert.equal(historico.apiRuns?.[0]?.status, 201);
      // Nem a URL guardada pode carregar a chave.
      assert.equal(historico.apiRuns?.[0]?.url.includes("chave-de-verdade"), false);
      assert.equal(JSON.stringify(historico).includes("token-de-verdade"), false);
    } finally {
      await target.close();
      await close();
    }
  });

  it("não registra nada na aplicação de outra conta", async () => {
    const { baseUrl, close } = await startServer();
    const target = await startTarget();
    try {
      const dela = await signUp(baseUrl, "dela@exemplo.com");
      const application = await createApplication(baseUrl, dela, "Dela");
      const minha = await signUp(baseUrl, "eu@exemplo.com");
      // A requisição sai — ela é dela mesma, não da aplicação —, mas o registro
      // não pode entrar no histórico alheio.
      const enviada = await fetch(`${baseUrl}/api/v1/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: minha },
        body: JSON.stringify({ method: "GET", url: target.url, applicationId: application }),
      });
      assert.equal(enviada.status, 200);
      const historico = (await (await fetch(`${baseUrl}/api/v1/applications/${application}/scans`, { headers: { cookie: dela } })).json()) as { apiRuns?: unknown[] };
      assert.deepEqual(historico.apiRuns, []);
    } finally {
      await target.close();
      await close();
    }
  });

  it("limpar o histórico apaga as execuções de API mas preserva as collections", async () => {
    // O botão promete apagar o histórico, não o trabalho salvo.
    const { baseUrl, close } = await startServer();
    const target = await startTarget();
    try {
      const cookie = await signUp(baseUrl, "dono@exemplo.com");
      const application = await createApplication(baseUrl, cookie, "Loja");
      await saveCollection(baseUrl, cookie, application, { name: "Smoke", requests: [{ name: "Pedidos", method: "GET", url: "https://api.exemplo.com/x", auth: {} }] });
      await fetch(`${baseUrl}/api/v1/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ method: "GET", url: target.url, applicationId: application }),
      });

      const limpeza = await fetch(`${baseUrl}/api/v1/scans`, { method: "DELETE", headers: { cookie } });
      assert.equal(((await limpeza.json()) as { apiRuns: number }).apiRuns, 1);

      const historico = (await (await fetch(`${baseUrl}/api/v1/applications/${application}/scans`, { headers: { cookie } })).json()) as { apiRuns?: unknown[] };
      assert.deepEqual(historico.apiRuns, []);
      const collections = ((await (await fetch(`${baseUrl}/api/v1/applications/${application}/collections`, { headers: { cookie } })).json()) as { collections: unknown[] }).collections;
      assert.equal(collections.length, 1, "a collection não é histórico e tem de sobreviver");
    } finally {
      await target.close();
      await close();
    }
  });
});
