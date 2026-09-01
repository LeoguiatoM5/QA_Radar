import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseYaml, YAML_UNSUPPORTED } from "../src/toolbox/yaml.js";
import { diffOpenApi, formatOpenApiDiff, type ApiChangeImpact, type OpenApiDiffResult } from "../src/toolbox/openapi-diff.js";
import type { JsonValue } from "../src/toolbox/json-value.js";

function impacts(result: OpenApiDiffResult): string[] {
  return result.changes.map((change) => `${change.impact}: ${change.message}`);
}

function contrato(paths: Record<string, unknown>, version = "1.0.0"): JsonValue {
  return { openapi: "3.0.3", info: { title: "Loja", version }, paths } as JsonValue;
}

const pedidosGet = (responseSchema: unknown, parameters: unknown[] = []) => ({
  get: { parameters, responses: { "200": { description: "ok", content: { "application/json": { schema: responseSchema } } } } },
});

describe("toolbox · yaml (subconjunto para OpenAPI)", () => {
  it("lê mapeamento, sequência e aninhamento por indentação", () => {
    const documento = parseYaml(["openapi: 3.0.3", "info:", "  title: Loja", "  version: '1.2'", "servers:", "  - url: https://a.com", "  - url: https://b.com"].join("\n"));

    assert.deepEqual(documento, { openapi: "3.0.3", info: { title: "Loja", version: "1.2" }, servers: [{ url: "https://a.com" }, { url: "https://b.com" }] });
  });

  it("aceita sequência na mesma coluna da chave, como o OpenAPI costuma escrever", () => {
    assert.deepEqual(parseYaml("tags:\n- pedidos\n- clientes"), { tags: ["pedidos", "clientes"] });
  });

  it("lê coleções em linha e respeita vírgula dentro de aspas", () => {
    assert.deepEqual(parseYaml("x: { a: 1, b: [2, 3], c: 'oi, tudo bem' }"), { x: { a: 1, b: [2, 3], c: "oi, tudo bem" } });
  });

  it("aplica os tipos escalares do YAML e preserva o que está entre aspas", () => {
    assert.deepEqual(parseYaml("a: 1\nb: 1.5\nc: true\nd: null\ne: ~\nf: 'true'\ng: \"x: y\"\nh: texto solto"), {
      a: 1,
      b: 1.5,
      c: true,
      d: null,
      e: null,
      f: "true",
      g: "x: y",
      h: "texto solto",
    });
  });

  it("ignora comentário fora de aspas e mantém o que está dentro", () => {
    assert.deepEqual(parseYaml("# topo\na: 1 # depois\nb: 'tem # dentro'"), { a: 1, b: "tem # dentro" });
  });

  it("lê blocos | e >", () => {
    assert.deepEqual(parseYaml("d: |\n  um\n  dois\noutro: 1"), { d: "um\ndois\n", outro: 1 });
    assert.deepEqual(parseYaml("d: >\n  um\n  dois\noutro: 1"), { d: "um dois\n", outro: 1 });
  });

  it("aceita JSON, que também é YAML", () => {
    assert.deepEqual(parseYaml('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] });
  });

  it("recusa em voz alta o que não suporta, em vez de devolver documento pela metade", () => {
    assert.throws(() => parseYaml("a: &x 1\nb: *x"), new RegExp(YAML_UNSUPPORTED.slice(0, 30)));
    assert.throws(() => parseYaml("a:\n\tb: 1"), /tabulação/);
    assert.throws(() => parseYaml("   "), /vazio/);
    assert.throws(() => parseYaml("{ nao json"), /JSON inválido/);
  });
});

describe("toolbox · openapi diff · estrutura", () => {
  it("marca caminho e operação removidos como quebra", () => {
    const antes = contrato({ "/pedidos": { get: { responses: {} } }, "/clientes": { get: { responses: {} }, post: { responses: {} } } });
    const depois = contrato({ "/clientes": { get: { responses: {} } } }, "2.0.0");

    const result = diffOpenApi(antes, depois);

    assert.equal(result.breaking, true);
    assert.ok(impacts(result).includes("breaking: Caminho removido."));
    assert.ok(impacts(result).includes("breaking: Operação removida."));
    assert.equal(result.from, "1.0.0");
    assert.equal(result.to, "2.0.0");
  });

  it("marca caminho e operação novos como adição, sem quebrar", () => {
    const result = diffOpenApi(
      contrato({ "/pedidos": { get: { responses: {} } } }),
      contrato({ "/pedidos": { get: { responses: {} }, post: { responses: {} } }, "/notas": { get: { responses: {} } } }),
    );

    assert.equal(result.breaking, false);
    assert.equal(result.counts.addition, 2);
  });

  it("ordena a saída com as quebras primeiro", () => {
    const result = diffOpenApi(contrato({ "/a": { get: { responses: {} } } }), contrato({ "/b": { get: { responses: {} } } }));

    assert.equal(result.changes[0]?.impact, "breaking");
  });
});

describe("toolbox · openapi diff · o lado importa", () => {
  const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", required, properties });

  it("campo obrigatório novo na REQUISIÇÃO quebra quem chama", () => {
    const antes = contrato({ "/pedidos": { post: { requestBody: { content: { "application/json": { schema: schema({ item: { type: "string" } }) } } }, responses: {} } } });
    const depois = contrato({
      "/pedidos": { post: { requestBody: { content: { "application/json": { schema: schema({ item: { type: "string" }, cupom: { type: "string" } }, ["cupom"]) } } }, responses: {} } },
    });

    const result = diffOpenApi(antes, depois);

    assert.equal(result.breaking, true);
    assert.ok(impacts(result).some((entry) => entry === "breaking: cupom: propriedade obrigatória nova na requisição."));
  });

  it("campo novo na RESPOSTA é adição, não quebra", () => {
    const result = diffOpenApi(
      contrato({ "/pedidos": pedidosGet(schema({ id: { type: "string" } })) }),
      contrato({ "/pedidos": pedidosGet(schema({ id: { type: "string" }, total: { type: "number" } }, ["total"])) }),
    );

    assert.equal(result.breaking, false);
    assert.ok(impacts(result).some((entry) => entry.startsWith("addition: total")));
  });

  it("campo removido da RESPOSTA quebra quem lê", () => {
    const result = diffOpenApi(
      contrato({ "/pedidos": pedidosGet(schema({ id: { type: "string" }, total: { type: "number" } })) }),
      contrato({ "/pedidos": pedidosGet(schema({ id: { type: "string" } })) }),
    );

    assert.equal(result.breaking, true);
    assert.ok(impacts(result).includes("breaking: total: propriedade removida."));
  });

  it("garantia perdida na RESPOSTA quebra; na requisição é só nota", () => {
    const respostaAntes = contrato({ "/pedidos": pedidosGet(schema({ total: { type: "number" } }, ["total"])) });
    const respostaDepois = contrato({ "/pedidos": pedidosGet(schema({ total: { type: "number" } })) });
    const resposta = diffOpenApi(respostaAntes, respostaDepois);

    assert.equal(resposta.breaking, true);
    assert.ok(impacts(resposta).includes("breaking: total: deixou de ser garantido na resposta."));

    const corpo = (required: string[]) =>
      contrato({ "/pedidos": { post: { requestBody: { content: { "application/json": { schema: schema({ cupom: { type: "string" } }, required) } } }, responses: {} } } });
    const requisicao = diffOpenApi(corpo(["cupom"]), corpo([]));

    assert.equal(requisicao.breaking, false);
    assert.ok(impacts(requisicao).includes("note: cupom: deixou de ser obrigatório na requisição."));
  });

  it("valor a menos no enum quebra na requisição; valor a mais quebra na resposta", () => {
    const requisicao = (valores: string[]) =>
      contrato({
        "/pedidos": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: valores } } } } } }, responses: {} } },
      });
    const menos = diffOpenApi(requisicao(["ativo", "inativo"]), requisicao(["ativo"]));
    assert.equal(menos.breaking, true);
    assert.ok(impacts(menos).some((entry) => entry.includes("valor(es) removido(s) do enum")));

    const resposta = (valores: string[]) => contrato({ "/pedidos": pedidosGet({ type: "object", properties: { status: { type: "string", enum: valores } } }) });
    const mais = diffOpenApi(resposta(["ativo"]), resposta(["ativo", "pendente"]));
    assert.equal(mais.breaking, true);
    assert.ok(impacts(mais).some((entry) => entry.includes("valor(es) novo(s) no enum")));

    // E as combinações inversas não quebram.
    assert.equal(diffOpenApi(requisicao(["ativo"]), requisicao(["ativo", "pendente"])).breaking, false);
    assert.equal(diffOpenApi(resposta(["ativo", "pendente"]), resposta(["ativo"])).breaking, false);
  });

  it("mudança de tipo quebra dos dois lados", () => {
    const result = diffOpenApi(contrato({ "/pedidos": pedidosGet(schema({ total: { type: "number" } })) }), contrato({ "/pedidos": pedidosGet(schema({ total: { type: "string" } })) }));

    assert.ok(impacts(result).includes("breaking: total: o tipo mudou de number para string."));
  });
});

describe("toolbox · openapi diff · parâmetros, corpo e segurança", () => {
  const operacao = (parameters: unknown[]) => ({ "/pedidos": { get: { parameters, responses: {} } } });

  it("parâmetro obrigatório novo quebra; opcional novo é adição", () => {
    const obrigatorio = diffOpenApi(contrato(operacao([])), contrato(operacao([{ name: "loja", in: "query", required: true }])));
    assert.equal(obrigatorio.breaking, true);

    const opcional = diffOpenApi(contrato(operacao([])), contrato(operacao([{ name: "loja", in: "query" }])));
    assert.equal(opcional.breaking, false);
    assert.equal(opcional.counts.addition, 1);
  });

  it("parâmetro que passa a ser obrigatório quebra", () => {
    const result = diffOpenApi(contrato(operacao([{ name: "loja", in: "query" }])), contrato(operacao([{ name: "loja", in: "query", required: true }])));

    assert.ok(impacts(result).includes("breaking: Parâmetro loja passou a ser obrigatório."));
  });

  it("distingue parâmetros de mesmo nome em lugares diferentes", () => {
    const result = diffOpenApi(contrato(operacao([{ name: "id", in: "path", required: true }])), contrato(operacao([{ name: "id", in: "query", required: true }])));

    assert.ok(impacts(result).includes("breaking: Parâmetro removido: id (path)."));
    assert.ok(impacts(result).includes("breaking: Parâmetro obrigatório novo: id (query)."));
  });

  it("passar a exigir corpo ou autenticação quebra", () => {
    const semCorpo = contrato({ "/pedidos": { post: { responses: {} } } });
    const comCorpo = contrato({ "/pedidos": { post: { requestBody: { required: true, content: {} }, responses: {} } } });
    assert.equal(diffOpenApi(semCorpo, comCorpo).breaking, true);

    const semAuth = contrato({ "/pedidos": { get: { security: [], responses: {} } } });
    const comAuth = contrato({ "/pedidos": { get: { security: [{ bearer: [] }], responses: {} } } });
    assert.ok(impacts(diffOpenApi(semAuth, comAuth)).includes("breaking: A operação passou a exigir autenticação."));
  });

  it("resposta de sucesso removida quebra; um 4xx a menos é nota", () => {
    const com = (status: string) => contrato({ "/pedidos": { get: { responses: { "200": { description: "ok" }, [status]: { description: "erro" } } } } });
    const sem = contrato({ "/pedidos": { get: { responses: { "200": { description: "ok" } } } } });

    assert.equal(diffOpenApi(com("404"), sem).breaking, false);
    assert.equal(
      diffOpenApi(contrato({ "/pedidos": { get: { responses: { "200": { description: "ok" } } } } }), contrato({ "/pedidos": { get: { responses: { "404": { description: "erro" } } } } })).breaking,
      true,
    );
  });

  it("resolve $ref de components dos dois documentos", () => {
    const documento = (tipo: string): JsonValue =>
      ({
        openapi: "3.0.3",
        info: { version: "1.0.0" },
        paths: { "/pedidos": pedidosGet({ $ref: "#/components/schemas/Pedido" }) },
        components: { schemas: { Pedido: { type: "object", properties: { total: { type: tipo } } } } },
      }) as JsonValue;

    assert.ok(impacts(diffOpenApi(documento("number"), documento("string"))).includes("breaking: total: o tipo mudou de number para string."));
  });

  it("compara contratos escritos em YAML", () => {
    const yaml = (version: string, required: string) =>
      parseYaml(
        [
          "openapi: 3.0.3",
          "info:",
          `  version: '${version}'`,
          "paths:",
          "  /pedidos:",
          "    post:",
          "      requestBody:",
          "        content:",
          "          application/json:",
          "            schema:",
          "              type: object",
          "              required:",
          `                - ${required}`,
          "              properties:",
          "                item:",
          "                  type: string",
          "                cupom:",
          "                  type: string",
          "      responses:",
          "        '201':",
          "          description: criado",
        ].join("\n"),
      );

    const result = diffOpenApi(yaml("1.0.0", "item"), yaml("1.1.0", "cupom"));

    assert.equal(result.from, "1.0.0");
    assert.equal(result.to, "1.1.0");
    assert.ok(impacts(result).includes("breaking: cupom: passou a ser obrigatório na requisição."));
  });

  it("não aponta diferença entre um contrato e ele mesmo", () => {
    const documento = contrato({ "/pedidos": pedidosGet({ type: "object", required: ["id"], properties: { id: { type: "string" } } }, [{ name: "page", in: "query" }]) });

    const result = diffOpenApi(documento, structuredClone(documento) as JsonValue);

    assert.deepEqual(result.changes, []);
    assert.equal(result.breaking, false);
    assert.match(formatOpenApiDiff(result), /Nenhuma diferença encontrada/);
  });

  it("recusa documento que não é um contrato", () => {
    assert.throws(() => diffOpenApi("texto" as never, {} as never), /objetos OpenAPI/);
    assert.throws(() => diffOpenApi({ info: {} } as never, { info: {} } as never), /`paths`/);
  });

  it("resume o resultado num relatório colável", () => {
    const result = diffOpenApi(contrato({ "/a": { get: { responses: {} } } }), contrato({ "/b": { get: { responses: {} } } }, "2.0.0"));
    const texto = formatOpenApiDiff(result);

    assert.match(texto, /^OpenAPI 1\.0\.0 -> 2\.0\.0/);
    assert.match(texto, /RESULTADO: HÁ QUEBRA DE COMPATIBILIDADE/);
    assert.match(texto, /\[BREAKING\]/);
    const impactos: ApiChangeImpact[] = ["breaking", "addition"];
    for (const impacto of impactos) assert.ok(result.counts[impacto] > 0);
  });
});
