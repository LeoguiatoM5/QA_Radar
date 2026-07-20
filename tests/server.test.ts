import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assert.match(html, /Cobrir sitemap\.xml/);
    assert.match(html, /TTFB/);
    assert.match(html, /Histórico desabilitado neste servidor/);
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

  it("não expõe histórico quando o recurso está desabilitado", async () => {
    const response = await fetch(`${baseUrl}/api/history?project=loja&environment=staging`);
    assert.equal(response.status, 403);
  });

  it("recupera relatórios do disco quando o job não está mais na memória", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-recovery-"));
    const id = "11111111-1111-4111-8111-111111111111";
    const outputDir = join(resultsDir, id);
    await mkdir(outputDir);
    await writeFile(join(outputDir, "report.json"), JSON.stringify({
      tool: "QA Radar",
      version: "3.0.0",
      startedAt: "2026-07-14T00:00:00.000Z",
      targetUrl: "https://example.com/",
      issues: [],
    }));
    await writeFile(join(outputDir, "report.html"), "<h1>Relatório recuperado</h1>");
    const recoveryServer = createQaRadarServer({ resultsDir });
    await new Promise<void>((resolve) => recoveryServer.listen(0, "127.0.0.1", resolve));
    const address = recoveryServer.address() as AddressInfo;
    const recoveryUrl = `http://127.0.0.1:${address.port}/api/scans/${id}`;
    try {
      const statusResponse = await fetch(recoveryUrl);
      const status = (await statusResponse.json()) as { status: string };
      assert.equal(status.status, "completed");
      const htmlResponse = await fetch(`${recoveryUrl}/report.html`);
      assert.equal(htmlResponse.status, 200);
      assert.match(await htmlResponse.text(), /Relatório recuperado/);
    } finally {
      await new Promise<void>((resolve) => recoveryServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
