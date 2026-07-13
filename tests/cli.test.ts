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
});
