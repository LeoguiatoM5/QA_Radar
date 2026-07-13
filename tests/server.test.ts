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

  it("responde 404 para rotas desconhecidas", async () => {
    const response = await fetch(`${baseUrl}/nao-existe`);
    assert.equal(response.status, 404);
  });
});
