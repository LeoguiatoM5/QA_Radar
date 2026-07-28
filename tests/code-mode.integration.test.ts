import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createQaRadarServer } from "../src/server.js";

describe("Modo Jornada de Playwright ponta a ponta (execução real, sem mocks)", () => {
  let targetOrigin = "";
  const target = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><html lang="pt-BR"><main><h1>Alvo</h1><button id="enter" onclick="document.querySelector(\'#result\').textContent=\'Bem-vindo\'">Entrar</button><p id="result"></p></main></html>',
    );
  });

  before(async () => {
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const address = target.address() as AddressInfo;
    targetOrigin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
  });

  it("grava código, executa de verdade, gera passos com evidência e produz o relatório HTML baixável", async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-code-mode-e2e-"));
    const server = createQaRadarServer({ allowCodeMode: true, resultsDir });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const code = [
      "import { test, expect } from '@playwright/test';",
      "test('login simples', async ({ page }) => {",
      `  await page.goto('${targetOrigin}');`,
      "  await page.getByRole('button', { name: 'Entrar' }).click();",
      "  await expect(page.locator('#result')).toHaveText('Bem-vindo');",
      "});",
    ].join("\n");

    try {
      const executionResponse = await fetch(`${baseUrl}/api/code-execution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, headed: false }),
      });
      const execution = (await executionResponse.json()) as {
        id: string;
        status: string;
        accessToken: string;
        report: { stats?: { expected?: number; unexpected?: number } };
      };
      assert.equal(executionResponse.status, 200, JSON.stringify(execution));
      assert.equal(execution.status, "passed");
      assert.equal(execution.report.stats?.expected, 1);
      assert.equal(execution.report.stats?.unexpected, 0);

      const authorization = { authorization: `Bearer ${execution.accessToken}` };

      const stepsResponse = await fetch(`${baseUrl}/api/code-executions/${execution.id}/steps`, { headers: authorization });
      assert.equal(stepsResponse.status, 200);
      const { steps } = (await stepsResponse.json()) as { steps: Array<{ action: string; description: string }> };
      assert.equal(steps.length, 3);
      assert.equal(steps[0]?.action, "goto");
      assert.match(steps[0]?.description ?? "", new RegExp(targetOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(steps[1]?.action, "click");
      assert.equal(steps[2]?.action, "assertText");

      const evidenceResponse = await fetch(`${baseUrl}/api/code-executions/${execution.id}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorization },
        body: JSON.stringify({ testerName: "QA Automatizado", testType: "smoke" }),
      });
      assert.equal(evidenceResponse.status, 201);
      const { url: evidencePath } = (await evidenceResponse.json()) as { url: string };

      const reportResponse = await fetch(`${baseUrl}${evidencePath}`, { headers: authorization });
      assert.equal(reportResponse.status, 200);
      assert.match(reportResponse.headers.get("content-type") ?? "", /text\/html/);
      const html = await reportResponse.text();
      assert.match(html, /QA Automatizado/);
      const embeddedScreenshots = html.match(/data:image\/png;base64,/g) ?? [];
      assert.ok(embeddedScreenshots.length >= 2, `esperava ao menos 2 screenshots embutidas, achou ${embeddedScreenshots.length}`);

      const reportWithoutToken = await fetch(`${baseUrl}${evidencePath}`);
      assert.equal(reportWithoutToken.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
