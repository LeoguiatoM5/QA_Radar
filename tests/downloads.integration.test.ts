import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";
import { createQaRadarServer } from "../src/server.js";

const ENGINES: Array<{ name: string; browserType: BrowserType }> = [
  { name: "Chromium", browserType: chromium },
  { name: "Firefox", browserType: firefox },
  { name: "WebKit", browserType: webkit },
];

describe("downloads de relatório entre engines de navegador", () => {
  let targetOrigin = "";
  let appUrl = "";
  let resultsDir = "";
  const target = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html lang="pt-BR"><title>Alvo de download</title><main>Conteúdo</main></html>');
  });
  let app: ReturnType<typeof createQaRadarServer>;

  before(async () => {
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const targetAddress = target.address() as AddressInfo;
    targetOrigin = `http://127.0.0.1:${targetAddress.port}`;

    resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-downloads-"));
    app = createQaRadarServer({ resultsDir, allowPrivateTargets: true });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const appAddress = app.address() as AddressInfo;
    appUrl = `http://127.0.0.1:${appAddress.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
    await rm(resultsDir, { recursive: true, force: true });
  });

  for (const { name, browserType } of ENGINES) {
    it(`baixa JSON, JUnit e SARIF pelo botão do dashboard no ${name}`, async () => {
      let browser: Browser | undefined;
      const downloadsDir = await mkdtemp(join(tmpdir(), `qa-radar-downloads-${name.toLowerCase()}-`));
      try {
        browser = await browserType.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`${appUrl}/scanner`);
        await page.locator("#url").fill(targetOrigin);
        await page.locator("summary").click();
        await page.locator("#settleMs").fill("0");
        await page.locator("#submit").click();
        await page.getByText("APROVADO", { exact: false }).waitFor({ timeout: 30_000 });

        const expectations: Array<{ linkText: string; filename: string; verify: (content: Buffer) => void }> = [
          {
            linkText: "Baixar JSON",
            filename: "qa-radar-report.json",
            verify: (content) => {
              const parsed = JSON.parse(content.toString("utf8")) as { schemaVersion?: string; targetUrl?: string };
              assert.equal(parsed.schemaVersion, "1.0");
              assert.equal(parsed.targetUrl, `${targetOrigin}/`);
            },
          },
          {
            linkText: "JUnit",
            filename: "qa-radar-report.junit.xml",
            verify: (content) => {
              assert.match(content.toString("utf8"), /<testsuite/);
            },
          },
          {
            linkText: "SARIF",
            filename: "qa-radar-report.sarif.json",
            verify: (content) => {
              const parsed = JSON.parse(content.toString("utf8")) as { version?: string };
              assert.equal(parsed.version, "2.1.0");
            },
          },
        ];

        for (const expectation of expectations) {
          const link = page.getByRole("link", { name: expectation.linkText, exact: true });
          const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
          assert.equal(download.suggestedFilename(), expectation.filename);
          const savedPath = join(downloadsDir, expectation.filename);
          await download.saveAs(savedPath);
          const content = await readFile(savedPath);
          assert.ok(content.byteLength > 0, `${expectation.filename} veio vazio no ${name}`);
          expectation.verify(content);
        }

        await page.close();
      } finally {
        await browser?.close();
        await rm(downloadsDir, { recursive: true, force: true });
      }
    });
  }
});
