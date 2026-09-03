import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PAIRS_PER_REQUEST, MAX_REQUESTS_PER_COLLECTION, isSecretHeader, isSecretParam, redactUrl, shareableRequest, shareableRequests } from "../src/api-collection.js";

/**
 * Esta é a regra de segurança da funcionalidade, não uma validação de formato.
 * Cada caso aqui é uma forma concreta de uma credencial chegar ao banco — e o
 * teste existe para que ela não chegue.
 */
describe("collection de API · o que pode ser gravado", () => {
  it("guarda o header comum e descarta o valor do header de credencial", () => {
    const request = shareableRequest({
      name: "Pedidos",
      method: "post",
      url: "https://api.exemplo.com/pedidos",
      headers: [
        { key: "Content-Type", value: "application/json" },
        { key: "Authorization", value: "Bearer segredo-de-verdade" },
        { key: "X-API-Key", value: "chave-de-verdade" },
        { key: "Cookie", value: "sessao=abc" },
      ],
      body: '{"item":7}',
      auth: {},
    });

    assert.deepEqual(request?.headers, [
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "" },
      { key: "X-API-Key", value: "" },
      { key: "Cookie", value: "" },
    ]);
    // O nome fica: é ele que diz à pessoa qual credencial aquela requisição
    // espera. Só o valor sai.
    assert.equal(JSON.stringify(request).includes("segredo-de-verdade"), false);
    assert.equal(JSON.stringify(request).includes("chave-de-verdade"), false);
  });

  it("nunca deixa o segredo da autenticação entrar na estrutura", () => {
    const request = shareableRequest({
      name: "Login",
      method: "POST",
      url: "https://api.exemplo.com/login",
      auth: {
        type: "bearer",
        bearerToken: "token-secreto",
        username: "ana",
        password: "senha-secreta",
        apiKeyName: "X-Key",
        apiKeyValue: "valor-secreto",
        apiKeyLocation: "header",
      },
    });

    assert.deepEqual(request?.auth, { type: "bearer", username: "ana", apiKeyName: "X-Key", apiKeyLocation: "header" });
    const gravado = JSON.stringify(request);
    for (const segredo of ["token-secreto", "senha-secreta", "valor-secreto"]) {
      assert.equal(gravado.includes(segredo), false, `${segredo} vazou para o que seria gravado`);
    }
  });

  it("limpa a credencial colada direto na URL", () => {
    // É assim que a maioria das APIs documenta o uso de API key, então limpar
    // só a lista de params deixaria o caminho mais comum aberto.
    const request = shareableRequest({
      name: "Busca",
      method: "GET",
      url: "https://api.exemplo.com/busca?q=camisa&api_key=chave-de-verdade&access_token=outra",
      auth: {},
    });

    assert.equal(request?.url.includes("chave-de-verdade"), false);
    assert.equal(request?.url.includes("outra"), false);
    assert.ok(request?.url.includes("q=camisa"), "o que não é segredo continua lá");
    assert.ok(request?.url.includes("api_key="), "o nome do parâmetro fica, para a tela poder explicar a falta");
  });

  it("descarta o valor do query param sensível na lista de params", () => {
    const request = shareableRequest({
      name: "Busca",
      method: "GET",
      url: "https://api.exemplo.com/busca",
      params: [
        { key: "q", value: "camisa" },
        { key: "token", value: "token-de-verdade" },
        { key: "client_secret", value: "segredo-de-verdade" },
      ],
      auth: {},
    });

    assert.deepEqual(request?.params, [
      { key: "q", value: "camisa" },
      { key: "token", value: "" },
      { key: "client_secret", value: "" },
    ]);
  });

  it("deixa passar intacta a URL que ainda tem variável a substituir", () => {
    // `{{baseUrl}}/pedidos` não é URL válida para o parser, e não há query param
    // a limpar numa coisa que o navegador ainda vai montar.
    assert.equal(redactUrl("{{baseUrl}}/pedidos"), "{{baseUrl}}/pedidos");
    assert.equal(redactUrl("/relativa/sem/host"), "/relativa/sem/host");
  });

  it("mantém o body, que é a razão de a collection existir", () => {
    // O body sobe de propósito: sem ele uma collection de POST não serve para
    // nada. Quem precisa de segredo no corpo usa `{{variavel}}`, cujo valor não
    // sai do navegador.
    const request = shareableRequest({ name: "Criar", method: "POST", url: "https://api.exemplo.com/x", body: '{"token":"{{token}}"}', auth: {} });
    assert.equal(request?.body, '{"token":"{{token}}"}');
  });

  it("recusa requisição sem nome e normaliza método desconhecido", () => {
    assert.equal(shareableRequest({ name: "   ", url: "https://x" }), undefined);
    assert.equal(shareableRequest({ name: "X", method: "TRACE", url: "https://x", auth: {} })?.method, "GET");
    assert.equal(shareableRequest({ name: "X", method: "delete", url: "https://x", auth: {} })?.method, "DELETE");
  });

  it("corta pelos tetos em vez de gravar o que vier", () => {
    const muitos = Array.from({ length: MAX_PAIRS_PER_REQUEST + 20 }, (_, index) => ({ key: `h${index}`, value: "v" }));
    const request = shareableRequest({ name: "X", method: "GET", url: "https://x", headers: muitos, auth: {} });
    assert.equal(request?.headers.length, MAX_PAIRS_PER_REQUEST);

    const collection = shareableRequests(Array.from({ length: MAX_REQUESTS_PER_COLLECTION + 10 }, (_, index) => ({ name: `r${index}`, method: "GET", url: "https://x", auth: {} })));
    assert.equal(collection.length, MAX_REQUESTS_PER_COLLECTION);
  });

  it("descarta silenciosamente o item inválido no meio da lista", () => {
    const collection = shareableRequests([{ name: "boa", method: "GET", url: "https://x", auth: {} }, null, { semNome: true }, "texto"]);
    assert.deepEqual(
      collection.map((request) => request.name),
      ["boa"],
    );
  });

  it("reconhece os nomes de credencial pelas convenções usadas na prática", () => {
    for (const nome of ["authorization", "Authorization", "x-api-key", "API-Key", "cookie", "x-auth-token"]) {
      assert.equal(isSecretHeader(nome), true, `${nome} deveria ser tratado como credencial`);
    }
    assert.equal(isSecretHeader("content-type"), false);
    for (const nome of ["api_key", "apiKey", "access-token", "client_secret", "password", "signature", "session"]) {
      assert.equal(isSecretParam(nome), true, `${nome} deveria ser tratado como credencial`);
    }
    assert.equal(isSecretParam("page"), false);
  });
});
