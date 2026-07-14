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

      const htmlLink = page.getByRole("link", { name: /Abrir relatório HTML/ });
      assert.match((await htmlLink.getAttribute("href")) ?? "", /^blob:/);
      const embeddedReport = page.frameLocator("#report-frame");
      assert.match(await embeddedReport.locator("body").innerText(), /Alvo Web/);
      assert.match(await embeddedReport.locator("body").innerText(), /503/);
      const evidenceImage = embeddedReport.getByRole("img", { name: /Screenshot anotado/ });
      await evidenceImage.waitFor();
      assert.equal(await evidenceImage.evaluate((image) => (image as HTMLImageElement).naturalWidth > 0), true);
      const [reportPage] = await Promise.all([page.waitForEvent("popup"), htmlLink.click()]);
      await reportPage.waitForLoadState();
      assert.match(await reportPage.locator("body").innerText(), /Alvo Web/);
      const popupEvidence = reportPage.getByRole("img", { name: /Screenshot anotado/ });
      await popupEvidence.waitFor();
      assert.equal(await popupEvidence.evaluate((image) => (image as HTMLImageElement).naturalWidth > 0), true);
      await reportPage.close();

      const jsonLink = page.getByRole("link", { name: /Baixar JSON/ });
      assert.match((await jsonLink.getAttribute("href")) ?? "", /^blob:/);
      assert.equal(await jsonLink.getAttribute("download"), "qa-radar-report.json");

      const screenshotLink = page.getByRole("link", { name: /Ver evidência anotada/ });
      assert.match((await screenshotLink.getAttribute("href")) ?? "", /^blob:/);
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
