import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCnpj, generateCpf, generateTestData, isValidCnpj, isValidCpf, testDataToCsv, testDataToSql, TEST_DATA_FIELDS, type RandomSource } from "../src/toolbox/test-data.js";

/** Fonte determinística: a mesma sequência sempre produz a mesma massa. */
function sequence(values: readonly number[]): RandomSource {
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

const random = sequence([0.13, 0.71, 0.42, 0.88, 0.05, 0.6, 0.31, 0.97, 0.24, 0.55]);

describe("toolbox · test data generator", () => {
  it("gera CPF com dígitos verificadores corretos", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const cpf = generateCpf(Math.random);
      assert.equal(cpf.length, 11);
      assert.equal(isValidCpf(cpf), true, `CPF gerado inválido: ${cpf}`);
    }
  });

  it("gera CNPJ com dígitos verificadores corretos", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const cnpj = generateCnpj(Math.random);
      assert.equal(cnpj.length, 14);
      assert.equal(isValidCnpj(cnpj), true, `CNPJ gerado inválido: ${cnpj}`);
    }
  });

  it("recusa documentos com todos os dígitos iguais, que passam na conta mas nenhum sistema aceita", () => {
    assert.equal(isValidCpf("11111111111"), false);
    assert.equal(isValidCnpj("11111111111111"), false);
  });

  it("respeita a quantidade pedida e os nomes das propriedades", () => {
    const rows = generateTestData({ fields: [{ key: "documento", type: "cpf", mode: "valid" }], count: 7 }, random);

    assert.equal(rows.length, 7);
    for (const row of rows) assert.deepEqual(Object.keys(row), ["documento"]);
  });

  it("gera dados propositalmente inválidos que reprovam na validação", () => {
    const rows = generateTestData(
      {
        fields: [
          { key: "cpf", type: "cpf", mode: "invalid" },
          { key: "cnpj", type: "cnpj", mode: "invalid" },
          { key: "email", type: "email", mode: "invalid" },
          { key: "nascimento", type: "birthdate", mode: "invalid" },
          { key: "data", type: "date", mode: "invalid" },
          { key: "texto", type: "text", mode: "invalid" },
          { key: "ativo", type: "boolean", mode: "invalid" },
        ],
        count: 5,
      },
      random,
    );

    for (const row of rows) {
      assert.equal(isValidCpf(String(row["cpf"])), false);
      assert.equal(isValidCnpj(String(row["cnpj"])), false);
      assert.equal(String(row["email"]).includes("@"), false);
      // Nascimento no futuro é o caso inválido: a data existe, a regra é que falha.
      assert.ok(Number(String(row["nascimento"]).slice(0, 4)) > new Date().getFullYear());
      assert.match(String(row["data"]), /-02-31$/);
      assert.ok(String(row["texto"]).length > 4000);
      assert.equal(typeof row["ativo"], "string");
    }
  });

  it("gera dados válidos que passam nas mesmas validações", () => {
    const rows = generateTestData(
      {
        fields: [
          { key: "cpf", type: "cpf", mode: "valid" },
          { key: "email", type: "email", mode: "valid" },
          { key: "uuid", type: "uuid", mode: "valid" },
          { key: "cep", type: "cep", mode: "valid" },
          { key: "telefone", type: "phone", mode: "valid" },
        ],
        count: 10,
      },
      random,
    );

    for (const row of rows) {
      assert.equal(isValidCpf(String(row["cpf"])), true);
      assert.match(String(row["email"]), /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
      assert.match(String(row["uuid"]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.match(String(row["cep"]), /^\d{5}-\d{3}$/);
      assert.match(String(row["telefone"]), /^\(\d{2}\) 9\d{4}-\d{4}$/);
    }
  });

  it("recusa pedidos impossíveis antes de gerar qualquer coisa", () => {
    assert.throws(() => generateTestData({ fields: [], count: 5 }, random), /ao menos um campo/);
    assert.throws(() => generateTestData({ fields: [{ key: "a", type: "name", mode: "valid" }], count: 0 }, random), /maior que zero/);
    assert.throws(() => generateTestData({ fields: [{ key: "a", type: "name", mode: "valid" }], count: 5000 }, random), /quantidade máxima/);
    assert.throws(() => generateTestData({ fields: [{ key: " ", type: "name", mode: "valid" }], count: 1 }, random), /precisa de um nome/);
    assert.throws(
      () =>
        generateTestData(
          {
            fields: [
              { key: "id", type: "uuid", mode: "valid" },
              { key: "id", type: "cpf", mode: "valid" },
            ],
            count: 1,
          },
          random,
        ),
      /repetido/,
    );
  });

  it("exporta em CSV com cabeçalho e aspas onde é preciso", () => {
    const rows = [{ nome: 'Ana "A" Lima', valor: 10, ativo: true }];

    assert.equal(testDataToCsv(rows), 'nome,valor,ativo\n"Ana ""A"" Lima",10,true');
    assert.equal(testDataToCsv([]), "");
  });

  it("exporta em SQL escapando aspas e recusando nome de tabela suspeito", () => {
    const rows = [{ nome: "O'Brien", ativo: false, valor: 3.5 }];

    assert.equal(testDataToSql(rows, "clientes"), "INSERT INTO clientes (nome, ativo, valor) VALUES ('O''Brien', FALSE, 3.5);");
    assert.match(testDataToSql(rows, "clientes; DROP TABLE users"), /^INSERT INTO test_data /);
  });

  it("cobre no catálogo todos os tipos que sabe gerar", () => {
    const catalogued = new Set(TEST_DATA_FIELDS.map((field) => field.type));
    const rows = generateTestData({ fields: TEST_DATA_FIELDS.map((field) => ({ key: field.defaultKey, type: field.type, mode: "valid" as const })), count: 1 }, random);

    assert.equal(catalogued.size, TEST_DATA_FIELDS.length);
    assert.equal(Object.keys(rows[0] as Record<string, unknown>).length, TEST_DATA_FIELDS.length);
  });
});
