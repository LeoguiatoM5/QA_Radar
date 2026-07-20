import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCli } from "../src/cli.js";

describe("parseCli", () => {
  it("cria uma configuração segura por padrão", () => {
    const result = parseCli(["https://example.com"]);
    assert.equal(result.action, "scan");
    assert.equal(result.options?.url, "https://example.com/");
    assert.equal(result.options?.headed, false);
    assert.equal(result.options?.failOn, "error");
    assert.equal(result.options?.format, "all");
    assert.equal(result.options?.regressionsOnly, false);
  });

  it("interpreta opções e filtros", () => {
    const result = parseCli([
      "https://example.com",
      "--browser",
      "firefox",
      "--headed",
      "--timeout",
      "5000",
      "--settle",
      "0",
      "--ignore-status",
      "401,404",
      "--ignore-url",
      "analytics",
    ]);
    const options = result.options;
    assert.equal(options?.browser, "firefox");
    assert.equal(options?.headed, true);
    assert.equal(options?.timeoutMs, 5000);
    assert.equal(options?.settleMs, 0);
    assert.deepEqual([...options?.ignoredStatuses ?? []], [401, 404]);
    assert.equal(options?.ignoredUrlPatterns[0]?.test("/analytics/event"), true);
  });

  it("rejeita protocolo inseguro ou não suportado", () => {
    assert.throws(() => parseCli(["file:///segredo"]), /HTTP ou HTTPS/);
  });

  it("rejeita opções desconhecidas", () => {
    assert.throws(() => parseCli(["https://example.com", "--nao-existe"]), /Opção desconhecida/);
  });

  it("configura baseline e gate de regressões", () => {
    const result = parseCli([
      "https://example.com",
      "--baseline",
      "previous.json",
      "--regressions-only",
    ]);
    assert.ok(result.options?.baselinePath?.endsWith("previous.json"));
    assert.equal(result.options?.regressionsOnly, true);
  });

  it("exige baseline para o gate de regressões", () => {
    assert.throws(
      () => parseCli(["https://example.com", "--regressions-only"]),
      /exige --baseline ou --project/,
    );
  });

  it("configura histórico isolado por projeto e ambiente", () => {
    const result = parseCli([
      "https://example.com",
      "--project", "Loja-Web",
      "--environment", "Staging",
      "--regressions-only",
    ]);
    assert.equal(result.options?.project, "loja-web");
    assert.equal(result.options?.environment, "staging");
    assert.ok(result.options?.historyDir?.endsWith(".qa-radar-history"));
  });

  it("rejeita ambiente sem projeto e identificadores inseguros", () => {
    assert.throws(() => parseCli(["https://example.com", "--environment", "prod"]), /exige a opção --project/);
    assert.throws(() => parseCli(["https://example.com", "--project", "../segredo"]), /deve conter/);
  });

  it("aceita formatos próprios para CI", () => {
    assert.equal(parseCli(["https://example.com", "--format", "junit"]).options?.format, "junit");
    assert.equal(parseCli(["https://example.com", "--format", "sarif"]).options?.format, "sarif");
  });

  it("habilita anotações do GitHub Actions explicitamente", () => {
    const result = parseCli(["https://example.com", "--github-annotations"]);
    assert.equal(result.options?.githubAnnotations, true);
  });

  it("configura cobertura por sitemap com limite seguro", () => {
    const result = parseCli(["https://example.com", "--sitemap", "--max-pages", "35"]);
    assert.equal(result.options?.sitemap, true);
    assert.equal(result.options?.maxPages, 35);
    assert.throws(() => parseCli(["https://example.com", "--max-pages", "101"]), /no máximo 100/);
  });
});
