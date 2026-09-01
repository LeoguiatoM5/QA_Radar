import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertCurl, CURL_TARGETS, formatCurl, isSecretHeader, maskParsedCurl, maskSecret, parseCurl, tokenizeShellCommand } from "../src/toolbox/curl.js";

describe("toolbox · curl converter · leitura do comando", () => {
  it("interpreta um GET simples", () => {
    const request = parseCurl("curl 'https://api.example.com/users'");

    assert.equal(request.method, "GET");
    assert.equal(request.url, "https://api.example.com/users");
    assert.deepEqual(request.headers, []);
    assert.equal(request.body, undefined);
  });

  it("interpreta headers, inclusive com dois-pontos no valor", () => {
    const request = parseCurl("curl 'https://api.example.com/users' -H 'Authorization: Bearer abc' -H 'X-Trace: 10:30:00'");

    assert.deepEqual(request.headers, [
      { name: "Authorization", value: "Bearer abc" },
      { name: "X-Trace", value: "10:30:00" },
    ]);
  });

  it("separa query parameters da URL", () => {
    const request = parseCurl("curl 'https://api.example.com/users?page=2&status=active'");

    assert.equal(request.url, "https://api.example.com/users");
    assert.deepEqual(request.query, [
      { name: "page", value: "2" },
      { name: "status", value: "active" },
    ]);
  });

  it("deduz POST quando há corpo e respeita -X explícito", () => {
    assert.equal(parseCurl(`curl 'https://api.example.com/users' --data '{"a":1}'`).method, "POST");
    assert.equal(parseCurl(`curl -X PUT 'https://api.example.com/users/1' -d '{"a":1}'`).method, "PUT");
    assert.equal(parseCurl(`curl --request DELETE 'https://api.example.com/users/1'`).method, "DELETE");
  });

  it("lê o corpo de --data-raw e junta múltiplos -d como o cURL faz", () => {
    const request = parseCurl(`curl 'https://api.example.com/form' -d 'a=1' -d 'b=2'`);

    assert.equal(request.body, "a=1&b=2");
  });

  it("entende a continuação de linha do Copy as cURL", () => {
    const command = ["curl 'https://api.example.com/users' \\", "  -H 'Authorization: Bearer token' \\", "  -H 'Content-Type: application/json'"].join("\n");
    const request = parseCurl(command);

    assert.equal(request.headers.length, 2);
    assert.equal(request.url, "https://api.example.com/users");
  });

  it("guarda a autenticação básica de -u", () => {
    assert.equal(parseCurl("curl -u qa:secreta 'https://api.example.com/'").basicAuth, "qa:secreta");
  });

  it("ignora opções que não mudam a requisição", () => {
    const request = parseCurl("curl -s -L -k --compressed 'https://api.example.com/users'");

    assert.equal(request.method, "GET");
    assert.equal(request.url, "https://api.example.com/users");
  });

  it("recusa entradas que não são um cURL", () => {
    assert.throws(() => parseCurl(""), /Cole um comando/);
    assert.throws(() => parseCurl("wget https://example.com"), /começar com/);
    assert.throws(() => parseCurl("curl -H 'A: b'"), /URL/);
  });

  it("preserva aspas e escapes ao dividir o comando", () => {
    assert.deepEqual(tokenizeShellCommand(`curl "https://a.com" -d '{"a":"b c"}'`), ["curl", "https://a.com", "-d", '{"a":"b c"}']);
  });
});

describe("toolbox · curl converter · segredos", () => {
  it("reconhece os headers que carregam credencial", () => {
    assert.equal(isSecretHeader("Authorization"), true);
    assert.equal(isSecretHeader("x-api-key"), true);
    assert.equal(isSecretHeader("Cookie"), true);
    assert.equal(isSecretHeader("Content-Type"), false);
  });

  it("mascara o miolo do segredo mantendo o esquema", () => {
    const masked = maskSecret("Bearer abcdefghijklmnop");

    assert.match(masked, /^Bearer abcd/);
    assert.equal(masked.includes("efghijkl"), false);
  });

  it("mascara os headers sensíveis na versão exibida do pedido", () => {
    const request = parseCurl("curl 'https://api.example.com/' -H 'Authorization: Bearer abcdefghijklmnop' -H 'Accept: application/json'");
    const masked = maskParsedCurl(request);

    assert.equal(masked.headers[0]?.value.includes("abcdefghijklmnop"), false);
    assert.equal(masked.headers[1]?.value, "application/json");
    // O pedido original continua intacto: quem mascara é a camada de exibição.
    assert.equal(request.headers[0]?.value, "Bearer abcdefghijklmnop");
  });

  it("nunca escreve o segredo no código gerado", () => {
    const request = parseCurl("curl 'https://api.example.com/users' -H 'Authorization: Bearer super-secreto-123' -H 'x-api-key: chave-secreta'");

    for (const target of CURL_TARGETS) {
      const code = convertCurl(request, target.id);
      assert.equal(code.includes("super-secreto-123"), false, `${target.id} vazou o token`);
      assert.equal(code.includes("chave-secreta"), false, `${target.id} vazou a api key`);
      assert.match(code, /API_TOKEN|api_token/, `${target.id} não declarou a variável do token`);
    }
  });

  it("transforma -u em Authorization por variável, não em literal", () => {
    const code = convertCurl(parseCurl("curl -u qa:secreta 'https://api.example.com/'"), "playwright");

    assert.equal(code.includes("secreta"), false);
    assert.match(code, /BASIC_AUTH_BASE64/);
  });
});

describe("toolbox · curl converter · geração de código", () => {
  const request = parseCurl(`curl 'https://api.example.com/users?page=2' -H 'Authorization: Bearer token' -H 'Content-Type: application/json' -X POST -d '{"nome":"Ana"}'`);

  it("gera Playwright com asserção de status", () => {
    const code = convertCurl(request, "playwright");

    assert.match(code, /import \{ test, expect \} from '@playwright\/test';/);
    assert.match(code, /await request\.post\(/);
    assert.match(code, /expect\(response\.status\(\)\)\.toBe\(200\);/);
    assert.match(code, /'Content-Type': 'application\/json'/);
  });

  it("gera Cypress com cy.request", () => {
    const code = convertCurl(request, "cypress");

    assert.match(code, /cy\.request\(\{/);
    assert.match(code, /method: 'POST'/);
    assert.match(code, /expect\(response\.status\)\.to\.eq\(200\);/);
    assert.match(code, /qs: \{/);
  });

  it("gera fetch com verificação de resposta", () => {
    const code = convertCurl(request, "fetch");

    assert.match(code, /await fetch\('https:\/\/api\.example\.com\/users\?page=2'/);
    assert.match(code, /method: 'POST'/);
    assert.match(code, /response\.ok/);
  });

  it("gera Axios, Python Requests e Rest Assured", () => {
    assert.match(convertCurl(request, "axios"), /import axios from 'axios';/);
    assert.match(convertCurl(request, "python"), /import requests/);
    assert.match(convertCurl(request, "python"), /assert response\.status_code == 200/);
    assert.match(convertCurl(request, "rest-assured"), /\.statusCode\(200\);/);
  });

  it("reescreve o comando em uma linha por opção", () => {
    const formatted = formatCurl("curl 'https://api.example.com/users' -H 'Accept: application/json'");

    assert.match(formatted, /^curl -X GET 'https:\/\/api\.example\.com\/users' \\\n/);
    assert.match(formatted, /-H 'Accept: application\/json'/);
  });

  it("cobre todos os alvos anunciados no catálogo", () => {
    for (const target of CURL_TARGETS) {
      assert.ok(convertCurl(request, target.id).length > 0, `${target.id} não gerou código`);
    }
  });
});
