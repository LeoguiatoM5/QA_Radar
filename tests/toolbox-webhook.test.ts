import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_REQUESTS_PER_BIN, formatWebhookRequest, isSensitiveWebhookHeader, maskAddress, prettyBody, recordFrom, type IncomingWebhook } from "../src/toolbox/webhook.js";
import { WebhookBinStore } from "../src/webhook-bin-store.js";

function chegada(overrides: Partial<IncomingWebhook> = {}): IncomingWebhook {
  return {
    method: "post",
    path: "/callback",
    query: [["ref", "123"]],
    headers: [
      ["content-type", "application/json"],
      ["x-signature", "abc"],
    ],
    body: '{"evento":"pedido.pago"}',
    bodyTruncated: false,
    address: "203.0.113.42",
    ...overrides,
  };
}

describe("toolbox · webhook · registro", () => {
  it("normaliza o método e guarda caminho, query e corpo", () => {
    const record = recordFrom(chegada(), "id-1", 1_788_274_800_000);

    assert.equal(record.method, "POST");
    assert.equal(record.path, "/callback");
    assert.deepEqual(record.query, [{ name: "ref", value: "123" }]);
    assert.equal(record.contentType, "application/json");
    assert.equal(record.body, '{"evento":"pedido.pago"}');
  });

  it("redige o cabeçalho de credencial no momento de registrar, não na hora de mostrar", () => {
    // A caixa é pública: o valor seria gravado no servidor e devolvido a quem
    // abrisse a URL. Redigir só na tela não resolveria nada.
    const record = recordFrom(
      chegada({
        headers: [
          ["Authorization", "Bearer segredo-123"],
          ["X-Api-Key", "chave"],
          ["Accept", "application/json"],
        ],
      }),
      "id-2",
      1,
    );

    const autorizacao = record.headers.find((header) => header.name === "Authorization");
    assert.equal(autorizacao?.redacted, true);
    assert.equal(autorizacao?.value.includes("segredo-123"), false);
    assert.equal(record.headers.find((header) => header.name === "X-Api-Key")?.redacted, true);
    assert.equal(record.headers.find((header) => header.name === "Accept")?.value, "application/json");
    assert.equal(JSON.stringify(record).includes("segredo-123"), false);
  });

  it("reconhece os cabeçalhos que carregam credencial", () => {
    for (const nome of ["authorization", "Cookie", "set-cookie", "x-api-key", "X-Auth-Token"]) {
      assert.equal(isSensitiveWebhookHeader(nome), true, `${nome} deveria ser tratado como credencial`);
    }
    assert.equal(isSensitiveWebhookHeader("content-type"), false);
    assert.equal(isSensitiveWebhookHeader("x-signature"), false);
  });

  it("guarda a origem só até o prefixo da rede", () => {
    assert.equal(maskAddress("203.0.113.42"), "203.0.x.x");
    assert.equal(maskAddress("::ffff:203.0.113.42"), "203.0.x.x");
    assert.equal(maskAddress("2001:db8:85a3::8a2e"), "2001:db8::");
    assert.equal(maskAddress("qualquer coisa"), "desconhecida");
  });

  it("formata o corpo JSON e deixa o resto como veio", () => {
    assert.equal(prettyBody('{"a":1}'), '{\n  "a": 1\n}');
    assert.equal(prettyBody("nao é json"), "nao é json");
    assert.equal(prettyBody("{quebrado"), "{quebrado");
  });

  it("resume uma chamada em texto colável, sem o segredo", () => {
    const record = recordFrom(chegada({ headers: [["authorization", "Bearer segredo-123"]] }), "id-3", Date.parse("2026-09-01T15:00:00Z"));
    const texto = formatWebhookRequest(record);

    assert.match(texto, /^POST \/callback/m);
    assert.match(texto, /2026-09-01T15:00:00\.000Z de 203\.0\.x\.x/);
    assert.match(texto, /"evento": "pedido\.pago"/);
    assert.equal(texto.includes("segredo-123"), false);
  });
});

describe("toolbox · webhook · caixas", () => {
  it("cria caixa com id imprevisível", () => {
    const store = new WebhookBinStore();
    const primeira = store.create();
    const segunda = store.create();

    assert.notEqual(primeira.id, segunda.id);
    assert.ok(primeira.id.length >= 20, "o id precisa ser longo o bastante para não ser adivinhado");
    assert.match(primeira.id, /^[A-Za-z0-9_-]+$/);
  });

  it("guarda as chamadas com a mais recente primeiro", () => {
    const store = new WebhookBinStore();
    const bin = store.create();

    store.push(bin.id, recordFrom(chegada({ path: "/um" }), "1", 1));
    store.push(bin.id, recordFrom(chegada({ path: "/dois" }), "2", 2));

    assert.deepEqual(
      store.get(bin.id)?.requests.map((entry) => entry.path),
      ["/dois", "/um"],
    );
  });

  it("descarta as mais antigas ao passar do teto, mas continua contando o total", () => {
    const store = new WebhookBinStore();
    const bin = store.create();
    for (let index = 0; index < MAX_REQUESTS_PER_BIN + 10; index += 1) {
      store.push(bin.id, recordFrom(chegada({ path: `/${index}` }), String(index), index));
    }

    const guardada = store.get(bin.id);
    assert.equal(guardada?.requests.length, MAX_REQUESTS_PER_BIN);
    assert.equal(guardada?.received, MAX_REQUESTS_PER_BIN + 10);
    assert.equal(guardada?.requests[0]?.path, `/${MAX_REQUESTS_PER_BIN + 9}`);
  });

  it("expira a caixa depois do TTL", () => {
    let agora = 1_000_000;
    const store = new WebhookBinStore(60_000, () => agora);
    const bin = store.create();

    assert.ok(store.get(bin.id));
    agora += 59_000;
    assert.ok(store.get(bin.id));
    agora += 2_000;
    assert.equal(store.get(bin.id), undefined);
    assert.equal(store.push(bin.id, recordFrom(chegada(), "x", agora)), false);
    assert.equal(store.size(), 0);
  });

  it("recusa escrita em caixa que não existe", () => {
    const store = new WebhookBinStore();

    assert.equal(store.push("nao-existe", recordFrom(chegada(), "x", 1)), false);
    assert.equal(store.clear("nao-existe"), false);
  });

  it("limpa as chamadas mantendo a caixa aberta", () => {
    const store = new WebhookBinStore();
    const bin = store.create();
    store.push(bin.id, recordFrom(chegada(), "1", 1));

    assert.equal(store.clear(bin.id), true);
    assert.equal(store.get(bin.id)?.requests.length, 0);
    assert.equal(store.get(bin.id)?.received, 1, "o total recebido é histórico e não volta a zero");
  });

  it("não deixa a memória crescer sem limite", () => {
    let agora = 0;
    const store = new WebhookBinStore(3_600_000, () => (agora += 1));
    for (let index = 0; index < 260; index += 1) store.create();

    assert.ok(store.size() <= 200, `esperava no máximo 200 caixas, veio ${store.size()}`);
  });
});
