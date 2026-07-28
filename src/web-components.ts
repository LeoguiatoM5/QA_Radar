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
  return `<main class="shell">
  ${renderAppNav("scanner")}
  ${renderToolHeader("Scanner", "Inspeção", "Informe a URL e ajuste os critérios da análise.")}
  <section class="tool-layout">${renderScannerForm(options)}</section>
  ${renderResultsPanel()}
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

function renderAppNav(active: "home" | "scanner" | "journeys" | "docs"): string {
  const link = (id: typeof active, label: string, href: string) =>
    `<a class="nav-link ${active === id ? "active" : ""}" style="color:${active === id ? "var(--cyan)" : "var(--muted)"};text-decoration:none;font-size:.78rem;padding:7px 9px;border-radius:7px" href="${href}">${label}</a>`;
  return `<nav><a class="logo" href="/"><i class="radar"></i> QA RADAR</a><div class="nav-links" style="display:flex;gap:8px;align-items:center;margin-left:auto">${link("home", "Home", "/")}${link("scanner", "Inspeção", "/scanner")}${link("journeys", "Jornada Playwright", "/journeys")}${link("docs", "Documentação", "/docs")}</div><span class="pill">Beta pública</span></nav>`;
}

function renderToolHeader(eyebrow: string, title: string, description: string): string {
  return `<header class="tool-header"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></header>`;
}

export function renderJourneyPage(allowCodeMode: boolean): string {
  const enabled = allowCodeMode;
  return `<main class="shell">
  ${renderAppNav("journeys")}
  ${enabled ? `${renderToolHeader("Automação Playwright", "Modo Jornada de Playwright", "Grave, revise e execute jornadas Playwright em TypeScript.")}<section class="journey-workspace">${renderCodePanel()}</section>${renderEvidenceModal()}` : '<section class="panel"><div class="eyebrow">Modo Jornada de Playwright</div><h1>Recurso indisponível neste ambiente</h1><p class="lead">A execução de jornadas ainda não está habilitada nesta implantação.</p><p><a class="home-action" href="/docs"><strong>Consultar configuração</strong><span>Veja os requisitos de infraestrutura para habilitar o recurso.</span></a></p></section>'}
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

function renderEvidenceModal(): string {
  return `<dialog id="journey-evidence-modal"><form id="journey-evidence-form"><div class="modal-head"><div><div class="eyebrow">Relatório HTML</div><h2>Gerar evidências</h2></div><button class="modal-close" id="journey-evidence-close" type="button" aria-label="Fechar">×</button></div><p class="sub">Identifique o responsável e o tipo desta execução.</p><label for="journey-tester-name">Responsável pelo teste</label><input id="journey-tester-name" maxlength="100" required placeholder="Seu nome"><label for="journey-test-type">Tipo de teste</label><select id="journey-test-type" required><option value="functional">Funcional</option><option value="smoke">Smoke</option><option value="regression">Regressão</option><option value="acceptance">Aceitação</option><option value="exploratory">Exploratório</option></select><label>Passo a passo</label><small class="hint">Por padrão, a descrição vem do código. Use "Editar" para personalizar o que aparece no relatório.</small><div id="journey-evidence-steps" class="evidence-steps"></div><div class="modal-actions"><button class="secondary" id="journey-evidence-cancel" type="button">Cancelar</button><button type="submit">Gerar HTML</button></div><div class="error-box" id="journey-evidence-error"></div></form></dialog>`;
}

function renderCodePanel(): string {
  return `<section class="panel" id="code-mode-panel"><div class="eyebrow">Jornada Playwright</div><h2>Teste Playwright em TypeScript</h2><p class="sub">Grave o fluxo no navegador, revise o código oficial e execute a jornada no ambiente configurado.</p><div class="code-flow"><span><b>1</b>Gravar</span><span><b>2</b>Revisar</span><span><b>3</b>Executar</span></div><label for="codegen-url">URL inicial da gravação</label><input id="codegen-url" type="url" placeholder="https://staging.sua-aplicacao.com"><div class="journey-controls"><button id="codegen-start" type="button">Abrir gravador</button><button id="codegen-stop" class="secondary" type="button" disabled>Usar código gravado</button></div><div class="error-box" id="codegen-error"></div><div class="code-editor-head"><div><label for="playwright-code">Arquivo Playwright</label><small>qa-radar.spec.ts</small></div><label class="code-import" for="code-import">Importar arquivo</label><input id="code-import" type="file" accept=".ts,.spec.ts" hidden></div><textarea id="playwright-code" rows="18" spellcheck="false" aria-label="Código do teste Playwright" placeholder="import { test, expect } from '@playwright/test';"></textarea><div class="journey-controls code-actions"><button id="code-save" class="secondary" type="button">Exportar .spec.ts</button><button id="code-execute" type="button">Executar</button></div><div id="code-result" hidden aria-live="polite"></div><p class="hint">Este recurso executa código informado pelo usuário. Revise o arquivo antes de executar.</p></section>`;
}

export function renderHome(): string {
  return `<main class="shell home-shell">
  ${renderAppNav("home")}
  <section class="hero home-hero">
    <div><div class="eyebrow">Quality intelligence · Beta</div><h1>Encontre problemas antes que cheguem ao <span>usuário.</span></h1><p class="lead">O QA Radar ajuda seu time a investigar aplicações web com inspeção automatizada, testes Playwright e evidências prontas para compartilhar.</p></div>
    <div class="panel home-navigation"><h2>O que você quer fazer?</h2><p class="sub">Escolha uma funcionalidade para começar.</p><div class="home-actions"><a class="home-action" href="/scanner"><strong>Inspecionar aplicação</strong><span>Detecte falhas de JavaScript, HTTP, rede, DOM, acessibilidade e performance.</span></a><a class="home-action" href="/journeys"><strong>Modo Jornada de Playwright</strong><span>Grave, edite e execute uma jornada Playwright em TypeScript.</span></a><a class="home-action" href="/docs"><strong>Aprender como funciona</strong><span>Consulte o tutorial, exemplos, limites e formatos de relatório.</span></a></div></div>
  </section>
  <section class="panel home-guide"><h2>Como começar</h2><div class="help-grid"><div class="help-item"><h3>1. Escolha uma ferramenta</h3><p>Use a inspeção para um diagnóstico rápido ou o Modo Jornada de Playwright para automatizar um fluxo.</p></div><div class="help-item"><h3>2. Revise as evidências</h3><p>Cada execução informa impacto, recomendação e detalhes técnicos para investigação.</p></div><div class="help-item"><h3>3. Integre ao seu fluxo</h3><p>Exporte HTML, JSON, JUnit ou SARIF e conecte o resultado ao CI.</p></div></div></section>
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}

export function renderDocs(): string {
  return `<main class="shell home-shell">
  ${renderAppNav("docs")}
  <section class="panel docs-panel"><div class="eyebrow">Documentação · Beta</div><h1>Como usar o QA Radar</h1><p class="lead">Escolha a ferramenta conforme o tipo de validação que você precisa executar.</p><h2>Inspeção</h2><p>Analisa uma URL sem clicar ou enviar formulários. Observa navegador, JavaScript, rede, DOM, acessibilidade e performance.</p><div class="docs-action"><a href="/scanner">Abrir inspeção</a><span>Começar um diagnóstico de aplicação.</span></div><h2>Modo Jornada de Playwright</h2><p>Grave um fluxo com Playwright Codegen e importe, edite, exporte e execute arquivos oficiais <code>.spec.ts</code>. A execução hospedada será disponibilizada sobre infraestrutura isolada, com limites de recursos e proteção de credenciais.</p><div class="docs-action"><a href="/journeys">Abrir Jornada Playwright</a><span>Trabalhar diretamente com Playwright TypeScript.</span></div><h2>Relatórios e limites</h2><p>As execuções geram evidências e formatos para leitura humana ou integração com CI. Os resultados são heurísticos e não substituem testes funcionais completos, exploração manual ou dados reais de usuários.</p></section>
  <footer>&copy; 2026 QA Radar · Todos os direitos reservados.</footer>
</main>`;
}
