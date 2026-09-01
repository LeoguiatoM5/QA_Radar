import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPairwiseCases, generatePairwise, pairwiseToCsv, type PairwiseParameter, type PairwiseRow } from "../src/toolbox/pairwise.js";

/** Confere a promessa da técnica: todo par de valores aparece em alguma linha. */
function uncoveredPairs(parameters: readonly PairwiseParameter[], rows: readonly PairwiseRow[]): string[] {
  const missing: string[] = [];
  for (let i = 0; i < parameters.length; i += 1) {
    for (let j = i + 1; j < parameters.length; j += 1) {
      const left = parameters[i] as PairwiseParameter;
      const right = parameters[j] as PairwiseParameter;
      for (const a of left.values) {
        for (const b of right.values) {
          if (!rows.some((row) => row[left.name] === a && row[right.name] === b)) missing.push(`${left.name}=${a} & ${right.name}=${b}`);
        }
      }
    }
  }
  return missing;
}

const navegadores: PairwiseParameter[] = [
  { name: "navegador", values: ["chromium", "firefox", "webkit"] },
  { name: "perfil", values: ["admin", "comum", "visitante"] },
  { name: "idioma", values: ["pt-BR", "en-US"] },
  { name: "plano", values: ["free", "pro"] },
];

describe("toolbox · pairwise generator", () => {
  it("cobre todos os pares", () => {
    const result = generatePairwise(navegadores);

    assert.deepEqual(uncoveredPairs(navegadores, result.rows), []);
  });

  it("custa muito menos que o produto cartesiano", () => {
    const result = generatePairwise(navegadores);

    assert.equal(result.exhaustive, 36);
    assert.ok(result.rows.length < 15, `esperava bem menos que 36 casos, veio ${result.rows.length}`);
    assert.ok(result.reduction > 50);
  });

  it("é determinístico: a mesma entrada dá a mesma suíte", () => {
    // O QA precisa poder versionar o resultado; uma suíte que muda a cada
    // clique não serve para comparar execuções.
    assert.deepEqual(generatePairwise(navegadores).rows, generatePairwise(navegadores).rows);
  });

  it("com dois parâmetros entrega o produto cartesiano, que já é o mínimo", () => {
    const parametros: PairwiseParameter[] = [
      { name: "a", values: ["1", "2", "3"] },
      { name: "b", values: ["x", "y"] },
    ];
    const result = generatePairwise(parametros);

    assert.equal(result.rows.length, 6);
    assert.equal(result.exhaustive, 6);
    assert.deepEqual(uncoveredPairs(parametros, result.rows), []);
  });

  it("lida com parâmetro de um valor só", () => {
    const parametros: PairwiseParameter[] = [
      { name: "ambiente", values: ["producao"] },
      { name: "navegador", values: ["chromium", "firefox"] },
      { name: "perfil", values: ["admin", "comum"] },
    ];
    const result = generatePairwise(parametros);

    assert.deepEqual(uncoveredPairs(parametros, result.rows), []);
    assert.ok(result.rows.every((row) => row["ambiente"] === "producao"));
  });

  it("cobre os pares também numa matriz grande", () => {
    const grande: PairwiseParameter[] = Array.from({ length: 6 }, (_unused, index) => ({
      name: `p${index}`,
      values: ["a", "b", "c", "d"],
    }));
    const result = generatePairwise(grande);

    assert.deepEqual(uncoveredPairs(grande, result.rows), []);
    assert.equal(result.exhaustive, 4096);
    assert.ok(result.rows.length < 60, `esperava uma redução grande, veio ${result.rows.length}`);
  });

  it("não devolve caso que não cobre par nenhum", () => {
    const result = generatePairwise(navegadores);

    for (let index = 0; index < result.rows.length; index += 1) {
      const semEsta = result.rows.filter((_unused, outro) => outro !== index);
      assert.notDeepEqual(uncoveredPairs(navegadores, semEsta), [], `o caso ${index + 1} é redundante`);
    }
  });

  it("descarta valor repetido e espaço em volta", () => {
    const result = generatePairwise([
      { name: " navegador ", values: [" chromium", "chromium ", "firefox"] },
      { name: "perfil", values: ["admin", "comum"] },
    ]);

    assert.equal(result.exhaustive, 4);
    assert.ok(result.rows.every((row) => Object.hasOwn(row, "navegador")));
  });

  it("recusa entradas que não formam uma matriz", () => {
    assert.throws(() => generatePairwise([{ name: "a", values: ["1"] }]), /ao menos dois parâmetros/);
    assert.throws(
      () =>
        generatePairwise([
          { name: "a", values: [] },
          { name: "b", values: ["1"] },
        ]),
      /ao menos dois parâmetros/,
    );
    assert.throws(
      () =>
        generatePairwise([
          { name: "a", values: ["1"] },
          { name: "a", values: ["2"] },
        ]),
      /repetido/,
    );
    assert.throws(
      () =>
        generatePairwise([
          { name: "a", values: Array.from({ length: 30 }, (_unused, index) => String(index)) },
          { name: "b", values: ["1"] },
        ]),
      /mais de 25 valores/,
    );
  });

  it("exporta como plano de teste e como CSV", () => {
    const result = generatePairwise(navegadores);

    assert.match(formatPairwiseCases(result.rows), /^TC001\n {2}navegador: /);
    assert.equal(pairwiseToCsv(result.rows).split("\n")[0], "navegador,perfil,idioma,plano");
    assert.equal(pairwiseToCsv(result.rows).split("\n").length, result.rows.length + 1);
    assert.equal(pairwiseToCsv([]), "");
  });
});
