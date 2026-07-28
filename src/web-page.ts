import { WEB_CLIENT_SCRIPT } from "./web-client.js";
import { renderDashboard, renderDocs, renderHome, renderJourneyPage } from "./web-components.js";
import { WEB_STYLES } from "./web-styles.js";

const NAV_RESPONSIVE_STYLES = `.nav-links{display:flex;flex-wrap:wrap;min-width:0;gap:8px;align-items:center;justify-content:flex-end}.shell nav{flex-wrap:wrap;gap:12px}.nav-links a{white-space:nowrap}@media(max-width:520px){.shell nav{align-items:flex-start}.shell nav .nav-links{order:3;flex:1 1 100%;width:100%;justify-content:space-between;margin-left:0!important}.shell nav .nav-links a{font-size:.72rem;padding:6px 4px}.shell nav .pill{margin-left:auto}}`;

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function createWebPage(turnstileSiteKey?: string, allowHistory = false, maxSitemapPages = 20): string {
  const turnstileScript = turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "";
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
<body>${renderDashboard({ allowHistory, maxSitemapPages, turnstileWidget, historyWidget })}
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

export function createJourneyPage(allowCodeMode = false): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="QA Radar - Modo Jornada de Playwright"><title>QA Radar · Jornada Playwright</title><style>${WEB_STYLES}${NAV_RESPONSIVE_STYLES}.journey-workspace{max-width:860px;margin:0 auto}#code-mode-panel{max-width:860px;margin:0 auto}#code-mode-panel textarea{display:block;width:100%;min-height:420px;resize:vertical;background:#07101d;border:1px solid #344964;color:#d8e8f8;border-radius:10px;padding:16px;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;outline:0;tab-size:2}#code-mode-panel textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #67e8f915}#code-mode-panel .journey-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}#code-mode-panel .journey-controls button{margin:0}#code-mode-panel .hint{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.code-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 22px}.code-flow span{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#07101d;border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:.75rem;font-weight:700}.code-flow b{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#164e63;color:var(--cyan)}.code-editor-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-top:22px}.code-editor-head label{margin:0}.code-editor-head small{display:block;color:var(--muted);font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:3px}.code-editor-head .code-import{margin:0;padding:8px 11px;border:1px solid var(--line);border-radius:8px;color:var(--cyan);cursor:pointer;font-size:.74rem}.code-editor-head .code-import:hover{border-color:var(--cyan)}.code-result{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:13px;background:#07101d}.code-result.pass{border-color:#2f9e6688;background:#0c241b}.code-result.fail{border-color:#c94b5b88;background:#291419}.code-result-head{display:flex;justify-content:space-between;align-items:start;gap:16px}.code-result-head span{font-weight:900;color:var(--green)}.code-result.fail .code-result-head span{color:var(--red)}.code-result-head small{display:block;color:var(--muted);font-size:.68rem;margin-top:4px}.code-result-head strong{font-size:1.2rem}.code-result-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.code-result-metrics span{padding:9px;background:#07101d88;border-radius:8px;color:var(--muted);font-size:.72rem}.code-result-metrics b{display:block;color:var(--text);font-size:1rem}.code-result pre{white-space:pre-wrap;overflow:auto;margin:14px 0 0;padding:12px;background:#07101d;border-radius:8px;color:var(--red);font-size:.75rem}@media(max-width:620px){.code-flow{grid-template-columns:1fr}#code-mode-panel textarea{min-height:330px}.code-result-metrics{grid-template-columns:1fr 1fr 1fr}}</style></head>
<body>${renderJourneyPage(allowCodeMode)}</body>
<script>${WEB_CLIENT_SCRIPT}</script></html>`;
}
