type NavSection = "home" | "scanner" | "journeys" | "api" | "docs" | "construcao";

/** Ambientes oferecidos no seletor da barra de contexto. */
export const ENVIRONMENTS = [
  { slug: "local", label: "Local" },
  { slug: "homologacao", label: "Homologação" },
  { slug: "producao", label: "Produção" },
] as const;

/** Áreas de apoio que ainda não existem: a navegação leva ao aviso de construção. */
export const CONSTRUCTION_AREAS = {
  relatorios: { label: "Relatórios", summary: "Uma área dedicada a consolidar os relatórios de todas as execuções, com filtros por projeto, período e ambiente." },
  "central-de-qualidade": { label: "Central de qualidade", summary: "O painel de padrões, tendências e evolução da qualidade do projeto ao longo do tempo." },
  alertas: { label: "Alertas", summary: "Notificações automáticas quando uma execução falhar ou um indicador de qualidade piorar." },
  ambientes: { label: "Ambientes", summary: "O cadastro de ambientes do projeto, com URLs, credenciais e histórico separados por ambiente." },
  configuracoes: { label: "Configurações", summary: "As preferências do projeto e da conta reunidas em um só lugar." },
} as const;

type ConstructionArea = keyof typeof CONSTRUCTION_AREAS;

export interface DashboardOptions {
  allowHistory: boolean;
  maxSitemapPages: number;
  turnstileWidget: string;
  historyWidget: string;
}

export function renderScannerForm(options: DashboardOptions): string {
  const { allowHistory, maxSitemapPages, turnstileWidget, historyWidget } = options;
  const defaultMaxPages = Math.min(10, maxSitemapPages);
  return `<form class="panel" id="scan-form">
      <div class="tabs" role="tablist" aria-label="Conteúdo do scanner"><button class="tab active" id="scan-tab" type="button" role="tab" aria-selected="true" aria-controls="scan-panel">Nova análise</button><button class="tab" id="help-tab" type="button" role="tab" aria-selected="false" aria-controls="help-panel">Como funciona</button></div>
      <div class="scan-panel" id="scan-panel" role="tabpanel" aria-labelledby="scan-tab">
        <h2>Nova análise</h2><p class="sub">Informe o ambiente que deseja inspecionar.</p>
        <label for="url">URL da aplicação</label><div class="url-row"><span>⌁</span><input id="url" name="url" type="url" placeholder="https://staging.sua-aplicacao.com" required autofocus></div><small class="hint">Endereço público iniciado por http:// ou https://. Ambientes locais e redes privadas são bloqueados na versão pública.</small>
        <div class="row"><div><label for="browser">Navegador</label><select id="browser" name="browser"><option>chromium</option><option>firefox</option><option>webkit</option></select><small class="hint">Motor usado para abrir e observar a página.</small></div><div><label for="failOn">Reprovar a partir de</label><select id="failOn" name="failOn"><option value="error">Erros</option><option value="warning">Avisos</option><option value="none">Nunca</option></select><small class="hint">Define quando o resultado será marcado como reprovado.</small></div></div>
        <div class="row"><div><label for="project">Projeto</label><input id="project" name="project" placeholder="loja-web" ${allowHistory ? "" : "disabled"}><small class="hint">${allowHistory ? "Ativa histórico e baseline automático." : "Histórico desabilitado neste servidor."}</small></div><div><label for="environment">Ambiente</label><input id="environment" name="environment" value="staging" ${allowHistory ? "" : "disabled"}><small class="hint">Separa staging, produção e outros ambientes.</small></div></div>
        <div class="row"><div class="option"><input id="sitemap" name="sitemap" type="checkbox"><div><label for="sitemap">Cobrir sitemap.xml</label><small class="hint">Analisa até ${maxSitemapPages} páginas do mesmo domínio.</small></div></div><div><label for="maxPages">Máximo de páginas</label><input id="maxPages" name="maxPages" type="number" min="1" max="${maxSitemapPages}" value="${defaultMaxPages}"><small class="hint">Execução sequencial para controlar recursos.</small></div></div>
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

export function renderDashboard(options: DashboardOptions): string {
  return `${renderWorkspaceStart("scanner", "Inspeção")}
  ${renderToolHeader("Scanner", "Inspeção", "Informe a URL e ajuste os critérios da análise.")}
  <section class="tool-layout">${renderScannerForm(options)}</section>
  ${renderResultsPanel()}
  ${renderWorkspaceEnd()}`;
}

function renderAppNav(active: NavSection, area = ""): string {
  const link = (id: NavSection, label: string, href: string, icon: string) =>
    `<a class="nav-link ${active === id ? "active" : ""}" href="${href}"${active === id ? ' aria-current="page"' : ""}><span class="nav-icon icon-${icon}" aria-hidden="true"><i></i></span><span>${label}</span></a>`;
  // As áreas de apoio ainda não existem: todas levam ao aviso de construção, e a
  // que estiver aberta é destacada pelo slug da área.
  const supportingLink = (slug: string, label: string, icon: string) =>
    `<a class="nav-link nav-link-supporting ${area === slug ? "active" : ""}" href="/em-construcao?area=${slug}"${area === slug ? ' aria-current="page"' : ""}><span class="nav-icon icon-${icon}" aria-hidden="true"><i></i></span><span>${label}</span></a>`;
  return `<aside class="app-sidebar">
    <div class="sidebar-brand"><a class="logo" href="/"><i class="radar"></i><span>QA RADAR</span></a><button class="mobile-nav-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Abrir menu"><i></i></button></div>
    <nav class="nav-links" id="primary-navigation" aria-label="Navegação principal">
      <div class="nav-group">
        ${link("home", "Visão geral", "/", "overview")}
        ${link("scanner", "Inspeção", "/scanner", "inspection")}
        ${link("journeys", "Jornada", "/journeys", "journey")}
        ${link("api", "Testes de API", "/api-tests", "api")}
        ${supportingLink("relatorios", "Relatórios", "reports")}
        ${supportingLink("central-de-qualidade", "Central de qualidade", "quality")}
      </div>
      <div class="nav-group nav-group-support">
        ${supportingLink("alertas", "Alertas", "alerts")}
        ${supportingLink("ambientes", "Ambientes", "environments")}
        ${supportingLink("configuracoes", "Configurações", "settings")}
      </div>
    </nav>
    <a class="sidebar-help ${active === "docs" ? "active" : ""}" href="/docs"><span class="help-mark">?</span><span>Ajuda</span></a>
  </aside>`;
}

function renderWorkspaceStart(active: NavSection, section: string, area = ""): string {
  return `<main class="shell ${active === "home" ? "home-shell" : ""}">
  ${renderAppNav(active, area)}
  <div class="app-main">
    <header class="context-bar">
      <div class="context-item context-project"><small>Projeto</small><strong>QA Radar Web</strong></div>
      <div class="context-item context-environment" data-environment="local"><small>Ambiente</small><strong><span class="live-dot"></span><span id="context-environment-label">Local</span></strong><select id="context-environment" aria-label="Ambiente do projeto">${ENVIRONMENTS.map((environment) => `<option value="${environment.slug}">${environment.label}</option>`).join("")}</select></div>
      <div class="context-section"><span class="context-page">${section}</span><span class="context-clock"><i aria-hidden="true"></i><time id="context-clock" datetime="">--/--/---- --:--</time></span><span class="context-period" title="Janela usada nos indicadores do dashboard">Últimas 24h</span></div>
    </header>
    <div class="app-page app-page-${active}">`;
}

function renderWorkspaceEnd(): string {
  return `<footer>&copy; 2026 QA Radar · Qualidade visível, decisões mais rápidas.</footer>
    </div>
  </div>
</main>`;
}

function renderToolHeader(eyebrow: string, title: string, description: string): string {
  return `<header class="tool-header"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></header>`;
}

export function renderJourneyPage(allowCodeMode: boolean): string {
  const enabled = allowCodeMode;
  return `${renderWorkspaceStart("journeys", "Jornada")}
  ${enabled ? `${renderToolHeader("Automação Playwright", "Modo Jornada de Playwright", "Grave, revise e execute jornadas Playwright em TypeScript.")}<section class="journey-workspace">${renderCodePanel()}</section>${renderEvidenceModal()}` : '<section class="panel"><div class="eyebrow">Modo Jornada de Playwright</div><h1>Recurso indisponível neste ambiente</h1><p class="lead">A execução de jornadas ainda não está habilitada nesta implantação.</p><p><a class="home-action" href="/docs"><strong>Consultar configuração</strong><span>Veja os requisitos de infraestrutura para habilitar o recurso.</span></a></p></section>'}
  ${renderWorkspaceEnd()}`;
}

export function renderApiPage(): string {
  return `${renderWorkspaceStart("api", "Testes de API")}
  ${renderToolHeader("Cliente HTTP", "Testes de API", "Monte, organize e execute requisições sem sair do QA Radar.")}
  <section class="api-workspace">${renderApiPanel()}</section>
  ${renderWorkspaceEnd()}`;
}

function renderEvidenceModal(): string {
  return `<dialog id="journey-evidence-modal"><form id="journey-evidence-form"><div class="modal-head"><div><div class="eyebrow">Relatório HTML</div><h2>Gerar evidências</h2></div><button class="modal-close" id="journey-evidence-close" type="button" aria-label="Fechar">×</button></div><p class="sub">Identifique o responsável e o tipo desta execução.</p><label for="journey-tester-name">Responsável pelo teste</label><input id="journey-tester-name" maxlength="100" required placeholder="Seu nome"><label for="journey-test-type">Tipo de teste</label><select id="journey-test-type" required><option value="functional">Funcional</option><option value="smoke">Smoke</option><option value="regression">Regressão</option><option value="acceptance">Aceitação</option><option value="exploratory">Exploratório</option></select><label>Passo a passo</label><small class="hint">Por padrão, a descrição vem do código. Use "Editar" para personalizar o que aparece no relatório.</small><div id="journey-evidence-steps" class="evidence-steps"></div><div class="modal-actions"><button class="secondary" id="journey-evidence-cancel" type="button">Cancelar</button><button type="submit">Gerar HTML</button></div><div class="error-box" id="journey-evidence-error"></div></form></dialog>`;
}

function renderCodePanel(): string {
  return `<section class="panel" id="code-mode-panel"><div class="eyebrow">Jornada Playwright</div><h2>Teste Playwright em TypeScript</h2><p class="sub">Grave o fluxo no navegador, revise o código oficial e execute a jornada no ambiente configurado.</p><div class="code-flow"><span><b>1</b>Gravar</span><span><b>2</b>Revisar</span><span><b>3</b>Executar</span></div><label for="codegen-url">URL inicial da gravação</label><input id="codegen-url" type="url" placeholder="https://staging.sua-aplicacao.com"><div class="journey-controls"><button id="codegen-start" type="button">Abrir gravador</button><button id="codegen-stop" class="secondary" type="button" disabled>Usar código gravado</button></div><div class="error-box" id="codegen-error"></div><div class="code-editor-head"><div><label for="playwright-code">Arquivo Playwright</label><small>qa-radar.spec.ts</small></div><label class="code-import" for="code-import">Importar arquivo</label><input id="code-import" type="file" accept=".ts,.spec.ts" hidden></div><textarea id="playwright-code" rows="18" spellcheck="false" aria-label="Código do teste Playwright" placeholder="import { test, expect } from '@playwright/test';"></textarea><div class="journey-controls code-actions"><button id="code-save" class="secondary" type="button">Exportar .spec.ts</button><button id="code-execute" type="button">Executar</button></div><div id="code-result" hidden aria-live="polite"></div><p class="hint">Este recurso executa código informado pelo usuário. Revise o arquivo antes de executar.</p></section>`;
}

function renderHttpKeyValueRow(keyPlaceholder: string, valuePlaceholder: string): string {
  return `<div class="http-kv-row"><input type="text" class="http-kv-key" placeholder="${keyPlaceholder}"><input type="text" class="http-kv-value" placeholder="${valuePlaceholder}"><button type="button" class="secondary http-kv-remove" aria-label="Remover">×</button></div>`;
}

function renderApiPanel(): string {
  return `<section class="panel" id="http-client-panel">
  <div class="http-request-line"><select id="http-method" aria-label="Método HTTP"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option></select><input id="http-url" type="text" inputmode="url" aria-label="URL da requisição" placeholder="https://api.exemplo.com/recurso ou {{baseUrl}}/recurso" required><button id="http-clear" class="secondary http-clear" type="button">Limpar</button><button id="http-send" class="http-send" type="button">Enviar</button></div>
  <div class="error-box" id="http-error" role="alert"></div>
  <div class="http-notice" id="http-notice" role="status"></div>
  <div class="http-layout">
    <section class="http-request" aria-label="Configuração da requisição">
      <div class="http-workspace-title"><h2>Requisição</h2><small>Ctrl/⌘ + Enter para enviar</small></div>
      <div class="http-tabs" role="tablist" aria-label="Dados da requisição" data-http-tabs>
        <button class="http-tab active" type="button" role="tab" aria-selected="true" aria-controls="http-request-params" data-http-tab="http-request-params">Params <span class="http-tab-count" id="http-param-count">0</span></button>
        <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-request-auth" data-http-tab="http-request-auth">Auth</button>
        <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-request-headers" data-http-tab="http-request-headers">Headers <span class="http-tab-count" id="http-header-count">0</span></button>
        <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-request-body" data-http-tab="http-request-body">Body</button>
        <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-request-variables" data-http-tab="http-request-variables">Variáveis <span class="http-tab-count" id="http-variable-count">0</span></button>
      </div>
      <div class="http-section http-tab-panel" id="http-request-params" role="tabpanel">
        <div class="http-section-head"><h3>Query parameters</h3><button id="http-add-param" class="secondary" type="button">+ Parâmetro</button></div>
        <div class="http-kv-labels"><span>Nome</span><span>Valor</span><span></span></div>
        <div id="http-params">${renderHttpKeyValueRow("page", "1")}</div>
      </div>
      <div class="http-section http-tab-panel" id="http-request-auth" role="tabpanel" hidden>
        <div class="http-section-head"><h3>Autenticação</h3></div>
        <label for="http-auth-type">Tipo</label>
        <select class="http-auth-type" id="http-auth-type"><option value="none">Sem autenticação</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api-key">API Key</option></select>
        <div class="http-auth-fields" id="http-auth-none"><p class="http-auth-note">Esta requisição será enviada sem credenciais adicionais.</p></div>
        <div class="http-auth-fields" id="http-auth-bearer" hidden><div><label for="http-auth-bearer-token">Token</label><input id="http-auth-bearer-token" type="password" autocomplete="off" placeholder="{{token}}"></div><small class="hint">Enviado como <code>Authorization: Bearer token</code>.</small></div>
        <div class="http-auth-fields http-auth-grid" id="http-auth-basic" hidden><div><label for="http-auth-basic-user">Usuário</label><input id="http-auth-basic-user" autocomplete="off"></div><div><label for="http-auth-basic-password">Senha</label><input id="http-auth-basic-password" type="password" autocomplete="off"></div></div>
        <div class="http-auth-fields http-auth-grid" id="http-auth-api-key" hidden><div><label for="http-auth-api-key-name">Nome</label><input id="http-auth-api-key-name" placeholder="X-API-Key"></div><div><label for="http-auth-api-key-value">Valor</label><input id="http-auth-api-key-value" type="password" autocomplete="off" placeholder="{{apiKey}}"></div><div><label for="http-auth-api-key-location">Enviar em</label><select id="http-auth-api-key-location"><option value="header">Header</option><option value="query">Query parameter</option></select></div></div>
      </div>
      <div class="http-section http-tab-panel" id="http-request-headers" role="tabpanel" hidden>
        <div class="http-section-head"><h3>Headers enviados</h3><button id="http-add-header" class="secondary" type="button">+ Header</button></div>
        <div class="http-kv-labels"><span>Nome</span><span>Valor</span><span></span></div>
        <div id="http-headers">${renderHttpKeyValueRow("Authorization", "Bearer {{token}}")}</div>
      </div>
      <div class="http-section http-tab-panel" id="http-request-body" role="tabpanel" hidden>
        <div class="http-section-head"><h3>Corpo da requisição</h3><div><span class="http-body-state" id="http-body-state" hidden>Não será enviado com GET/HEAD</span> <button id="http-format-body" class="secondary" type="button">Formatar JSON</button></div></div>
        <textarea id="http-body" rows="10" spellcheck="false" aria-label="Corpo da requisição" placeholder='{"chave":"valor"}'></textarea>
        <small class="hint">JSON válido recebe o header <code>Content-Type: application/json</code> automaticamente.</small>
      </div>
      <div class="http-section http-tab-panel" id="http-request-variables" role="tabpanel" hidden>
        <div class="http-section-head"><h3>Variáveis deste navegador</h3><button id="http-add-variable" class="secondary" type="button">+ Variável</button></div>
        <small class="hint">Use <code>{{nome}}</code> na URL, nos headers ou no body. Os valores ficam salvos somente neste navegador.</small>
        <div class="http-kv-labels"><span>Nome</span><span>Valor</span><span></span></div>
        <div id="http-variables">${renderHttpKeyValueRow("baseUrl", "https://api.exemplo.com")}</div>
      </div>
    </section>
    <section class="http-response-shell" aria-label="Resposta da API">
      <div class="http-workspace-title"><h2>Resposta</h2><div class="http-response-tools"><button id="http-copy-response" class="secondary" type="button" hidden>Copiar body</button></div></div>
      <div class="http-response-empty" id="http-response-empty"><div><i>{ }</i><strong>A resposta aparecerá aqui</strong><span>Informe uma URL e envie a requisição para inspecionar status, tempo, headers e body.</span></div></div>
      <div class="http-response" id="http-response" hidden>
        <div class="http-response-head"><span class="http-status" id="http-response-status"></span><span class="http-response-meta" id="http-response-duration"></span><span class="http-response-meta" id="http-response-size"></span></div>
        <div class="http-tabs" role="tablist" aria-label="Dados da resposta" data-http-tabs>
          <button class="http-tab active" type="button" role="tab" aria-selected="true" aria-controls="http-response-body-panel" data-http-tab="http-response-body-panel">Body</button>
          <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-response-headers-panel" data-http-tab="http-response-headers-panel">Headers</button>
        </div>
        <div class="http-response-panel" id="http-response-body-panel" role="tabpanel"><pre id="http-response-body"></pre></div>
        <div class="http-response-panel" id="http-response-headers-panel" role="tabpanel" hidden><pre id="http-response-headers"></pre></div>
      </div>
    </section>
  </div>
  <section class="http-library">
    <div class="http-tabs" role="tablist" aria-label="Biblioteca de requisições" data-http-tabs>
      <button class="http-tab active" type="button" role="tab" aria-selected="true" aria-controls="http-library-collection" data-http-tab="http-library-collection">Collection</button>
      <button class="http-tab" type="button" role="tab" aria-selected="false" aria-controls="http-library-history" data-http-tab="http-library-history">Histórico <span class="http-tab-count" id="http-history-count">0</span></button>
    </div>
    <div class="http-library-panel http-collection" id="http-library-collection" role="tabpanel">
      <div class="http-collection-head"><div><h2>Collection</h2><p>Salve e recupere requisições frequentes.</p></div><div class="http-collection-save"><input id="http-collection-name" type="text" aria-label="Nome da requisição" placeholder="Nome da requisição"><button id="http-save-request" class="secondary" type="button">Salvar requisição</button></div></div>
      <div class="http-collection-toolbar"><input id="http-collection-search" class="http-collection-search" type="search" aria-label="Buscar na collection" placeholder="Buscar requisição..."><div class="http-import-row"><label class="http-import-label" for="http-collection-import">Importar JSON</label><input id="http-collection-import" type="file" accept=".json,application/json" hidden><button id="http-collection-export" class="secondary" type="button">Exportar JSON</button></div></div>
      <div id="http-collection-list" class="http-collection-list"><p class="hint">Nenhuma requisição salva ainda.</p></div>
    </div>
    <div class="http-library-panel" id="http-library-history" role="tabpanel" hidden>
      <div class="http-history-head"><div><h2>Histórico</h2><p>Últimas 30 requisições executadas neste navegador.</p></div><button id="http-clear-history" class="secondary" type="button">Limpar histórico</button></div>
      <div class="http-history-list" id="http-history-list"><p class="hint">Nenhuma requisição executada ainda.</p></div>
    </div>
  </section>
  <p class="hint http-footnote">As chamadas saem do servidor do QA Radar para evitar bloqueios de CORS e passam pela proteção contra redes privadas. Collections, histórico, variáveis e credenciais ficam somente neste navegador.</p>
</section>`;
}

// Grade do radar. A mesma fórmula posiciona os anéis de referência aqui e os
// vértices dos dados no cliente (que lê estas constantes dos data-* do <svg>),
// para que um eixo com valor 75 caia exatamente sobre o anel do 75.
const RADAR_CENTER = 200;
const RADAR_RADIUS = 180;
const RADAR_FLOOR = 0.2; // fração do raio ocupada pelo valor 0
const RADAR_SPAN = 0.008; // fração do raio ganha por ponto de 0 a 100
const RADAR_AXES = ["http", "performance", "accessibility", "dom", "javascript"] as const;

function radarRadius(value: number): number {
  return RADAR_RADIUS * (RADAR_FLOOR + RADAR_SPAN * Math.max(0, Math.min(100, value)));
}

function radarCoordinate(axisIndex: number, value: number): [number, number] {
  const angle = ((-90 + axisIndex * 72) * Math.PI) / 180;
  const radius = radarRadius(value);
  return [RADAR_CENTER + Math.cos(angle) * radius, RADAR_CENTER + Math.sin(angle) * radius];
}

function renderRadarSvg(): string {
  const round = (value: number) => Number(value.toFixed(1));
  const rings = [100, 75, 50, 25].map((value) => `<circle cx="${RADAR_CENTER}" cy="${RADAR_CENTER}" r="${round(radarRadius(value))}"/>`).join("");
  const spokes = RADAR_AXES.map((_, index) => {
    const [x, y] = radarCoordinate(index, 100);
    return `<line x1="${RADAR_CENTER}" y1="${RADAR_CENTER}" x2="${round(x)}" y2="${round(y)}"/>`;
  }).join("");
  const dots = RADAR_AXES.map((axis) => `<circle class="radar-dot" data-radar-point="${axis}" cx="${RADAR_CENTER}" cy="${RADAR_CENTER}" r="4.5"/>`).join("");
  const labels = [100, 75, 50, 25].map((value) => `<text x="${RADAR_CENTER}" y="${round(RADAR_CENTER - radarRadius(value) + 11)}">${value}</text>`).join("");
  const collapsed = RADAR_AXES.map((_, index) => {
    const [x, y] = radarCoordinate(index, 0);
    return `${round(x)},${round(y)}`;
  }).join(" ");
  return `<svg class="radar-svg" viewBox="0 0 400 400" aria-hidden="true" data-radar-center="${RADAR_CENTER}" data-radar-radius="${RADAR_RADIUS}" data-radar-floor="${RADAR_FLOOR}" data-radar-span="${RADAR_SPAN}"><g class="radar-rings">${rings}</g><g class="radar-spokes">${spokes}</g><polygon class="radar-area" points="${collapsed}"/><g class="radar-dots">${dots}</g><g class="radar-scale">${labels}</g></svg>`;
}

export function renderHome(): string {
  return `${renderWorkspaceStart("home", "Visão geral")}
  <header class="overview-header"><div><h1>Visão geral</h1><p>Panorama da qualidade em tempo real</p></div></header>
  <section class="home-dashboard">
    <div class="dashboard-primary">
      <section class="overview-grid">
      <div class="quality-map">
      <div class="quality-metrics">
        <span class="quality-errors"><small>Erros</small><strong id="dashboard-errors">0</strong><em class="quality-delta" id="dashboard-errors-delta"></em></span>
        <span class="quality-performance"><small>Performance</small><strong id="dashboard-performance">—</strong><em class="quality-delta" id="dashboard-performance-delta"></em></span>
        <span class="quality-warnings"><small>Avisos</small><strong id="dashboard-warnings">0</strong><em class="quality-delta" id="dashboard-warnings-delta"></em></span>
        <span class="quality-accessibility"><small>Acessibilidade</small><strong id="dashboard-accessibility">—</strong><em class="quality-delta" id="dashboard-accessibility-delta"></em></span>
      </div>
      <div class="radar-visual" aria-label="Coberturas observadas pelo QA Radar">
        ${renderRadarSvg()}
        <span class="radar-axis axis-top">HTTP <b id="radar-value-http">—</b></span><span class="radar-axis axis-right">Performance <b id="radar-value-performance">—</b></span><span class="radar-axis axis-bottom-right">Acessibilidade <b id="radar-value-accessibility">—</b></span><span class="radar-axis axis-bottom-left">DOM <b id="radar-value-dom">—</b></span><span class="radar-axis axis-left">JavaScript <b id="radar-value-javascript">—</b></span>
        <div class="radar-center"><div><strong id="dashboard-quality-index">—</strong><span>/100</span></div><small>Índice de qualidade</small><em id="dashboard-quality-label">Sem dados</em></div>
      </div>
      <div class="section-kicker map-legend">Mapa de qualidade</div>
      <p class="map-status"><span class="live-dot"></span> Índice calculado a partir das execuções deste navegador.</p>
      </div>
      <div class="execution-panel">
      <div class="section-kicker">O que deseja executar?</div>
      <div class="execution-list">
        <a class="execution-card" href="/scanner"><span class="execution-icon"><em class="tool-icon icon-overview"><i></i></em></span><span class="execution-copy"><strong>Inspeção</strong><small>Verifique páginas, fluxos e componentes em busca de problemas de qualidade.</small></span><span class="execution-action"><b>Executar inspeção</b><small id="dashboard-last-scan">Sem execuções recentes</small></span></a>
        <a class="execution-card" href="/journeys"><span class="execution-icon"><em class="tool-icon icon-journey"><i></i></em></span><span class="execution-copy"><strong>Jornada</strong><small>Execute fluxos automatizados com Playwright e valide experiências reais.</small></span><span class="execution-action"><b>Executar jornada</b><small id="dashboard-last-journey">Sem execuções recentes</small></span></a>
        <a class="execution-card" href="/api-tests"><span class="execution-icon execution-icon-plain"><em class="tool-icon icon-api"><i></i></em></span><span class="execution-copy"><strong>Testes de API</strong><small>Valide contratos, respostas e regras de negócio das suas APIs.</small></span><span class="execution-action"><b>Executar testes</b><small id="dashboard-last-api">Sem execuções recentes</small></span></a>
      </div>
      <a class="executions-link" href="/em-construcao?area=relatorios">Ver todas as execuções <span>→</span></a>
      </div>
      </section>
      <section class="recent-runs">
        <div class="recent-head"><div class="section-kicker">Execuções recentes <span class="run-count" id="dashboard-run-count">Dados locais</span></div><div class="recent-controls"><div class="dashboard-filters" role="group" aria-label="Filtrar execuções"><button class="active" type="button" data-dashboard-filter="all">Todas</button><button type="button" data-dashboard-filter="scan">Inspeção</button><button type="button" data-dashboard-filter="journey">Jornada</button><button type="button" data-dashboard-filter="api">API</button></div><button class="history-toggle" id="dashboard-history-toggle" type="button" aria-expanded="false" hidden>Ver histórico completo</button></div></div>
        <div class="dashboard-table-head" id="dashboard-table-head" role="row" hidden><span></span><span role="columnheader">Execução</span><span role="columnheader">Ambiente</span><span role="columnheader">Status</span><span role="columnheader">Erros</span><span role="columnheader">Avisos</span><span role="columnheader">Qualidade</span><span role="columnheader">Horário</span><span role="columnheader">Duração</span><span></span></div>
        <div class="dashboard-runs" id="dashboard-recent-list" role="rowgroup"></div>
        <div class="recent-empty" id="dashboard-recent-empty"><span class="icon-overview"><i></i></span><div><strong>Nenhuma execução encontrada</strong><p>Comece por uma inspeção, uma jornada ou uma requisição de API.</p></div><a href="/scanner">Executar agora</a></div>
      </section>
    </div>
    <aside class="live-signal">
      <div class="section-kicker signal-kicker"><span>Sinal ao vivo</span><span class="live-state" id="dashboard-live-state" data-state="connecting" title="Conectando ao sinal ao vivo" aria-live="polite"><span class="live-dot"></span><span class="sr-only">Conectando ao sinal ao vivo</span></span></div>
      <div class="signal-list" id="dashboard-signal-list"></div>
      <div class="signal-empty" id="dashboard-signal-empty"><i>⌁</i><strong>Aguardando execução</strong><p>Erros, avisos e sucessos aparecerão aqui durante as análises.</p></div>
      <a class="signals-link" href="/scanner">Ver todos os sinais <span>→</span></a>
      <a class="quality-center-card" href="/em-construcao?area=central-de-qualidade"><span class="quality-center-icon"><i class="icon-overview"><b></b></i></span><span><strong>Central de qualidade</strong><small>Acompanhe padrões, tendências e a evolução da qualidade do projeto.</small><b>Acessar central <i>→</i></b></span></a>
    </aside>
  </section>
  ${renderWorkspaceEnd()}`;
}

export function renderConstructionPage(area: string): string {
  const slug: ConstructionArea = Object.hasOwn(CONSTRUCTION_AREAS, area) ? (area as ConstructionArea) : "central-de-qualidade";
  const { label, summary } = CONSTRUCTION_AREAS[slug];
  return `${renderWorkspaceStart("construcao", label, slug)}
  <section class="panel construction-panel">
    <span class="construction-mark" aria-hidden="true"><i></i></span>
    <div class="eyebrow">${label}</div>
    <h1>Em construção</h1>
    <p class="lead">${summary}</p>
    <p class="construction-note">Esta área ainda não foi montada. Enquanto isso, as três ferramentas do QA Radar já estão disponíveis e alimentam a Visão geral.</p>
    <div class="construction-actions">
      <a href="/">Voltar para a Visão geral</a>
      <a href="/scanner">Executar uma inspeção</a>
      <a href="/docs">Ver perguntas frequentes</a>
    </div>
  </section>
  ${renderWorkspaceEnd()}`;
}

function faqItem(id: string, question: string, answer: string): string {
  return `<details class="faq-item"${id ? ` id="${id}"` : ""}><summary>${question}</summary><div class="faq-answer">${answer}</div></details>`;
}

export function renderDocs(): string {
  const action = (href: string, label: string, hint: string) => `<div class="docs-action"><a href="${href}">${label}</a><span>${hint}</span></div>`;
  return `${renderWorkspaceStart("docs", "Ajuda")}
  <section class="panel docs-panel">
    <div class="eyebrow">Ajuda · Beta</div>
    <h1>Perguntas frequentes</h1>
    <p class="lead">Respostas rápidas sobre as ferramentas, os resultados e os limites do QA Radar.</p>

    <h2 class="faq-group">Primeiros passos</h2>
    ${faqItem("", "O que o QA Radar faz?", "<p>Ele executa validações de qualidade em aplicações web e reúne o resultado em um painel único. São três ferramentas: <strong>Inspeção</strong> (diagnóstico de uma página), <strong>Jornada</strong> (fluxos automatizados com Playwright) e <strong>Testes de API</strong> (cliente HTTP interativo).</p>")}
    ${faqItem("", "Por onde eu começo?", "<p>Pela Inspeção. Ela não exige configuração nem código: basta informar a URL e executar. O resultado já alimenta o índice de qualidade e o histórico da Visão geral.</p>" + action("/scanner", "Abrir inspeção", "Começar um diagnóstico de aplicação."))}
    ${faqItem("", "Qual ferramenta devo usar em cada caso?", "<p>Depende do que você precisa validar:</p><ul><li><strong>Inspeção</strong> — a página carrega sem erros de JavaScript, rede, DOM ou acessibilidade?</li><li><strong>Jornada</strong> — o fluxo completo funciona (login, carrinho, checkout)?</li><li><strong>Testes de API</strong> — o endpoint responde o status, o corpo e os headers esperados?</li></ul>")}

    <h2 class="faq-group">Ferramentas</h2>
    ${faqItem("inspecao", "O que a Inspeção analisa?", "<p>Ela abre a URL em um navegador real e observa o carregamento sem clicar em nada nem enviar formulários. Cobre erros de JavaScript, requisições de rede com falha, problemas de DOM, acessibilidade (via axe-core, quando ativado) e métricas de performance como TTFB, LCP e CLS.</p>" + action("/scanner", "Abrir inspeção", "Começar um diagnóstico de aplicação."))}
    ${faqItem("", "A Inspeção consegue testar telas que exigem login?", "<p>Não. Ela analisa a página informada sem interagir com ela, então não faz login, cliques nem preenchimento de formulários. Para isso use a Jornada, que executa um fluxo real com Playwright.</p>")}
    ${faqItem("jornada", "Como funciona o Modo Jornada de Playwright?", "<p>Você grava o fluxo no navegador com o Playwright Codegen, revisa o código gerado e executa. Também dá para importar, editar e exportar arquivos oficiais <code>.spec.ts</code> — é Playwright de verdade, sem formato proprietário.</p><p>A execução hospedada roda sobre infraestrutura isolada, com limites de recursos e proteção de credenciais.</p>" + action("/journeys", "Abrir Jornada Playwright", "Trabalhar diretamente com Playwright TypeScript."))}
    ${faqItem("", "Preciso saber programar para usar a Jornada?", "<p>Para gravar, não: o Codegen escreve o código enquanto você navega. Para ajustar asserções ou reaproveitar trechos, é útil conhecer TypeScript básico — o arquivo fica aberto para edição antes de executar.</p>")}
    ${faqItem("api", "Como testo uma API?", "<p>Pelo cliente HTTP interativo, no estilo Postman: escolha o método, informe a URL, monte headers e corpo, envie e veja status, tempo, tamanho, headers e body na hora — sem escrever código nem esperar um job rodar.</p>" + action("/api-tests", "Abrir Testes de API", "Enviar requisições e organizar uma collection."))}
    ${faqItem("", "Dá para reaproveitar token e URL base entre requisições?", "<p>Sim. Cadastre variáveis na aba <strong>Variáveis</strong> e use <code>{{nome}}</code> na URL, nos headers ou no corpo. As requisições que você usa com frequência podem ser salvas na Collection, que exporta e importa em JSON.</p>")}
    ${faqItem("", "Por que as chamadas de API saem do servidor e não do meu navegador?", "<p>Para evitar bloqueios de CORS, que impediriam testar boa parte das APIs direto do navegador. As chamadas passam pela mesma proteção contra redes privadas aplicada ao restante do produto.</p>")}

    <h2 class="faq-group">Resultados e dados</h2>
    ${faqItem("relatorios", "Onde vejo os relatórios das execuções?", "<p>Cada execução aparece em <strong>Execuções recentes</strong>, na Visão geral — clique na linha para abrir o resultado completo. A Inspeção gera relatório em HTML (leitura e compartilhamento) e em JSON (integração com CI), e a Jornada gera evidências em HTML com o passo a passo.</p>")}
    ${faqItem("central-de-qualidade", "O que é o índice de qualidade?", "<p>É a nota de 0 a 100 no centro do radar. Ela é a média de cinco eixos — HTTP, performance, acessibilidade, DOM e JavaScript — calculada sobre as execuções mais recentes. Acima de 85 é <em>Excelente</em>; de 70 a 84, <em>Estável</em>; de 50 a 69, <em>Atenção</em>; abaixo disso, <em>Crítico</em>.</p><p>Os quatro números ao redor do radar comparam as últimas 24h com as 24h anteriores — a seta indica se o indicador melhorou ou piorou.</p>")}
    ${faqItem("", "Onde ficam salvos os meus dados?", "<p>O histórico do painel fica no seu navegador e também no servidor, associado à sua sessão, limitado às 40 execuções mais recentes. Collections, variáveis e credenciais dos Testes de API <strong>nunca saem do navegador</strong> — não são enviadas ao servidor.</p>")}

    <h2 class="faq-group">Configuração</h2>
    ${faqItem("ambientes", "Como separo staging de produção?", "<p>Na Inspeção, use os campos <strong>Projeto</strong> e <strong>Ambiente</strong>. Eles mantêm o histórico e o baseline separados por ambiente, de modo que uma análise de staging não interfira na de produção. Os campos ficam disponíveis quando o histórico está habilitado no servidor.</p>")}
    ${faqItem("alertas", "Dá para receber alertas quando algo falha?", "<p>Ainda não nesta Beta. Hoje o acompanhamento é pelo painel: o <strong>Sinal ao vivo</strong> mostra erros, avisos e sucessos conforme as análises acontecem, em tempo real.</p><p>Para bloquear uma entrega automaticamente, use o quality gate: o campo <strong>Reprovar a partir de</strong> define se a execução falha por erros, por avisos ou nunca — e o código de saída pode ser lido pela sua CI.</p>")}
    ${faqItem("configuracoes", "Onde ficam as configurações?", "<p>As opções de execução ficam na própria Inspeção, em <strong>Configurações avançadas</strong>: timeout, tempo de observação, status HTTP ignorados e política de screenshot. Configurações de servidor (histórico, limite de páginas do sitemap, execução de código) são definidas por variáveis de ambiente na implantação.</p>")}

    <h2 class="faq-group">Limites</h2>
    ${faqItem("", "Posso analisar localhost ou uma rede interna?", "<p>Não na versão pública: endereços locais e faixas de rede privada são bloqueados por segurança. O alvo precisa ser um endereço público iniciado por <code>http://</code> ou <code>https://</code>. Em uma implantação própria, dentro da sua rede, essa restrição pode ser ajustada.</p>")}
    ${faqItem("", "Quais são os limites desta Beta?", "<p>Os resultados são heurísticos: apontam sinais de problema, mas não substituem testes funcionais completos, exploração manual nem dados reais de uso. A Inspeção cobre a página informada (ou o sitemap, quando ativado) sem interagir com ela, e o histórico guarda as 40 execuções mais recentes.</p>")}
  </section>
  ${renderWorkspaceEnd()}`;
}
