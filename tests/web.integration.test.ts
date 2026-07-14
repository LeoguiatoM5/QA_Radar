import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { createQaRadarServer } from "../src/server.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("web scan integration", () => {
  it("executa o scanner pelo dashboard e disponibiliza os artefatos", async () => {
    const target = createServer((request, response) => {
      if (request.url === "/broken") {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("indisponível");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<title>Alvo Web</title><h1>Catálogo</h1><img src="/broken" alt="Imagem do produto"><button></button><input id="email"><div id="repetido"></div><span id="repetido"></span>');
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-"));
    const app = createQaRadarServer({
      resultsDir,
      concurrency: 1,
      allowPrivateTargets: true,
      allowCustomIgnorePatterns: true,
    });
    const targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#url").fill(targetUrl);
      await page.locator("summary").click();
      await page.locator("#timeoutMs").fill("10000");
      await page.locator("#settleMs").fill("200");
      await page.locator("#screenshot").selectOption("always");
      await page.locator("#submit").click();
      await page.locator("#status.fail").waitFor({ timeout: 20_000 });

      assert.equal(await page.locator("#status").textContent(), "REPROVADO");
      assert.notEqual(await page.locator("#errors").textContent(), "0");
      assert.match((await page.locator("#issues").textContent()) ?? "", /503/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /img\[src/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /Botão sem identificação/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /Campo sem identificação/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /Identificador duplicado/);

      const reportHref = await page.locator('#actions a[href$="report.html"]').getAttribute("href");
      if (!reportHref) throw new Error("Link do relatório HTML não encontrado.");
      const htmlResponse = await fetch(new URL(reportHref, appUrl));
      const html = await htmlResponse.text();
      assert.equal(htmlResponse.status, 200);
      assert.match(html, /Alvo Web/);
      assert.match(html, /503/);

      const jsonHref = await page.locator('#actions a[href$="report.json"]').getAttribute("href");
      if (!jsonHref) throw new Error("Link do relatório JSON não encontrado.");
      const jsonResponse = await fetch(new URL(jsonHref, appUrl));
      assert.equal(jsonResponse.status, 200);
      const report = (await jsonResponse.json()) as { issues: Array<{ evidence?: { element: string } }> };
      assert.ok(report.issues.some((issue) => issue.evidence?.element.includes("Imagem do produto")));

      const screenshotHref = await page.locator('#actions a[href$="screenshot.png"]').getAttribute("href");
      if (!screenshotHref) throw new Error("Link da evidência visual não encontrado.");
      const screenshotResponse = await fetch(new URL(screenshotHref, appUrl));
      assert.equal(screenshotResponse.status, 200);
      assert.equal(screenshotResponse.headers.get("content-type"), "image/png");
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
