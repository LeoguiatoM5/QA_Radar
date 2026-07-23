export interface DashboardOptions {
  allowHistory: boolean;
  maxSitemapPages: number;
  turnstileWidget: string;
  historyWidget: string;
  allowJourneys: boolean;
}

export function renderScannerForm(options: DashboardOptions): string {
  const { allowHistory, maxSitemapPages, turnstileWidget, historyWidget } = options;
  return `<form class="panel" id="scan-form">
      <div class="tabs" role="tablist" aria-label="Conteúdo do scanner"><button class="tab active" id="scan-tab" type="button" role="tab" aria-selected="true" aria-controls="scan-panel">Nova análise</button><button class="tab" id="help-tab" type="button" role="tab" aria-selected="false" aria-controls="help-panel">Como funciona</button></div>
      <div class="scan-panel" id="scan-panel" role="tabpanel" aria-labelledby="scan-tab">
        <h2>Nova análise</h2><p class="sub">Informe o ambiente que deseja inspecionar.</p>
        <label for="url">URL da aplicação</label><div class="url-row"><span>⌁</span><input id="url" name="url" type="url" placeholder="https://staging.sua-aplicacao.com" required autofocus></div><small class="hint">Endereço público iniciado por http:// ou https://. Ambientes locais e redes privadas são bloqueados na versão pública.</small>
        <div class="row"><div><label for="browser">Navegador</label><select id="browser" name="browser"><option>chromium</option><option>firefox</option><option>webkit</option></select><small class="hint">Motor usado para abrir e observar a página.</small></div><div><label for="failOn">Reprovar a partir de</label><select id="failOn" name="failOn"><option value="error">Erros</option><option value="warning">Avisos</option><option value="none">Nunca</option></select><small class="hint">Define quando o resultado será marcado como reprovado.</small></div></div>
        <div class="row"><div><label for="project">Projeto</label><input id="project" name="project" placeholder="loja-web" ${allowHistory ? "" : "disabled"}><small class="hint">${allowHistory ? "Ativa histórico e baseline automático." : "Histórico desabilitado neste servidor."}</small></div><div><label for="environment">Ambiente</label><input id="environment" name="environment" value="staging" ${allowHistory ? "" : "disabled"}><small class="hint">Separa staging, produção e outros ambientes.</small></div></div>
        <div class="row"><div class="option"><input id="sitemap" name="sitemap" type="checkbox"><div><label for="sitemap">Cobrir sitemap.xml</label><small class="hint">Analisa até ${maxSitemapPages} páginas do mesmo domínio.</small></div></div><div><label for="maxPages">Máximo de páginas</label><input id="maxPages" name="maxPages" type="number" min="1" max="${maxSitemapPages}" value="10"><small class="hint">Execução sequencial para controlar recursos.</small></div></div>
        <div class="option"><input id="accessibility" name="accessibility" type="checkbox"><div><label for="accessibility">Auditoria de acessibilidade com axe-core</label><small class="hint">Ative para incluir regras WCAG no diagnóstico e no quality gate.</small></div></div>
        ${allowHistory ? '<div class="row"><div class="option"><input id="regressionsOnly" name="regressionsOnly" type="checkbox"><div><label for="regressionsOnly">Somente regressões</label><small class="hint">Problemas existentes não reprovam novamente.</small></div></div><div class="option"><input id="acceptBaseline" name="acceptBaseline" type="checkbox"><div><label for="acceptBaseline">Aceitar como baseline</label><small class="hint">Use apenas após revisar o resultado.</small></div></div></div>' : ""}
        <details class="advanced"><summary>Configurações avançadas</summary><div class="row"><div><label for="timeoutMs">Timeout (ms)</label><input id="timeoutMs" name="timeoutMs" type="number" min="1000" max="120000" value="30000"><small class="hint">Tempo máximo para abrir a página.</small></div><div><label for="settleMs">Observação (ms)</label><input id="settleMs" name="settleMs" type="number" min="0" max="30000" value="2000"><small class="hint">Tempo extra para capturar falhas após o carregamento.</small></div></div><label for="ignoredStatuses">Status ignorados</label><input id="ignoredStatuses" name="ignoredStatuses" placeholder="401,404"><small class="hint">Códigos HTTP separados por vírgula que não devem virar ocorrências.</small><label for="ignoredUrl">Ignorar URLs (regex)</label><input id="ignoredUrl" name="ignoredUrl" placeholder="Indisponível na Beta pública" disabled><small class="hint">Filtros personalizados estão desabilitados no servidor público por segurança.</small><label for="screenshot">Screenshot</label><select id="screenshot" name="screenshot"><option value="on-failure">Quando reprovar</option><option value="always">Sempre</option><option value="never">Nunca</option></select><small class="hint">“Sempre” inclui evidência visual mesmo quando a análise é aprovada.</small></details>
        ${turnstileWidget}<button id="submit" type="submit">Executar scanner</button>${historyWidget}<div class="error-box" id="error"></div>
      </div>
      <section class="help-panel" id="help-panel" role="tabpanel" aria-labelledby="help-tab" hidden><h2>Como o QA Radar funciona</h2><p class="sub">Um guia rápido para configurar e interpretar sua análise.</p><div class="help-grid"><div class="help-item"><h3>1. Informe a URL</h3><p>O scanner abre a página em um navegador real e observa o carregamento, o DOM, o console e as requisições de rede.</p></div><div class="help-item"><h3>2. Escolha o quality gate</h3><p>“Erros” reprova apenas problemas críticos. “Avisos” exige uma análise totalmente limpa. “Nunca” apenas informa os achados.</p></div><div class="help-item"><h3>3. Configure a evidência</h3><p>“Quando reprovar” captura screenshot apenas se o quality gate falhar. Use “Sempre” para gerar evidência visual em toda execução.</p></div><div class="help-item"><h3>4. Entenda o diagnóstico</h3><p>Cada ocorrência apresenta categoria, impacto para o usuário, recomendação, detalhe técnico e, quando possível, o elemento relacionado.</p></div><div class="help-item"><h3>5. Use os relatórios</h3><p>O HTML facilita a leitura e o compartilhamento. O JSON permite integrações e automações. Os resultados ficam disponíveis temporariamente.</p></div><div class="help-item"><h3>Limites da Beta</h3><p>A análise cobre a página informada, mas ainda não realiza login, cliques, formulários ou jornadas completas automaticamente.</p></div></div></section>
    </form>`;
}

export function renderResultsPanel(): string {
  return `<section class="results" id="results"><div class="result-head"><div><div class="eyebrow">Resultado da análise</div><h2 id="result-title">Analisando aplicação</h2><div class="comparison" id="comparison"></div><div class="progress" id="progress"><span id="progress-text">Preparando análise…</span><div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div></div></div><div><span class="status running" id="status"><i class="loader"></i>Executando</span><button class="cancel" id="cancel" type="button" hidden>Cancelar</button></div></div><div class="metrics"><div class="metric"><small>Erros</small><strong id="errors">—</strong></div><div class="metric"><small>Avisos</small><strong id="warnings">—</strong></div><div class="metric"><small>HTTP principal</small><strong id="http">—</strong></div><div class="metric"><small>Duração</small><strong id="duration">—</strong></div><div class="metric"><small>TTFB</small><strong id="ttfb">—</strong></div><div class="metric"><small>LCP</small><strong id="lcp">—</strong></div><div class="metric"><small>CLS</small><strong id="cls">—</strong></div><div class="metric"><small>Páginas</small><strong id="pages">1</strong></div></div><div class="issues" id="issues"><div class="issue"><div class="message">O Chromium está carregando e observando a página…</div></div></div><div class="actions" id="actions"></div><iframe id="report-frame" title="Relatório completo" hidden></iframe></section>`;
}

export function renderJourneyPanel(): string {
  return `<section class="panel journey-panel"><div class="eyebrow">Experimental</div><h1 class="journey-title">Jornada Playwright</h1><p class="sub">Informe a URL e descreva os passos que o navegador deve executar.</p><details class="journey-help"><summary>Como montar uma jornada</summary><div class="journey-help-grid"><div><strong>goto</strong><span>Abre uma URL da mesma origem autorizada.</span></div><div><strong>fill</strong><span>Preenche um campo usando selector e value.</span></div><div><strong>click</strong><span>Clica em um elemento identificado pelo selector.</span></div><div><strong>select</strong><span>Escolhe uma opção de uma lista.</span></div><div><strong>waitFor</strong><span>Aguarda um elemento ficar visível.</span></div><div><strong>assertVisible</strong><span>Confirma que um elemento está visível.</span></div><div><strong>assertText</strong><span>Confirma que um elemento contém o texto esperado.</span></div><div><strong>description</strong><span>Explica o objetivo do passo no resultado.</span></div></div><p class="hint">Cada passo aceita uma descrição de até 200 caracteres. Use seletores CSS como #login, .produto ou [data-testid=resultado].</p></details><form id="journey-form"><label for="journey-url">URL e origem autorizada</label><input id="journey-url" type="url" required placeholder="https://staging.example.com"><div class="row"><div><label for="journey-browser">Navegador</label><select id="journey-browser"><option>chromium</option><option>firefox</option><option>webkit</option></select></div><div><label for="journey-timeout">Timeout por passo (ms)</label><input id="journey-timeout" type="number" min="100" max="120000" value="10000"></div></div><label for="journey-json">Passos da jornada</label><textarea id="journey-json" rows="14" spellcheck="false" required>{
  "schemaVersion": "1.0",
  "name": "Smoke local",
  "steps": [
    { "action": "goto", "url": "https://example.com", "description": "Abrir a página inicial" },
    { "action": "assertVisible", "selector": "body", "description": "Confirmar que a página foi exibida" }
  ]
}</textarea><div class="journey-controls"><button id="journey-submit" type="submit">Executar jornada</button><button class="cancel" id="journey-cancel" type="button" hidden>Cancelar jornada</button></div><div class="error-box" id="journey-error"></div></form><section id="journey-results" hidden><div class="result-head"><div><h2 id="journey-title"></h2><small id="journey-summary"></small></div><span class="status" id="journey-status"></span></div><div class="issues" id="journey-steps"></div><button class="secondary" id="journey-evidence-button" type="button" hidden>Gerar relatório de evidências</button></section><dialog id="journey-evidence-modal"><form id="journey-evidence-form"><div class="modal-head"><div><div class="eyebrow">Relatório HTML</div><h2>Gerar evidências</h2></div><button class="modal-close" id="journey-evidence-close" type="button" aria-label="Fechar">×</button></div><p class="sub">Identifique o responsável e o tipo desta execução.</p><label for="journey-tester-name">Responsável pelo teste</label><input id="journey-tester-name" maxlength="100" required placeholder="Seu nome"><label for="journey-test-type">Tipo de teste</label><select id="journey-test-type" required><option value="functional">Funcional</option><option value="smoke">Smoke</option><option value="regression">Regressão</option><option value="acceptance">Aceitação</option><option value="exploratory">Exploratório</option></select><div class="modal-actions"><button class="secondary" id="journey-evidence-cancel" type="button">Cancelar</button><button type="submit">Gerar HTML</button></div><div class="error-box" id="journey-evidence-error"></div></form></dialog></section>`;
}

export function renderDashboard(options: DashboardOptions): string {
  return `<main class="shell">
  ${renderAppNav("scanner")}
  <section class="hero">
    <div><div class="eyebrow">Quality intelligence · Beta</div><h1>Encontre falhas antes que o <span>usuário encontre.</span></h1><p class="lead">O QA Radar inspeciona os elementos da página, detecta falhas de JavaScript, HTTP e rede, explica o impacto para o usuário e gera evidências visuais prontas para investigação.</p><div class="features"><span>Inspeção do DOM</span><span>Evidências anotadas</span><span>Diagnóstico em linguagem de QA</span></div></div>
    ${renderScannerForm(options)}
  </section>
  ${renderResultsPanel()}
  ${options.allowJourneys ? renderJourneyPanel() : ""}
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

function renderAppNav(active: "home" | "scanner" | "journeys" | "docs"): string {
  const link = (id: typeof active, label: string, href: string) => `<a class="nav-link ${active === id ? "active" : ""}" style="color:${active === id ? "var(--cyan)" : "var(--muted)"};text-decoration:none;font-size:.78rem;padding:7px 9px;border-radius:7px" href="${href}">${label}</a>`;
  return `<nav><a class="logo" href="/"><i class="radar"></i> QA RADAR</a><div class="nav-links" style="display:flex;gap:8px;align-items:center;margin-left:auto">${link("home", "Home", "/")}${link("scanner", "Inspeção", "/scanner")}${link("journeys", "Jornadas", "/journeys")}${link("docs", "Documentação", "/docs")}</div><span class="pill">Beta pública</span></nav>`;
}

export function renderJourneyPage(allowJourneys: boolean): string {
  return `<main class="shell">
  ${renderAppNav("journeys")}
  ${allowJourneys ? `${renderJourneyPanel()}${renderJourneyReference()}` : '<section class="panel"><div class="eyebrow">Jornada Playwright</div><h1>Recurso indisponível</h1><p class="lead">As Jornadas estão desabilitadas neste servidor. Volte à Home ou use a inspeção de aplicação.</p><p><a class="home-action" href="/scanner"><strong>Abrir inspeção</strong><span>Executar o scanner seguro por URL.</span></a></p></section>'}
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

function renderJourneyReference(): string {
  return `<section class="panel journey-reference"><div class="eyebrow">Referência</div><h2>Modelo JSON</h2><p class="sub">Use o schema 1.0 para declarar os passos. A execução aceita as funcionalidades permitidas pelo contrato atual da Jornada.</p><pre><code>{
  "schemaVersion": "1.0",
  "name": "Login",
  "steps": [
    { "action": "goto", "url": "https://example.com", "description": "Abrir a página" },
    { "action": "fill", "selector": "#email", "value": "qa@example.com" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "assertVisible", "selector": "[data-testid=dashboard]" }
  ]
}</code></pre><p><a href="https://playwright.dev/docs/intro" target="_blank" rel="noreferrer">Consultar documentação oficial do Playwright ↗</a></p></section>`;
}

export function renderHome(): string {
  return `<main class="shell home-shell">
  ${renderAppNav("home")}
  <section class="hero home-hero">
    <div><div class="eyebrow">Quality intelligence · Beta</div><h1>Qualidade antes que o <span>usuário encontre.</span></h1><p class="lead">O QA Radar ajuda seu time a investigar aplicações web com inspeção automatizada, jornadas controladas e evidências prontas para compartilhar.</p></div>
    <div class="panel home-navigation"><h2>O que você quer fazer?</h2><p class="sub">Escolha uma funcionalidade para começar.</p><div class="home-actions"><a class="home-action" href="/scanner"><strong>Inspecionar aplicação</strong><span>Detecte falhas de JavaScript, HTTP, rede, DOM, acessibilidade e performance.</span></a><a class="home-action" href="/journeys"><strong>Executar jornada</strong><span>Teste fluxos declarativos com navegação, preenchimento, cliques e asserts.</span></a><a class="home-action" href="/docs"><strong>Aprender como funciona</strong><span>Consulte o tutorial, exemplos, limites e formatos de relatório.</span></a></div></div>
  </section>
  <section class="panel home-guide"><h2>Como começar</h2><div class="help-grid"><div class="help-item"><h3>1. Escolha uma ferramenta</h3><p>Use a inspeção para um diagnóstico rápido ou uma jornada para validar um fluxo.</p></div><div class="help-item"><h3>2. Revise as evidências</h3><p>Cada execução informa impacto, recomendação e detalhes técnicos para investigação.</p></div><div class="help-item"><h3>3. Integre ao seu fluxo</h3><p>Exporte HTML, JSON, JUnit ou SARIF e conecte o resultado ao CI.</p></div></div></section>
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

export function renderDocs(): string {
  return `<main class="shell home-shell">
  ${renderAppNav("docs")}
  <section class="panel docs-panel"><div class="eyebrow">Documentação · Beta</div><h1>Como usar o QA Radar</h1><p class="lead">Escolha a ferramenta conforme o tipo de validação que você precisa executar.</p><h2>Inspeção</h2><p>Analisa uma URL sem clicar ou enviar formulários. Observa navegador, JavaScript, rede, DOM, acessibilidade e performance.</p><div class="docs-action"><a href="/scanner">Abrir inspeção</a><span>Começar um diagnóstico de aplicação.</span></div><h2>Jornadas</h2><p>Execute uma Jornada usando um JSON compatível com o schema 1.0. O formulário apresenta um modelo e um link para a documentação oficial do Playwright.</p><div class="docs-action"><a href="/journeys">Abrir jornadas</a><span>Validar um fluxo controlado.</span></div><h2>Relatórios e limites</h2><p>As execuções geram evidências e formatos para leitura humana ou integração com CI. Os resultados são heurísticos e não substituem testes funcionais completos, exploração manual ou dados reais de usuários.</p></section>
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}
