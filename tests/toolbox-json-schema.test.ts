import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSchemaValidation, validateJsonSchema } from "../src/toolbox/json-schema.js";

function keywords(schema: unknown, payload: unknown): string[] {
  return validateJsonSchema(schema as never, payload as never).violations.map((violation) => `${violation.keyword} @ ${violation.instancePath}`);
}

describe("toolbox · json schema validator", () => {
  it("aprova um payload que atende ao schema", () => {
    const result = validateJsonSchema({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } as never, { email: "ana@exemplo.com" } as never);

    assert.equal(result.valid, true);
    assert.deepEqual(result.violations, []);
    assert.equal(formatSchemaValidation(result), "O payload atende ao schema.");
  });

  it("aponta campo obrigatório ausente no caminho do campo, não do objeto", () => {
    // O QA precisa saber qual campo faltou; apontar para a raiz obrigaria a
    // ler a mensagem inteira para descobrir.
    const result = validateJsonSchema({ type: "object", required: ["email", "nome"] } as never, { nome: "Ana" } as never);

    assert.deepEqual(
      result.violations.map((violation) => [violation.instancePath, violation.keyword]),
      [["$.email", "required"]],
    );
    assert.match(result.violations[0]?.message ?? "", /email/);
  });

  it("descreve o tipo esperado e o recebido em português", () => {
    const result = validateJsonSchema({ type: "object", properties: { idade: { type: "integer" } } } as never, { idade: "31" } as never);

    assert.equal(result.violations[0]?.instancePath, "$.idade");
    assert.match(result.violations[0]?.message ?? "", /Esperado número inteiro, recebido texto/);
  });

  it("separa integer de number", () => {
    assert.equal(validateJsonSchema({ type: "integer" } as never, 3.5 as never).valid, false);
    assert.equal(validateJsonSchema({ type: "number" } as never, 3.5 as never).valid, true);
    assert.equal(validateJsonSchema({ type: "integer" } as never, 3 as never).valid, true);
  });

  it("valida limites numéricos e de texto", () => {
    assert.deepEqual(keywords({ type: "number", minimum: 10, maximum: 20 }, 5), ["minimum @ $"]);
    assert.deepEqual(keywords({ type: "number", exclusiveMinimum: 10 }, 10), ["exclusiveMinimum @ $"]);
    assert.deepEqual(keywords({ type: "number", multipleOf: 0.5 }, 1.3), ["multipleOf @ $"]);
    assert.deepEqual(keywords({ type: "string", minLength: 3 }, "ab"), ["minLength @ $"]);
    assert.deepEqual(keywords({ type: "string", pattern: "^[a-z]+$" }, "Ana"), ["pattern @ $"]);
  });

  it("conta o tamanho do texto em pontos de código, não em unidades UTF-16", () => {
    // Um emoji tem length 2 em JavaScript; reprovar por isso num maxLength de 1
    // seria falso positivo.
    assert.equal(validateJsonSchema({ type: "string", maxLength: 1 } as never, "🙂" as never).valid, true);
  });

  it("valida formatos comuns e avisa sobre os que não conhece", () => {
    assert.deepEqual(keywords({ type: "string", format: "uuid" }, "não é uuid"), ["format @ $"]);
    assert.equal(validateJsonSchema({ type: "string", format: "date" } as never, "2026-09-01" as never).valid, true);

    const desconhecido = validateJsonSchema({ type: "string", format: "iban" } as never, "qualquer coisa" as never);
    assert.equal(desconhecido.valid, true);
    assert.deepEqual(desconhecido.unsupported, ['format "iban"']);
  });

  it("valida arrays: itens, tamanho, unicidade e tupla", () => {
    assert.deepEqual(keywords({ type: "array", items: { type: "number" } }, [1, "dois", 3]), ["type @ $[1]"]);
    assert.deepEqual(keywords({ type: "array", minItems: 2 }, [1]), ["minItems @ $"]);
    assert.deepEqual(keywords({ type: "array", uniqueItems: true }, [1, 2, 1]), ["uniqueItems @ $[2]"]);
    assert.deepEqual(keywords({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }] }, ["a", "b"]), ["type @ $[1]"]);
  });

  it("desce em objeto aninhado sem perder o caminho", () => {
    assert.deepEqual(keywords({ properties: { data: { properties: { user: { required: ["id"] } } } } }, { data: { user: { nome: "Ana" } } }), ["required @ $.data.user.id"]);
  });

  it("recusa propriedade não prevista quando additionalProperties é false", () => {
    assert.deepEqual(keywords({ type: "object", properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 }), ["additionalProperties @ $.b"]);
  });

  it("valida enum e const", () => {
    assert.deepEqual(keywords({ enum: ["ativo", "inativo"] }, "pendente"), ["enum @ $"]);
    assert.deepEqual(keywords({ const: 42 }, 41), ["const @ $"]);
  });

  it("resolve $ref local, inclusive em components do OpenAPI", () => {
    const schema = {
      $defs: { positivo: { type: "integer", minimum: 1 } },
      type: "object",
      properties: { quantidade: { $ref: "#/$defs/positivo" } },
    };

    assert.equal(validateJsonSchema(schema as never, { quantidade: 3 } as never).valid, true);
    assert.deepEqual(keywords(schema, { quantidade: 0 }), ["minimum @ $.quantidade"]);
  });

  it("não gira em schema recursivo", () => {
    const schema = { $defs: { no: { type: "object", properties: { filho: { $ref: "#/$defs/no" } } } }, $ref: "#/$defs/no" };

    assert.equal(validateJsonSchema(schema as never, { filho: { filho: {} } } as never).valid, true);
  });

  it("avisa quando o $ref não existe, em vez de aprovar por omissão", () => {
    const result = validateJsonSchema({ $ref: "#/$defs/inexistente" } as never, { a: 1 } as never);

    assert.equal(
      result.unsupported.some((entry) => entry.includes("inexistente")),
      true,
    );
  });

  it("resolve allOf, anyOf, oneOf e not", () => {
    assert.equal(validateJsonSchema({ allOf: [{ type: "number" }, { minimum: 5 }] } as never, 7 as never).valid, true);
    assert.deepEqual(keywords({ allOf: [{ type: "number" }, { minimum: 5 }] }, 3), ["minimum @ $"]);
    assert.equal(validateJsonSchema({ anyOf: [{ type: "string" }, { type: "number" }] } as never, 7 as never).valid, true);
    assert.deepEqual(keywords({ anyOf: [{ type: "string" }, { type: "boolean" }] }, 7), ["anyOf @ $"]);
    assert.deepEqual(keywords({ oneOf: [{ type: "number" }, { minimum: 1 }] }, 7), ["oneOf @ $"], "duas alternativas válidas reprovam em oneOf");
    assert.deepEqual(keywords({ not: { type: "string" } }, "texto"), ["not @ $"]);
  });

  it("aceita nullable do OpenAPI 3.0, que aparece em contrato real", () => {
    assert.equal(validateJsonSchema({ type: "string", nullable: true } as never, null as never).valid, true);
    assert.equal(validateJsonSchema({ type: "string" } as never, null as never).valid, false);
  });

  it("entende as formas curtas true e false no lugar do objeto", () => {
    assert.equal(validateJsonSchema(true as never, { qualquer: "coisa" } as never).valid, true);
    assert.equal(validateJsonSchema(false as never, 1 as never).valid, false);
  });

  it("lista as palavras-chave que não avalia, em vez de fingir que validou", () => {
    const result = validateJsonSchema({ type: "object", dependentRequired: { a: ["b"] }, if: {}, then: {} } as never, {} as never);

    assert.deepEqual(result.unsupported, ["dependentRequired", "if", "then"]);
  });

  it("acumula todas as violações, não só a primeira", () => {
    const result = validateJsonSchema({ type: "object", required: ["a", "b"], properties: { c: { type: "number" }, d: { type: "string", minLength: 5 } } } as never, { c: "texto", d: "ab" } as never);

    assert.equal(result.violations.length, 4);
    assert.match(formatSchemaValidation(result), /4 violação\(ões\)/);
  });
});
