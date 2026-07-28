import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertHostedPlaywrightCode } from "../src/code-policy.js";

describe("política preventiva do código hospedado", () => {
  it("aceita testes que usam somente a API oficial do Playwright", () => {
    assert.doesNotThrow(() =>
      assertHostedPlaywrightCode(`
      import { test, expect } from "@playwright/test";
      // O texto "process.env" em uma descrição não executa a API process.
      test("login", async ({ page }) => {
        const description = "validar process.env apenas como texto";
        await page.goto("https://example.com");
        await expect(page.locator("h1")).toBeVisible();
        expect(description).toContain("process.env");
      });
    `),
    );
  });

  it("bloqueia leitura de arquivos e criação de processos", () => {
    assert.throws(() => assertHostedPlaywrightCode('import { readFile } from "node:fs/promises";'), /Importação não permitida.*node:fs/);
    assert.throws(() => assertHostedPlaywrightCode('import { spawn } from "node:child_process";'), /Importação não permitida.*node:child_process/);
  });

  it("bloqueia acesso a secrets e construção dinâmica de código", () => {
    assert.throws(() => assertHostedPlaywrightCode("const token = process.env.API_TOKEN;"), /API process não é permitida/);
    assert.throws(() => assertHostedPlaywrightCode('const fs = require("fs");'), /API require não é permitida/);
    assert.throws(() => assertHostedPlaywrightCode('new Function("return process")();'), /Construção dinâmica de funções/);
    assert.throws(() => assertHostedPlaywrightCode('await import("node:fs");'), /Importações dinâmicas/);
  });
});
