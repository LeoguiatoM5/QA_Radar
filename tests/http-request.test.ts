import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createQaRadarServer } from "../src/server.js";
import { guardedFetch } from "../src/routes/http-request.js";

describe("POST /api/http-request", () => {
  let targetOrigin = "";
  const target = createServer((request, response) => {
    if (request.url === "/echo") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json", "x-echo": request.method ?? "" });
        response.end(JSON.stringify({ method: request.method, body: Buffer.concat(chunks).toString("utf8") }));
      });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  before(async () => {
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address() as AddressInfo;
    targetOrigin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
  });

  it("envia uma requisição real e devolve status, headers e corpo da resposta", async () => {
    const app = createQaRadarServer({ allowPrivateTargets: true });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "POST", url: `${targetOrigin}/echo`, headers: { "x-test": "1" }, body: '{"a":1}' }),
      });
      assert.equal(response.status, 200);
      const data = (await response.json()) as { status: number; statusText: string; headers: Record<string, string>; body: string; durationMs: number };
      assert.equal(data.status, 200);
      assert.equal(data.headers["x-echo"], "POST");
      assert.deepEqual(JSON.parse(data.body), { method: "POST", body: '{"a":1}' });
      assert.ok(data.durationMs >= 0);
    } finally {
      await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("ignora corpo em GET/HEAD e não envia headers reservados", async () => {
    const app = createQaRadarServer({ allowPrivateTargets: true });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", url: `${targetOrigin}/echo`, headers: { host: "deveria-ser-ignorado.exemplo" }, body: "ignorado" }),
      });
      const data = (await response.json()) as { body: string };
      assert.deepEqual(JSON.parse(data.body), { method: "GET", body: "" });
    } finally {
      await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("rejeita método não suportado e URL ausente", async () => {
    const app = createQaRadarServer({ allowPrivateTargets: true });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address() as AddressInfo;
    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const missingUrl = await fetch(`${baseUrl}/api/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "GET" }),
      });
      assert.equal(missingUrl.status, 400);

      const badMethod = await fetch(`${baseUrl}/api/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "CONNECT", url: `${targetOrigin}/echo` }),
      });
      assert.equal(badMethod.status, 400);
      assert.match(((await badMethod.json()) as { error: string }).error, /não suportado/);
    } finally {
      await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("bloqueia por padrão um alvo privado", async () => {
    const app = createQaRadarServer();
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const address = app.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/http-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "GET", url: targetOrigin }),
      });
      assert.equal(response.status, 400);
      assert.match(((await response.json()) as { error: string }).error, /privad/);
    } finally {
      await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("valida cada hop de redirecionamento, não só a URL inicial", async () => {
    const redirecting = createServer((_request, response) => {
      response.writeHead(302, { location: "http://blocked.qa-radar.teste/x" });
      response.end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
    const redirectingAddress = redirecting.address() as AddressInfo;
    const fakeResolver = async (hostname: string) => (hostname === "blocked.qa-radar.teste" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
    try {
      await assert.rejects(guardedFetch(`http://127.0.0.1:${redirectingAddress.port}`, "GET", {}, undefined, false, fakeResolver), /privad/);
    } finally {
      await new Promise<void>((resolve, reject) => redirecting.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
