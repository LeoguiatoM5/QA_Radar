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
 * A folga entre `SLOW_TARGET_MS` e `SLOW_THRESHOLD_MS` é grande de propósito: o
 * CI roda oito arquivos de Playwright ao mesmo tempo, e um limiar apertado
 * transforma disputa de CPU em falha de teste — foi exatamente o que aconteceu
 * com 120 ms de atraso contra um limite de 50 ms.
 */
const SLOW_TARGET_MS = 600;
const SLOW_THRESHOLD_MS = 250;

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
      }, SLOW_TARGET_MS);
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
    // a página carrega e nenhuma ferramenta funciona. E `'unsafe-inline'` saiu
    // junto com o último script embutido — voltar a embutir reabriria a brecha
    // em todas as telas do Toolbox de uma vez.
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'self';/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
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
    for (const name of [
      "catalog",
      "json-value",
      "json-diff",
      "boundary-values",
      "test-data",
      "jwt",
      "curl",
      "health",
      "pairwise",
      "regex-tester",
      "timestamp",
      "http-status",
      "json-schema",
      "yaml",
      "openapi-diff",
      "webhook",
    ]) {
      assert.equal((await fetch(`${appUrl}/assets/toolbox/${name}.js`)).status, 200, `módulo ausente: ${name}`);
    }
  });

  it("aplica os limites da caixa de webhook", async () => {
    const criada = await fetch(`${appUrl}/api/v1/toolbox/webhooks`, { method: "POST" });
    const bin = (await criada.json()) as { id: string; maxRequests: number; maxBodyBytes: number };
    assert.equal(criada.status, 201);

    // Corpo acima do teto é cortado, mas a chamada é aceita: um provedor de
    // webhook desativa a assinatura depois de algumas respostas de erro.
    const grande = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}`, { method: "POST", body: "x".repeat(bin.maxBodyBytes + 5000) });
    assert.equal(grande.status, 200);

    const lida = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}`);
    const conteudo = (await lida.json()) as { requests: Array<{ body: string; bodyTruncated: boolean; origin: string }> };
    assert.equal(conteudo.requests[0]?.bodyTruncated, true);
    assert.ok((conteudo.requests[0]?.body.length ?? 0) <= bin.maxBodyBytes);
    // A origem fica no prefixo da rede, não no endereço inteiro.
    assert.match(conteudo.requests[0]?.origin ?? "", /x\.x$|::$|desconhecida/);

    assert.equal((await fetch(`${appUrl}/api/v1/toolbox/webhooks/nao-existe`)).status, 404);
    assert.equal((await fetch(`${appUrl}/api/v1/toolbox/webhooks/nao-existe`, { method: "POST" })).status, 404);
  });

  it("captura DELETE como uma chamada normal e só limpa a caixa pela sub-rota /clear", async () => {
    const criada = await fetch(`${appUrl}/api/v1/toolbox/webhooks`, { method: "POST" });
    const bin = (await criada.json()) as { id: string };

    // DELETE na URL pública da caixa não é mais um comando escondido: é só
    // mais um verbo de webhook, como qualquer outro.
    const apagar = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}`, { method: "DELETE" });
    assert.equal(apagar.status, 200);
    assert.equal(((await apagar.json()) as { received?: boolean }).received, true);

    const lida = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}`);
    const conteudo = (await lida.json()) as { requests: Array<{ method: string }> };
    assert.equal(conteudo.requests.length, 1);
    assert.equal(conteudo.requests[0]?.method, "DELETE");

    // Limpar exige a sub-rota /clear, não a URL pública que o provedor externo recebe.
    const limpar = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}/clear`, { method: "POST" });
    assert.equal(limpar.status, 200);
    assert.deepEqual(await limpar.json(), { cleared: true });

    const depois = await fetch(`${appUrl}/api/v1/toolbox/webhooks/${bin.id}`);
    assert.equal(((await depois.json()) as { requests: unknown[] }).requests.length, 0);

    assert.equal((await fetch(`${appUrl}/api/v1/toolbox/webhooks/nao-existe/clear`, { method: "POST" })).status, 404);
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
        maxResponseTimeMs: SLOW_THRESHOLD_MS,
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

  it("gera as combinações de pares e mostra a redução", async () => {
    await page.goto(`${appUrl}/toolbox/pairwise`, { waitUntil: "networkidle" });
    await page.locator(".pairwise-name").nth(0).fill("navegador");
    await page.locator(".pairwise-values").nth(0).fill("chromium, firefox, webkit");
    await page.locator(".pairwise-name").nth(1).fill("perfil");
    await page.locator(".pairwise-values").nth(1).fill("admin, comum, visitante");
    await page.locator(".pairwise-name").nth(2).fill("idioma");
    await page.locator(".pairwise-values").nth(2).fill("pt-BR, en-US");
    await page.locator("#pairwise-run").click();
    await page.locator("#pairwise-result-panel").waitFor({ state: "visible" });

    const linhas = await page.locator("#pairwise-body tr").count();
    assert.ok(linhas >= 9 && linhas < 18, `esperava uma matriz reduzida, veio ${linhas}`);
    assert.match((await page.locator("#pairwise-summary").textContent()) ?? "", /18 combinações completas/);
    assert.match((await page.locator("#pairwise-head").textContent()) ?? "", /navegador/);

    await page.locator("#pairwise-clear").click();
    assert.equal(await page.locator("#pairwise-result-panel").isVisible(), false);
    assert.equal(await page.locator("#pairwise-body").textContent(), "");
  });

  it("testa uma expressão regular e mostra grupos e linhas atingidas", async () => {
    await page.goto(`${appUrl}/toolbox/regex-tester`, { waitUntil: "networkidle" });
    await page.locator("#regex-pattern").fill("(?<usuario>\\w+)@(?<dominio>[\\w.]+)");
    await page.locator("#regex-subject").fill("ana@exemplo.com\nsem email aqui\nbruno@teste.com.br");
    await page.locator("#regex-run").click();
    await page.locator("#regex-result-panel").waitFor({ state: "visible" });

    assert.match((await page.locator("#regex-summary").textContent()) ?? "", /2 CASAMENTO\(S\)/);
    assert.equal(await page.locator(".regex-line-row.matched").count(), 2);
    assert.match((await page.locator("#regex-matches").textContent()) ?? "", /usuario/);

    await page.locator("#regex-pattern").fill("(");
    await page.locator("#regex-run").click();
    await page.locator("#regex-error").waitFor({ state: "visible" });
    assert.match((await page.locator("#regex-error").textContent()) ?? "", /Expressão inválida/);
  });

  it("converte epoch dizendo em que unidade leu", async () => {
    await page.goto(`${appUrl}/toolbox/timestamp`, { waitUntil: "networkidle" });
    await page.locator("#timestamp-input").fill("1788274800");
    await page.locator("#timestamp-run").click();
    await page.locator("#timestamp-result-panel").waitFor({ state: "visible" });

    assert.match((await page.locator("#timestamp-summary").textContent()) ?? "", /EPOCH EM SEGUNDOS/);
    assert.match((await page.locator("#timestamp-facts").textContent()) ?? "", /2026-09-01T15:00:00\.000Z/);

    await page.locator("#timestamp-input").fill("2026-09-01T15:00:00");
    await page.locator("#timestamp-run").click();
    await page.locator("#timestamp-warnings").waitFor({ state: "visible" });
    assert.match((await page.locator("#timestamp-warnings").textContent()) ?? "", /não declara fuso/);
  });

  it("busca no explorador de status por código e por texto", async () => {
    await page.goto(`${appUrl}/toolbox/http-status`, { waitUntil: "networkidle" });
    const total = await page.locator(".status-item").count();
    assert.ok(total > 30);

    await page.locator("#status-search").fill("429");
    await page.locator(".status-item").first().waitFor();
    assert.equal(await page.locator(".status-item").count(), 1);
    assert.match((await page.locator(".status-item").textContent()) ?? "", /Too Many Requests/);

    await page.locator("#status-search").fill("");
    await page.locator('[data-status-class="5xx"]').click();
    const cincos = await page.locator(".status-item").allTextContents();
    assert.ok(cincos.length > 0);
    assert.ok(cincos.every((texto) => /^\s*5\d\d/.test(texto)));

    await page.locator("#status-search").fill("nao existe isso");
    await page.locator("#status-empty").waitFor({ state: "visible" });
  });

  it("valida um payload contra o schema apontando o campo que falhou", async () => {
    await page.goto(`${appUrl}/toolbox/json-schema`, { waitUntil: "networkidle" });
    await page.locator("#schema-input").fill(JSON.stringify({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" }, idade: { type: "integer" } } }));
    await page.locator("#schema-payload").fill(JSON.stringify({ idade: "31" }));
    await page.locator("#schema-run").click();
    await page.locator("#schema-result-panel").waitFor({ state: "visible" });

    const linhas = (await page.locator("#schema-violations").textContent()) ?? "";
    assert.match((await page.locator("#schema-summary").textContent()) ?? "", /2 VIOLAÇÃO/);
    assert.match(linhas, /\$\.email/);
    assert.match(linhas, /\$\.idade/);
    assert.match(linhas, /Esperado número inteiro, recebido texto/);

    await page.locator("#schema-payload").fill(JSON.stringify({ email: "ana@exemplo.com", idade: 31 }));
    await page.locator("#schema-run").click();
    assert.match((await page.locator("#schema-summary").textContent()) ?? "", /VÁLIDO/);
  });

  it("compara contratos OpenAPI em YAML e separa quebra de adição", async () => {
    const contrato = (versao: string, obrigatorio: string) =>
      [
        "openapi: 3.0.3",
        "info:",
        `  version: '${versao}'`,
        "paths:",
        "  /pedidos:",
        "    post:",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              type: object",
        "              required:",
        `                - ${obrigatorio}`,
        "              properties:",
        "                item:",
        "                  type: string",
        "                cupom:",
        "                  type: string",
        "      responses:",
        "        '201':",
        "          description: criado",
      ].join("\n");

    await page.goto(`${appUrl}/toolbox/openapi-diff`, { waitUntil: "networkidle" });
    await page.locator("#oas-left").fill(contrato("1.0.0", "item"));
    await page.locator("#oas-right").fill(contrato("1.1.0", "cupom"));
    await page.locator("#oas-run").click();
    await page.locator("#oas-result-panel").waitFor({ state: "visible" });

    assert.match((await page.locator("#oas-summary").textContent()) ?? "", /HÁ QUEBRA/);
    assert.match((await page.locator("#oas-summary").textContent()) ?? "", /1\.0\.0 → 1\.1\.0/);
    assert.match((await page.locator("#oas-changes").textContent()) ?? "", /cupom: passou a ser obrigatório na requisição/);

    await page.locator('[data-oas-filter="addition"]').click();
    await page.locator("#oas-empty").waitFor({ state: "visible" });

    await page.locator("#oas-left").fill("a: [1,");
    await page.locator('[data-oas-filter="todas"]').click();
    await page.locator("#oas-run").click();
    await page.locator("#oas-error").waitFor({ state: "visible" });
    assert.match((await page.locator("#oas-error").textContent()) ?? "", /Contrato atual:/);
  });

  it("abre uma caixa de webhook, recebe uma chamada e redige a credencial", async () => {
    await page.goto(`${appUrl}/toolbox/webhook-inspector`, { waitUntil: "networkidle" });
    await page.locator("#webhook-create").click();
    await page.locator("#webhook-bin").waitFor({ state: "visible" });

    const binUrl = await page.locator("#webhook-url").inputValue();
    assert.match(binUrl, /\/api\/v1\/toolbox\/webhooks\/[A-Za-z0-9_-]+$/);

    const entrega = await page.request.post(`${binUrl}/pedido?ref=42`, {
      headers: { authorization: "Bearer token-de-producao", "content-type": "application/json", "x-signature": "abc" },
      data: { evento: "pedido.pago", total: 149.9 },
    });
    assert.equal(entrega.status(), 200);

    // Esperar pelo caminho, e não por `.webhook-item` genérico: depois da
    // primeira chamada o seletor genérico já está satisfeito, e o `waitFor`
    // voltaria antes de o refresh trazer a chamada nova.
    const chamadaDe = (caminho: string) => page.locator(".webhook-item").filter({ hasText: caminho }).first();

    await page.locator("#webhook-refresh").click();
    await chamadaDe("/pedido").waitFor({ state: "visible" });

    const chamada = (await chamadaDe("/pedido").textContent()) ?? "";
    assert.match(chamada, /POST/);
    assert.match(chamada, /"evento": "pedido\.pago"/);
    assert.match(chamada, /redigido pelo QA Radar/);
    assert.match(chamada, /x-signature/, "cabeçalho comum continua visível");
    // O ponto central: a credencial não pode existir na página, nem escondida.
    assert.equal((await page.content()).includes("token-de-producao"), false);

    // E o endereço tampouco: o proxy escreve o IP real em cabeçalho próprio.
    const comEndereco = await page.request.post(`${binUrl}/proxy`, { headers: { "x-forwarded-for": "45.227.249.203, 172.68.11.132" }, data: {} });
    assert.equal(comEndereco.status(), 200);
    await page.locator("#webhook-refresh").click();
    await chamadaDe("/proxy").waitFor({ state: "visible" });

    const comProxy = (await chamadaDe("/proxy").textContent()) ?? "";
    assert.match(comProxy, /x-forwarded-for/, "o cabeçalho de endereço precisa ter chegado para o teste significar algo");
    assert.equal(comProxy.includes("45.227.249.203"), false, "o IP completo não pode aparecer");
    assert.match(comProxy, /45\.227\.x\.x, 172\.68\.x\.x/, "cada endereço da cadeia é reduzido ao prefixo da rede");

    await page.locator("#webhook-clear").click();
    await page.locator("#webhook-empty").waitFor({ state: "visible" });
  });

  it("favorita uma ferramenta e a mantém no topo entre visitas", async () => {
    await page.goto(`${appUrl}/toolbox`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#toolbox-favorites").isVisible(), false);

    await page.locator('[data-tool-favorite="jwt-inspector"]').first().click();
    await page.locator("#toolbox-favorites").waitFor({ state: "visible" });
    assert.equal(await page.locator('#toolbox-favorites-grid [data-tool-id="jwt-inspector"]').count(), 1);

    // A preferência é do navegador: precisa sobreviver a um recarregamento.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#toolbox-favorites").waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-tool-favorite="jwt-inspector"]').first().getAttribute("aria-pressed"), "true");

    // E o clone não pode inflar a contagem da busca.
    assert.match((await page.locator("#toolbox-search-count").textContent()) ?? "", new RegExp(`de ${QA_TOOLS.length} ferramentas`));

    await page.locator('#toolbox-favorites-grid [data-tool-favorite="jwt-inspector"]').click();
    assert.equal(await page.locator("#toolbox-favorites").isVisible(), false);
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
