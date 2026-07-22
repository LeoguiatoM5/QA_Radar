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
  it("cancela uma análise em execução e libera a concorrência", async () => {
    const target = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html lang="pt-BR"><title>Alvo lento</title><main>Conteúdo</main>');
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-cancel-"));
    const app = createQaRadarServer({ resultsDir, concurrency: 1, allowPrivateTargets: true });
    const targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#url").fill(targetUrl);
      await page.locator("summary").click();
      await page.locator("#settleMs").fill("30000");
      await page.locator("#submit").click();
      await page.locator("#cancel").waitFor();

      const queuedResponse = await page.request.post(`${appUrl}/api/scans`, {
        data: { url: targetUrl, settleMs: 0, screenshot: "never" },
      });
      const queued = await queuedResponse.json() as { id: string; status: string; queuePosition: number };
      assert.equal(queued.status, "queued");
      assert.equal(queued.queuePosition, 1);
      await page.locator("#cancel").click();
      await page.getByText("CANCELADA", { exact: true }).waitFor({ timeout: 15_000 });

      await assert.doesNotReject(async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const response = await page.request.get(`${appUrl}/api/scans/${queued.id}`);
          const job = await response.json() as { status: string; error?: string };
          if (job.status === "completed") return;
          if (job.status === "failed") throw new Error(job.error);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("A próxima análise não iniciou após o cancelamento.");
      });

      const health = await (await page.request.get(`${appUrl}/health`)).json() as {
        active: number;
        queued: number;
      };
      assert.equal(health.active, 0);
      assert.equal(health.queued, 0);
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("executa o scanner pelo dashboard e disponibiliza os artefatos", async () => {
    const target = createServer((request, response) => {
      if (request.url === "/broken") {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("indisponível");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<html lang="pt-BR"><title>Alvo Web</title><main><h1>Catálogo</h1><img src="/broken" alt="Imagem do produto"><button></button><input id="email"><div id="repetido"></div><span id="repetido"></span></main>');
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-"));
    const app = createQaRadarServer({
      resultsDir,
      concurrency: 1,
      allowPrivateTargets: true,
      allowCustomIgnorePatterns: true,
      allowHistory: true,
      historyDir: join(resultsDir, "history"),
    });
    const targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#url").fill(targetUrl);
      await page.locator("#project").fill("catalogo-web");
      await page.locator("#regressionsOnly").check();
      await page.locator("summary").click();
      await page.locator("#timeoutMs").fill("10000");
      await page.locator("#settleMs").fill("200");
      await page.locator("#screenshot").selectOption("always");
      await page.locator("#accessibility").check();
      await page.locator("#submit").click();
      await page.locator("#status.fail").waitFor({ timeout: 20_000 });

      assert.equal(await page.locator("#status").textContent(), "REPROVADO");
      assert.notEqual(await page.locator("#errors").textContent(), "0");
      assert.notEqual(await page.locator("#ttfb").textContent(), "N/A");
      assert.equal(await page.locator("#pages").textContent(), "1");
      assert.match((await page.locator("#comparison").textContent()) ?? "", /novo/);
      await page.locator("#history-panel").waitFor();
      assert.match((await page.locator("#history-count").textContent()) ?? "", /1 execução/);
      assert.match((await page.locator("#history-list").textContent()) ?? "", /catalogo-web|Execução completa/i);
      assert.match((await page.locator("#issues").textContent()) ?? "", /503/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /img\[src/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /Buttons must have discernible text/);
      assert.match((await page.locator("#issues").textContent()) ?? "", /Form elements must have labels/);
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

      assert.match((await page.getByRole("link", { name: "JUnit" }).getAttribute("href")) ?? "", /^blob:/);
      assert.match((await page.getByRole("link", { name: "SARIF" }).getAttribute("href")) ?? "", /^blob:/);

      const screenshotLink = page.getByRole("link", { name: /Ver evidência anotada/ });
      assert.match((await screenshotLink.getAttribute("href")) ?? "", /^blob:/);
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("executa cobertura por sitemap e abre relatórios individuais", async () => {
    let targetUrl = "";
    const target = createServer((request, response) => {
      if (request.url === "/sitemap.xml") {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(`<urlset><url><loc>${targetUrl}/catalogo</loc></url><url><loc>${targetUrl}/contato</loc></url></urlset>`);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html lang="pt-BR"><title>${request.url === "/catalogo" ? "Catálogo" : "Contato"}</title><main>Conteúdo saudável</main>`);
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-suite-"));
    const app = createQaRadarServer({ resultsDir, concurrency: 1, allowPrivateTargets: true, maxSitemapPages: 5 });
    targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#url").fill(targetUrl);
      await page.locator("#sitemap").check();
      await page.locator("#maxPages").fill("2");
      await page.locator("summary").click();
      await page.locator("#settleMs").fill("50");
      await page.locator("#submit").click();
      await page.locator("#status.pass").waitFor({ timeout: 30_000 });

      assert.equal(await page.locator("#pages").textContent(), "2");
      assert.notEqual(await page.locator("#ttfb").textContent(), "N/A");
      const embeddedReport = page.frameLocator("#report-frame");
      assert.match(await embeddedReport.locator("body").innerText(), /Cobertura do sitemap/);
      const href = await embeddedReport.getByRole("link", { name: "Catálogo" }).getAttribute("href");
      assert.match(href ?? "", /^\/api\/scans\/[0-9a-f-]+\/pages\//);
      const childResponse = await page.request.get(new URL(href ?? "", appUrl).toString());
      assert.equal(childResponse.status(), 200);
      assert.match(await childResponse.text(), /Catálogo/);
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("cancela uma jornada em execução pelo dashboard", async () => {
    const target = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html lang=pt-BR><main>Jornada longa</main>");
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-journey-cancel-"));
    const app = createQaRadarServer({ resultsDir, allowJourneys: true, allowPrivateTargets: true });
    const targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#journey-url").fill(targetUrl);
      await page.locator("#journey-json").fill(JSON.stringify({ schemaVersion: "1.0", name: "Cancelar", steps: [
        { action: "goto", url: targetUrl },
        { action: "waitFor", selector: "#nunca-existe", timeoutMs: 120000 },
      ] }));
      await page.locator("#journey-submit").click();
      await page.locator("#journey-cancel").waitFor();
      await page.locator("#journey-cancel").click();
      await page.getByText("A jornada foi cancelada.", { exact: true }).waitFor({ timeout: 20_000 });
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });

  it("executa jornada experimental pelo dashboard quando habilitada", async () => {
    const target = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html lang="pt-BR"><main><button id="go" onclick="document.querySelector(\'#done\').textContent=\'Concluído\'">Ir</button><p id="done"></p></main>');
    });
    const resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-web-journey-"));
    const app = createQaRadarServer({ resultsDir, allowJourneys: true, allowPrivateTargets: true, retentionMs: 1_000 });
    const targetUrl = await listen(target);
    const appUrl = await listen(app);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(appUrl);
      await page.locator("#journey-url").fill(targetUrl);
      await page.locator("#journey-json").fill(JSON.stringify({ schemaVersion: "1.0", name: "Jornada Web", steps: [
        { action: "goto", url: targetUrl },
        { action: "click", selector: "#go" },
        { action: "assertText", selector: "#done", text: "Concluído" },
      ] }));
      const creationPromise = page.waitForResponse((response) =>
        response.url() === `${appUrl}/api/journeys` && response.request().method() === "POST");
      await page.locator("#journey-submit").click();
      const creation = await creationPromise;
      const createdJourney = await creation.json() as { id: string; accessToken: string };
      await page.waitForTimeout(200);
      const journeyCookies = await page.context().cookies(`${appUrl}/api/journeys/status`);
      const journeyCookie = journeyCookies.find((cookie) => cookie.name === "qa_radar_access");
      assert.ok(journeyCookie, "Cookie HttpOnly da jornada ausente.");
      assert.ok(journeyCookie.value === createdJourney.accessToken, "Cookie da jornada não corresponde ao token criado.");
      try {
        await page.locator("#journey-status.pass").waitFor({ timeout: 20_000 });
      } catch (error) {
        const detail = await page.locator("#journey-error").textContent();
        throw new Error(`A jornada não apareceu como aprovada: ${detail || "sem detalhe na interface"}`, { cause: error });
      }
      assert.equal(await page.locator("#journey-status").textContent(), "APROVADA");
      assert.match((await page.locator("#journey-steps").textContent()) ?? "", /assertText/);
      const evidenceHref = await page.locator("#journey-steps a").first().getAttribute("href");
      assert.match(evidenceHref ?? "", /^\/api\/journeys\//);
      const evidenceUrl = new URL(evidenceHref ?? "", appUrl).toString();
      assert.equal((await fetch(evidenceUrl)).status, 401);
      const artifactHeaders = { authorization: `Bearer ${createdJourney.accessToken}` };
      assert.equal((await page.context().request.get(evidenceUrl, { headers: artifactHeaders })).status(), 200);
      const journeyBase = evidenceUrl.slice(0, evidenceUrl.lastIndexOf("/") + 1);
      assert.equal((await page.context().request.get(`${journeyBase}journey-report.json`, { headers: artifactHeaders })).status(), 200);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      assert.equal((await page.context().request.get(evidenceUrl, { headers: artifactHeaders })).status(), 404);
    } finally {
      await browser?.close();
      await close(app);
      await close(target);
      await rm(resultsDir, { recursive: true, force: true });
    }
  });
});
