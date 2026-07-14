import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createQaRadarServer } from "../src/server.js";

describe("web server", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createQaRadarServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("entrega o dashboard com cabeçalhos de segurança", async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(html, /Nova análise/);
    assert.match(html, /Executar scanner/);
  });

  it("expõe o estado de saúde sem iniciar uma análise", async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string; active: number; queued: number };
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", active: 0, queued: 0, jobs: 0 });
  });

  it("valida entradas antes de criar uma análise", async () => {
    const response = await fetch(`${baseUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /HTTP ou HTTPS/);
  });

  it("bloqueia destinos privados e limites abusivos", async () => {
    for (const payload of [
      { url: "http://127.0.0.1:8080" },
      { url: "http://10.0.0.1" },
      { url: "https://example.com", timeoutMs: 120001 },
      { url: "https://example.com", settleMs: 30001 },
    ]) {
      const response = await fetch(`${baseUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400);
    }
  });

  it("responde 404 para rotas desconhecidas", async () => {
    const response = await fetch(`${baseUrl}/nao-existe`);
    assert.equal(response.status, 404);
  });
});
