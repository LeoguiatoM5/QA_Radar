export type NavSection = "home" | "scanner" | "journeys" | "api" | "aplicacoes" | "toolbox" | "relatorios" | "qualidade" | "alertas" | "configuracoes" | "docs";

/** Ambientes oferecidos no seletor da barra de contexto. */
export const ENVIRONMENTS = [
  { slug: "local", label: "Local" },
  { slug: "homologacao", label: "Homologação" },
  { slug: "producao", label: "Produção" },
] as const;

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
        <div class="application-picker" id="application-picker" hidden><label for="scan-application">Aplicação</label><select id="scan-application" name="applicationId"><option value="">Sem aplicação</option></select><small class="hint">Escolha uma aplicação da sua conta para guardar esta análise no histórico dela. <a href="/aplicacoes">Gerenciar aplicações</a></small></div>
        <label for="url">URL da aplicação</label><div class="url-row"><span aria-hidden="true">⌁</span><input id="url" name="url" type="url" placeholder="https://staging.sua-aplicacao.com" required autofocus></div><small class="hint">Endereço público iniciado por http:// ou https://. Ambientes locais e redes privadas são bloqueados na versão pública.</small>
        <div class="row"><div><label for="browser">Navegador</label><select id="browser" name="browser"><option>chromium</option><option>firefox</option><option>webkit</option></select><small class="hint">Motor usado para abrir e observar a página.</small></div><div><label for="failOn">Reprovar a partir de</label><select id="failOn" name="failOn"><option value="error">Erros</option><option value="warning">Avisos</option><option value="none">Nunca</option></select><small class="hint">Define quando o resultado será marcado como reprovado.</small></div></div>
        <div class="row"><div><label for="project">Projeto</label><input id="project" name="project" placeholder="loja-web" ${allowHistory ? "" : "disabled"}><small class="hint">${allowHistory ? "Ativa histórico e baseline automático." : "Histórico por projeto desabilitado neste servidor — para guardar a análise no histórico da sua conta, use Aplicação, acima."}</small></div><div><label for="environment">Ambiente</label><input id="environment" name="environment" value="staging" ${allowHistory ? "" : "disabled"}><small class="hint">Separa staging, produção e outros ambientes.</small></div></div>
        <div class="row"><div class="option"><input id="sitemap" name="sitemap" type="checkbox"><div><label for="sitemap">Cobrir sitemap.xml</label><small class="hint">Analisa até ${maxSitemapPages} páginas do mesmo domínio.</small></div></div><div><label for="maxPages">Máximo de páginas</label><input id="maxPages" name="maxPages" type="number" min="1" max="${maxSitemapPages}" value="${defaultMaxPages}"><small class="hint">Execução sequencial para controlar recursos.</small></div></div>
        <div class="option"><input id="accessibility" name="accessibility" type="checkbox"><div><label for="accessibility">Auditoria de acessibilidade com axe-core</label><small class="hint">Ative para incluir regras WCAG no diagnóstico e no quality gate.</small></div></div>
        ${allowHistory ? '<div class="row"><div class="option"><input id="regressionsOnly" name="regressionsOnly" type="checkbox"><div><label for="regressionsOnly">Somente regressões</label><small class="hint">Problemas existentes não reprovam novamente.</small></div></div><div class="option"><input id="acceptBaseline" name="acceptBaseline" type="checkbox"><div><label for="acceptBaseline">Aceitar como baseline</label><small class="hint">Use apenas após revisar o resultado.</small></div></div></div>' : ""}
        <details class="advanced"><summary>Configurações avançadas</summary><div class="row"><div><label for="timeoutMs">Timeout (ms)</label><input id="timeoutMs" name="timeoutMs" type="number" min="1000" max="120000" value="30000"><small class="hint">Tempo máximo para abrir a página.</small></div><div><label for="settleMs">Observação (ms)</label><input id="settleMs" name="settleMs" type="number" min="0" max="30000" value="2000"><small class="hint">Tempo extra para capturar falhas após o carregamento.</small></div></div><label for="ignoredStatuses">Status ignorados</label><input id="ignoredStatuses" name="ignoredStatuses" placeholder="401,404"><small class="hint">Códigos HTTP separados por vírgula que não devem virar ocorrências.</small><label for="ignoredUrl">Ignorar URLs (regex)</label><input id="ignoredUrl" name="ignoredUrl" placeholder="Indisponível na Beta pública" disabled><small class="hint">Filtros personalizados estão desabilitados no servidor público por segurança.</small><label for="screenshot">Screenshot</label><select id="screenshot" name="screenshot"><option value="on-failure">Quando reprovar</option><option value="always">Sempre</option><option value="never">Nunca</option></select><small class="hint">“Sempre” inclui evidência visual mesmo quando a análise é aprovada.</small></details>
        ${turnstileWidget}<button id="submit" type="submit">Executar scanner</button>${historyWidget}<div class="error-box" id="error"></div>
      </div>
      <section class="help-panel" id="help-panel" role="tabpanel" aria-labelledby="help-tab" hidden><h2>Como o QA Radar funciona</h2><p class="sub">Um guia rápido para configurar e interpretar sua análise.</p><div class="help-grid"><div class="help-item"><h3>1. Informe a URL</h3><p>O scanner abre a página em um navegador real e observa o carregamento, o DOM, o console e as requisições de rede.</p></div><div class="help-item"><h3>2. Escolha o quality gate</h3><p>“Erros” reprova apenas problemas críticos. “Avisos” exige uma análise totalmente limpa. “Nunca” apenas informa os achados.</p></div><div class="help-item"><h3>3. Configure a evidência</h3><p>“Quando reprovar” captura screenshot apenas se o quality gate falhar. Use “Sempre” para gerar evidência visual em toda execução.</p></div><div class="help-item"><h3>4. Entenda o diagnóstico</h3><p>Cada ocorrência apresenta categoria, impacto para o usuário, recomendação, detalhe técnico e, quando possível, o elemento relacionado.</p></div><div class="help-item"><h3>5. Use os relatórios</h3><p>O HTML facilita a leitura e o compartilhamento. O JSON permite integrações e automações. O download (HTML, JSON, screenshot) fica disponível por um tempo limitado; o resultado em si — status, contagens, ocorrências — permanece no histórico da conta, em Relatórios.</p></div><div class="help-item"><h3>Limites da Beta</h3><p>A análise cobre a página informada, mas ainda não realiza login, cliques, formulários ou jornadas completas automaticamente.</p></div></div></section>
    </form>`;
}

export function renderResultsPanel(): string {
  return `<section class="results" id="results"><div class="result-head"><div><div class="eyebrow">Resultado da análise</div><h2 id="result-title">Analisando aplicação</h2><div class="comparison" id="comparison"></div><div class="progress" id="progress"><span id="progress-text">Preparando análise…</span><div class="progress-track"><div class="progress-bar" id="progress-bar"></div></div></div></div><div><span class="status running" id="status"><i class="loader"></i>Executando</span><button class="cancel" id="cancel" type="button" hidden>Cancelar</button></div></div><div class="metrics"><div class="metric"><small>Erros</small><strong id="errors">—</strong></div><div class="metric"><small>Avisos</small><strong id="warnings">—</strong></div><div class="metric"><small>HTTP principal</small><strong id="http">—</strong></div><div class="metric"><small>Duração</small><strong id="duration">—</strong></div><div class="metric"><small>TTFB</small><strong id="ttfb">—</strong></div><div class="metric"><small>LCP</small><strong id="lcp">—</strong></div><div class="metric"><small>CLS</small><strong id="cls">—</strong></div><div class="metric"><small>Páginas</small><strong id="pages">1</strong></div></div><div class="issues" id="issues"><div class="issue issue-note"><div class="message">O navegador está carregando e observando a página…</div></div></div><div class="actions" id="actions"></div><iframe id="report-frame" title="Relatório completo" hidden></iframe></section>`;
}

export function renderDashboard(options: DashboardOptions): string {
  return `${renderWorkspaceStart("scanner", "Inspeção")}
  ${renderToolHeader("Scanner", "Inspeção", "Informe a URL e ajuste os critérios da análise.")}
  <section class="tool-layout">${renderScannerForm(options)}</section>
  ${renderResultsPanel()}
  ${renderWorkspaceEnd()}`;
}

function renderAppNav(active: NavSection): string {
  const link = (id: NavSection, label: string, href: string, icon: string) =>
    `<a class="nav-link ${active === id ? "active" : ""}" href="${href}"${active === id ? ' aria-current="page"' : ""}><span class="nav-icon icon-${icon}" aria-hidden="true"><i></i></span><span>${label}</span></a>`;
  return `<aside class="app-sidebar">
    <div class="sidebar-brand"><a class="logo" href="/"><i class="radar"></i><span>QA RADAR</span></a><button class="mobile-nav-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Abrir menu"><i></i></button></div>
    <nav class="nav-links" id="primary-navigation" aria-label="Navegação principal">
      <div class="nav-group">
        ${link("home", "Visão geral", "/", "overview")}
        ${link("scanner", "Inspeção", "/scanner", "inspection")}
        ${link("journeys", "Jornada", "/journeys", "journey")}
        ${link("api", "Testes de API", "/api-tests", "api")}
        ${link("aplicacoes", "Aplicações", "/aplicacoes", "environments")}
        ${link("toolbox", "QA Toolbox", "/toolbox", "toolbox")}
        ${link("relatorios", "Relatórios", "/relatorios", "reports")}
        ${link("qualidade", "Central de qualidade", "/central-de-qualidade", "quality")}
        ${link("alertas", "Alertas", "/alertas", "alerts")}
        ${link("configuracoes", "Configurações", "/configuracoes", "settings")}
      </div>
    </nav>
    <a class="sidebar-help ${active === "docs" ? "active" : ""}" href="/docs"><span class="help-mark">?</span><span>Ajuda</span></a>
  </aside>`;
}

/**
 * Controle de conta da barra superior.
 *
 * Começa oculto e o cliente decide o que mostrar a partir de
 * `GET /api/v1/auth/me`: sem login configurado no servidor nada aparece, e o
 * produto continua anônimo como sempre.
 */
function renderAccountControl(): string {
  // Aponta para /entrar, e não direto para o GitHub: o provedor externo virou um
  // dos caminhos de entrada, e quem não tem conta precisa achar o cadastro.
  return `<div class="context-account" id="account-control" hidden><a class="account-signin" id="account-signin" href="/entrar" hidden>Entrar</a><div class="account-user" id="account-user" hidden><img class="account-avatar" id="account-avatar" alt="" width="26" height="26" hidden><span class="account-avatar account-avatar-fallback" id="account-avatar-fallback" aria-hidden="true" hidden></span><span class="account-login" id="account-login"></span><button type="button" class="account-signout" id="account-signout">Sair</button></div></div>`;
}

/**
 * Aviso de e-mail ainda não confirmado.
 *
 * Fica no topo de toda página e só aparece pelo `/auth/me`. Não bloqueia nada de
 * propósito: exigir confirmação para usar o produto deixaria quem não recebeu a
 * mensagem — caixa de spam, provedor lento — parado sem ter o que fazer.
 */
function renderVerifyBanner(): string {
  return `<div class="verify-banner" id="verify-banner" hidden><span>Confirme seu e-mail para poder recuperar a senha depois.</span><button type="button" id="verify-resend">Reenviar</button><span class="verify-state" id="verify-state" hidden></span></div>`;
}

export function renderWorkspaceStart(active: NavSection, section: string): string {
  return `<main class="shell ${active === "home" ? "home-shell" : ""}">
  ${renderAppNav(active)}
  <div class="app-main">
    <header class="context-bar">
      <div class="context-item context-project"><small>Projeto</small><strong>QA Radar Web</strong></div>
      <div class="context-item context-environment" data-environment="local"><small>Ambiente</small><strong><span class="live-dot"></span><span id="context-environment-label">Local</span></strong><select id="context-environment" aria-label="Ambiente do projeto">${ENVIRONMENTS.map((environment) => `<option value="${environment.slug}">${environment.label}</option>`).join("")}</select></div>
      <div class="context-section"><span class="context-page">${section}</span><span class="context-clock"><i aria-hidden="true"></i><time id="context-clock" datetime="">--/--/---- --:--</time></span><span class="context-period" title="Janela usada nos indicadores do dashboard">Últimas 24h</span>${renderAccountControl()}</div>
    </header>
    ${renderVerifyBanner()}
    <div class="app-page app-page-${active}">`;
}

export function renderWorkspaceEnd(): string {
  return `<footer>&copy; 2026 QA Radar · Qualidade visível, decisões mais rápidas.</footer>
    </div>
  </div>
</main>`;
}

export function renderToolHeader(eyebrow: string, title: string, description: string): string {
  return `<header class="tool-header"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></header>`;
}

export function renderJourneyPage(allowCodeMode: boolean): string {
  const enabled = allowCodeMode;
  return `${renderWorkspaceStart("journeys", "Jornada")}
  ${
    enabled
      ? `${renderToolHeader("Automação Playwright", "Modo Jornada de Playwright", "Grave, revise e execute jornadas Playwright em TypeScript.")}<section class="journey-workspace">${renderCodePanel()}</section>${renderEvidenceModal()}`
      : `<section class="panel"><div class="eyebrow">Modo Jornada de Playwright</div><h1>Execução desligada neste servidor</h1><p class="lead">A Jornada executa o código Playwright que você escreve. Neste servidor a execução está desligada — ligá-la sem isolamento deixaria qualquer visitante rodar código na máquina.</p>
    <h2 class="journey-setup-title">Para usar agora</h2>
    <p>Rode o QA Radar na sua máquina: em <code>localhost</code> a execução vem habilitada por padrão, com o gravador Codegen e o navegador visível.</p>
    <pre class="journey-setup"><code>npm install
npm run web   # abre em http://localhost:4173/journeys</code></pre>
    <h2 class="journey-setup-title">Para habilitar neste servidor</h2>
    <p>É preciso um runner sandbox dedicado — o servidor recusa execução hospedada sem ele, sem cair para o worker local:</p>
    <ul class="journey-setup-list">
      <li><code>QA_RADAR_ENABLE_CODE_MODE=true</code></li>
      <li><code>QA_RADAR_SANDBOX_URL</code> (HTTPS) e <code>QA_RADAR_SANDBOX_SIGNING_SECRET</code> apontando para o runner isolado</li>
      <li><code>QA_RADAR_CODE_MODE_ADMIN_TOKEN</code>, exigido como Bearer em toda execução remota</li>
    </ul>
    <div class="construction-actions"><a href="/docs">Ver perguntas frequentes</a><a href="/scanner">Executar uma inspeção</a><a href="/">Voltar para a Visão geral</a></div></section>`
  }
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
  return `<section class="panel" id="code-mode-panel"><div class="eyebrow">Jornada Playwright</div><h2>Teste Playwright em TypeScript</h2><p class="sub">Grave o fluxo no navegador, revise o código oficial e execute a jornada no ambiente configurado.</p><div class="code-flow"><span><b>1</b>Gravar</span><span><b>2</b>Revisar</span><span><b>3</b>Executar</span></div><label for="codegen-url">URL inicial da gravação</label><input id="codegen-url" type="url" placeholder="https://staging.sua-aplicacao.com"><div class="journey-controls"><button id="codegen-start" type="button">Abrir gravador</button><button id="codegen-stop" class="secondary" type="button" disabled>Usar código gravado</button></div><div class="error-box" id="codegen-error"></div><div class="code-editor-head"><div><label for="playwright-code">Arquivo Playwright</label><small>qa-radar.spec.ts</small></div><label class="code-import" for="code-import">Importar arquivo</label><input id="code-import" type="file" accept=".ts,.spec.ts" hidden></div><textarea id="playwright-code" rows="18" spellcheck="false" aria-label="Código do teste Playwright" placeholder="import { test, expect } from '@playwright/test';"></textarea><div class="application-picker" id="journey-application-picker" hidden><label for="journey-application">Aplicação</label><select id="journey-application" name="applicationId"><option value="">Sem aplicação</option></select><small class="hint">Escolha uma aplicação da sua conta para guardar esta execução no histórico dela. <a href="/aplicacoes">Gerenciar aplicações</a></small></div><div class="journey-controls code-actions"><button id="code-save" class="secondary" type="button">Exportar .spec.ts</button><button id="code-execute" type="button">Executar</button></div><div class="journey-admin" id="journey-signin" hidden><div class="error-box" id="journey-signin-error" role="alert"></div><label>Entre para executar</label><small class="hint">A execução da jornada neste servidor exige uma conta. Entrar leva um clique e mantém suas execuções reunidas no seu histórico.</small><div class="journey-admin-row"><a class="button" id="journey-signin-link" href="/entrar">Entrar ou criar conta</a></div></div><div id="code-result" hidden aria-live="polite"></div><p class="hint">Este recurso executa código informado pelo usuário. Revise o arquivo antes de executar.</p></section>`;
}

function renderHttpKeyValueRow(keyPlaceholder: string, valuePlaceholder: string): string {
  return `<div class="http-kv-row"><input type="text" class="http-kv-key" aria-label="Nome" placeholder="${keyPlaceholder}"><input type="text" class="http-kv-value" aria-label="Valor" placeholder="${valuePlaceholder}"><button type="button" class="secondary http-kv-remove" aria-label="Remover">×</button></div>`;
}

function renderApiPanel(): string {
  return `<section class="panel" id="http-client-panel">
  <div class="http-request-line"><select id="http-method" aria-label="Método HTTP"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option></select><input id="http-url" type="text" inputmode="url" aria-label="URL da requisição" placeholder="https://api.exemplo.com/recurso ou {{baseUrl}}/recurso" required><button id="http-clear" class="secondary http-clear" type="button">Limpar</button><button id="http-send" class="http-send" type="button">Enviar</button></div>
  <div class="application-picker http-application-picker" id="api-application-picker" hidden><label for="api-application">Aplicação</label><select id="api-application" name="applicationId"><option value="">Somente neste navegador</option></select><small class="hint" id="api-application-hint">Escolha uma aplicação para guardar esta collection na sua conta e registrar as execuções no histórico dela. É esta escolha que decide se a execução entra no histórico de <a href="/relatorios">Relatórios</a>. <a href="/aplicacoes">Gerenciar aplicações</a></small></div>
  <div class="http-shared-warning" id="api-shared-warning" hidden role="status"><b>Esta collection está na sua conta.</b> Sobem nome, método, URL, params, headers e body. <b>Não sobem</b> os valores de Authorization, API key, senha e token — nem na query. Guarde credencial em <b>Variáveis</b>, que continuam só neste navegador, e referencie com <code>{{nome}}</code>.</div>
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
  <p class="hint http-footnote">As chamadas saem do servidor do QA Radar para evitar bloqueios de CORS e passam pela proteção contra redes privadas. Sem aplicação escolhida, tudo fica somente neste navegador. Com uma aplicação escolhida, a collection e o histórico de execuções ficam na sua conta — <b>credenciais e variáveis nunca sobem</b>.</p>
</section>`;
}

// Grade do radar. A mesma fórmula posiciona os anéis de referência aqui e os
// vértices dos dados no cliente (que lê estas constantes dos data-* do <svg>),
// para que um eixo com valor 75 caia exatamente sobre o anel do 75.
const RADAR_CENTER = 200;
const RADAR_RADIUS = 156;
// Distância do rótulo do eixo ao centro: fora do anel de 100, dentro do viewBox.
const RADAR_LABEL_RADIUS = 178;
const RADAR_FLOOR = 0.2; // fração do raio ocupada pelo valor 0
const RADAR_SPAN = 0.008; // fração do raio ganha por ponto de 0 a 100
const RADAR_AXES = ["http", "performance", "accessibility", "dom", "javascript"] as const;

/**
 * Rótulo visível de cada eixo, na ordem em que o polígono é desenhado.
 *
 * O radar plotava cinco vértices sem dizer o que era cada um, e os quatro
 * números nos cantos do painel são outras métricas — quem olhava lia um deles
 * como se fosse o vértice ao lado. Nomear o eixo é o que torna o gráfico
 * legível.
 */
const RADAR_AXIS_LABELS: Record<(typeof RADAR_AXES)[number], string> = {
  http: "HTTP",
  performance: "Performance",
  accessibility: "Acessibilidade",
  dom: "DOM",
  javascript: "JavaScript",
};

// O texto foge do vértice para não cobrir o polígono: acima no topo, à esquerda
// do próprio ponto do lado direito e à direita do lado esquerdo.
const RADAR_LABEL_PLACEMENT: Record<(typeof RADAR_AXES)[number], { anchor: string; dy: number }> = {
  http: { anchor: "middle", dy: -6 },
  performance: { anchor: "end", dy: 0 },
  accessibility: { anchor: "end", dy: 12 },
  dom: { anchor: "start", dy: 12 },
  javascript: { anchor: "start", dy: 0 },
};

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
  const axisLabels = RADAR_AXES.map((axis, index) => {
    const angle = ((-90 + index * 72) * Math.PI) / 180;
    const x = RADAR_CENTER + Math.cos(angle) * RADAR_LABEL_RADIUS;
    const placement = RADAR_LABEL_PLACEMENT[axis];
    const y = RADAR_CENTER + Math.sin(angle) * RADAR_LABEL_RADIUS + placement.dy;
    return `<text x="${round(x)}" y="${round(y)}" text-anchor="${placement.anchor}">${RADAR_AXIS_LABELS[axis]} <tspan class="radar-label-value" id="radar-value-${axis}">—</tspan></text>`;
  }).join("");
  const collapsed = RADAR_AXES.map((_, index) => {
    const [x, y] = radarCoordinate(index, 0);
    return `${round(x)},${round(y)}`;
  }).join(" ");
  return `<svg class="radar-svg" viewBox="0 0 400 400" aria-hidden="true" data-radar-center="${RADAR_CENTER}" data-radar-radius="${RADAR_RADIUS}" data-radar-floor="${RADAR_FLOOR}" data-radar-span="${RADAR_SPAN}"><g class="radar-rings">${rings}</g><g class="radar-spokes">${spokes}</g><polygon class="radar-area" points="${collapsed}"/><g class="radar-dots">${dots}</g><g class="radar-scale">${labels}</g><g class="radar-labels">${axisLabels}</g></svg>`;
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
        <span class="quality-warnings"><small>Avisos</small><strong id="dashboard-warnings">0</strong><em class="quality-delta" id="dashboard-warnings-delta"></em></span>
      </div>
      <div class="radar-visual" aria-label="Coberturas observadas pelo QA Radar">
        ${renderRadarSvg()}
        <div class="radar-center"><div><strong id="dashboard-quality-index">—</strong><span>/100</span></div><small>Índice de qualidade</small><em id="dashboard-quality-label">Sem dados</em></div>
      </div>
      <h2 class="section-kicker map-legend">Mapa de qualidade</h2>
      <p class="map-status"><span class="live-dot"></span> Índice calculado a partir das execuções deste navegador.</p>
      </div>
      <div class="execution-panel">
      <h2 class="section-kicker">O que deseja executar?</h2>
      <div class="execution-list">
        <a class="execution-card" href="/scanner"><span class="execution-icon"><em class="tool-icon icon-overview"><i></i></em></span><span class="execution-copy"><strong>Inspeção</strong><small>Verifique páginas, fluxos e componentes em busca de problemas de qualidade.</small></span><span class="execution-action"><b>Executar inspeção</b><small id="dashboard-last-scan">Sem execuções recentes</small></span></a>
        <a class="execution-card" href="/journeys"><span class="execution-icon"><em class="tool-icon icon-journey"><i></i></em></span><span class="execution-copy"><strong>Jornada</strong><small>Execute fluxos automatizados com Playwright e valide experiências reais.</small></span><span class="execution-action"><b>Executar jornada</b><small id="dashboard-last-journey">Sem execuções recentes</small></span></a>
        <a class="execution-card" href="/api-tests"><span class="execution-icon execution-icon-plain"><em class="tool-icon icon-api"><i></i></em></span><span class="execution-copy"><strong>Testes de API</strong><small>Valide contratos, respostas e regras de negócio das suas APIs.</small></span><span class="execution-action"><b>Executar testes</b><small id="dashboard-last-api">Sem execuções recentes</small></span></a>
      </div>
      <a class="executions-link" href="/relatorios">Ver todas as execuções <span>→</span></a>
      </div>
      </section>
      <section class="recent-runs">
        <div class="recent-head"><h2 class="section-kicker">Execuções recentes <span class="run-count" id="dashboard-run-count">Dados locais</span><span class="run-source" id="dashboard-source" hidden>Da sua conta</span></h2><div class="recent-controls"><div class="dashboard-filters" role="group" aria-label="Filtrar execuções"><button class="active" type="button" data-dashboard-filter="all">Todas</button><button type="button" data-dashboard-filter="scan">Inspeção</button><button type="button" data-dashboard-filter="journey">Jornada</button><button type="button" data-dashboard-filter="api">API</button></div><button class="history-toggle" id="dashboard-history-toggle" type="button" aria-expanded="false" hidden>Ver histórico completo</button><button class="history-clear" id="dashboard-clear" type="button" hidden>Limpar histórico</button></div></div>
        <div class="dashboard-runs" id="dashboard-recent-list"></div>
        <div class="recent-empty" id="dashboard-recent-empty"><span class="icon-overview"><i></i></span><div><strong>Nenhuma execução encontrada</strong><p>Comece por uma inspeção, uma jornada ou uma requisição de API.</p></div><a href="/scanner">Executar agora</a></div>
      </section>
    </div>
    <aside class="live-signal">
      <h2 class="section-kicker signal-kicker"><span>Sinal ao vivo</span><span class="live-state" id="dashboard-live-state" data-state="connecting" title="Conectando ao sinal ao vivo" aria-live="polite"><span class="live-dot"></span><span class="sr-only">Conectando ao sinal ao vivo</span></span></h2>
      <div class="signal-list" id="dashboard-signal-list"></div>
      <div class="signal-empty" id="dashboard-signal-empty"><i aria-hidden="true">⌁</i><strong>Aguardando execução</strong><p>Erros, avisos e sucessos aparecerão aqui durante as análises.</p></div>
      <a class="signals-link" href="/scanner">Ver todos os sinais <span>→</span></a>
      <a class="quality-center-card" href="/central-de-qualidade"><span class="quality-center-icon"><i class="icon-overview"><b></b></i></span><span><strong>Central de qualidade</strong><small>Acompanhe padrões, tendências e a evolução da qualidade do projeto.</small><b>Acessar central <i>→</i></b></span></a>
    </aside>
  </section>
  ${renderWorkspaceEnd()}`;
}

/**
 * Aplicações da conta.
 *
 * Tudo nasce vazio e é preenchido pelo cliente: a página é servida igual para
 * todo mundo, então nenhum dado de conta pode vir no HTML — o servidor não sabe
 * quem pediu no momento em que monta o documento, e cravar dados aqui os deixaria
 * no cache de qualquer intermediário.
 */
export function renderApplicationsPage(): string {
  return `${renderWorkspaceStart("aplicacoes", "Aplicações")}
  ${renderToolHeader("Cadastro", "Aplicações", "Dê nome ao que você testa. Cada análise fica guardada na aplicação certa, dentro da sua conta.")}
  <section class="tool-layout applications-layout">
    <form class="panel" id="application-form" novalidate>
      <h2 id="application-form-title">Nova aplicação</h2>
      <p class="sub">Um apelido e o endereço onde ela roda.</p>
      <p class="form-unavailable" id="application-unavailable" hidden></p>
      <input type="hidden" id="application-id">
      <label for="application-name">Nome</label>
      <input id="application-name" maxlength="60" placeholder="Loja Web" required>
      <small class="hint">Como você reconhece essa aplicação. Único dentro da sua conta.</small>
      <label for="application-base-url">URL base</label>
      <input id="application-base-url" type="url" placeholder="https://loja.exemplo.com" required>
      <small class="hint">Endereço público iniciado por http:// ou https://. Endereços locais e redes privadas são bloqueados.</small>
      <label for="application-environments">Ambientes</label>
      <input id="application-environments" placeholder="staging, produção" maxlength="200">
      <small class="hint">Separados por vírgula. Opcional.</small>
      <div class="journey-controls">
        <button id="application-submit" type="submit">Cadastrar aplicação</button>
        <button id="application-cancel" class="secondary" type="button" hidden>Cancelar edição</button>
      </div>
      <div class="error-box" id="application-error"></div>
    </form>

    <section class="panel" id="application-list-panel">
      <h2>Suas aplicações</h2>
      <p class="sub" id="application-list-hint">Carregando...</p>
      <div class="application-list" id="application-list"></div>
    </section>
  </section>
  ${renderWorkspaceEnd()}`;
}

/**
 * Relatórios: a linha do tempo consultável das três origens.
 *
 * Os filtros nascem no HTML e não são montados pelo cliente porque a página tem
 * de ser legível — e navegável por teclado — antes de qualquer JavaScript rodar.
 * O que o cliente preenche é o seletor de aplicação, que depende da conta.
 */
export function renderReportsPage(): string {
  return `${renderWorkspaceStart("relatorios", "Relatórios")}
  ${renderToolHeader("Histórico", "Relatórios", "Tudo o que rodou na sua conta, em uma linha do tempo só: Inspeção, Jornada e Testes de API.")}
  <section class="tool-layout reports-layout">
    <p class="form-unavailable" id="reports-unavailable" hidden></p>
    <section class="panel reports-filters" aria-label="Filtros do histórico">
      <div class="reports-filter-grid">
        <div class="tool-field">
          <label for="reports-application">Aplicação</label>
          <select id="reports-application"><option value="">Todas</option></select>
        </div>
        <div class="tool-field">
          <label for="reports-kind">Tipo</label>
          <select id="reports-kind">
            <option value="">Todos</option>
            <option value="scan">Inspeção</option>
            <option value="journey">Jornada</option>
            <option value="api">Teste de API</option>
          </select>
        </div>
        <div class="tool-field">
          <label for="reports-period">Período</label>
          <select id="reports-period">
            <option value="7">Últimos 7 dias</option>
            <option value="30" selected>Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="">Desde o começo</option>
          </select>
        </div>
        <div class="tool-field">
          <label for="reports-search">Buscar</label>
          <input id="reports-search" type="search" placeholder="URL, nome do teste, rota...">
        </div>
      </div>
      <small class="hint">A busca refina o que já está carregado. Os demais filtros são aplicados na consulta.</small>
    </section>

    <section class="panel reports-summary-panel" aria-label="Resumo do período">
      <div class="reports-summary" id="reports-summary">
        ${reportTile("reports-total", "Execuções", "—")}
        ${reportTile("reports-passed", "Sem falha", "—")}
        ${reportTile("reports-failed", "Com falha", "—")}
        ${reportTile("reports-rate", "Taxa de sucesso", "—")}
      </div>
      <small class="hint" id="reports-summary-note">Calculado sobre as execuções carregadas.</small>
    </section>

    <section class="panel">
      <div class="reports-list-head"><h2>Linha do tempo</h2><span class="reports-count" id="reports-count"></span></div>
      <div class="error-box" id="reports-error" role="alert"></div>
      <div class="reports-list" id="reports-list"><p class="hint">Carregando execuções...</p></div>
      <div class="reports-more"><button id="reports-more" class="secondary" type="button" hidden>Carregar mais</button></div>
    </section>
  </section>
  ${renderWorkspaceEnd()}`;
}

function reportTile(id: string, label: string, value: string): string {
  return `<div class="reports-tile"><small>${label}</small><strong id="${id}">${value}</strong></div>`;
}

/**
 * Central de qualidade: o resumo da conta, não a lista de execuções.
 *
 * Relatórios responde "o que aconteceu"; esta página responde "como está
 * indo" — total, taxa de sucesso, tendência contra o período anterior, e a
 * quebra por tipo e por aplicação. Os números vêm de `GET
 * /api/v1/quality/summary`, que soma a mesma linha do tempo de Relatórios em
 * vez de listá-la — ver `src/quality-summary.ts`.
 */
export function renderQualityPage(): string {
  return `${renderWorkspaceStart("qualidade", "Central de qualidade")}
  ${renderToolHeader("Panorama", "Central de qualidade", "Padrões, tendências e a evolução da qualidade da conta ao longo do tempo.")}
  <section class="tool-layout quality-layout">
    <p class="form-unavailable" id="quality-unavailable" hidden></p>
    <section class="panel quality-filters" aria-label="Filtros do resumo">
      <div class="quality-filter-grid">
        <div class="tool-field">
          <label for="quality-application">Aplicação</label>
          <select id="quality-application"><option value="">Todas</option></select>
        </div>
        <div class="tool-field">
          <label for="quality-period">Período</label>
          <select id="quality-period">
            <option value="7">Últimos 7 dias</option>
            <option value="30" selected>Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="">Desde o começo</option>
          </select>
        </div>
      </div>
      <small class="hint" id="quality-truncated-hint" hidden>O período tem mais execuções do que este resumo soma; os números são aproximados.</small>
    </section>

    <div class="error-box" id="quality-error" role="alert"></div>

    <section class="panel quality-summary-panel" aria-label="Resumo do período">
      <div class="quality-summary" id="quality-summary">
        ${qualityTile("quality-total", "Execuções", "—")}
        ${qualityTile("quality-rate", "Taxa de sucesso", "—", "quality-rate-delta")}
        ${qualityTile("quality-passed", "Sem falha", "—")}
        ${qualityTile("quality-failed", "Com falha", "—")}
      </div>
      <small class="hint" id="quality-summary-note">Calculado sobre o período escolhido.</small>
    </section>

    <section class="panel quality-trend-panel" aria-label="Tendência diária">
      <div class="quality-list-head"><h2>Tendência</h2><span class="reports-count" id="quality-trend-note"></span></div>
      <div class="quality-trend" id="quality-trend"><p class="hint">Carregando...</p></div>
      <ul class="quality-trend-legend" id="quality-trend-legend" hidden><li><i class="legend-dot legend-pass"></i>Aprovado</li><li><i class="legend-dot legend-fail"></i>Reprovado</li><li><i class="legend-dot legend-running"></i>Em execução</li></ul>
    </section>

    <section class="panel quality-kind-panel" aria-label="Por tipo">
      <h2>Por tipo</h2>
      <div class="quality-kind-grid" id="quality-kind-grid"><p class="hint">Carregando...</p></div>
    </section>

    <section class="panel quality-app-panel" aria-label="Por aplicação">
      <h2>Por aplicação</h2>
      <div class="quality-app-table" id="quality-app-table"><p class="hint">Carregando...</p></div>
    </section>
  </section>
  ${renderWorkspaceEnd()}`;
}

function qualityTile(id: string, label: string, value: string, deltaId = ""): string {
  return `<div class="reports-tile quality-tile"><small>${label}</small><strong id="${id}">${value}</strong>${deltaId ? `<em class="quality-delta" id="${deltaId}"></em>` : ""}</div>`;
}

/**
 * Alertas: o que pede atenção agora, para a conta inteira.
 *
 * Sem filtro nenhum de propósito: a granularidade é a conta, não a aplicação
 * — decisão do usuário, registrada em `src/alerts.ts`. Os números vêm de
 * `GET /api/v1/alerts`.
 */
export function renderAlertsPage(): string {
  return `${renderWorkspaceStart("alertas", "Alertas")}
  ${renderToolHeader("Monitoramento", "Alertas", "O que pede atenção agora: execuções que falharam e quedas na taxa de sucesso, para a conta inteira.")}
  <section class="tool-layout alerts-layout">
    <p class="form-unavailable" id="alerts-unavailable" hidden></p>
    <div class="error-box" id="alerts-error" role="alert"></div>

    <section class="panel alert-regression" id="alert-regression" hidden>
      <strong id="alert-regression-title"></strong>
      <p id="alert-regression-detail"></p>
    </section>

    <section class="panel" aria-label="Execuções com falha recentes">
      <div class="reports-list-head"><h2>Falhas recentes</h2><span class="reports-count" id="alerts-count"></span></div>
      <div class="reports-list" id="alerts-list"><p class="hint">Carregando...</p></div>
    </section>
  </section>
  ${renderWorkspaceEnd()}`;
}

function settingsField(id: string, label: string, hint: string, inputHtml: string): string {
  return `<div class="tool-field"><label for="${id}">${label}</label>${inputHtml}<small class="hint">${hint}</small></div>`;
}

/**
 * Configurações: as três coisas que o usuário escolheu para a primeira entrega
 * — conta (senha, e-mail), limiares de Alertas e padrões de execução da
 * Inspeção. Tudo nasce vazio e sem valor: o cliente busca `/api/v1/auth/me` e
 * `/api/v1/account/settings` e preenche, porque o documento é servido igual
 * para todo mundo.
 */
export function renderSettingsPage(): string {
  return `${renderWorkspaceStart("configuracoes", "Configurações")}
  ${renderToolHeader("Preferências", "Configurações", "A conta, os limiares de Alertas e os padrões de execução da Inspeção, reunidos em um só lugar.")}
  <section class="tool-layout settings-layout">
    <p class="form-unavailable" id="settings-unavailable" hidden></p>

    <section class="panel" aria-label="Conta">
      <h2>Conta</h2>
      <p class="sub"><span id="settings-email">—</span> <span class="settings-badge" id="settings-verified" hidden>verificado</span> <span class="settings-badge settings-badge-warn" id="settings-unverified" hidden>não verificado</span></p>
      <button type="button" class="secondary" id="settings-resend" hidden>Reenviar confirmação</button>

      <form id="settings-password-form">
        <h3 id="settings-password-title">Trocar senha</h3>
        ${settingsField("settings-current-password", "Senha atual", "Só pedida se a conta já tem senha.", '<input id="settings-current-password" type="password" autocomplete="current-password">')}
        ${settingsField("settings-new-password", "Nova senha", "Pelo menos 10 caracteres.", '<input id="settings-new-password" type="password" autocomplete="new-password" required minlength="10" maxlength="200">')}
        <button type="submit">Salvar senha</button>
        <div class="error-box" id="settings-password-error"></div>
      </form>
    </section>

    <section class="panel" aria-label="Alertas">
      <h2>Alertas</h2>
      <p class="sub">Quando um alerta de queda na taxa de sucesso nasce.</p>
      <form id="settings-alerts-form">
        <div class="row">
          ${settingsField("settings-window-days", "Janela (dias)", "1 a 90.", '<input id="settings-window-days" type="number" min="1" max="90" required>')}
          ${settingsField("settings-threshold-points", "Queda mínima (pp)", "1 a 100.", '<input id="settings-threshold-points" type="number" min="1" max="100" required>')}
          ${settingsField("settings-min-sample", "Amostra mínima", "1 a 500.", '<input id="settings-min-sample" type="number" min="1" max="500" required>')}
        </div>
        <button type="submit">Salvar limiares</button>
        <div class="error-box" id="settings-alerts-error"></div>
      </form>
    </section>

    <section class="panel" aria-label="Execução padrão da Inspeção">
      <h2>Execução padrão da Inspeção</h2>
      <p class="sub">Pré-preenche o formulário de uma nova análise. Preencher o campo lá continua vencendo este padrão.</p>
      <form id="settings-scan-form">
        <div class="row">
          ${settingsField("settings-timeout-ms", "Timeout (ms)", "1000 a 120000.", '<input id="settings-timeout-ms" type="number" min="1000" max="120000" required>')}
          ${settingsField("settings-settle-ms", "Observação (ms)", "0 a 30000.", '<input id="settings-settle-ms" type="number" min="0" max="30000" required>')}
        </div>
        ${settingsField("settings-ignored-statuses", "Status ignorados", "Códigos HTTP separados por vírgula.", '<input id="settings-ignored-statuses" placeholder="401,404" maxlength="200">')}
        ${settingsField("settings-screenshot", "Screenshot", "Política padrão de captura.", '<select id="settings-screenshot"><option value="on-failure">Quando reprovar</option><option value="always">Sempre</option><option value="never">Nunca</option></select>')}
        <button type="submit">Salvar padrões</button>
        <div class="error-box" id="settings-scan-error"></div>
      </form>
    </section>
  </section>
  ${renderWorkspaceEnd()}`;
}

function authField(id: string, label: string, type: string, autocomplete: string, hint = "", attributes = ""): string {
  return `<label class="auth-field" for="${id}"><span>${label}</span><input id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" ${attributes}>${hint ? `<small>${hint}</small>` : ""}</label>`;
}

/**
 * Entrada e cadastro.
 *
 * Fora do shell do produto de propósito: quem chega aqui não está trabalhando
 * numa análise, e a navegação lateral cheia de ferramentas que exigem conta só
 * atrapalharia. Os quatro formulários vivem na mesma página e o cliente decide
 * qual mostrar, porque são o mesmo assunto e trocar de tela a cada passo perde
 * o e-mail já digitado.
 */
export function renderAuthPage(): string {
  return `<main class="auth-shell">
  <a class="auth-brand" href="/"><span class="radar" aria-hidden="true"></span><span>QA Radar</span></a>
  <section class="auth-card">
    <div class="auth-tabs" id="auth-tabs" role="tablist">
      <button type="button" role="tab" id="auth-tab-signin" class="active" aria-selected="true">Entrar</button>
      <button type="button" role="tab" id="auth-tab-signup" aria-selected="false">Criar conta</button>
    </div>

    <p class="auth-alert auth-alert-error" id="auth-error" role="alert" hidden></p>
    <p class="auth-alert auth-alert-ok" id="auth-notice" role="status" hidden></p>

    <form class="auth-form" id="auth-signin-form" novalidate>
      <h1>Entrar na sua conta</h1>
      <p class="auth-lead">Suas aplicações, execuções e histórico ficam guardados na conta.</p>
      ${authField("signin-email", "E-mail", "email", "email", "", 'required inputmode="email" maxlength="254"')}
      ${authField("signin-password", "Senha", "password", "current-password", "", 'required maxlength="200"')}
      <button type="submit" id="signin-submit">Entrar</button>
      <button type="button" class="auth-link" id="auth-forgot-open" hidden>Esqueci minha senha</button>
    </form>

    <form class="auth-form" id="auth-signup-form" novalidate hidden>
      <h1>Criar sua conta</h1>
      <p class="auth-lead">Leva um minuto e não custa nada durante o Beta.</p>
      ${authField("signup-name", "Nome", "text", "name", "Opcional. Aparece só para você.", 'maxlength="80"')}
      ${authField("signup-email", "E-mail", "email", "email", "", 'required inputmode="email" maxlength="254"')}
      ${authField("signup-password", "Senha", "password", "new-password", "Pelo menos 10 caracteres. Prefira uma frase a uma palavra com símbolos.", 'required minlength="10" maxlength="200"')}
      <button type="submit" id="signup-submit">Criar conta</button>
    </form>

    <form class="auth-form" id="auth-forgot-form" novalidate hidden>
      <h1>Recuperar acesso</h1>
      <p class="auth-lead">Enviamos um link para você escolher uma senha nova. Ele vale por uma hora.</p>
      ${authField("forgot-email", "E-mail da conta", "email", "email", "", 'required inputmode="email" maxlength="254"')}
      <button type="submit" id="forgot-submit">Enviar link</button>
      <button type="button" class="auth-link" id="auth-forgot-cancel">Voltar para a entrada</button>
    </form>

    <form class="auth-form" id="auth-reset-form" novalidate hidden>
      <h1>Escolher uma nova senha</h1>
      <p class="auth-lead">Ao confirmar, todas as sessões abertas nesta conta são encerradas.</p>
      ${authField("reset-password", "Nova senha", "password", "new-password", "Pelo menos 10 caracteres.", 'required minlength="10" maxlength="200"')}
      <button type="submit" id="reset-submit">Salvar e entrar</button>
    </form>

    <div class="auth-unavailable" id="auth-unavailable" hidden>
      <h1>Sem contas por aqui</h1>
      <p>Neste servidor as análises ficam no seu navegador e cada relatório é acessado pelo próprio link. Não há o que cadastrar.</p>
      <a href="/">Usar o QA Radar sem entrar</a>
    </div>

    <div class="auth-external" id="auth-github-block" hidden>
      <span class="auth-divider"><i></i>ou<i></i></span>
      <a class="auth-github" id="auth-github" href="/api/v1/auth/github">Continuar com o GitHub</a>
    </div>
  </section>
  <p class="auth-foot">Ao criar uma conta você concorda com a licença de avaliação do QA Radar. <a href="/docs">Dúvidas?</a></p>
</main>`;
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
    ${faqItem("relatorios", "Onde vejo os relatórios das execuções?", "<p>Em <strong>Relatórios</strong>, que reúne Inspeção, Jornada e Testes de API numa linha do tempo só, com filtro por aplicação, tipo e período. Ela depende de conta: sem login o histórico fica em <strong>Execuções recentes</strong>, na Visão geral, guardado por navegador. A Inspeção gera relatório em HTML (leitura e compartilhamento) e em JSON (integração com CI), e a Jornada gera evidências em HTML com o passo a passo.</p>")}
    ${faqItem("central-de-qualidade", "O que é o índice de qualidade?", "<p>É a nota de 0 a 100 no centro do radar, na Visão geral. Ela é a média de cinco eixos — HTTP, performance, acessibilidade, DOM e JavaScript — calculada sobre as execuções mais recentes deste navegador. Acima de 85 é <em>Excelente</em>; de 70 a 84, <em>Estável</em>; de 50 a 69, <em>Atenção</em>; abaixo disso, <em>Crítico</em>.</p><p>Os quatro números ao redor do radar comparam as últimas 24h com as 24h anteriores — a seta indica se o indicador melhorou ou piorou.</p>")}
    ${faqItem("", "Qual a diferença entre o radar da Visão geral e a Central de qualidade?", "<p>O radar é por navegador: só o que rodou ali. A <strong>Central de qualidade</strong> soma a conta inteira — total de execuções, taxa de sucesso, tendência contra o período anterior, quebra por Inspeção/Jornada/Testes de API e por aplicação. Depende de conta, como Relatórios.</p>" + action("/central-de-qualidade", "Abrir Central de qualidade", "Ver o resumo de qualidade da conta."))}
    ${faqItem("alertas", "Dá para receber alertas quando algo falha?", "<p><strong>Alertas</strong> lista as execuções com falha dos últimos 7 dias e avisa quando a taxa de sucesso da conta cai 15 pontos percentuais ou mais frente ao período anterior de igual duração. É por conta, não por aplicação, e só no painel nesta primeira entrega — nenhum e-mail sai daqui ainda.</p><p>Para bloquear uma entrega automaticamente, use o quality gate: o campo <strong>Reprovar a partir de</strong> define se a execução falha por erros, por avisos ou nunca — e o código de saída pode ser lido pela sua CI.</p>" + action("/alertas", "Abrir Alertas", "Ver o que pede atenção agora na sua conta."))}
    ${faqItem("", "Onde ficam salvos os meus dados?", "<p>O histórico do painel fica no seu navegador e também no servidor, associado à sua sessão, limitado às 40 execuções mais recentes. Collections, variáveis e credenciais dos Testes de API <strong>nunca saem do navegador</strong> — não são enviadas ao servidor.</p>")}

    <h2 class="faq-group">Configuração</h2>
    ${faqItem("ambientes", "Como separo staging de produção?", "<p>Na Inspeção, use os campos <strong>Projeto</strong> e <strong>Ambiente</strong>. Eles mantêm o histórico e o baseline separados por ambiente, de modo que uma análise de staging não interfira na de produção. Os campos ficam disponíveis quando o histórico está habilitado no servidor.</p>")}
    ${faqItem("configuracoes", "Onde ficam as configurações?", "<p><strong>Configurações</strong> reúne o que depende de conta: trocar senha e ver o e-mail cadastrado, os limiares que disparam um Alerta (janela, queda mínima e amostra mínima) e os padrões de execução da Inspeção — timeout, tempo de observação, status HTTP ignorados e política de screenshot, que pré-preenchem o formulário e continuam podendo ser ajustados por análise. Configurações de servidor (histórico, limite de páginas do sitemap, execução de código) continuam por variável de ambiente na implantação.</p>" + action("/configuracoes", "Abrir Configurações", "Ajustar conta, Alertas e padrões de execução."))}

    <h2 class="faq-group">Limites</h2>
    ${faqItem("", "Posso analisar localhost ou uma rede interna?", "<p>Não na versão pública: endereços locais e faixas de rede privada são bloqueados por segurança. O alvo precisa ser um endereço público iniciado por <code>http://</code> ou <code>https://</code>. Em uma implantação própria, dentro da sua rede, essa restrição pode ser ajustada.</p>")}
    ${faqItem("", "Quais são os limites desta Beta?", "<p>Os resultados são heurísticos: apontam sinais de problema, mas não substituem testes funcionais completos, exploração manual nem dados reais de uso. A Inspeção cobre a página informada (ou o sitemap, quando ativado) sem interagir com ela, e o histórico guarda as 40 execuções mais recentes.</p>")}
  </section>
  ${renderWorkspaceEnd()}`;
}
