/**
 * HTML do QA Toolbox.
 *
 * Só marcação: nenhuma regra de negócio mora aqui. O que cada ferramenta calcula
 * está em `src/toolbox/`, tipado e coberto por teste, e chega ao navegador como
 * módulo ES servido em `/assets/toolbox/`. Esta camada monta os campos, os
 * painéis e os botões — e nada mais.
 */

import { renderToolHeader, renderWorkspaceEnd, renderWorkspaceStart } from "./web-components.js";
import { CURL_TARGETS } from "./toolbox/curl.js";
import { TEST_DATA_FIELDS } from "./toolbox/test-data.js";
import { BOUNDARY_FIELD_LABELS } from "./toolbox/boundary-values.js";
import { DEFAULT_EXPECTED_STATUS, DEFAULT_MAX_RESPONSE_TIME_MS, MAX_HEALTH_CHECKS } from "./toolbox/health.js";
import { MAX_PAIRWISE_PARAMETERS } from "./toolbox/pairwise.js";
import { REGEX_FLAGS } from "./toolbox/regex-tester.js";
import { HTTP_STATUS_CLASSES } from "./toolbox/http-status.js";
import { MAX_REQUESTS_PER_BIN, MAX_WEBHOOK_BODY_BYTES, WEBHOOK_TTL_MS } from "./toolbox/webhook.js";
import { categoryLabel, QA_TOOLS, TOOL_CATEGORIES, type QaToolDefinition } from "./toolbox/catalog.js";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const STATUS_LABELS: Record<QaToolDefinition["status"], string> = {
  stable: "",
  beta: "Beta",
  new: "Novo",
  soon: "Em breve",
};

/**
 * Selo de privacidade.
 *
 * Só aparece quando a ferramenta realmente não manda nada para o servidor. A
 * ausência dele também é informação: quem não tem o selo diz, no lugar dele, o
 * que sai do navegador.
 */
export function renderPrivacyBadge(tool: QaToolDefinition): string {
  return tool.runsLocally
    ? '<span class="tool-privacy tool-privacy-local" title="Nada digitado aqui sai do seu navegador">Roda local</span>'
    : '<span class="tool-privacy tool-privacy-server" title="Esta ferramenta usa o servidor do QA Radar">Usa o servidor</span>';
}

function renderToolCard(tool: QaToolDefinition): string {
  const badge = STATUS_LABELS[tool.status];
  const inner = `<span class="tool-card-icon"><em class="tool-icon icon-${escapeHtml(tool.icon)}" aria-hidden="true"><i></i></em></span>
      <span class="tool-card-body">
        <strong>${escapeHtml(tool.name)}${badge ? `<b class="tool-card-status tool-card-status-${tool.status}">${badge}</b>` : ""}</strong>
        <small>${escapeHtml(tool.description)}</small>
      </span>
      <span class="tool-card-foot">${tool.status === "soon" ? "<span></span>" : renderPrivacyBadge(tool)}<b class="tool-card-action">${tool.status === "soon" ? "Em breve" : "Abrir"}</b></span>`;
  const attributes = `class="tool-card" data-tool-card data-tool-id="${escapeHtml(tool.id)}" data-tool-category="${escapeHtml(tool.category)}"`;
  if (tool.status === "soon") return `<div ${attributes} data-tool-soon="true" aria-disabled="true">${inner}</div>`;
  // O botão de favoritar fica fora do <a>: um botão dentro de um link não pode
  // ser acionado pelo teclado sem também navegar.
  // O invólucro guarda o id em `data-tool-slot`, não em `data-tool-id`: repetir
  // o mesmo atributo no pai e no filho faz todo seletor por id casar duas vezes.
  return `<div class="tool-card-slot" data-tool-slot="${escapeHtml(tool.id)}"><a ${attributes} href="${escapeHtml(tool.route)}">${inner}</a>${renderFavoriteButton(tool)}</div>`;
}

/**
 * Estrela de favoritar.
 *
 * Nasce apagada e sem estado: quem decide é o cliente, a partir do
 * `localStorage`. O servidor não sabe — nem precisa saber — quais ferramentas
 * alguém usa mais.
 */
function renderFavoriteButton(tool: QaToolDefinition): string {
  return `<button type="button" class="tool-favorite" data-tool-favorite="${escapeHtml(tool.id)}" aria-pressed="false" aria-label="Favoritar ${escapeHtml(tool.name)}" title="Favoritar"><span aria-hidden="true">★</span></button>`;
}

function renderCategorySection(categoryId: string, label: string, description: string): string {
  const tools = QA_TOOLS.filter((tool) => tool.category === categoryId);
  if (tools.length === 0) return "";
  return `<section class="tool-category" data-tool-category-section="${escapeHtml(categoryId)}">
    <div class="tool-category-head"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(description)}</p></div>
    <div class="tool-grid">${tools.map(renderToolCard).join("")}</div>
  </section>`;
}

/**
 * Faixa das favoritas.
 *
 * Sai vazia do servidor e é preenchida pelo cliente com cópias dos cards. Fica
 * escondida enquanto ninguém favoritou nada, para não ocupar o topo da página
 * com uma seção vazia.
 */
function renderFavoritesSection(): string {
  return `<section class="tool-category tool-category-favorites" id="toolbox-favorites" hidden>
    <div class="tool-category-head"><h2>Favoritas</h2><p>As que você mais usa, sempre no topo. Ficam só neste navegador.</p></div>
    <div class="tool-grid" id="toolbox-favorites-grid"></div>
  </section>`;
}

export function renderToolboxHome(): string {
  return `${renderWorkspaceStart("toolbox", "QA Toolbox")}
  ${renderToolHeader("QA Toolbox", "Daily tools for Software Quality", "Ferramentas rápidas para QA, automação, APIs e design de testes. Sem configuração e, quase sempre, sem sair do seu navegador.")}
  <section class="toolbox-layout">
    <div class="toolbox-search">
      <label for="toolbox-search-input">Buscar ferramenta</label>
      <input id="toolbox-search-input" type="search" placeholder="Buscar ferramenta..." autocomplete="off" aria-describedby="toolbox-search-count">
      <p class="hint" id="toolbox-search-count" role="status" aria-live="polite">${QA_TOOLS.length} ferramentas disponíveis.</p>
    </div>
    ${renderFavoritesSection()}
    ${TOOL_CATEGORIES.map((category) => renderCategorySection(category.id, category.label, category.description)).join("")}
    <p class="toolbox-empty" id="toolbox-empty" hidden>Nenhuma ferramenta corresponde à busca. Tente outro termo, como <code>json</code>, <code>token</code> ou <code>massa</code>.</p>
  </section>
  ${renderWorkspaceEnd()}`;
}

function renderToolShell(tool: QaToolDefinition, body: string): string {
  return `${renderWorkspaceStart("toolbox", tool.name)}
  <nav class="tool-breadcrumb" aria-label="Trilha"><a href="/toolbox">QA Toolbox</a><span aria-hidden="true">/</span><span>${escapeHtml(tool.name)}</span></nav>
  <header class="tool-header"><div class="eyebrow">${escapeHtml(categoryLabel(tool.category))}</div><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(tool.description)}</p><div class="tool-header-badges">${renderPrivacyBadge(tool)}</div></header>
  ${body}
  ${renderWorkspaceEnd()}`;
}

function renderToolActions(buttons: ReadonlyArray<{ id: string; label: string; primary?: boolean; type?: string }>): string {
  return `<div class="tool-actions">${buttons.map((button) => `<button id="${button.id}" type="${button.type ?? "button"}" class="${button.primary ? "" : "secondary"}">${escapeHtml(button.label)}</button>`).join("")}</div>`;
}

const LOCAL_NOTE = '<p class="tool-note">Tudo é processado no seu navegador: nada digitado aqui é enviado ao servidor do QA Radar.</p>';

function renderJsonDiff(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <div class="tool-io">
      <div class="tool-field">
        <label for="diff-left">Original</label>
        <textarea id="diff-left" spellcheck="false" rows="12" placeholder='{ "limit": 5000 }'></textarea>
      </div>
      <div class="tool-field">
        <label for="diff-right">Comparar com</label>
        <textarea id="diff-right" spellcheck="false" rows="12" placeholder='{ "limit": 3000 }'></textarea>
      </div>
    </div>
    <label for="diff-ignore">Campos ignorados</label>
    <input id="diff-ignore" placeholder="timestamp, requestId, metadata.timestamp, data[*].requestId" autocomplete="off">
    <small class="hint">Separados por vírgula. Um nome simples ignora a propriedade em qualquer profundidade; use caminho (<code>metadata.timestamp</code>) ou <code>[*]</code> para índices de array.</small>
    ${renderToolActions([
      { id: "diff-run", label: "Comparar", primary: true },
      { id: "diff-format", label: "Formatar JSON" },
      { id: "diff-swap", label: "Inverter" },
      { id: "diff-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="diff-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="diff-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Resultado</h2><div class="tool-result-actions"><button class="secondary" id="diff-copy" type="button">Copiar resultado</button><button class="secondary" id="diff-download" type="button">Baixar resultado</button></div></div>
    <div class="tool-summary" id="diff-summary"></div>
    <div class="tool-diff-list" id="diff-list"></div>
    <p class="tool-note" id="diff-ignored" hidden></p>
  </section>`,
  );
}

function renderBoundaryValues(tool: QaToolDefinition): string {
  const options = Object.entries(BOUNDARY_FIELD_LABELS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");
  return renderToolShell(
    tool,
    `<form class="tool-panel panel" id="boundary-form" novalidate>
    <div class="tool-grid-fields">
      <div class="tool-field"><label for="boundary-field">Campo</label><input id="boundary-field" value="idade" maxlength="60" required></div>
      <div class="tool-field"><label for="boundary-type">Tipo</label><select id="boundary-type">${options}</select></div>
      <div class="tool-field"><label for="boundary-min">Mínimo</label><input id="boundary-min" value="18" required></div>
      <div class="tool-field"><label for="boundary-max">Máximo</label><input id="boundary-max" value="65" required></div>
      <div class="tool-field" id="boundary-step-field"><label for="boundary-step">Passo</label><input id="boundary-step" type="number" step="any" min="0" value="0.01"><small class="hint">Menor incremento aceito pelo campo decimal.</small></div>
    </div>
    ${renderToolActions([
      { id: "boundary-run", label: "Gerar casos", primary: true, type: "submit" },
      { id: "boundary-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="boundary-error" role="alert"></div>
    ${LOCAL_NOTE}
  </form>
  <section class="tool-panel panel" id="boundary-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Boundary Value Analysis</h2><div class="tool-result-actions"><button class="secondary" id="boundary-copy" type="button">Copiar casos</button><button class="secondary" id="boundary-download" type="button">Baixar CSV</button></div></div>
    <table class="tool-table"><thead><tr><th scope="col">Caso</th><th scope="col">Entrada</th><th scope="col">Resultado</th><th scope="col">Descrição</th></tr></thead><tbody id="boundary-rows"></tbody></table>
  </section>`,
  );
}

function renderTestData(tool: QaToolDefinition): string {
  const rows = TEST_DATA_FIELDS.map(
    (field) => `<tr>
      <td><label class="tool-check"><input type="checkbox" data-field-type="${escapeHtml(field.type)}"><span>${escapeHtml(field.label)}</span></label></td>
      <td><input class="tool-key" data-field-key="${escapeHtml(field.type)}" value="${escapeHtml(field.defaultKey)}" aria-label="Nome da propriedade de ${escapeHtml(field.label)}"></td>
      <td><select data-field-mode="${escapeHtml(field.type)}" aria-label="Validade de ${escapeHtml(field.label)}"><option value="valid">Válido</option><option value="invalid">Inválido</option></select></td>
      <td class="tool-hint-cell">${escapeHtml(field.invalidHint)}</td>
    </tr>`,
  ).join("");
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <p class="tool-warning">Synthetic Test Data — Do not use as real identity data. Os documentos gerados são sintéticos e servem só para teste.</p>
    <table class="tool-table tool-table-fields"><thead><tr><th scope="col">Campo</th><th scope="col">Propriedade</th><th scope="col">Validade</th><th scope="col">O que "inválido" produz</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tool-grid-fields">
      <div class="tool-field"><label for="data-count">Quantidade</label><input id="data-count" type="number" min="1" max="1000" value="10"></div>
      <div class="tool-field"><label for="data-table">Tabela (SQL)</label><input id="data-table" value="test_data" maxlength="60"></div>
    </div>
    ${renderToolActions([
      { id: "data-generate", label: "Gerar", primary: true },
      { id: "data-regenerate", label: "Gerar de novo" },
      { id: "data-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="data-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="data-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Massa gerada</h2><div class="tool-result-actions"><button class="secondary" id="data-copy" type="button">Copiar</button><button class="secondary" id="data-download-json" type="button">Baixar JSON</button><button class="secondary" id="data-download-csv" type="button">Baixar CSV</button></div></div>
    <div class="tool-tabs" role="tablist" aria-label="Formato da massa">
      <button class="tool-tab active" type="button" role="tab" aria-selected="true" data-data-format="json">JSON</button>
      <button class="tool-tab" type="button" role="tab" aria-selected="false" data-data-format="csv">CSV</button>
      <button class="tool-tab" type="button" role="tab" aria-selected="false" data-data-format="sql">SQL</button>
    </div>
    <pre class="tool-code" id="data-output" tabindex="0"></pre>
  </section>`,
  );
}

function renderJwtInspector(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <label for="jwt-input">Cole seu JWT</label>
    <textarea id="jwt-input" spellcheck="false" rows="6" autocomplete="off" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.assinatura"></textarea>
    <small class="hint">A decodificação acontece no seu navegador. O token não é enviado ao servidor, não entra no histórico e não vai para telemetria.</small>
    ${renderToolActions([
      { id: "jwt-decode", label: "Decodificar", primary: true },
      { id: "jwt-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="jwt-error" role="alert"></div>
  </section>
  <section class="tool-panel panel" id="jwt-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Token decodificado</h2><div class="tool-result-actions"><button class="secondary" id="jwt-copy" type="button">Copiar payload</button></div></div>
    <div class="tool-status-row"><span class="tool-status" id="jwt-status"></span><span class="tool-status tool-status-warning" id="jwt-signature">Assinatura não verificada</span></div>
    <p class="tool-note" id="jwt-signature-note">Decodificado não é verificado. O QA Radar lê o conteúdo do token, mas não tem a chave do emissor e por isso <strong>não</strong> confere a assinatura — um token forjado seria decodificado do mesmo jeito.</p>
    <ul class="tool-warning tool-warning-list" id="jwt-warnings" hidden></ul>
    <dl class="tool-facts" id="jwt-claims"></dl>
    <h3 class="tool-subtitle">Header</h3>
    <pre class="tool-code" id="jwt-header" tabindex="0"></pre>
    <h3 class="tool-subtitle">Payload</h3>
    <pre class="tool-code" id="jwt-payload" tabindex="0"></pre>
  </section>`,
  );
}

function renderCurlConverter(tool: QaToolDefinition): string {
  const targets = CURL_TARGETS.map(
    (target, index) =>
      `<button class="tool-tab${index === 0 ? " active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-curl-target="${escapeHtml(target.id)}">${escapeHtml(target.label)}</button>`,
  ).join("");
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <label for="curl-input">Comando cURL</label>
    <textarea id="curl-input" spellcheck="false" rows="8" placeholder="curl 'https://api.example.com/users' -H 'Authorization: Bearer token'"></textarea>
    <small class="hint">Cole o "Copy as cURL" do DevTools. Tokens e chaves de API viram variáveis de ambiente no código gerado, nunca literais.</small>
    ${renderToolActions([
      { id: "curl-convert", label: "Converter", primary: true },
      { id: "curl-format", label: "Formatar" },
      { id: "curl-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="curl-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="curl-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Requisição interpretada</h2><div class="tool-result-actions"><button class="secondary" id="curl-copy" type="button">Copiar código</button></div></div>
    <dl class="tool-facts" id="curl-facts"></dl>
    <div class="tool-tabs" role="tablist" aria-label="Destino da conversão">${targets}</div>
    <pre class="tool-code" id="curl-output" tabindex="0"></pre>
  </section>`,
  );
}

function renderApiHealth(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<form class="tool-panel panel" id="health-form" novalidate>
    <p class="tool-note tool-note-server">Esta é a única ferramenta do Toolbox que usa o servidor: o navegador não consegue medir um endpoint de terceiro por causa do CORS. A chamada sai do QA Radar, só com GET ou HEAD, sem cabeçalhos personalizados e com a mesma política de rede das análises — endereços locais e redes privadas são recusados.</p>
    <div class="health-rows" id="health-rows"></div>
    <div class="tool-actions tool-actions-inline"><button class="secondary" id="health-add" type="button">+ Endpoint</button><span class="hint">Até ${MAX_HEALTH_CHECKS} endpoints por verificação.</span></div>
    <div class="tool-grid-fields">
      <div class="tool-field"><label for="health-expected">Status esperado</label><input id="health-expected" type="number" min="100" max="599" value="${DEFAULT_EXPECTED_STATUS}"></div>
      <div class="tool-field"><label for="health-max-time">Tempo máximo de resposta (ms)</label><input id="health-max-time" type="number" min="1" max="60000" value="${DEFAULT_MAX_RESPONSE_TIME_MS}"></div>
    </div>
    ${renderToolActions([
      { id: "health-run", label: "Verificar", primary: true, type: "submit" },
      { id: "health-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="health-error" role="alert"></div>
  </form>
  <section class="tool-panel panel" id="health-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Resultado</h2><div class="tool-result-actions"><button class="secondary" id="health-copy" type="button">Copiar relatório do ambiente</button></div></div>
    <div class="tool-summary" id="health-summary"></div>
    <table class="tool-table"><thead><tr><th scope="col">Serviço</th><th scope="col">Status</th><th scope="col">Tempo</th><th scope="col">Content-Type</th><th scope="col">Resultado</th></tr></thead><tbody id="health-rows-result"></tbody></table>
  </section>`,
  );
}

function renderPairwise(tool: QaToolDefinition): string {
  const linhas = Array.from(
    { length: 4 },
    (_unused, index) => `<div class="pairwise-row">
      <div class="tool-field"><label for="pairwise-name-${index}">Parâmetro</label><input id="pairwise-name-${index}" class="pairwise-name" maxlength="40" placeholder="navegador"></div>
      <div class="tool-field"><label for="pairwise-values-${index}">Valores</label><input id="pairwise-values-${index}" class="pairwise-values" placeholder="chromium, firefox, webkit"></div>
      <button type="button" class="secondary pairwise-remove" aria-label="Remover parâmetro">×</button>
    </div>`,
  ).join("");
  return renderToolShell(
    tool,
    `<form class="tool-panel panel" id="pairwise-form" novalidate>
    <p class="tool-note tool-note-plain">A maioria dos defeitos de combinação aparece na interação de <strong>dois</strong> parâmetros. Cobrir todos os pares custa uma fração do produto cartesiano e ainda pega essa classe de defeito.</p>
    <div id="pairwise-rows">${linhas}</div>
    <div class="tool-actions tool-actions-inline"><button class="secondary" id="pairwise-add" type="button">+ Parâmetro</button><span class="hint">Valores separados por vírgula. Até ${MAX_PAIRWISE_PARAMETERS} parâmetros.</span></div>
    ${renderToolActions([
      { id: "pairwise-run", label: "Gerar combinações", primary: true, type: "submit" },
      { id: "pairwise-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="pairwise-error" role="alert"></div>
    ${LOCAL_NOTE}
  </form>
  <section class="tool-panel panel" id="pairwise-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Combinações</h2><div class="tool-result-actions"><button class="secondary" id="pairwise-copy" type="button">Copiar casos</button><button class="secondary" id="pairwise-download" type="button">Baixar CSV</button></div></div>
    <div class="tool-summary" id="pairwise-summary"></div>
    <div class="tool-table-scroll"><table class="tool-table" id="pairwise-table"><thead id="pairwise-head"></thead><tbody id="pairwise-body"></tbody></table></div>
  </section>`,
  );
}

function renderRegexTester(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <div class="regex-line">
      <div class="tool-field"><label for="regex-pattern">Expressão regular</label><input id="regex-pattern" spellcheck="false" autocomplete="off" placeholder="(\\d{3})\\.(\\d{3})\\.(\\d{3})-(\\d{2})"></div>
      <div class="tool-field"><label for="regex-flags">Flags</label><input id="regex-flags" spellcheck="false" autocomplete="off" maxlength="8" value="gm" placeholder="gim"></div>
    </div>
    <small class="hint">Flags aceitas: <code>${REGEX_FLAGS.split("").join("</code>, <code>")}</code>. O <code>g</code> é acrescentado sozinho, para que todos os casamentos apareçam.</small>
    <label for="regex-subject">Texto de teste</label>
    <textarea id="regex-subject" spellcheck="false" rows="10" placeholder="Uma linha por caso de teste."></textarea>
    ${renderToolActions([
      { id: "regex-run", label: "Testar", primary: true },
      { id: "regex-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="regex-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="regex-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Resultado</h2><div class="tool-result-actions"><button class="secondary" id="regex-copy" type="button">Copiar resultado</button></div></div>
    <div class="tool-summary" id="regex-summary"></div>
    <ul class="tool-warning tool-warning-list" id="regex-warnings" hidden></ul>
    <h3 class="tool-subtitle">Linhas</h3>
    <div class="regex-lines" id="regex-lines"></div>
    <h3 class="tool-subtitle">Casamentos</h3>
    <div class="tool-table-scroll"><table class="tool-table"><thead><tr><th scope="col">#</th><th scope="col">Linha</th><th scope="col">Posição</th><th scope="col">Casamento</th><th scope="col">Grupos</th></tr></thead><tbody id="regex-matches"></tbody></table></div>
  </section>`,
  );
}

function renderTimestamp(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <label for="timestamp-input">Epoch ou data ISO 8601</label>
    <input id="timestamp-input" spellcheck="false" autocomplete="off" placeholder="1788279562, 1788279562000 ou 2026-09-01T15:19:22Z">
    <small class="hint">Até 11 dígitos é lido como segundos, de 12 a 14 como milissegundos, acima disso como microssegundos. Deixe vazio ou escreva <code>agora</code> para o instante atual.</small>
    ${renderToolActions([
      { id: "timestamp-run", label: "Converter", primary: true },
      { id: "timestamp-now", label: "Agora" },
      { id: "timestamp-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="timestamp-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="timestamp-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Conversão</h2><div class="tool-result-actions"><button class="secondary" id="timestamp-copy" type="button">Copiar</button></div></div>
    <div class="tool-summary" id="timestamp-summary"></div>
    <ul class="tool-warning tool-warning-list" id="timestamp-warnings" hidden></ul>
    <dl class="tool-facts" id="timestamp-facts"></dl>
  </section>`,
  );
}

function renderHttpStatus(tool: QaToolDefinition): string {
  const classes = HTTP_STATUS_CLASSES.map(
    (entry) => `<button class="tool-tab" type="button" role="tab" aria-selected="false" data-status-class="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</button>`,
  ).join("");
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <label for="status-search">Buscar código ou situação</label>
    <input id="status-search" type="search" autocomplete="off" placeholder="404, timeout, cache, autenticação..." aria-describedby="status-count">
    <p class="hint" id="status-count" role="status" aria-live="polite"></p>
    <div class="tool-tabs" role="tablist" aria-label="Classe do status"><button class="tool-tab active" type="button" role="tab" aria-selected="true" data-status-class="todas">Todas</button>${classes}</div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" aria-live="polite">
    <div class="status-list" id="status-list"></div>
    <p class="toolbox-empty" id="status-empty" hidden>Nenhum código corresponde à busca.</p>
  </section>`,
  );
}

function renderJsonSchema(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <div class="tool-io">
      <div class="tool-field">
        <label for="schema-input">Schema</label>
        <textarea id="schema-input" spellcheck="false" rows="14" placeholder='{ "type": "object", "required": ["email"] }'></textarea>
      </div>
      <div class="tool-field">
        <label for="schema-payload">Payload</label>
        <textarea id="schema-payload" spellcheck="false" rows="14" placeholder='{ "email": "ana@exemplo.com" }'></textarea>
      </div>
    </div>
    <small class="hint">Cobre o núcleo do draft 2020-12 e as formas equivalentes dos drafts anteriores, mais <code>nullable</code> do OpenAPI 3.0. Palavra-chave não suportada é listada no resultado em vez de passar em silêncio.</small>
    ${renderToolActions([
      { id: "schema-run", label: "Validar", primary: true },
      { id: "schema-format", label: "Formatar" },
      { id: "schema-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="schema-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="schema-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Resultado</h2><div class="tool-result-actions"><button class="secondary" id="schema-copy" type="button">Copiar resultado</button></div></div>
    <div class="tool-summary" id="schema-summary"></div>
    <ul class="tool-warning tool-warning-list" id="schema-unsupported" hidden></ul>
    <div class="tool-table-scroll"><table class="tool-table"><thead><tr><th scope="col">Campo</th><th scope="col">Regra</th><th scope="col">O que falhou</th></tr></thead><tbody id="schema-violations"></tbody></table></div>
  </section>`,
  );
}

function renderOpenApiDiff(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <div class="tool-io">
      <div class="tool-field">
        <label for="oas-left">Contrato atual</label>
        <textarea id="oas-left" spellcheck="false" rows="14" placeholder="openapi: 3.0.3&#10;info:&#10;  version: '1.0.0'"></textarea>
      </div>
      <div class="tool-field">
        <label for="oas-right">Contrato novo</label>
        <textarea id="oas-right" spellcheck="false" rows="14" placeholder="openapi: 3.0.3&#10;info:&#10;  version: '1.1.0'"></textarea>
      </div>
    </div>
    <small class="hint">Aceita YAML ou JSON. O veredicto depende do lado: exigir campo novo na <strong>requisição</strong> quebra quem chama; deixar de garantir campo na <strong>resposta</strong> quebra quem lê.</small>
    ${renderToolActions([
      { id: "oas-run", label: "Comparar", primary: true },
      { id: "oas-swap", label: "Inverter" },
      { id: "oas-clear", label: "Limpar" },
    ])}
    <div class="error-box" id="oas-error" role="alert"></div>
    ${LOCAL_NOTE}
  </section>
  <section class="tool-panel panel" id="oas-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Mudanças</h2><div class="tool-result-actions"><button class="secondary" id="oas-copy" type="button">Copiar relatório</button></div></div>
    <div class="tool-summary" id="oas-summary"></div>
    <div class="tool-tabs" role="tablist" aria-label="Filtrar por impacto">
      <button class="tool-tab active" type="button" role="tab" aria-selected="true" data-oas-filter="todas">Todas</button>
      <button class="tool-tab" type="button" role="tab" aria-selected="false" data-oas-filter="breaking">Breaking</button>
      <button class="tool-tab" type="button" role="tab" aria-selected="false" data-oas-filter="note">Note</button>
      <button class="tool-tab" type="button" role="tab" aria-selected="false" data-oas-filter="addition">Addition</button>
    </div>
    <div class="tool-diff-list" id="oas-changes"></div>
    <p class="toolbox-empty" id="oas-empty" hidden>Nenhuma mudança neste filtro.</p>
  </section>`,
  );
}

function renderWebhookInspector(tool: QaToolDefinition): string {
  return renderToolShell(
    tool,
    `<section class="tool-panel panel">
    <p class="tool-note tool-note-server">A caixa é uma <strong>URL pública</strong>: qualquer um que a descubra pode escrever nela. Ela vive ${Math.round(WEBHOOK_TTL_MS / 60000)} minutos, guarda as ${MAX_REQUESTS_PER_BIN} últimas chamadas e corta o corpo em ${Math.round(MAX_WEBHOOK_BODY_BYTES / 1024)} KB. Cabeçalho de credencial é redigido antes de virar registro, e nada é gravado em banco — um reinício leva tudo junto. Não use com dado real de produção.</p>
    ${renderToolActions([{ id: "webhook-create", label: "Abrir uma caixa", primary: true }])}
    <div class="error-box" id="webhook-error" role="alert"></div>
    <div id="webhook-bin" hidden>
      <label for="webhook-url">URL da sua caixa</label>
      <div class="webhook-url-row"><input id="webhook-url" readonly spellcheck="false"><button class="secondary" id="webhook-copy-url" type="button">Copiar</button></div>
      <small class="hint" id="webhook-expiry"></small>
      <div class="tool-actions">
        <button id="webhook-refresh" type="button">Atualizar</button>
        <button class="secondary" id="webhook-auto" type="button" aria-pressed="false">Atualizar sozinho</button>
        <button class="secondary" id="webhook-clear" type="button">Limpar chamadas</button>
      </div>
    </div>
  </section>
  <section class="tool-panel panel" id="webhook-result-panel" hidden aria-live="polite">
    <div class="tool-result-head"><h2>Chamadas recebidas</h2><div class="tool-result-actions"><button class="secondary" id="webhook-copy" type="button">Copiar a última</button></div></div>
    <div class="tool-summary" id="webhook-summary"></div>
    <div class="webhook-list" id="webhook-list"></div>
    <p class="toolbox-empty" id="webhook-empty" hidden>Nada chegou ainda. Aponte o webhook do seu sistema para a URL acima.</p>
  </section>`,
  );
}

const RENDERERS: Record<string, (tool: QaToolDefinition) => string> = {
  "json-diff": renderJsonDiff,
  "boundary-values": renderBoundaryValues,
  "test-data": renderTestData,
  "jwt-inspector": renderJwtInspector,
  "curl-converter": renderCurlConverter,
  "api-health": renderApiHealth,
  pairwise: renderPairwise,
  "regex-tester": renderRegexTester,
  timestamp: renderTimestamp,
  "http-status": renderHttpStatus,
  "json-schema": renderJsonSchema,
  "openapi-diff": renderOpenApiDiff,
  "webhook-inspector": renderWebhookInspector,
};

/** Marcação da ferramenta, ou `undefined` quando ela ainda não tem página. */
export function renderTool(tool: QaToolDefinition): string | undefined {
  return RENDERERS[tool.id]?.(tool);
}
