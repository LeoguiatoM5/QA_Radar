import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTimestamp, parseTimestampInput, TIMESTAMP_SOURCE_LABELS } from "../src/toolbox/timestamp.js";
import { compileRegex, formatRegexResult, MAX_REGEX_MATCHES, testRegex } from "../src/toolbox/regex-tester.js";
import { findHttpStatus, HTTP_STATUSES, HTTP_STATUS_CLASSES, searchHttpStatuses } from "../src/toolbox/http-status.js";

const NOW = Date.parse("2026-09-01T15:00:00Z");

describe("toolbox · timestamp converter", () => {
  it("lê 10 dígitos como segundos e 13 como milissegundos", () => {
    const segundos = parseTimestampInput("1788274800", NOW);
    const milissegundos = parseTimestampInput("1788274800000", NOW);

    assert.equal(segundos.source, "epoch-seconds");
    assert.equal(milissegundos.source, "epoch-milliseconds");
    assert.equal(segundos.epochMs, milissegundos.epochMs, "o mesmo instante, escrito em duas unidades");
    assert.equal(TIMESTAMP_SOURCE_LABELS[segundos.source], "Epoch em segundos");
  });

  it("lê 16 dígitos como microssegundos", () => {
    const leitura = parseTimestampInput("1788274800000000", NOW);

    assert.equal(leitura.source, "epoch-microseconds");
    assert.equal(leitura.epochMs, 1788274800000);
  });

  it("avisa quando o resultado cai fora de qualquer época plausível", () => {
    // 1788274800000 lido como segundos joga a data para o ano 58 mil: é o
    // sintoma clássico de unidade trocada.
    const leitura = parseTimestampInput("999", NOW);

    assert.match(leitura.warnings.join(" "), /fora da faixa de 1990 a 2100/);
  });

  it("lê data ISO com fuso e avisa quando o fuso está ausente", () => {
    assert.deepEqual(parseTimestampInput("2026-09-01T15:00:00Z", NOW).warnings, []);
    assert.deepEqual(parseTimestampInput("2026-09-01T12:00:00-03:00", NOW).warnings, []);
    assert.match(parseTimestampInput("2026-09-01T15:00:00", NOW).warnings.join(" "), /não declara fuso/);
  });

  it("entende vazio, now e agora como o instante atual", () => {
    for (const entrada of ["", "   ", "now", "AGORA"]) {
      const leitura = parseTimestampInput(entrada, NOW);
      assert.equal(leitura.source, "now");
      assert.equal(leitura.epochMs, NOW);
    }
  });

  it("recusa o que não é epoch nem data", () => {
    assert.throws(() => parseTimestampInput("ontem à noite", NOW), /Não reconheci o valor/);
  });

  it("descreve o instante nas unidades que o QA precisa comparar", () => {
    const breakdown = describeTimestamp(Date.parse("2026-09-01T15:00:00Z"), NOW);

    assert.equal(breakdown.iso, "2026-09-01T15:00:00.000Z");
    assert.equal(breakdown.epochSeconds, 1788274800);
    assert.equal(breakdown.epochMilliseconds, 1788274800000);
    assert.match(breakdown.utc, /2026/);
    assert.ok(breakdown.timeZone.length > 0);
    assert.ok(breakdown.weekday.length > 0);
  });

  it("descreve a distância até agora em texto", () => {
    assert.match(describeTimestamp(NOW - 2 * 3_600_000, NOW).relative, /2/);
    assert.match(describeTimestamp(NOW + 86_400_000, NOW).relative, /amanh|1 dia/i);
  });
});

describe("toolbox · regex tester", () => {
  it("lista cada casamento com posição, linha e grupos", () => {
    const result = testRegex("(\\w+)@(\\w+)\\.com", "g", "ana@exemplo.com\nbruno@teste.com");

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0]?.line, 1);
    assert.equal(result.matches[0]?.index, 0);
    assert.equal(result.matches[1]?.line, 2);
    assert.deepEqual(
      result.matches[0]?.groups.map((group) => group.value),
      ["ana", "exemplo"],
    );
  });

  it("expõe grupos nomeados pelo nome", () => {
    const result = testRegex("(?<ddd>\\d{2})9(?<numero>\\d{8})", "g", "11987654321");

    const nomeados = Object.fromEntries((result.matches[0]?.groups ?? []).map((group) => [group.name, group.value]));
    assert.equal(nomeados["ddd"], "11");
    assert.equal(nomeados["numero"], "87654321");
  });

  it("marca quais linhas casaram, que é a leitura mais útil de um log", () => {
    const result = testRegex("ERROR", "g", "info: ok\nERROR: caiu\ninfo: ok\nERROR: de novo");

    assert.deepEqual(
      result.lines.map((line) => line.matched),
      [false, true, false, true],
    );
    assert.equal(result.lines.length, 4);
  });

  it("acrescenta o g sozinho, senão só o primeiro casamento apareceria", () => {
    assert.equal(compileRegex("a", "i").flags.includes("g"), true);
    assert.equal(testRegex("a", "", "aaa").matches.length, 3);
  });

  it("avisa e não trava quando a expressão casa com vazio", () => {
    const result = testRegex("x*", "g", "abc");

    assert.ok(result.matches.length > 0);
    assert.match(result.warnings.join(" "), /casa com texto vazio/);
    assert.ok(result.matches.length <= MAX_REGEX_MATCHES + 1);
  });

  it("recusa expressão inválida com a mensagem do motor", () => {
    assert.throws(() => testRegex("(", "g", "abc"), /Expressão inválida/);
    assert.throws(() => testRegex("", "g", "abc"), /Informe a expressão/);
    assert.throws(() => testRegex("a", "gz", "abc"), /Flag não suportada/);
  });

  it("recusa texto de teste maior que o teto", () => {
    assert.throws(() => testRegex("a", "g", "x".repeat(200_001)), /passa de/);
  });

  it("resume o resultado num texto colável", () => {
    const texto = formatRegexResult(testRegex("(\\d+)", "g", "pedido 42\npedido 7"));

    assert.match(texto, /2 casamento\(s\) em 2 linha\(s\)/);
    assert.match(texto, /linha 1, posição 7: 42/);
    assert.equal(formatRegexResult(testRegex("zzz", "g", "abc")), "Nenhum casamento.");
  });
});

describe("toolbox · http status explorer", () => {
  it("descreve cada código com resumo e o que checar", () => {
    for (const status of HTTP_STATUSES) {
      assert.ok(status.code >= 100 && status.code < 600, `código fora da faixa: ${status.code}`);
      assert.equal(status.group, `${Math.floor(status.code / 100)}xx`);
      assert.ok(status.name.length > 1, `${status.code} sem nome`);
      assert.ok(status.summary.length > 15, `${status.code} sem resumo útil`);
      assert.ok(status.testing.length > 20, `${status.code} não diz o que checar`);
    }
  });

  it("não repete código e cobre as cinco classes", () => {
    const codigos = HTTP_STATUSES.map((status) => status.code);
    assert.equal(new Set(codigos).size, codigos.length);
    for (const classe of HTTP_STATUS_CLASSES) {
      assert.ok(
        HTTP_STATUSES.some((status) => status.group === classe.id),
        `classe sem nenhum código: ${classe.id}`,
      );
    }
  });

  it("traz a família inteira quando se digita um prefixo", () => {
    // Quem digita "40" está investigando a família 40x, não procurando o
    // código 40 — que não existe.
    const encontrados = searchHttpStatuses("40").map((status) => status.code);

    assert.ok(encontrados.includes(400));
    assert.ok(encontrados.includes(404));
    assert.ok(encontrados.every((code) => String(code).startsWith("40")));
  });

  it("busca por texto, ignorando acento e caixa", () => {
    assert.ok(searchHttpStatuses("AUTENTICACAO").some((status) => status.code === 401));
    assert.ok(searchHttpStatuses("cache").some((status) => status.code === 304));
    assert.ok(searchHttpStatuses("timeout").some((status) => status.code === 504));
  });

  it("devolve o catálogo inteiro sem busca e nada para termo inexistente", () => {
    assert.equal(searchHttpStatuses("").length, HTTP_STATUSES.length);
    assert.equal(searchHttpStatuses("   ").length, HTTP_STATUSES.length);
    assert.equal(searchHttpStatuses("nao existe isso").length, 0);
  });

  it("encontra pelo código exato", () => {
    assert.equal(findHttpStatus(429)?.name, "Too Many Requests");
    assert.equal(findHttpStatus(999), undefined);
  });
});
