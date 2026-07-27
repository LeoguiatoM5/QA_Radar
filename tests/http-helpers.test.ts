import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  accessCookie,
  bearerToken,
  json,
  numberField,
  readJson,
  requestToken,
  requireAccess,
  textField,
  tokenHash,
  tokenMatches,
} from "../src/http-helpers.js";

function fakeRequest(overrides: Partial<{ headers: Record<string, string>; body: string; encrypted: boolean }> = {}): IncomingMessage {
  const stream = Readable.from(overrides.body !== undefined ? [Buffer.from(overrides.body)] : []);
  return Object.assign(stream, {
    headers: overrides.headers ?? {},
    socket: { encrypted: overrides.encrypted ?? false, remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function fakeResponse(): ServerResponse & { status?: number; headers: Record<string, unknown>; body?: string } {
  const headers: Record<string, unknown> = {};
  const response = {
    headers,
    status: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(status: number, responseHeaders: Record<string, unknown>) {
      response.status = status;
      Object.assign(headers, responseHeaders);
      return response;
    },
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    end(chunk?: string) {
      response.body = chunk;
    },
  };
  return response as unknown as ServerResponse & { status?: number; headers: Record<string, unknown>; body?: string };
}

describe("http helpers", () => {
  it("gera e valida o hash do token com comparação segura", () => {
    const hash = tokenHash("segredo");
    assert.equal(tokenMatches("segredo", hash), true);
    assert.equal(tokenMatches("outro", hash), false);
  });

  it("extrai o bearer token do cabeçalho Authorization", () => {
    assert.equal(bearerToken(fakeRequest({ headers: { authorization: "Bearer abc123" } })), "abc123");
    assert.equal(bearerToken(fakeRequest({ headers: {} })), undefined);
    assert.equal(bearerToken(fakeRequest({ headers: { authorization: "Basic xyz" } })), undefined);
  });

  it("prioriza o bearer token e cai para o cookie de acesso", () => {
    assert.equal(requestToken(fakeRequest({ headers: { authorization: "Bearer do-header" } })), "do-header");
    assert.equal(
      requestToken(fakeRequest({ headers: { cookie: "qa_radar_access=do-cookie" } })),
      "do-cookie",
    );
    assert.equal(requestToken(fakeRequest({ headers: {} })), undefined);
  });

  it("monta o cookie de acesso com Secure apenas quando a conexão é segura", () => {
    const insecure = accessCookie(fakeRequest({}), "/api/scans", "tok", 60_000, false);
    assert.match(insecure, /HttpOnly; SameSite=Strict; Path=\/api\/scans; Max-Age=60/);
    assert.doesNotMatch(insecure, /Secure/);

    const secure = accessCookie(fakeRequest({ encrypted: true }), "/api/scans", "tok", 60_000, false);
    assert.match(secure, /Secure/);

    const trustedProxy = accessCookie(
      fakeRequest({ headers: { "x-forwarded-proto": "https" } }),
      "/api/scans",
      "tok",
      60_000,
      true,
    );
    assert.match(trustedProxy, /Secure/);
  });

  it("lê e valida o corpo JSON respeitando o limite de bytes", async () => {
    const body = await readJson(fakeRequest({ body: '{"url":"https://example.com"}' }), 1024);
    assert.deepEqual(body, { url: "https://example.com" });

    await assert.rejects(readJson(fakeRequest({ body: "não é json" }), 1024), /Corpo JSON inválido/);
    await assert.rejects(readJson(fakeRequest({ body: "[]" }), 1024), /Corpo JSON inválido/);
    await assert.rejects(readJson(fakeRequest({ body: '{"a":1}' }), 4), /Requisição muito grande/);
  });

  it("extrai campos de texto e número validando tipo", () => {
    assert.equal(textField({ url: "  https://example.com  " }, "url"), "https://example.com");
    assert.equal(textField({ url: "" }, "url"), undefined);
    assert.equal(textField({ url: 123 }, "url"), undefined);
    assert.equal(numberField({ maxPages: 5 }, "maxPages"), "5");
    assert.equal(numberField({ maxPages: "5" }, "maxPages"), undefined);
    assert.equal(numberField({ maxPages: Number.NaN }, "maxPages"), undefined);
  });

  it("escreve respostas JSON com os cabeçalhos de segurança padrão", () => {
    const response = fakeResponse();
    json(response, 201, { ok: true });
    assert.equal(response.status, 201);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body, JSON.stringify({ ok: true }));
  });

  it("exige um token de acesso válido para o hash esperado", () => {
    const hash = tokenHash("correto");
    const missing = fakeResponse();
    assert.equal(requireAccess(fakeRequest({}), missing, hash), false);
    assert.equal(missing.status, 401);

    const wrong = fakeResponse();
    assert.equal(requireAccess(fakeRequest({ headers: { authorization: "Bearer errado" } }), wrong, hash), false);
    assert.equal(wrong.status, 403);

    const correct = fakeResponse();
    assert.equal(requireAccess(fakeRequest({ headers: { authorization: "Bearer correto" } }), correct, hash), true);
    assert.equal(correct.status, undefined);
  });
});
