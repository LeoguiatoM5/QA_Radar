import { WEB_CLIENT_SCRIPT } from "./web-client.js";
import { renderDashboard } from "./web-components.js";
import { WEB_STYLES } from "./web-styles.js";

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
  <style>${WEB_STYLES}</style>
</head>
<body>${renderDashboard({ allowHistory, maxSitemapPages, turnstileWidget, historyWidget, allowJourneys })}
<script>${WEB_CLIENT_SCRIPT}</script></body></html>`;
}
