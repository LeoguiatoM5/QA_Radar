import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDashboard, renderResultsPanel, renderScannerForm } from "../src/web-components.js";
import {
  createAlertsPage,
  createApiTestsPage,
  createApplicationsPage,
  createAuthPage,
  createDocsPage,
  createHomePage,
  createJourneyPage,
  createQualityPage,
  createSettingsPage,
  createWebPage,
} from "../src/web-page.js";

/**
 * Contraste WCAG (fórmula em https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio).
 *
 * Existe aqui, e não só numa checagem manual, porque o axe-core não avalia
 * `color-contrast` de forma confiável sobre fundo em gradiente (marca
 * "incomplete", não "violation") — foi assim que o BUG-18 do relatório de
 * 04/09/2026 passou pela auditoria automática da própria Inspeção. Sem essa
 * conta aqui, nada neste repositório barra uma regressão de contraste no
 * `.execution-card`.
 */
function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("entrada e cadastro", () => {
  it("compõe os quatro formulários de conta numa página só", () => {
    const html = createAuthPage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /id="auth-signin-form"/);
    assert.match(html, /id="auth-signup-form"/);
    assert.match(html, /id="auth-forgot-form"/);
    assert.match(html, /id="auth-reset-form"/);
    assert.match(html, /type="password"/);
    assert.match(html, /autocomplete="new-password"/, "o cadastro precisa dizer ao gerenciador de senhas que é senha nova");
    assert.match(html, /autocomplete="current-password"/);
    assert.match(html, /name="robots" content="noindex"/, "a tela de entrada não deve ser indexada");
  });

  it("carrega o cliente de aplicações como módulo", () => {
    const html = createApplicationsPage();
    assert.match(html, /<script type="module" src="\/assets\/js\/applications\.js"><\/script>/);
    assert.doesNotMatch(html, /application-form'\)/, "o cliente saiu da string e não pode voltar embutido");
  });

  it("carrega o cliente de alertas como módulo, sem script embutido", () => {
    const html = createAlertsPage();
    assert.match(html, /<script type="module" src="\/assets\/js\/alerts\.js"><\/script>/);
    assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/);
    assert.doesNotMatch(html, /<script(?! type="module")/, "nenhum script embutido nesta página");
    assert.match(html, /id="alert-regression"/);
    assert.match(html, /id="alerts-list"/);
  });

  it("carrega o cliente como módulo, sem script embutido", () => {
    // O JavaScript do cliente vivia dentro de um `String.raw` do servidor, onde
    // nem o `tsc` nem o `eslint` olhavam — foi de lá que saiu um erro de sintaxe
    // que passou pelo build e pelos testes e só apareceu abrindo a página.
    // Voltar a embutir script aqui desfaria isso em silêncio.
    const html = createAuthPage();

    assert.match(html, /<script type="module" src="\/assets\/js\/auth\.js"><\/script>/);
    assert.doesNotMatch(html, /<script(?! type="module")/, "nenhum script embutido nesta página");
  });

  it("não carrega o script das ferramentas na tela de entrada", () => {
    // A página é anônima por definição: puxar o cliente do scanner traria
    // consultas e estado que ninguém ali pode usar.
    const html = createAuthPage();
    assert.ok(!html.includes("#scan-form"), "a tela de entrada não deve conter o cliente do scanner");
    assert.match(html, /AUTH|auth-tabs/);
  });

  it("leva o controle de conta para /entrar, não direto ao provedor", () => {
    // Quem ainda não tem conta precisa achar o cadastro; mandar direto ao
    // GitHub esconderia o caminho de quem não usa GitHub.
    for (const html of [createHomePage(), createDocsPage(), createWebPage()]) {
      assert.match(html, /id="account-signin" href="\/entrar"/);
    }
  });

  it("ativa o controle de conta em toda página, inclusive nas que não carregam o cliente do scanner", () => {
    // A lógica já morou no script das ferramentas, que a Visão geral e a Ajuda
    // não carregam: o controle nascia oculto e nunca aparecia na primeira
    // página que se abre.
    for (const html of [createHomePage(), createDocsPage(), createJourneyPage(), createApiTestsPage(), createWebPage()]) {
      assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/, "toda página precisa carregar o shell, que é quem consulta /auth/me");
      assert.match(html, /id="verify-banner"/);
    }
  });
});

describe("dashboard components", () => {
  it("compõe a Home sem carregar o cliente do scanner", () => {
    const html = createHomePage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<h1>Visão geral<\/h1>/);
    // BUG-19 do relatório de 04/09/2026: a página tinha só o <h1> — os
    // títulos de seção eram <div>/<span>, invisíveis para quem navega por
    // headings no leitor de tela. Agora cada seção é um <h2> de verdade.
    assert.match(html, /<h2 class="section-kicker map-legend">Mapa de qualidade<\/h2>/);
    assert.match(html, /<h2 class="section-kicker">O que deseja executar\?<\/h2>/);
    assert.match(html, /<h2 class="section-kicker">Execuções recentes /);
    assert.match(html, /<h2 class="section-kicker signal-kicker">/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/<h2[ >]/g) ?? []).length, 4);

    // BUG-18: ".execution-action small" (o "Sem execuções recentes" /
    // "Última execução há X min" de cada card) precisa passar em WCAG AA
    // (4,5:1) contra o extremo mais escuro do gradiente de fundo do card —
    // o pior caso, já que o texto pode acabar sobre qualquer ponto dele.
    const textColor = html.match(/\.execution-action small\{[^}]*color:(#[0-9a-f]{6})/)?.[1];
    const [, bgStopA, bgStopB] = html.match(/\.execution-card\{[^}]*background:linear-gradient\([^,]+,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/) ?? [];
    assert.ok(textColor && bgStopA && bgStopB, "não encontrou as cores do card na folha de estilo");
    const worstCaseBg = contrastRatio(textColor, bgStopA) < contrastRatio(textColor, bgStopB) ? bgStopA : bgStopB;
    assert.ok(contrastRatio(textColor, worstCaseBg) >= 4.5, `contraste de ${textColor} sobre ${worstCaseBg} é ${contrastRatio(textColor, worstCaseBg).toFixed(2)}:1, abaixo do mínimo AA (4.5:1)`);

    assert.match(html, /Mapa de qualidade/);
    assert.match(html, /Executar inspeção/);
    assert.match(html, /id="dashboard-last-scan"/);
    assert.match(html, /id="dashboard-last-journey"/);
    assert.match(html, /id="dashboard-last-api"/);
    assert.match(html, /Aguardando execução/);
    assert.match(html, /id="dashboard-quality-index"/);
    assert.match(html, /data-radar-point="http"/);
    assert.match(html, /Índice de qualidade/);
    assert.match(html, /class="radar-svg"/);
    assert.match(html, /<text x="200" y="[\d.]+">75<\/text>/);
    assert.match(html, /id="dashboard-recent-list"/);
    assert.match(html, /id="dashboard-signal-list"/);
    assert.match(html, /data-dashboard-filter="scan"/);
    assert.match(html, /id="dashboard-history-toggle"/);
    assert.match(html, /id="dashboard-clear"/);
    assert.match(html, /Limpar histórico/);
    // O cliente virou módulo, então as asserções que liam o corpo do script
    // embutido saíram: o que a página garante agora é que aponta para ele, e o
    // comportamento é conferido no navegador e pelo typecheck do módulo.
    assert.match(html, /<script type="module" src="\/assets\/js\/dashboard\.js"><\/script>/);
    // O cabeçalho da tabela nunca chegou a ser renderizado e deixava um
    // `role="rowgroup"` sem tabela por cima — violação crítica de
    // `aria-required-parent`. Os papéis órfãos não podem voltar.
    assert.doesNotMatch(html, /role="rowgroup"/);
    assert.doesNotMatch(html, /role="columnheader"/);
    // Cada eixo do radar precisa dizer o próprio nome: o polígono sozinho não
    // informa qual vértice é qual.
    assert.match(html, /class="radar-labels"/);
    for (const label of ["HTTP", "Performance", "Acessibilidade", "DOM", "JavaScript"]) {
      assert.match(html, new RegExp(`>${label} <tspan class="radar-label-value" id="radar-value-`));
    }
    assert.match(html, /class="home-dashboard"/);
    assert.match(html, /class="nav-icon icon-overview"/);
    assert.match(html, /class="nav-group"/);
    assert.match(html, /class="sidebar-help/);
    assert.match(html, />Ajuda</);
    assert.match(html, /class="app-sidebar"/);
    assert.match(html, /class="context-bar"/);
    assert.match(html, /QA Radar Web/);
    assert.match(html, /id="context-clock"/);
    assert.match(html, /Últimas 24h/);
    assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/);
    assert.match(html, /class="mobile-nav-toggle"/);
    assert.match(html, /id="dashboard-live-state"/);
    assert.doesNotMatch(html, /Plano Empresarial|Plano empresarial/);
    assert.match(html, /href="\/scanner"/);
    assert.match(html, /href="\/journeys"/);
    assert.match(html, /href="\/api-tests"/);
    assert.doesNotMatch(html, /WEB_CLIENT_SCRIPT/);
    assert.doesNotMatch(html, /id="scan-form"/);
  });

  it("desenha a grade do radar na mesma escala usada pelos dados", () => {
    const html = createHomePage();
    const attribute = (name: string) => Number(html.match(new RegExp(`data-radar-${name}="([\\d.]+)"`))?.[1]);
    const center = attribute("center");
    const radius = attribute("radius");
    const floor = attribute("floor");
    const span = attribute("span");
    const rings = [...html.matchAll(new RegExp(`<circle cx="${center}" cy="${center}" r="([\\d.]+)"/>`, "g"))].map((match) => Number(match[1]));

    // Um eixo com valor 75 tem que cair exatamente sobre o anel do 75; era essa
    // divergência que fazia o desenho parecer torto.
    for (const value of [100, 75, 50, 25]) {
      const expected = Number((radius * (floor + span * value)).toFixed(1));
      assert.ok(rings.includes(expected), `anel ausente para ${value} (esperado r=${expected}, anéis: ${rings.join(", ")})`);
    }
  });

  it("compõe a ajuda como FAQ com navegação para as ferramentas", () => {
    const html = createDocsPage();

    assert.match(html, /Perguntas frequentes/);
    assert.match(html, /href="\/scanner"/);
    assert.match(html, /href="\/journeys"/);
    assert.match(html, /href="\/api-tests"/);
    assert.match(html, /Modo Jornada de Playwright/);
    assert.doesNotMatch(html, /Jornada visual|Modelo JSON/);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.match(html, /<details class="faq-item"/);
    assert.match(html, /<summary>/);
  });

  it("expõe no FAQ as âncoras usadas pela navegação lateral", () => {
    const html = createDocsPage();

    for (const anchor of ["relatorios", "central-de-qualidade", "alertas", "ambientes", "configuracoes"]) {
      assert.match(html, new RegExp(`<details class="faq-item" id="${anchor}"`), `âncora ausente: ${anchor}`);
    }
  });

  it("não leva a navegação a nenhum aviso de construção", () => {
    // Configurações foi a última área "em construção" a virar página de
    // verdade — não sobra nenhum link de aviso na navegação principal.
    const html = createHomePage();
    assert.doesNotMatch(html, /em-construcao/);
    assert.doesNotMatch(html, /nav-link-supporting/);
    assert.doesNotMatch(html, /href="\/docs#/);
    assert.match(html, /href="\/configuracoes"/);
  });

  it("carrega o cliente de configurações como módulo, sem script embutido", () => {
    const html = createSettingsPage();
    assert.match(html, /<script type="module" src="\/assets\/js\/settings\.js"><\/script>/);
    assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/);
    assert.doesNotMatch(html, /<script(?! type="module")/, "nenhum script embutido nesta página");
    assert.match(html, /id="settings-password-form"/);
    assert.match(html, /id="settings-alerts-form"/);
    assert.match(html, /id="settings-scan-form"/);
    // BUG-26 do relatório de 04/09/2026: a dica dizia "Pelo menos 10
    // caracteres", mas o campo não tinha `minlength` — só o servidor
    // validava, então quem digitasse menos só descobria depois de enviar.
    assert.match(html, /id="settings-new-password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"/);
  });

  it("oferece Produção, Homologação e Local no seletor de ambiente", () => {
    const html = createHomePage();

    assert.match(html, /<select id="context-environment" aria-label="Ambiente do projeto">/);
    for (const [slug, label] of [
      ["local", "Local"],
      ["homologacao", "Homologação"],
      ["producao", "Produção"],
    ]) {
      assert.match(html, new RegExp(`<option value="${slug}">${label}</option>`), `ambiente ausente: ${label}`);
    }
    // A escolha vale para as demais páginas e chega ao campo Ambiente da
    // Inspeção. Aqui ficam as duas pontas: quem carrega o shell e quem tem o
    // campo que ele preenche.
    assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/);
    assert.match(createWebPage(), /id="environment"/);
  });

  it("compõe somente o Modo Jornada de Playwright na página de automação", () => {
    const html = createJourneyPage(true);

    assert.match(html, /<header class="tool-header">.*<h1>Modo Jornada de Playwright<\/h1>/);
    assert.match(html, /id="code-mode-panel"/);
    assert.match(html, /id="playwright-code"/);
    assert.match(html, /id="code-execute"/);
    // O painel de token administrativo virou aviso para entrar. O token segue
    // valendo na API para automação, mas deixou de ser o que se pede a uma
    // pessoa — e por isso não é mais guardado no navegador.
    // O controle de conta existe em toda página, mas nasce oculto: quem decide
    // mostrá-lo é o cliente, depois de perguntar ao servidor se há login.
    assert.match(html, /id="account-control" hidden/);
    // Entrar leva à tela de conta, e não direto ao provedor: com cadastro por
    // e-mail e senha, o GitHub virou um dos caminhos e não mais o único.
    assert.match(html, /id="account-signin"[^>]*href="\/entrar"/);
    assert.match(html, /id="account-signout"/);
    assert.match(html, /<script type="module" src="\/assets\/js\/shell\.js"><\/script>/);
    assert.match(html, /id="journey-signin"/);
    assert.match(html, /Entrar ou criar conta/);
    assert.doesNotMatch(html, /journey-admin-token/);
    assert.doesNotMatch(html, /qa-radar-code-admin-token/);
    assert.match(html, /\.app-sidebar \.nav-link\{/);
    assert.match(html, />Executar<\/button>/);
    assert.doesNotMatch(html, /somente local|Executar localmente/);
    assert.doesNotMatch(html, /id="visual-mode-tab"|id="journey-form"|Modelo JSON/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="results"/);
  });

  it("mantém o Modo Jornada indisponível quando o ambiente não habilita execução", () => {
    const html = createJourneyPage();

    assert.match(html, /Execução desligada neste servidor/);
    // O aviso precisa dizer o que fazer: rodar local ou apontar um runner sandbox.
    assert.match(html, /npm run web/);
    assert.match(html, /QA_RADAR_ENABLE_CODE_MODE=true/);
    assert.match(html, /QA_RADAR_SANDBOX_URL/);
    assert.doesNotMatch(html, /id="code-mode-tab"/);
    assert.doesNotMatch(html, /id="code-execution"/);
    assert.doesNotMatch(html, /id="playwright-code"/);
    assert.doesNotMatch(html, /id="journey-form"|Modelo JSON/);
  });

  it("compõe os Testes de API como cliente HTTP interativo, separado da Jornada e sempre disponível", () => {
    const html = createApiTestsPage();

    assert.match(html, /<header class="tool-header">.*<h1>Testes de API<\/h1>/);
    assert.match(html, /id="http-client-panel"/);
    assert.match(html, /id="http-method"/);
    assert.match(html, /id="http-url"/);
    assert.match(html, /id="http-send"/);
    assert.match(html, /id="http-clear"/);
    assert.match(html, /id="http-params"/);
    assert.match(html, /id="http-auth-type"/);
    assert.match(html, /id="http-auth-bearer-token"/);
    assert.match(html, /id="http-auth-api-key-location"/);
    assert.match(html, /id="http-headers"/);
    assert.match(html, /id="http-format-body"/);
    assert.match(html, /id="http-variables"/);
    assert.match(html, /id="http-response-empty"/);
    assert.match(html, /id="http-copy-response"/);
    assert.match(html, /id="http-collection-list"/);
    assert.match(html, /id="http-collection-search"/);
    assert.match(html, /id="http-history-list"/);
    assert.match(html, /id="http-clear-history"/);
    assert.match(html, />Enviar<\/button>/);
    // O cliente virou módulo próprio; a página garante que carrega o dela e
    // nenhum dos outros.
    assert.match(html, /<script type="module" src="\/assets\/js\/api-tests\.js"><\/script>/);
    assert.doesNotMatch(html, /src="\/assets\/js\/(scanner|journey)\.js"/);
    assert.doesNotMatch(html, /Execução desligada neste servidor/);
    assert.doesNotMatch(html, /id="playwright-code"|id="codegen-start"|id="codegen-stop"|id="code-mode-panel"/);
    assert.doesNotMatch(html, /id="scan-form"/);
    assert.doesNotMatch(html, /id="results"/);
  });

  it("compõe estrutura, estilos e comportamento do cliente", () => {
    const html = createWebPage();

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<header class="tool-header">.*<h1>Inspeção<\/h1>/);
    assert.match(html, /<section class="tool-layout"><form class="panel" id="scan-form">/);
    assert.match(html, /Informe a URL e ajuste os critérios da análise/);
    assert.doesNotMatch(html, /Encontre falhas antes que o/);
    assert.match(html, /\.progress-bar\{/);
    assert.match(html, /<script type="module" src="\/assets\/js\/scanner\.js"><\/script>/);
    assert.doesNotMatch(html, /src="\/assets\/js\/(journey|api-tests)\.js"/);
    // BUG-24 do relatório de 04/09/2026: "Histórico desabilitado neste
    // servidor" (do campo Projeto) convivia, sem explicação, com "guarde
    // esta análise no histórico dela" (do seletor Aplicação) — como se a
    // tela se contradissesse. São dois sistemas de histórico diferentes; o
    // aviso agora diz qual dos dois está desligado.
    assert.match(html, /Histórico por projeto desabilitado neste servidor — para guardar a análise no histórico da sua conta, use Aplicação, acima\./);
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

    assert.match(
      renderScannerForm({
        allowHistory: false,
        maxSitemapPages: 3,
        turnstileWidget: "",
        historyWidget: "",
      }),
      /id="scan-form"/,
    );
    assert.match(renderResultsPanel(), /id="results"/);
  });
});

describe("central de qualidade", () => {
  // BUG-17 do relatório de 04/09/2026: os KPIs (Execuções, Taxa de sucesso,
  // Sem falha, Com falha) usam a mesma classe `.reports-tile` dos cards de
  // Relatórios, mas essa página nunca incluía REPORTS_STYLES no <style> —
  // então a classe não tinha regra nenhuma, e rótulo e valor colavam num
  // texto só, sem quebra de linha nem cara de card.
  it("inclui a folha de estilo que dá aparência de card aos KPIs (.reports-tile)", () => {
    const html = createQualityPage();
    assert.match(html, /\.reports-tile\{[^}]*background:/);
    assert.match(html, /\.reports-tile small\{[^}]*display:block/);
    assert.match(html, /\.reports-tile strong\{[^}]*display:block/);
    assert.match(html, /class="reports-tile quality-tile"/);
  });
});
