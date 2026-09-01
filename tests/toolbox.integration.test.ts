import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { createQaRadarServer } from "../src/server.js";
import { auditAccessibility } from "../src/scanner-accessibility.js";
import { AVAILABLE_TOOLS, QA_TOOLS } from "../src/toolbox/catalog.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

/**
 * Alvo controlado dos health checks.
 *
 * `/lento` responde depois de 120 ms para exercitar a degradação sem depender
 * do relógio da máquina de CI, que é o que tornaria o teste instável.
 */
function createTargetServer(): Server {
  return createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === "/ok") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (path === "/lento") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }, 120);
      return;
    }
    if (path === "/erro") {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("boom");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("nao encontrado");
  });
}

describe("toolbox integration · rotas", () => {
  let app: Server;
  let appUrl: string;
  let target: Server;
  let targetUrl: string;
  let resultsDir: string;

  before(async () => {
    resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-toolbox-"));
    // `allowPrivateTargets` só para poder medir um alvo local no teste; a
    // instalação pública mantém a política de rede ligada, como o teste de
    // SSRF abaixo confirma com um servidor sem essa permissão.
    app = createQaRadarServer({ resultsDir, allowPrivateTargets: true });
    target = createTargetServer();
    appUrl = await listen(app);
    targetUrl = await listen(target);
  });

  after(async () => {
    await close(app);
    await close(target);
    await rm(resultsDir, { recursive: true, force: true });
  });

  it("serve a página inicial do Toolbox com a política de conteúdo certa", async () => {
    const response = await fetch(`${appUrl}/toolbox`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    // Os módulos das ferramentas vêm da própria origem: sem `script-src 'self'`
    // a página carrega e nenhuma ferramenta funciona.
    assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self' 'unsafe-inline'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(html, /Daily tools for Software Quality/);
  });

  it("serve a página de cada ferramenta disponível", async () => {
    for (const tool of AVAILABLE_TOOLS) {
      const response = await fetch(`${appUrl}${tool.route}`);
      assert.equal(response.status, 200, `${tool.id} não respondeu 200`);
      assert.match(await response.text(), new RegExp(tool.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("responde 404 para ferramenta anunciada como em breve e para id inexistente", async () => {
    for (const tool of QA_TOOLS.filter((candidate) => candidate.status === "soon")) {
      assert.equal((await fetch(`${appUrl}${tool.route}`)).status, 404, `${tool.id} não deveria ter página`);
    }
    assert.equal((await fetch(`${appUrl}/toolbox/nao-existe`)).status, 404);
  });

  it("serve os módulos do catálogo como JavaScript e recusa qualquer outro arquivo", async () => {
    const module = await fetch(`${appUrl}/assets/toolbox/json-diff.js`);
    const code = await module.text();

    assert.equal(module.status, 200);
    assert.match(module.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(code, /export function diffJson/);
    // Nada de tipo no que chega ao navegador.
    assert.equal(code.includes(": JsonDiffResult"), false);

    for (const path of ["/assets/toolbox/server.js", "/assets/toolbox/../server.js", "/assets/toolbox/catalog.ts", "/assets/toolbox/nao-existe.js"]) {
      assert.equal((await fetch(`${appUrl}${path}`)).status, 404, `${path} não deveria ser servido`);
    }
  });

  it("serve todo o grafo de módulos que o navegador vai importar", async () => {
    for (const name of ["catalog", "json-value", "json-diff", "boundary-values", "test-data", "jwt", "curl", "health"]) {
      assert.equal((await fetch(`${appUrl}/assets/toolbox/${name}.js`)).status, 200, `módulo ausente: ${name}`);
    }
  });

  it("classifica 200, 404, 500 e resposta lenta", async () => {
    const response = await fetch(`${appUrl}/api/v1/toolbox/health-checks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checks: [
          { name: "Ok", url: `${targetUrl}/ok` },
          { name: "NaoEncontrado", url: `${targetUrl}/nao-existe` },
          { name: "Erro", url: `${targetUrl}/erro` },
          { name: "Lento", url: `${targetUrl}/lento` },
        ],
        expectedStatus: 200,
        maxResponseTimeMs: 50,
      }),
    });
    const body = (await response.json()) as { outcomes: Array<{ name: string; state: string; status?: number; contentType?: string }>; summary: { state: string; failed: number } };
    const byName = Object.fromEntries(body.outcomes.map((outcome) => [outcome.name, outcome]));

    assert.equal(response.status, 200);
    assert.equal(byName["Ok"]?.state, "healthy");
    assert.equal(byName["Ok"]?.contentType, "application/json");
    assert.equal(byName["NaoEncontrado"]?.state, "failed");
    assert.equal(byName["NaoEncontrado"]?.status, 404);
    assert.equal(byName["Erro"]?.state, "failed");
    assert.equal(byName["Erro"]?.status, 500);
    assert.equal(byName["Lento"]?.state, "degraded");
    assert.equal(body.summary.state, "failed");
    assert.equal(body.summary.failed, 2);
  });

  it("reporta erro de conexão como falha do endpoint, não como erro da requisição", async () => {
    // Uma porta fechada não pode derrubar a verificação inteira: os outros
    // serviços do ambiente ainda precisam ser reportados.
    const response = await fetch(`${appUrl}/api/v1/toolbox/health-checks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checks: [
          { name: "Fora", url: "http://127.0.0.1:1/health" },
          { name: "Ok", url: `${targetUrl}/ok` },
        ],
      }),
    });
    const body = (await response.json()) as { outcomes: Array<{ name: string; state: string; reason?: string }> };

    assert.equal(response.status, 200);
    assert.equal(body.outcomes[0]?.state, "failed");
    assert.ok(body.outcomes[0]?.reason);
    assert.equal(body.outcomes[1]?.state, "healthy");
  });

  it("recusa entradas inválidas antes de sair para a rede", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ checks: [] }, /ao menos um endpoint/],
      [{ checks: Array.from({ length: 11 }, () => ({ url: "https://example.com" })) }, /No máximo 10/],
      [{ checks: [{ url: "" }] }, /Informe a URL/],
      [{ checks: [{ url: "https://example.com", method: "POST" }] }, /apenas GET ou HEAD/],
    ];

    for (const [body, expected] of cases) {
      const response = await fetch(`${appUrl}/api/v1/toolbox/health-checks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { error: string; code: string };
      assert.equal(response.status, 400, JSON.stringify(payload));
      assert.match(payload.error, expected);
    }
  });

  it("bloqueia endereços privados quando a política de rede está ligada", async () => {
    const guarded = createQaRadarServer({ resultsDir });
    const guardedUrl = await listen(guarded);
    try {
      const response = await fetch(`${guardedUrl}/api/v1/toolbox/health-checks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checks: [
            { name: "Interno", url: "http://169.254.169.254/latest/meta-data/" },
            { name: "Local", url: "http://localhost:8080/health" },
          ],
        }),
      });
      const body = (await response.json()) as { outcomes: Array<{ state: string; reason?: string }> };

      assert.equal(response.status, 200);
      for (const outcome of body.outcomes) {
        assert.equal(outcome.state, "failed");
        assert.match(outcome.reason ?? "", /locais ou privados/);
      }
    } finally {
      await close(guarded);
    }
  });

  it("exige conta quando a instalação exige conta", async () => {
    const restricted = createQaRadarServer({ resultsDir, requireAccount: true, allowPrivateTargets: true });
    const restrictedUrl = await listen(restricted);
    try {
      const response = await fetch(`${restrictedUrl}/api/v1/toolbox/health-checks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checks: [{ url: `${targetUrl}/ok` }] }),
      });

      assert.equal(response.status, 401);
      // Navegar continua livre: só executar exige entrar.
      assert.equal((await fetch(`${restrictedUrl}/toolbox`)).status, 200);
    } finally {
      await close(restricted);
    }
  });
});

describe("toolbox integration · navegador", () => {
  let app: Server;
  let appUrl: string;
  let target: Server;
  let targetUrl: string;
  let resultsDir: string;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];

  before(async () => {
    resultsDir = await mkdtemp(join(tmpdir(), "qa-radar-toolbox-e2e-"));
    app = createQaRadarServer({ resultsDir, allowPrivateTargets: true });
    target = createTargetServer();
    appUrl = await listen(app);
    targetUrl = await listen(target);
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Um módulo que não carrega ou uma violação de CSP aparecem aqui antes de
    // aparecerem como "o botão não faz nada".
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
  });

  after(async () => {
    await browser.close();
    await close(app);
    await close(target);
    await rm(resultsDir, { recursive: true, force: true });
  });

  it("filtra o catálogo pela busca", async () => {
    await page.goto(`${appUrl}/toolbox`, { waitUntil: "networkidle" });

    assert.equal(await page.locator("[data-tool-card]:visible").count(), QA_TOOLS.length);
    await page.locator("#toolbox-search-input").fill("token");
    await page.locator('[data-tool-id="jwt-inspector"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-tool-id="json-diff"]').isVisible(), false);
    assert.match((await page.locator("#toolbox-search-count").textContent()) ?? "", /de \d+ ferramentas/);

    await page.locator("#toolbox-search-input").fill("nada disso existe");
    await page.locator("#toolbox-empty").waitFor({ state: "visible" });

    await page.locator("#toolbox-search-input").fill("");
    await page.locator('[data-tool-id="json-diff"]').waitFor({ state: "visible" });
  });

  it("compara dois JSON no navegador, sem enviar nada ao servidor", async () => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    await page.goto(`${appUrl}/toolbox/json-diff`, { waitUntil: "networkidle" });

    await page.locator("#diff-left").fill('{"limit":5000,"nome":"Ana","extra":true}');
    await page.locator("#diff-right").fill('{"limit":3000,"nome":"Ana","novo":1}');
    await page.locator("#diff-run").click();
    await page.locator("#diff-result-panel").waitFor({ state: "visible" });

    const entries = await page.locator(".diff-entry").allTextContents();
    assert.equal(entries.length, 3);
    assert.ok(entries.some((entry) => entry.includes("$.limit") && entry.includes("3000")));
    assert.ok(entries.some((entry) => entry.includes("REMOVED") && entry.includes("$.extra")));
    assert.ok(entries.some((entry) => entry.includes("ADDED") && entry.includes("$.novo")));
    assert.deepEqual(requests, [], "a comparação de JSON não pode sair do navegador");

    await page.locator("#diff-clear").click();
    assert.equal(await page.locator("#diff-result-panel").isVisible(), false);
  });

  it("apaga do DOM o que foi comparado quando o usuário limpa", async () => {
    // Regressão: o painel era apenas escondido, e o payload comparado continuava
    // no HTML — visível no inspetor e em qualquer captura de tela, numa
    // ferramenta que promete não mandar nada para fora.
    await page.goto(`${appUrl}/toolbox/json-diff`, { waitUntil: "networkidle" });
    await page.locator("#diff-left").fill('{"cartao":"4111111111111111"}');
    await page.locator("#diff-right").fill('{"cartao":"5555444433332222"}');
    await page.locator("#diff-run").click();
    await page.locator("#diff-result-panel").waitFor({ state: "visible" });
    assert.ok((await page.content()).includes("4111111111111111"));

    await page.locator("#diff-clear").click();
    const html = await page.content();
    assert.equal(html.includes("4111111111111111"), false, "o valor comparado continuou no DOM");
    assert.equal(html.includes("5555444433332222"), false, "o valor comparado continuou no DOM");
  });

  it("mostra erro legível quando o JSON é inválido", async () => {
    await page.goto(`${appUrl}/toolbox/json-diff`, { waitUntil: "networkidle" });
    await page.locator("#diff-left").fill("{ nao json");
    await page.locator("#diff-right").fill("{}");
    await page.locator("#diff-run").click();

    await page.locator("#diff-error").waitFor({ state: "visible" });
    assert.match((await page.locator("#diff-error").textContent()) ?? "", /Original: JSON inválido/);
    assert.equal(await page.locator("#diff-result-panel").isVisible(), false);
  });

  it("gera os casos de fronteira", async () => {
    await page.goto(`${appUrl}/toolbox/boundary-values`, { waitUntil: "networkidle" });
    await page.locator("#boundary-run").click();
    await page.locator("#boundary-result-panel").waitFor({ state: "visible" });

    const rows = await page.locator("#boundary-rows tr").allTextContents();
    assert.equal(rows.length, 6);
    assert.ok(rows[0]?.includes("17") && rows[0]?.includes("INVALID"));
    assert.ok(rows[1]?.includes("18") && rows[1]?.includes("VALID"));

    await page.locator("#boundary-type").selectOption("string-length");
    await page.locator("#boundary-run").click();
    assert.match((await page.locator("#boundary-rows").textContent()) ?? "", /caractere\(s\)/);
  });

  it("gera massa de teste e alterna entre JSON, CSV e SQL", async () => {
    await page.goto(`${appUrl}/toolbox/test-data`, { waitUntil: "networkidle" });
    await page.locator('[data-field-type="cpf"]').check();
    await page.locator('[data-field-type="email"]').check();
    await page.locator("#data-count").fill("3");
    await page.locator("#data-generate").click();
    await page.locator("#data-result-panel").waitFor({ state: "visible" });

    const json = (await page.locator("#data-output").textContent()) ?? "";
    assert.equal((JSON.parse(json) as unknown[]).length, 3);
    assert.match(json, /"cpf": "\d{11}"/);

    await page.locator('[data-data-format="csv"]').click();
    assert.match((await page.locator("#data-output").textContent()) ?? "", /^cpf,email/);
    await page.locator('[data-data-format="sql"]').click();
    assert.match((await page.locator("#data-output").textContent()) ?? "", /^INSERT INTO test_data \(cpf, email\)/);
  });

  it("apaga a massa gerada ao limpar", async () => {
    await page.goto(`${appUrl}/toolbox/test-data`, { waitUntil: "networkidle" });
    await page.locator('[data-field-type="cpf"]').check();
    await page.locator("#data-generate").click();
    await page.locator("#data-result-panel").waitFor({ state: "visible" });

    await page.locator("#data-clear").click();
    assert.equal(await page.locator("#data-output").textContent(), "");
    assert.equal(await page.locator('[data-field-type="cpf"]').isChecked(), false);
  });

  it("avisa quando nenhum campo foi escolhido", async () => {
    await page.goto(`${appUrl}/toolbox/test-data`, { waitUntil: "networkidle" });
    await page.locator("#data-generate").click();

    await page.locator("#data-error").waitFor({ state: "visible" });
    assert.match((await page.locator("#data-error").textContent()) ?? "", /ao menos um campo/);
  });

  it("decodifica um JWT expirado sem afirmar que a assinatura confere", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "1234", exp: Math.floor(Date.now() / 1000) - 3600 })).toString("base64url");

    await page.goto(`${appUrl}/toolbox/jwt-inspector`, { waitUntil: "networkidle" });
    await page.locator("#jwt-input").fill(`${header}.${payload}.assinatura`);
    await page.locator("#jwt-decode").click();
    await page.locator("#jwt-result-panel").waitFor({ state: "visible" });

    assert.equal(await page.locator("#jwt-status").textContent(), "EXPIRED");
    assert.equal(await page.locator("#jwt-signature").textContent(), "Assinatura não verificada");
    assert.match((await page.locator("#jwt-payload").textContent()) ?? "", /"sub": "1234"/);

    // Limpar tem de apagar o token de verdade.
    await page.locator("#jwt-clear").click();
    assert.equal(await page.locator("#jwt-input").inputValue(), "");
    assert.equal(await page.locator("#jwt-result-panel").isVisible(), false);
  });

  it("mostra na tela o desvio do RFC quando o emissor manda exp como texto", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "1", exp: String(Math.floor(Date.now() / 1000) - 60) })).toString("base64url");

    await page.goto(`${appUrl}/toolbox/jwt-inspector`, { waitUntil: "networkidle" });
    await page.locator("#jwt-input").fill(`${header}.${payload}.assinatura`);
    await page.locator("#jwt-decode").click();
    await page.locator("#jwt-warnings").waitFor({ state: "visible" });

    assert.equal(await page.locator("#jwt-status").textContent(), "EXPIRED");
    assert.match((await page.locator("#jwt-warnings").textContent()) ?? "", /exp veio como texto/);
  });

  it("recusa um JWT malformado", async () => {
    await page.goto(`${appUrl}/toolbox/jwt-inspector`, { waitUntil: "networkidle" });
    await page.locator("#jwt-input").fill("isto.nao");
    await page.locator("#jwt-decode").click();

    await page.locator("#jwt-error").waitFor({ state: "visible" });
    assert.match((await page.locator("#jwt-error").textContent()) ?? "", /três partes/);
  });

  it("converte um cURL mascarando o token na tela e no código", async () => {
    await page.goto(`${appUrl}/toolbox/curl-converter`, { waitUntil: "networkidle" });
    await page.locator("#curl-input").fill("curl 'https://api.example.com/users?page=2' -H 'Authorization: Bearer token-super-secreto' -H 'Accept: application/json'");
    await page.locator("#curl-convert").click();
    await page.locator("#curl-result-panel").waitFor({ state: "visible" });

    const facts = (await page.locator("#curl-facts").textContent()) ?? "";
    assert.equal(facts.includes("token-super-secreto"), false, "o token não pode aparecer na tela inteiro");
    assert.match(facts, /Header · Authorization/);

    const playwrightCode = (await page.locator("#curl-output").textContent()) ?? "";
    assert.match(playwrightCode, /@playwright\/test/);
    assert.equal(playwrightCode.includes("token-super-secreto"), false);
    assert.match(playwrightCode, /process\.env\.API_TOKEN/);

    await page.locator('[data-curl-target="cypress"]').click();
    assert.match((await page.locator("#curl-output").textContent()) ?? "", /cy\.request/);
    await page.locator('[data-curl-target="python"]').click();
    assert.match((await page.locator("#curl-output").textContent()) ?? "", /import requests/);
  });

  it("verifica endpoints e monta o relatório do ambiente", async () => {
    await page.goto(`${appUrl}/toolbox/api-health`, { waitUntil: "networkidle" });
    await page.locator(".health-url").first().fill(`${targetUrl}/ok`);
    await page.locator(".health-name").first().fill("Users");
    await page.locator("#health-add").click();
    await page.locator(".health-url").nth(1).fill(`${targetUrl}/erro`);
    await page.locator(".health-name").nth(1).fill("Orders");
    await page.locator("#health-run").click();
    await page.locator("#health-result-panel").waitFor({ state: "visible" });

    const summary = (await page.locator("#health-summary").textContent()) ?? "";
    assert.match(summary, /Environment Status: FAILED/);
    assert.match(summary, /1 healthy/);
    const rows = (await page.locator("#health-rows-result").textContent()) ?? "";
    assert.match(rows, /Users/);
    assert.match(rows, /HEALTHY/);
    assert.match(rows, /FAILED/);
  });

  it("não deixa nenhum erro de console nem violação de CSP nas ferramentas", async () => {
    assert.deepEqual(consoleErrors, []);
  });

  it("passa na auditoria de acessibilidade do axe-core", async () => {
    for (const path of ["/toolbox", "/toolbox/json-diff", "/toolbox/test-data", "/toolbox/api-health"]) {
      await page.goto(`${appUrl}${path}`, { waitUntil: "networkidle" });
      const issues = await auditAccessibility(page, `${appUrl}${path}`);
      const blocking = issues.filter((issue) => issue.severity === "error");
      assert.deepEqual(
        blocking.map((issue) => `${issue.ruleId}: ${issue.evidence?.selector ?? ""}`),
        [],
        `${path} tem violação de acessibilidade`,
      );
    }
  });

  it("cabe na tela do celular sem rolagem horizontal", async () => {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      for (const path of ["/toolbox", ...AVAILABLE_TOOLS.map((tool) => tool.route)]) {
        await mobile.goto(`${appUrl}${path}`, { waitUntil: "domcontentloaded" });
        const layout = await mobile.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          h1Count: document.querySelectorAll("h1").length,
        }));
        assert.equal(layout.scrollWidth, layout.innerWidth, `${path}: possui overflow horizontal`);
        assert.equal(layout.h1Count, 1, `${path}: deve conter um único h1`);
      }
    } finally {
      await mobile.close();
    }
  });
});
