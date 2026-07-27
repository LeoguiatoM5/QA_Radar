import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderDashboard,
  renderResultsPanel,
  renderScannerForm,
} from "../src/web-components.js";
import { createDocsPage, createHomePage, createJourneyPage, createWebPage } from "../src/web-page.js";

describe("dashboard components", () => {
  it("compõe a Home sem carregar o cliente do scanner", () => {
    const html = createHomePage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /Encontre problemas antes que cheguem ao/);
    assert.match(html, /Inspecionar aplicação/);
    assert.match(html, /href="\/scanner"/);
    assert.match(html, /href="\/journeys"/);
    assert.doesNotMatch(html, /WEB_CLIENT_SCRIPT/);
    assert.doesNotMatch(html, /id="scan-form"/);
  });

  it("compõe a documentação com navegação para as ferramentas", () => {
    const html = createDocsPage();

    assert.match(html, /Como usar o QA Radar/);
    assert.match(html, /href="\/scanner"/);
    assert.match(html, /href="\/journeys"/);
    assert.match(html, /Modo Jornada de Playwright/);
    assert.doesNotMatch(html, /Jornada visual|Modelo JSON/);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="scan-form"/);
  });

  it("compõe somente o Modo Jornada de Playwright na página de automação", () => {
    const html = createJourneyPage(true);

    assert.match(html, /<header class="tool-header">.*<h1>Modo Jornada de Playwright<\/h1>/);
    assert.match(html, /id="code-mode-panel"/);
    assert.match(html, /id="playwright-code"/);
    assert.match(html, /id="code-execute"/);
    assert.match(html, /\.nav-links\{display:flex;flex-wrap:wrap/);
    assert.match(html, />Executar<\/button>/);
    assert.doesNotMatch(html, /somente local|Executar localmente/);
    assert.doesNotMatch(html, /id="visual-mode-tab"|id="journey-form"|Modelo JSON/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="results"/);
  });

  it("mantém o Modo Jornada indisponível quando o ambiente não habilita execução", () => {
    const html = createJourneyPage();

    assert.match(html, /Recurso indisponível neste ambiente/);
    assert.doesNotMatch(html, /id="code-mode-tab"/);
    assert.doesNotMatch(html, /id="code-execution"/);
    assert.doesNotMatch(html, /id="playwright-code"/);
    assert.doesNotMatch(html, /id="journey-form"|Modelo JSON/);
  });

  it("compõe estrutura, estilos e comportamento do cliente", () => {
    const html = createWebPage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<header class="tool-header">.*<h1>Inspeção<\/h1>/);
    assert.match(html, /<section class="tool-layout"><form class="panel" id="scan-form">/);
    assert.match(html, /Informe a URL e ajuste os critérios da análise/);
    assert.doesNotMatch(html, /Encontre falhas antes que o/);
    assert.match(html, /\.progress-bar\{/);
    assert.match(html, /cancelButton\.addEventListener/);
    assert.match(html, /queuePosition/);
    assert.match(html, /Gerando relatórios/);
    assert.match(html, /Histórico desabilitado neste servidor/);
    assert.doesNotMatch(html, /id="history-button"/);
  });

  it("limita o valor inicial de páginas ao máximo configurado", () => {
    const limitedHtml = createWebPage(undefined, false, 5);
    const defaultHtml = createWebPage();

    assert.match(limitedHtml, /id="maxPages"[^>]*max="5" value="5"/);
    assert.match(defaultHtml, /id="maxPages"[^>]*max="20" value="10"/);
  });

  it("renderiza recursos opcionais sem expor atributos não escapados", () => {
    const html = createWebPage('site"><script>alert(1)</script>', true, 5);

    assert.match(html, /data-sitekey="site&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.doesNotMatch(html, /data-sitekey="site"><script>/);
    assert.match(html, /id="history-button"/);
    assert.match(html, /max="5"/);
    assert.match(html, /Analisa até 5 páginas/);
    assert.doesNotMatch(html, /id="journey-form"|\/api\/journeys|Modelo JSON/);
  });

  it("mantém os componentes principais no fragmento do dashboard", () => {
    const dashboard = renderDashboard({
      allowHistory: false,
      maxSitemapPages: 3,
      turnstileWidget: "",
      historyWidget: "",
    });

    for (const id of ["scan-form", "scan-panel", "help-panel", "results", "progress", "issues"]) {
      assert.match(dashboard, new RegExp(`id="${id}"`));
    }

    assert.match(renderScannerForm({
      allowHistory: false,
      maxSitemapPages: 3,
      turnstileWidget: "",
      historyWidget: "",
    }), /id="scan-form"/);
    assert.match(renderResultsPanel(), /id="results"/);
  });
});
