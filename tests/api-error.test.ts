import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServerResponse } from "node:http";
import { ApiError, INTERNAL_ERROR_MESSAGE, STATUS_BY_ERROR_CODE, invalidRequest, toApiError, validating } from "../src/api-error.js";
import { jsonError } from "../src/http-helpers.js";

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

describe("api error", () => {
  it("deriva o status HTTP do código, sem deixar os dois divergirem", () => {
    assert.equal(new ApiError("not_found", "sumiu").status, 404);
    assert.equal(new ApiError("conflict", "estado errado").status, 409);
    assert.equal(invalidRequest("faltou url").status, 400);
    // Todo código do contrato precisa mapear para um status HTTP real.
    for (const [code, status] of Object.entries(STATUS_BY_ERROR_CODE)) {
      assert.ok(status >= 400 && status <= 599, `${code} mapeia para status inválido: ${status}`);
    }
  });

  it("mantém error como texto e acrescenta o código estável", () => {
    // O cliente web e a suíte existente leem body.error; o código é aditivo.
    assert.deepEqual(invalidRequest("Informe a URL da aplicação.").body(), {
      error: "Informe a URL da aplicação.",
      code: "invalid_request",
    });
  });

  it("classifica uma falha não prevista como interna, sem vazar a mensagem original", () => {
    const normalized = toApiError(new TypeError("cannot read properties of undefined (reading 'outputDir')"));
    assert.equal(normalized.status, 500);
    assert.equal(normalized.code, "internal_error");
    assert.equal(normalized.message, INTERNAL_ERROR_MESSAGE);
    assert.doesNotMatch(normalized.message, /outputDir/);
  });

  it("preserva um ApiError já classificado e trata ENOENT como recurso ausente", () => {
    const original = new ApiError("feature_disabled", "Histórico está desabilitado neste servidor.");
    assert.equal(toApiError(original), original);
    assert.equal(toApiError(Object.assign(new Error("no such file"), { code: "ENOENT" })).status, 404);
  });

  it("reclassifica a falha de um validador sem HTTP como erro do cliente", () => {
    // parseCli, parseJourney e a política de código são compartilhados com a
    // CLI e lançam Error comum; sem validating() virariam 500.
    assert.equal(
      validating(() => "resultado intacto"),
      "resultado intacto",
    );
    assert.throws(
      () =>
        validating(() => {
          throw new Error("A URL deve utilizar HTTP ou HTTPS.");
        }),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "invalid_request" && error.message === "A URL deve utilizar HTTP ou HTTPS.",
    );
    // Um ApiError deliberado atravessa sem ser rebaixado a invalid_request.
    assert.throws(
      () =>
        validating(() => {
          throw new ApiError("payload_too_large", "grande demais");
        }),
      (error: unknown) => error instanceof ApiError && error.code === "payload_too_large",
    );
  });

  it("emite o corpo padronizado e os cabeçalhos exigidos pelo status", () => {
    const response = fakeResponse();
    jsonError(response, "unauthorized", "Token ausente.", { "www-authenticate": 'Bearer realm="teste"' });
    assert.equal(response.status, 401);
    assert.equal(response.headers["www-authenticate"], 'Bearer realm="teste"');
    assert.deepEqual(JSON.parse(response.body ?? "{}"), { error: "Token ausente.", code: "unauthorized" });
  });
});
