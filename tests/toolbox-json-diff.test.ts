import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffJson, formatJsonDiff, formatJsonText, JSON_DIFF_LABELS } from "../src/toolbox/json-diff.js";
import { parseJsonInput } from "../src/toolbox/json-value.js";

describe("toolbox · json diff", () => {
  it("não aponta diferença entre dois JSON iguais", () => {
    const result = diffJson({ a: 1, b: [1, 2, { c: true }] }, { a: 1, b: [1, 2, { c: true }] });

    assert.equal(result.equal, true);
    assert.deepEqual(result.entries, []);
    assert.match(formatJsonDiff(result), /equivalentes/);
  });

  it("ignora a ordem das propriedades, que não muda o significado do JSON", () => {
    const result = diffJson({ a: 1, b: 2 }, { b: 2, a: 1 });

    assert.equal(result.equal, true);
  });

  it("aponta propriedade alterada com o caminho, o valor anterior e o novo", () => {
    const result = diffJson({ limit: 5000 }, { limit: 3000 });

    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.entries[0], { path: "$.limit", kind: "changed", before: 5000, after: 3000, beforeKind: "number", afterKind: "number" });
    assert.equal(result.counts.changed, 1);
  });

  it("aponta propriedade adicionada e removida", () => {
    const result = diffJson({ removida: "a" }, { adicionada: "b" });

    const kinds = result.entries.map((entry) => `${entry.kind} ${entry.path}`).sort();
    assert.deepEqual(kinds, ["added $.adicionada", "removed $.removida"]);
    assert.equal(result.counts.added, 1);
    assert.equal(result.counts.removed, 1);
  });

  it("separa mudança de tipo de mudança de valor", () => {
    // "5000" virar 5000 quebra cliente tipado; 5000 virar 3000 não. Tratar as
    // duas como a mesma coisa esconderia a quebra de contrato.
    const result = diffJson({ limit: "5000" }, { limit: 5000 });

    assert.equal(result.entries[0]?.kind, "type_changed");
    assert.equal(result.entries[0]?.beforeKind, "string");
    assert.equal(result.entries[0]?.afterKind, "number");
    assert.equal(JSON_DIFF_LABELS.type_changed, "TYPE_CHANGED");
  });

  it("compara arrays por índice e reporta o elemento que sobrou", () => {
    const result = diffJson({ items: [1, 2, 3] }, { items: [1, 9] });

    assert.deepEqual(
      result.entries.map((entry) => [entry.kind, entry.path]),
      [
        ["changed", "$.items[1]"],
        ["removed", "$.items[2]"],
      ],
    );
  });

  it("desce em objetos aninhados sem perder o caminho", () => {
    const result = diffJson({ data: { user: { name: "Ana" } } }, { data: { user: { name: "Bruno" } } });

    assert.equal(result.entries[0]?.path, "$.data.user.name");
  });

  it("ignora um campo dinâmico pelo nome, em qualquer profundidade", () => {
    const result = diffJson({ id: 1, data: { id: 2, valor: 10 } }, { id: 9, data: { id: 8, valor: 10 } }, { ignore: ["id"] });

    assert.equal(result.equal, true);
    assert.deepEqual(result.ignored.sort(), ["$.data.id", "$.id"]);
  });

  it("ignora por caminho e por índice de array com [*]", () => {
    const before = { metadata: { timestamp: "1" }, data: [{ requestId: "a", valor: 1 }] };
    const after = { metadata: { timestamp: "2" }, data: [{ requestId: "b", valor: 1 }] };

    const result = diffJson(before, after, { ignore: ["metadata.timestamp", "data[*].requestId"] });

    assert.equal(result.equal, true);
  });

  it("não deixa uma regra de caminho apagar uma propriedade de nome parecido", () => {
    // `metadata.timestamp` não pode calar `outro.timestamp` — quem escreveu o
    // caminho completo pediu precisão de propósito.
    const result = diffJson({ metadata: { timestamp: "1" }, outro: { timestamp: "1" } }, { metadata: { timestamp: "2" }, outro: { timestamp: "9" } }, { ignore: ["metadata.timestamp"] });

    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      ["$.outro.timestamp"],
    );
  });

  it("recusa JSON inválido com mensagem que diz qual dos dois lados falhou", () => {
    assert.throws(() => parseJsonInput("{ nao json", "Original"), /Original: JSON inválido/);
    assert.throws(() => parseJsonInput("   ", "Comparar com"), /Comparar com: informe um JSON/);
    assert.throws(() => formatJsonText("{", "Original"), /Original: JSON inválido/);
  });

  it("compara JSON minificado e formatado como o mesmo documento", () => {
    const minified = parseJsonInput('{"a":1,"b":{"c":2}}', "Original");
    const pretty = parseJsonInput('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}', "Comparar com");

    assert.equal(diffJson(minified, pretty).equal, true);
  });

  it("reindenta a entrada sem alterar o conteúdo", () => {
    assert.equal(formatJsonText('{"a":1}', "Original"), '{\n  "a": 1\n}');
    assert.equal(formatJsonText("   ", "Original"), "");
  });

  it("resume o resultado num texto colável", () => {
    const text = formatJsonDiff(diffJson({ a: 1, b: 2 }, { a: 2, c: 3 }));

    assert.match(text, /3 diferença\(s\)/);
    assert.match(text, /CHANGED \$\.a/);
    assert.match(text, /REMOVED \$\.b/);
    assert.match(text, /ADDED \$\.c/);
  });
});
