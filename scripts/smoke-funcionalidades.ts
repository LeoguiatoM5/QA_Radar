import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

/**
 * Smoke das três funcionalidades pela UI real: Inspeção, Jornada e Testes de API.
 *
 * Diferente da suíte unitária, este script sobe nada — ele dirige um QA Radar já
 * em execução contra um alvo público, e ao final confere como o painel reagiu
 * (radar, Execuções recentes e Sinal ao vivo).
 *
 * Uso:
 *   QA_RADAR_ENABLE_HISTORY=true npm run web        # em um terminal
 *   npm run smoke                                    # em outro
 *
 * Ao final grava capturas do painel já povoado em qa-radar-results/smoke.
 *
 * Variáveis:
 *   SMOKE_BASE_URL   endereço do QA Radar (padrão http://localhost:4173)
 *   SMOKE_TARGET     aplicação alvo (padrão https://www.saucedemo.com)
 *   SMOKE_HEADED     "true" para acompanhar no navegador
 *   SMOKE_SHOTS_DIR  destino das capturas (padrão qa-radar-results/smoke)
 */

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:4173";
const target = (process.env.SMOKE_TARGET ?? "https://www.saucedemo.com").replace(/\/$/, "");
const headed = process.env.SMOKE_HEADED === "true";
const diretorioCapturas = resolve(process.env.SMOKE_SHOTS_DIR ?? "qa-radar-results/smoke");

const falhas: string[] = [];
const registrar = (grupo: string, caso: string, ok: boolean, detalhe: string) => {
  console.log(`  ${ok ? "ok   " : "FALHA"} ${caso} — ${detalhe}`);
  if (!ok) falhas.push(`${grupo} / ${caso}: ${detalhe}`);
};

const resposta = await fetch(base).catch(() => undefined);
if (!resposta?.ok) {
  console.error(`QA Radar não respondeu em ${base}. Suba o servidor com "npm run web" antes de rodar o smoke.`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: !headed });
const page: Page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.setDefaultTimeout(240_000);

// ---------------------------------------------------------------- Inspeção
console.log("\n[Inspeção]");
const paginas = [
  { caminho: "/", acessibilidade: true },
  { caminho: "/inventory.html", acessibilidade: false },
  { caminho: "/rota-que-nao-existe", acessibilidade: false },
];

for (const { caminho, acessibilidade } of paginas) {
  await page.goto(`${base}/scanner`, { waitUntil: "domcontentloaded" });
  await page.fill("#url", `${target}${caminho}`);
  if (await page.isEnabled("#project")) {
    await page.fill("#project", "smoke");
    await page.fill("#environment", "staging");
  }
  if (acessibilidade) await page.check("#accessibility");
  await page.click("#submit");
  try {
    await page.waitForFunction(() => {
      const status = document.querySelector("#status");
      return Boolean(status) && !status!.className.includes("running");
    });
    const [status, erros, avisos] = await Promise.all([page.textContent("#status"), page.textContent("#errors"), page.textContent("#warnings")]);
    const concluiu = /APROVADO|REPROVADO/.test(status ?? "");
    registrar("inspeção", caminho, concluiu, `${status?.trim()} · ${erros} erro(s) / ${avisos} aviso(s)`);
  } catch (error) {
    registrar("inspeção", caminho, false, String(error).slice(0, 140));
  }
}

// ------------------------------------------------------------ Testes de API
console.log("\n[Testes de API]");
const requisicoes: Array<[string, string, number]> = [
  ["GET", `${target}/`, 200],
  ["GET", `${target}/rota-que-nao-existe`, 404],
  ["POST", `${target}/`, 405],
];

await page.goto(`${base}/api-tests`, { waitUntil: "domcontentloaded" });
for (const [metodo, url, esperado] of requisicoes) {
  await page.selectOption("#http-method", metodo);
  await page.fill("#http-url", url);
  await page.click("#http-send");
  try {
    // O painel de resposta pode já estar visível da requisição anterior; o ciclo
    // do botão Enviar é o sinal confiável de que esta resposta chegou.
    await page.waitForSelector(".http-send.cancel-active", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForSelector(".http-send:not(.cancel-active)");
    await page.waitForTimeout(150);
    const status = (await page.textContent("#http-response-status"))?.trim() ?? "";
    const duracao = (await page.textContent("#http-response-duration"))?.trim() ?? "";
    registrar("api", `${metodo} ${url.replace(target, "") || "/"}`, status.startsWith(String(esperado)), `esperado ${esperado}, recebido "${status}" (${duracao})`);
  } catch (error) {
    registrar("api", `${metodo} ${url}`, false, String(error).slice(0, 140));
  }
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- Jornada
console.log("\n[Jornada]");
// Credenciais de demonstração publicadas na própria home do Swag Labs.
const jornadas: Array<[string, string, boolean]> = [
  [
    "login do usuário padrão",
    `import { test, expect } from '@playwright/test';

test('login do usuário padrão', async ({ page }) => {
  await page.goto('${target}/');
  await page.fill('#user-name', 'standard_user');
  await page.fill('#password', 'secret_sauce');
  await page.click('#login-button');
  await expect(page.locator('.title')).toHaveText('Products');
});
`,
    true,
  ],
  [
    "compra completa",
    `import { test, expect } from '@playwright/test';

test('compra completa', async ({ page }) => {
  await page.goto('${target}/');
  await page.fill('#user-name', 'standard_user');
  await page.fill('#password', 'secret_sauce');
  await page.click('#login-button');
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('.shopping_cart_link');
  await page.click('[data-test="checkout"]');
  await page.fill('[data-test="firstName"]', 'QA');
  await page.fill('[data-test="lastName"]', 'Radar');
  await page.fill('[data-test="postalCode"]', '01310000');
  await page.click('[data-test="continue"]');
  await page.click('[data-test="finish"]');
  await expect(page.locator('.complete-header')).toContainText('Thank you for your order');
});
`,
    true,
  ],
  [
    "falha proposital",
    `import { test, expect } from '@playwright/test';

test('falha proposital', async ({ page }) => {
  await page.goto('${target}/');
  await expect(page).toHaveTitle(/Titulo Que Nao Existe/);
});
`,
    false,
  ],
];

for (const [nome, codigo, deveAprovar] of jornadas) {
  await page.goto(`${base}/journeys`, { waitUntil: "domcontentloaded" });
  if (!(await page.$("#playwright-code"))) {
    registrar("jornada", nome, false, "execução de código desabilitada neste servidor");
    break;
  }
  await page.fill("#playwright-code", codigo);
  await page.click("#code-execute");
  try {
    await page.waitForSelector("#code-result:not([hidden])");
    await page.waitForFunction(() => !/executando|aguard/i.test(document.querySelector("#code-result")?.textContent ?? "executando"));
    const texto = ((await page.textContent("#code-result")) ?? "").replace(/\s+/g, " ").trim();
    const aprovou = texto.startsWith("✓");
    registrar("jornada", nome, aprovou === deveAprovar, `${aprovou ? "aprovada" : "reprovada"} (esperado ${deveAprovar ? "aprovada" : "reprovada"})`);
  } catch (error) {
    registrar("jornada", nome, false, String(error).slice(0, 140));
  }
}

// ---------------------------------------------------------------- Dashboard
console.log("\n[Dashboard]");
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

interface EstadoDoPainel {
  execucoes: number;
  sinais: number;
  indice: string;
  rotulo: string;
  verticesForaDaGrade: number;
  transbordos: number;
  cortados: number;
  scrollHorizontal: boolean;
}

// Avaliado como string: o tsx injeta chamadas a __name nas funções que compila,
// e esse helper não existe dentro da página.
const painel = (await page.evaluate(`(() => {
  const svg = document.querySelector('.radar-svg');
  const centro = Number(svg && svg.dataset.radarCenter);
  const raioMaximo = Number(svg && svg.dataset.radarRadius);
  const area = svg && svg.querySelector('.radar-area');
  const vertices = ((area && area.getAttribute('points')) || '')
    .split(' ')
    .filter(Boolean)
    .map(function (par) {
      const partes = par.split(',').map(Number);
      return Math.hypot(partes[0] - centro, partes[1] - centro);
    });

  // Transbordo é sair da moldura em qualquer direção: a borda do painel cortando o
  // primeiro sinal era invisível para uma checagem só horizontal.
  function escapa(elemento, container) {
    if (!container) return false;
    const a = elemento.getBoundingClientRect();
    const b = container.getBoundingClientRect();
    return a.right > b.right + 1 || a.left < b.left - 1 || a.bottom > b.bottom + 1 || a.top < b.top - 1;
  }

  // Texto cortado pela própria caixa (reticências ou linha escondida).
  function corta(elemento) {
    const altura = elemento.getBoundingClientRect().height;
    return elemento.scrollWidth > elemento.clientWidth + 1 || elemento.scrollHeight > Math.ceil(altura) + 1;
  }

  const indice = document.querySelector('#dashboard-quality-index');
  const rotulo = document.querySelector('#dashboard-quality-label');
  return {
    execucoes: document.querySelectorAll('.dashboard-run').length,
    sinais: document.querySelectorAll('.signal-event').length,
    indice: (indice && indice.textContent) || '',
    rotulo: (rotulo && rotulo.textContent) || '',
    verticesForaDaGrade: vertices.filter(function (raio) {
      return !Number.isFinite(raio) || raio > raioMaximo + 0.5;
    }).length,
    transbordos: Array.prototype.slice
      .call(document.querySelectorAll('.signal-event time, .signal-event span b, .signal-event span strong, .signal-event span small, .run-title strong'))
      .filter(function (el) {
        return escapa(el, el.closest('.live-signal') || el.closest('.recent-runs'));
      }).length,
    cortados: Array.prototype.slice
      .call(document.querySelectorAll('.signal-event span strong, .signal-event span small'))
      .filter(corta).length,
    scrollHorizontal: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1,
  };
})()`)) as EstadoDoPainel;

registrar("dashboard", "histórico registrou execuções", painel.execucoes > 0, `${painel.execucoes} linha(s) visível(is)`);
registrar("dashboard", "sinal ao vivo registrou eventos", painel.sinais > 0, `${painel.sinais} sinal(is)`);
registrar("dashboard", "radar calculou o índice", /^\d+$/.test(painel.indice), `${painel.indice}/100 · ${painel.rotulo}`);
registrar("dashboard", "radar dentro da grade", painel.verticesForaDaGrade === 0, `${painel.verticesForaDaGrade} vértice(s) fora`);
registrar("dashboard", "nenhum texto transbordando", painel.transbordos === 0, `${painel.transbordos} elemento(s)`);
registrar("dashboard", "nenhum texto cortado no sinal ao vivo", painel.cortados === 0, `${painel.cortados} elemento(s)`);
registrar("dashboard", "sem scroll horizontal", !painel.scrollHorizontal, `scroll=${painel.scrollHorizontal}`);

// ------------------------------------------------------------- Navegação
console.log("\n[Navegação]");
for (const area of ["relatorios", "central-de-qualidade", "alertas", "ambientes", "configuracoes"]) {
  const destino = await page.getAttribute(`.nav-link-supporting[href*="area=${area}"]`, "href").catch(() => undefined);
  registrar("navegação", `${area} avisa que está em construção`, destino === `/em-construcao?area=${area}`, String(destino));
}
await page.goto(`${base}/em-construcao?area=alertas`, { waitUntil: "domcontentloaded" });
const tituloConstrucao = (await page.textContent("h1"))?.trim();
registrar("navegação", "página de construção responde", tituloConstrucao === "Em construção", String(tituloConstrucao));

// O ambiente escolhido na barra de contexto tem que sobreviver à navegação.
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.selectOption("#context-environment", "producao");
await page.goto(`${base}/scanner`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const ambienteAtual = (await page.textContent("#context-environment-label"))?.trim();
const ambienteNoFormulario = await page.inputValue("#environment").catch(() => "");
registrar("navegação", "ambiente escolhido persiste entre páginas", ambienteAtual === "Produção", String(ambienteAtual));
registrar("navegação", "ambiente chega ao formulário da Inspeção", ambienteNoFormulario === "producao", String(ambienteNoFormulario));
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.selectOption("#context-environment", "local");
await page.waitForTimeout(300);

// ---------------------------------------------------------------- Capturas
// O painel só fica interessante depois que há execuções: as capturas saem no
// fim para mostrar o layout já povoado, em desktop e em telas menores.
await mkdir(diretorioCapturas, { recursive: true });
const capturas: string[] = [];
const capturar = async (nome: string, largura: number, paginaInteira = false) => {
  await page.setViewportSize({ width: largura, height: 950 });
  await page.waitForTimeout(500);
  const caminho = join(diretorioCapturas, `${nome}.png`);
  await page.screenshot({ path: caminho, fullPage: paginaInteira });
  capturas.push(caminho);
};

await capturar("painel-1680", 1680);
await capturar("painel-1280", 1280);
await capturar("painel-mobile", 390, true);

await page.setViewportSize({ width: 1680, height: 950 });
await page.click("#dashboard-history-toggle").catch(() => undefined);
await page.waitForTimeout(600);
const caminhoHistorico = join(diretorioCapturas, "historico-completo.png");
await page.screenshot({ path: caminhoHistorico, fullPage: true });
capturas.push(caminhoHistorico);

for (const [nome, rota] of [
  ["inspecao", "/scanner"],
  ["jornada", "/journeys"],
  ["testes-de-api", "/api-tests"],
  ["ajuda", "/docs"],
  ["em-construcao", "/em-construcao?area=central-de-qualidade"],
] as const) {
  await page.goto(`${base}${rota}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const caminho = join(diretorioCapturas, `pagina-${nome}.png`);
  await page.screenshot({ path: caminho });
  capturas.push(caminho);
}

await browser.close();

console.log(`\n[Capturas] ${capturas.length} imagem(ns) em ${diretorioCapturas}`);
for (const caminho of capturas) console.log("  ", basename(caminho));

console.log(`\n${falhas.length ? `${falhas.length} falha(s):` : "Tudo certo."}`);
for (const falha of falhas) console.log(" -", falha);
process.exit(falhas.length ? 1 : 0);
