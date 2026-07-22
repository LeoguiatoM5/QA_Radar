import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser } from "playwright";
import { runJourney } from "../src/journey-runner.js";
import { runJourneyFile } from "../src/journey-cli.js";
import type { ScanOptions } from "../src/types.js";

describe("journey runner integration", () => {
  let origin = "";
  let browser: Browser;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html lang="pt-BR"><main><input id="email"><input id="password"><select id="role"><option value="qa">QA</option></select><button id="enter" onclick="document.querySelector(\'#result\').textContent=\'Bem-vindo QA\'">Entrar</button><p id="result"></p></main>');
  });

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("executa uma jornada declarativa com secret sem expor seu valor", async () => {
    const page = await browser.newPage();
    const evidenceDir = await mkdtemp(join(tmpdir(), "qa-radar-journey-"));
    try {
      const result = await runJourney(page, { schemaVersion: "1.0", name: "Login", steps: [
        { action: "goto", url: origin, description: "Abrir o formulário de login" },
        { action: "fill", selector: "#email", value: "qa@example.com" },
        { action: "fill", selector: "#password", valueFromEnv: "QA_RADAR_SECRET_PASSWORD" },
        { action: "select", selector: "#role", value: "qa" },
        { action: "click", selector: "#enter" },
        { action: "assertText", selector: "#result", text: "Bem-vindo QA" },
      ] }, {
        allowedOrigins: [origin],
        secrets: { QA_RADAR_SECRET_PASSWORD: "super-secret" },
        evidenceDir,
      });
      assert.equal(result.status, "passed");
      assert.equal(result.steps.length, 6);
      assert.equal(result.steps[0]?.description, "Abrir o formulário de login");
      assert.doesNotMatch(JSON.stringify(result), /super-secret/);
      assert.equal(result.steps.every((step) => Boolean(step.evidence)), true);
      await access(result.steps[2]?.evidence?.after ?? "missing");
      assert.equal(await page.locator("#password").evaluate((element) => (element as HTMLElement).style.filter), "");
      assert.equal(await page.locator("#password").evaluate((element) => "qaRadarOriginalFilter" in (element as HTMLElement).dataset), false);
    } finally {
      await page.close();
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it("interrompe no primeiro passo com falha e bloqueia outra origem", async () => {
    const page = await browser.newPage();
    try {
      const result = await runJourney(page, { schemaVersion: "1.0", name: "Bloqueio", steps: [
        { action: "goto", url: "https://example.com" },
        { action: "assertVisible", selector: "body" },
      ] }, { allowedOrigins: [origin] });
      assert.equal(result.status, "failed");
      assert.equal(result.steps.length, 1);
      assert.match(result.steps[0]?.error ?? "", /origem não autorizada/);
    } finally {
      await page.close();
    }
  });

  it("bloqueia redirecionamento antes de enviar requisição para outra origem", async () => {
    let destinationHits = 0;
    const destination = createServer((_request, response) => {
      destinationHits += 1;
      response.end("destino não autorizado");
    });
    await new Promise<void>((resolve) => destination.listen(0, "127.0.0.1", resolve));
    const destinationAddress = destination.address();
    assert.ok(destinationAddress && typeof destinationAddress === "object");
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${destinationAddress.port}/private` });
      response.end();
    });
    await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
    const redirectAddress = redirect.address();
    assert.ok(redirectAddress && typeof redirectAddress === "object");
    const allowedRedirectOrigin = `http://127.0.0.1:${redirectAddress.port}`;
    const page = await browser.newPage();
    try {
      const result = await runJourney(page, {
        schemaVersion: "1.0", name: "Redirect", steps: [{ action: "goto", url: allowedRedirectOrigin }],
      }, { allowedOrigins: [allowedRedirectOrigin] });
      assert.equal(result.status, "failed");
      assert.equal(destinationHits, 0);
    } finally {
      await page.close();
      await new Promise<void>((resolve) => redirect.close(() => resolve()));
      await new Promise<void>((resolve) => destination.close(() => resolve()));
    }
  });

  it("inspeciona o controle e exige confirmação antes de clique destrutivo", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<button id="primary">Excluir conta</button>');
      const result = await runJourney(page, {
        schemaVersion: "1.0", name: "Proteção", steps: [{ action: "click", selector: "#primary" }],
      }, { allowedOrigins: [origin] });
      assert.equal(result.status, "failed");
      assert.match(result.steps[0]?.error ?? "", /allowDestructive/);
    } finally {
      await page.close();
    }
  });

  it("remove valores secretos de mensagens de erro", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const result = await runJourney(page, {
        schemaVersion: "1.0", name: "Redação", steps: [{ action: "assertText", selector: "#super-secret", text: "x" }],
      }, { allowedOrigins: [origin], secrets: { QA_RADAR_SECRET_PASSWORD: "super-secret" }, timeoutMs: 100 });
      assert.equal(result.status, "failed");
      assert.doesNotMatch(JSON.stringify(result), /super-secret/);
      assert.match(result.steps[0]?.error ?? "", /\[SECRET\]/);
    } finally {
      await page.close();
    }
  });

  it("respeita cancelamento antes de executar o próximo passo", async () => {
    const page = await browser.newPage();
    const controller = new AbortController();
    controller.abort(new Error("cancelada pelo teste"));
    try {
      await assert.rejects(
        runJourney(page, { schemaVersion: "1.0", name: "Cancelamento", steps: [{ action: "goto", url: origin }] }, {
          allowedOrigins: [origin], signal: controller.signal,
        }),
        /cancelada pelo teste/,
      );
    } finally {
      await page.close();
    }
  });

  it("executa arquivo JSON pela camada CLI e grava relatório próprio", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-journey-cli-"));
    const journeyPath = join(outputDir, "journey.json");
    await writeFile(journeyPath, JSON.stringify({ schemaVersion: "1.0", name: "Smoke CLI", steps: [
      { action: "goto", url: origin },
      { action: "assertVisible", selector: "#enter" },
    ] }), "utf8");
    const options: ScanOptions = {
      url: origin,
      browser: "chromium",
      headed: false,
      timeoutMs: 10_000,
      settleMs: 0,
      outputDir,
      format: "json",
      screenshot: "never",
      failOn: "error",
      ignoredStatuses: new Set(),
      ignoredUrlPatterns: [],
      journeyPath,
    };
    try {
      const result = await runJourneyFile(options);
      assert.equal(result.report.status, "passed");
      assert.equal(JSON.parse(await readFile(result.reportPath, "utf8")).name, "Smoke CLI");
      await access(join(outputDir, "journey-evidence", "001-goto-before.png"));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
