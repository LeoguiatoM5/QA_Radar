import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundaryCasesToCsv, formatBoundaryCases, generateBoundaryCases } from "../src/toolbox/boundary-values.js";

describe("toolbox · boundary value generator", () => {
  it("gera os seis casos clássicos de um inteiro", () => {
    const cases = generateBoundaryCases({ field: "idade", type: "integer", minimum: "18", maximum: "65" });

    assert.deepEqual(
      cases.map((testCase) => [testCase.input, testCase.valid]),
      [
        ["17", false],
        ["18", true],
        ["19", true],
        ["64", true],
        ["65", true],
        ["66", false],
      ],
    );
    assert.deepEqual(
      cases.map((testCase) => testCase.id),
      ["TC001", "TC002", "TC003", "TC004", "TC005", "TC006"],
    );
  });

  it("marca o mínimo e o máximo como válidos e os vizinhos de fora como inválidos", () => {
    const cases = generateBoundaryCases({ field: "idade", type: "integer", minimum: "18", maximum: "65" });
    const positions = Object.fromEntries(cases.map((testCase) => [testCase.position, testCase.valid]));

    assert.equal(positions["minimum"], true);
    assert.equal(positions["maximum"], true);
    assert.equal(positions["below-minimum"], false);
    assert.equal(positions["above-maximum"], false);
  });

  it("não repete o mesmo valor quando a faixa é curta", () => {
    // Com 1..2 o "acima do mínimo" e o "máximo" são o mesmo valor; repetir o
    // caso só inflaria a suíte.
    const cases = generateBoundaryCases({ field: "quantidade", type: "integer", minimum: "1", maximum: "2" });

    assert.deepEqual(
      cases.map((testCase) => testCase.input),
      ["0", "1", "2", "3"],
    );
    // O 2 chega como "acima do mínimo" e precisa ser rotulado como o máximo.
    assert.equal(cases[2]?.position, "maximum");
  });

  it("não marca como válido um valor fora da faixa quando mínimo e máximo são iguais", () => {
    // Regressão: a validade vinha da posição de origem do ponto, então numa
    // faixa 5..5 o "primeiro valor acima do mínimo" (6) saía como VALID e o
    // caso "acima do máximo" desaparecia — a ferramenta ensinava exatamente o
    // contrário do que a técnica existe para descobrir.
    const cases = generateBoundaryCases({ field: "idade", type: "integer", minimum: "5", maximum: "5" });

    assert.deepEqual(
      cases.map((testCase) => [testCase.input, testCase.valid, testCase.position]),
      [
        ["4", false, "below-minimum"],
        ["5", true, "minimum"],
        ["6", false, "above-maximum"],
      ],
    );
  });

  it("aplica a mesma regra a texto, data e decimal de faixa mínima", () => {
    const texto = generateBoundaryCases({ field: "sigla", type: "string-length", minimum: "3", maximum: "3" });
    const data = generateBoundaryCases({ field: "dia", type: "date", minimum: "2026-01-01", maximum: "2026-01-01" });
    const decimal = generateBoundaryCases({ field: "taxa", type: "decimal", minimum: "10", maximum: "10", step: 0.01 });

    assert.deepEqual(
      texto.map((testCase) => [testCase.display, testCase.valid]),
      [
        ["2 caractere(s)", false],
        ["3 caractere(s)", true],
        ["4 caractere(s)", false],
      ],
    );
    assert.deepEqual(
      data.map((testCase) => [testCase.input, testCase.valid]),
      [
        ["2025-12-31", false],
        ["2026-01-01", true],
        ["2026-01-02", false],
      ],
    );
    assert.deepEqual(
      decimal.map((testCase) => [testCase.input, testCase.valid]),
      [
        ["9.99", false],
        ["10", true],
        ["10.01", false],
      ],
    );
  });

  it("recusa dia que não existe no mês em vez de rolar para o mês seguinte", () => {
    // Regressão: Date.parse("2026-02-30") não dá NaN, rola para 2026-03-02 —
    // e os casos saíam para uma faixa que ninguém pediu.
    assert.throws(() => generateBoundaryCases({ field: "vigencia", type: "date", minimum: "2026-02-30", maximum: "2026-12-31" }), /não é uma data existente/);
    assert.throws(() => generateBoundaryCases({ field: "vigencia", type: "date", minimum: "2025-02-29", maximum: "2025-12-31" }), /não é uma data existente/);
    // 2028 é bissexto: 29/02 existe e continua passando.
    assert.equal(generateBoundaryCases({ field: "vigencia", type: "date", minimum: "2028-02-29", maximum: "2028-12-31" })[1]?.input, "2028-02-29");
  });

  it("usa o passo informado no tipo decimal", () => {
    const cases = generateBoundaryCases({ field: "preco", type: "decimal", minimum: "10.00", maximum: "20.00", step: 0.01 });

    assert.deepEqual(
      cases.map((testCase) => testCase.input),
      ["9.99", "10", "10.01", "19.99", "20", "20.01"],
    );
  });

  it("gera texto do tamanho pedido para o tipo string", () => {
    const cases = generateBoundaryCases({ field: "apelido", type: "string-length", minimum: "3", maximum: "20" });

    assert.deepEqual(
      cases.map((testCase) => testCase.input.length),
      [2, 3, 4, 19, 20, 21],
    );
    assert.equal(cases[0]?.display, "2 caractere(s)");
    assert.equal(cases[5]?.valid, false);
  });

  it("não inventa texto de tamanho negativo quando o mínimo é zero", () => {
    const cases = generateBoundaryCases({ field: "observacao", type: "string-length", minimum: "0", maximum: "5" });

    assert.equal(
      cases.some((testCase) => testCase.position === "below-minimum"),
      false,
    );
    assert.equal(cases[0]?.input, "");
  });

  it("anda um dia para cada lado no tipo data", () => {
    const cases = generateBoundaryCases({ field: "vigencia", type: "date", minimum: "2026-01-01", maximum: "2026-12-31" });

    assert.deepEqual(
      cases.map((testCase) => testCase.input),
      ["2025-12-31", "2026-01-01", "2026-01-02", "2026-12-30", "2026-12-31", "2027-01-01"],
    );
  });

  it("recusa entradas que não formam uma faixa", () => {
    assert.throws(() => generateBoundaryCases({ field: "idade", type: "integer", minimum: "65", maximum: "18" }), /maior que o máximo/);
    assert.throws(() => generateBoundaryCases({ field: "idade", type: "integer", minimum: "", maximum: "18" }), /deve ser um número/);
    assert.throws(() => generateBoundaryCases({ field: "idade", type: "integer", minimum: "1.5", maximum: "18" }), /inteiro/);
    assert.throws(() => generateBoundaryCases({ field: "data", type: "date", minimum: "01/01/2026", maximum: "2026-12-31" }), /AAAA-MM-DD/);
    assert.throws(() => generateBoundaryCases({ field: "preco", type: "decimal", minimum: "1", maximum: "2", step: 0 }), /maior que zero/);
  });

  it("exporta os casos como plano de teste e como CSV", () => {
    const cases = generateBoundaryCases({ field: "idade", type: "integer", minimum: "18", maximum: "65" });
    const text = formatBoundaryCases(cases);
    const csv = boundaryCasesToCsv(cases);

    assert.match(text, /TC001 - Validar valor abaixo do mínimo de idade/);
    assert.match(text, /Input: 17\nExpected: rejected/);
    assert.match(text, /Input: 18\nExpected: accepted/);
    assert.equal(csv.split("\n")[0], "id,title,input,expected");
    assert.equal(csv.split("\n").length, cases.length + 1);
  });
});
