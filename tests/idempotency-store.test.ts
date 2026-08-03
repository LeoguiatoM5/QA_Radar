import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryIdempotencyKeys, idempotencyScope, requestFingerprint } from "../src/idempotency-store.js";

describe("idempotency store", () => {
  it("ignora a ordem das chaves ao comparar corpos iguais", () => {
    assert.equal(requestFingerprint({ url: "https://example.com", browser: "chromium" }), requestFingerprint({ browser: "chromium", url: "https://example.com" }));
    assert.equal(requestFingerprint({ nested: { b: 1, a: [{ y: 2, x: 1 }] } }), requestFingerprint({ nested: { a: [{ x: 1, y: 2 }], b: 1 } }));
  });

  it("distingue corpos diferentes, inclusive por um único campo", () => {
    assert.notEqual(requestFingerprint({ url: "https://example.com" }), requestFingerprint({ url: "https://exemplo.com" }));
    assert.notEqual(requestFingerprint({ url: "https://example.com" }), requestFingerprint({ url: "https://example.com", sitemap: true }));
  });

  it("separa clientes que escolheram a mesma chave", () => {
    assert.notEqual(idempotencyScope("10.0.0.1", "abc"), idempotencyScope("10.0.0.2", "abc"));
  });

  it("marca a reserva como em andamento até a criação terminar", async () => {
    const store = new InMemoryIdempotencyKeys(60_000);
    await store.reserve("cliente abc", "impressao");
    assert.equal((await store.get("cliente abc"))?.jobId, undefined);
    await store.complete("cliente abc", "job-1", "token-1");
    assert.equal((await store.get("cliente abc"))?.jobId, "job-1");
    assert.equal((await store.get("cliente abc"))?.accessToken, "token-1");
  });

  it("libera a chave quando a criação falha, para o cliente poder tentar de novo", async () => {
    const store = new InMemoryIdempotencyKeys(60_000);
    await store.reserve("cliente abc", "impressao");
    await store.release("cliente abc");
    assert.equal(await store.get("cliente abc"), undefined);
  });

  it("descarta registros vencidos em vez de prender a chave para sempre", async () => {
    const store = new InMemoryIdempotencyKeys(60_000);
    const start = 1_000_000;
    await store.reserve("cliente abc", "impressao", start);
    await store.complete("cliente abc", "job-1", "token-1");
    assert.ok(await store.get("cliente abc", start + 59_999));
    assert.equal(await store.get("cliente abc", start + 60_000), undefined);
    assert.equal(await store.size(start + 60_000), 0);
  });

  it("não completa um registro que já foi liberado", async () => {
    // Evita ressuscitar uma chave cuja criação falhou.
    const store = new InMemoryIdempotencyKeys(60_000);
    await store.reserve("cliente abc", "impressao");
    await store.release("cliente abc");
    await store.complete("cliente abc", "job-1", "token-1");
    assert.equal(await store.get("cliente abc"), undefined);
  });
});
