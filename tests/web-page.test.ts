import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderDashboard,
  renderResultsPanel,
  renderScannerForm,
} from "../src/web-components.js";
import { createWebPage } from "../src/web-page.js";

describe("dashboard components", () => {
  it("compõe estrutura, estilos e comportamento do cliente", () => {
    const html = createWebPage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /\.progress-bar\{/);
    assert.match(html, /cancelButton\.addEventListener/);
    assert.match(html, /queuePosition/);
    assert.match(html, /Gerando relatórios/);
    assert.match(html, /Histórico desabilitado neste servidor/);
    assert.doesNotMatch(html, /id="history-button"/);
  });

  it("renderiza recursos opcionais sem expor atributos não escapados", () => {
    const html = createWebPage('site"><script>alert(1)</script>', true, 5, true);

    assert.match(html, /data-sitekey="site&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.doesNotMatch(html, /data-sitekey="site"><script>/);
    assert.match(html, /id="history-button"/);
    assert.match(html, /max="5"/);
    assert.match(html, /Analisa até 5 páginas/);
    assert.match(html, /id="journey-form"/);
    assert.match(html, /\/api\/journeys/);
    assert.match(html, /Informe a URL e descreva os passos que o navegador deve executar/);
    assert.match(html, /Como montar uma jornada/);
    assert.match(html, /description/);
    assert.match(html, /journey-controls/);
    assert.match(html, /journeyActionLabels/);
    assert.doesNotMatch(html, /Secrets são lidos somente/);
  });

  it("mantém os componentes principais no fragmento do dashboard", () => {
    const dashboard = renderDashboard({
      allowHistory: false,
      maxSitemapPages: 3,
      turnstileWidget: "",
      historyWidget: "",
      allowJourneys: false,
    });

    for (const id of ["scan-form", "scan-panel", "help-panel", "results", "progress", "issues"]) {
      assert.match(dashboard, new RegExp(`id="${id}"`));
    }

    assert.match(renderScannerForm({
      allowHistory: false,
      maxSitemapPages: 3,
      turnstileWidget: "",
      historyWidget: "",
      allowJourneys: false,
    }), /id="scan-form"/);
    assert.match(renderResultsPanel(), /id="results"/);
  });
});
