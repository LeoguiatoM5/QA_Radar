import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createQaRadarServer } from "../src/server.js";
import { createOpenApiDocument } from "../src/openapi.js";
import { STATUS_BY_ERROR_CODE } from "../src/api-error.js";
import { VERSION } from "../src/version.js";

interface OpenApiDocument {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { schemas: { ApiError: { properties: { code: { enum: string[] } } } } };
}

describe("openapi contract", () => {
  const document = createOpenApiDocument() as unknown as OpenApiDocument;
  let baseUrl = "";
  let server: ReturnType<typeof createQaRadarServer>;

  before(async () => {
    server = createQaRadarServer({ allowPrivateTargets: true });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("descreve todos os códigos de erro do contrato, sem deixar nenhum de fora", () => {
    // Esta é a razão de o documento ser código e não arquivo estático: um
    // código de erro novo em api-error.ts não pode ficar sem documentação.
    assert.deepEqual([...document.components.schemas.ApiError.properties.code.enum].sort(), Object.keys(STATUS_BY_ERROR_CODE).sort());
  });

  it("acompanha a versão do pacote", () => {
    assert.equal(document.info.version, VERSION);
    assert.equal(document.openapi, "3.1.0");
  });

  it("documenta só caminhos versionados, fora os operacionais", () => {
    for (const path of Object.keys(document.paths)) {
      assert.ok(path.startsWith("/api/v1/") || path === "/health" || path === "/ready", `${path} não é versionado nem operacional`);
    }
  });

  it("serve o documento nos dois prefixos", async () => {
    const versioned = await fetch(`${baseUrl}/api/v1/openapi.json`);
    assert.equal(versioned.status, 200);
    assert.equal(versioned.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(((await versioned.json()) as OpenApiDocument).info.version, VERSION);

    const alias = await fetch(`${baseUrl}/api/openapi.json`);
    assert.equal(alias.status, 200);
  });

  it("não documenta nenhum caminho que o servidor não roteia", async () => {
    // Um endpoint descrito mas inexistente é pior que endpoint sem descrição:
    // o cliente escreve a integração e só descobre em produção.
    for (const [path, operations] of Object.entries(document.paths)) {
      const concrete = path.replaceAll("{id}", randomUUID()).replaceAll("{artifact}", "report.json");
      for (const method of Object.keys(operations)) {
        const response = await fetch(`${baseUrl}${concrete}`, { method: method.toUpperCase() });
        if (response.status !== 404) continue;
        const body = (await response.json()) as { error?: string };
        assert.notEqual(body.error, "Rota não encontrada.", `${method.toUpperCase()} ${path} está documentado mas não é roteado`);
      }
    }
  });

  it("descreve o formato de erro em toda resposta 4xx e 5xx documentada", () => {
    // Duas respostas de status alto não são erro da API e por isso não usam o
    // schema de erro: 422 é uma jornada que executou e reprovou, e o 503 de
    // /ready é o próprio relatório de prontidão.
    const NOT_API_ERRORS = new Set(["/api/v1/code-execution 422", "/ready 503"]);
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, definition] of Object.entries(operation.responses)) {
          if (Number(status) < 400 || NOT_API_ERRORS.has(`${path} ${status}`)) continue;
          const content = (definition as { content?: Record<string, { schema?: { $ref?: string } }> }).content;
          assert.equal(content?.["application/json"]?.schema?.$ref, "#/components/schemas/ApiError", `${method.toUpperCase()} ${path} ${status} não usa o schema de erro`);
        }
      }
    }
  });
});
