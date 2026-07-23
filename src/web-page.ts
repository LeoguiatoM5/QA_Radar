import { WEB_CLIENT_SCRIPT } from "./web-client.js";
import { renderDashboard, renderDocs, renderHome, renderJourneyPage } from "./web-components.js";
import { WEB_STYLES } from "./web-styles.js";

const NAV_RESPONSIVE_STYLES = `.nav-links{display:flex;flex-wrap:wrap;min-width:0;gap:8px;align-items:center;justify-content:flex-end}.shell nav{flex-wrap:wrap;gap:12px}.nav-links a{white-space:nowrap}@media(max-width:520px){.shell nav{align-items:flex-start}.shell nav .nav-links{order:3;flex:1 1 100%;width:100%;justify-content:space-between;margin-left:0!important}.shell nav .nav-links a{font-size:.72rem;padding:6px 4px}.shell nav .pill{margin-left:auto}}`;

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function createWebPage(turnstileSiteKey?: string, allowHistory = false, maxSitemapPages = 20, allowJourneys = false): string {
  const turnstileScript = turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : "";
  const turnstileWidget = turnstileSiteKey
    ? `<div id="turnstile-block"><div class="cf-turnstile" data-sitekey="${escapeAttribute(turnstileSiteKey)}" data-theme="dark" data-size="flexible" data-callback="onTurnstileSuccess" data-expired-callback="onTurnstileExpired" data-error-callback="onTurnstileError"></div><small class="hint">Verificação de segurança necessária para iniciar a análise.</small></div>`
    : "";
  const historyWidget = allowHistory
    ? '<button class="secondary" id="history-button" type="button">Consultar histórico</button><section class="history-panel" id="history-panel" hidden><div class="history-head"><div><strong>Histórico do projeto</strong><small id="history-baseline">Nenhum baseline aprovado</small></div><span id="history-count"></span></div><div class="history-list" id="history-list"></div></section>'
    : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="QA Radar - scanner de qualidade para aplicações web">
  <title>QA Radar · Web Scanner</title>
  ${turnstileScript}
  <style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}</style>
</head>
<body>${renderDashboard({ allowHistory, maxSitemapPages, turnstileWidget, historyWidget, allowJourneys })}
<script>${WEB_CLIENT_SCRIPT}</script></body></html>`;
}

export function createHomePage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="QA Radar - qualidade e diagnóstico para aplicações web">
  <title>QA Radar · Qualidade web</title>
  <style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}.home-actions{display:grid;gap:10px;margin-top:20px}.home-action{display:block;padding:14px;border:1px solid var(--line);border-radius:10px;background:#07101d;color:var(--text);text-decoration:none}.home-action:hover,.home-action:focus{border-color:var(--cyan)}.home-action strong,.home-action span{display:block}.home-action strong{color:var(--cyan)}.home-action span{margin-top:5px;color:var(--muted);font-size:.78rem;line-height:1.45}.home-guide{margin-top:30px}.home-hero{align-items:stretch}</style>
</head>
<body>${renderHome()}</body>
</html>`;
}

export function createDocsPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Documentação do QA Radar"><title>QA Radar · Documentação</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}.docs-panel{max-width:860px;margin:0 auto}.docs-panel h1{margin-top:8px}.docs-panel h2{margin-top:28px}.docs-action{margin:14px 0 26px}.docs-action a{display:block;color:var(--cyan);font-weight:800}.docs-action span{display:block;color:var(--muted);font-size:.82rem;margin-top:5px}</style></head>
<body>${renderDocs()}</body>
</html>`;
}

export function createJourneyPage(allowJourneys = false): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - Jornadas Playwright"><title>QA Radar · Jornadas</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}.journey-page{max-width:980px;margin:0 auto}.journey-panel .journey-title{font-size:1.8rem;line-height:1.1;letter-spacing:normal;margin:0 0 5px;max-width:none}.journey-panel .journey-help{display:none}.journey-reference{max-width:980px;margin-top:24px}.journey-reference pre{overflow:auto;background:#07101d;border:1px solid var(--line);border-radius:10px;padding:16px;color:#d8e8f8;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.journey-reference a{color:var(--cyan);font-weight:800}</style></head>
<body>${renderJourneyPage(allowJourneys)}</body>
<script>${WEB_CLIENT_SCRIPT}</script></html>`;
}
