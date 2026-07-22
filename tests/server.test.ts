import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createQaRadarServer } from "../src/server.js";
import type { OperationalEvent } from "../src/server.js";

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("A condição esperada não ocorreu no prazo.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(html, /Nova análise/);
    assert.match(html, /Executar scanner/);
    assert.match(html, /Cobrir sitemap\.xml/);
    assert.match(html, /TTFB/);
    assert.match(html, /Cancelar/);
    assert.match(html, /progress-bar/);
    assert.match(html, /Histórico desabilitado neste servidor/);
    assert.doesNotMatch(html, /id="journey-form"/);
  });

  it("mantém jornadas desabilitadas por padrão", async () => {
    const response = await fetch(`${baseUrl}/api/journeys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json() as { error: string }).error, /desabilitadas/);
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

  it("aplica rate limit por cliente e publica os cabeçalhos da janela", async () => {
    const limitedServer = createQaRadarServer({
      allowPrivateTargets: true,
      concurrency: 0,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });
    await new Promise<void>((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    const address = limitedServer.address() as AddressInfo;
    const limitedUrl = `http://127.0.0.1:${address.port}`;
    const request = () => fetch(`${limitedUrl}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: limitedUrl }),
    });
    try {
      const accepted = await request();
      assert.equal(accepted.status, 202);
      assert.equal(accepted.headers.get("x-ratelimit-limit"), "1");
      assert.equal(accepted.headers.get("x-ratelimit-remaining"), "0");

      const blocked = await request();
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers.get("x-ratelimit-remaining"), "0");
      assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  });

  it("expõe progresso aditivo e cancela uma análise na fila", async () => {
    const queuedServer = createQaRadarServer({ concurrency: 0, allowPrivateTargets: true });
    await new Promise<void>((resolve) => queuedServer.listen(0, "127.0.0.1", resolve));
    const address = queuedServer.address() as AddressInfo;
    const queuedUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${queuedUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: queuedUrl }),
      });
      const created = (await createResponse.json()) as {
        id: string;
        accessToken: string;
        status: string;
        queuePosition: number;
        progress: { discoveredPages: number; completedPages: number; percent: number; stage: string };
      };
      assert.equal(created.status, "queued");
      assert.match(created.accessToken, /^[A-Za-z0-9_-]{40,}$/);
      assert.match(createResponse.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
      assert.equal(created.queuePosition, 1);
      assert.deepEqual(created.progress, {
        discoveredPages: 0,
        completedPages: 0,
        percent: 0,
        stage: "queued",
      });

      const authorization = { authorization: `Bearer ${created.accessToken}` };
      const deniedResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`);
      assert.equal(deniedResponse.status, 401);
      const forbiddenResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`, {
        headers: { authorization: "Bearer token-incorreto" },
      });
      assert.equal(forbiddenResponse.status, 403);

      const cancelResponse = await fetch(`${queuedUrl}/api/scans/${created.id}/cancel`, {
        method: "POST",
        headers: authorization,
      });
      const cancelled = (await cancelResponse.json()) as { status: string };
      assert.equal(cancelResponse.status, 202);
      assert.equal(cancelled.status, "cancelled");

      const statusResponse = await fetch(`${queuedUrl}/api/scans/${created.id}`, { headers: authorization });
      const status = (await statusResponse.json()) as { status: string; accessToken?: string };
      assert.equal(status.status, "cancelled");
      assert.equal(status.accessToken, undefined);
    } finally {
      await new Promise<void>((resolve) => queuedServer.close(() => resolve()));
    }
  });

  it("interrompe a análise ao atingir o timeout global do servidor", async () => {
    const timeoutServer = createQaRadarServer({
      allowPrivateTargets: true,
      maxJobDurationMs: 25,
      scanRunner: async (_options, control) => new Promise<never>((_resolve, reject) => {
        const fail = () => reject(control?.signal?.reason ?? new Error("abortada"));
        if (control?.signal?.aborted) fail();
        else control?.signal?.addEventListener("abort", fail, { once: true });
      }),
    });
    await new Promise<void>((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
    const address = timeoutServer.address() as AddressInfo;
    const timeoutUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${timeoutUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: timeoutUrl }),
      });
      const created = await createResponse.json() as { id: string; accessToken: string };
      const headers = { authorization: `Bearer ${created.accessToken}` };
      await waitFor(async () => {
        const response = await fetch(`${timeoutUrl}/api/scans/${created.id}`, { headers });
        const job = await response.json() as { status: string; error?: string };
        return job.status === "failed" && /limite global de 25 ms/.test(job.error ?? "");
      });
    } finally {
      await new Promise<void>((resolve) => timeoutServer.close(() => resolve()));
    }
  });

  it("não expõe histórico quando o recurso está desabilitado", async () => {
    const response = await fetch(`${baseUrl}/api/history?project=loja&environment=staging`);
    assert.equal(response.status, 403);
  });

  it("recupera relatórios do disco quando o job não está mais na memória", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-recovery-"));
    const id = "11111111-1111-4111-8111-111111111111";
    const outputDir = join(resultsDir, id);
    const accessToken = "recovery-test-token";
    await mkdir(outputDir);
    await writeFile(join(outputDir, ".access-token.sha256"), createHash("sha256").update(accessToken).digest("hex"));
    await writeFile(join(outputDir, "report.json"), JSON.stringify({
      tool: "QA Radar",
      version: "3.0.1",
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
      const headers = { authorization: `Bearer ${accessToken}` };
      const statusResponse = await fetch(recoveryUrl, { headers });
      const status = (await statusResponse.json()) as { status: string };
      assert.equal(status.status, "completed");
      const htmlResponse = await fetch(`${recoveryUrl}/report.html`, { headers });
      assert.equal(htmlResponse.status, 200);
      assert.equal(htmlResponse.headers.get("cache-control"), "private, no-store");
      assert.match(htmlResponse.headers.get("content-security-policy") ?? "", /sandbox/);
      assert.match(await htmlResponse.text(), /Relatório recuperado/);
    } finally {
      await new Promise<void>((resolve) => recoveryServer.close(() => resolve()));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("expira jobs e registra a remoção depois da retenção", async () => {
    const events: OperationalEvent[] = [];
    const expirationServer = createQaRadarServer({
      allowPrivateTargets: true,
      retentionMs: 25,
      operationalLogger: (event) => events.push(event),
    });
    await new Promise<void>((resolve) => expirationServer.listen(0, "127.0.0.1", resolve));
    const address = expirationServer.address() as AddressInfo;
    const expirationUrl = `http://127.0.0.1:${address.port}`;
    try {
      const createResponse = await fetch(`${expirationUrl}/api/scans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: expirationUrl, sitemap: true, maxPages: 1 }),
      });
      const created = (await createResponse.json()) as { id: string };
      assert.equal(createResponse.status, 202);

      await waitFor(() => events.some((event) => event.event === "scan.expired"));
      const statusResponse = await fetch(`${expirationUrl}/api/scans/${created.id}`);
      assert.equal(statusResponse.status, 404);
      assert.deepEqual(events.map((event) => event.event), [
        "scan.started",
        "scan.failed",
        "scan.expired",
      ]);
      assert.equal(events.at(-1)?.jobs, 0);
    } finally {
      await new Promise<void>((resolve) => expirationServer.close(() => resolve()));
    }
  });
});
