import { JWT_STATUS_LABELS, formatDuration, inspectJwt, type JwtStatus } from "../../toolbox/jwt.js";
import { clearError, copyText, esc, need, on, runOnCtrlEnter, show, showError } from "./ui.js";

const input = need<HTMLTextAreaElement>("jwt-input");
const errorBox = need("jwt-error");
const panel = need("jwt-result-panel");
const statusBox = need("jwt-status");
const claims = need("jwt-claims");
const headerBox = need("jwt-header");
const payloadBox = need("jwt-payload");
const warnings = need("jwt-warnings");

let lastPayload = "";

const STATUS_CLASS: Record<JwtStatus, string> = {
  valid_structure: "tool-status-ok",
  expired: "tool-status-fail",
  not_active_yet: "tool-status-warning",
  invalid: "tool-status-fail",
};

function moment(value: number | undefined): string {
  return value === undefined ? "—" : `${new Date(value).toLocaleString("pt-BR")} (${new Date(value).toISOString()})`;
}

function fact(term: string, value: string): string {
  return `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;
}

function decode(): void {
  clearError(errorBox);
  const result = inspectJwt(input.value);
  if (!result.decoded) {
    show(panel, false);
    lastPayload = "";
    showError(errorBox, result.error ?? "Token inválido.");
    return;
  }
  statusBox.className = `tool-status ${STATUS_CLASS[result.status]}`;
  statusBox.textContent = JWT_STATUS_LABELS[result.status];
  // Desvio do RFC aparece antes dos claims: é o que explica uma expiração que
  // parece errada, e sem isso o QA acredita no número sem saber de onde veio.
  warnings.innerHTML = result.warnings.map((aviso) => `<li>${esc(aviso)}</li>`).join("");
  warnings.hidden = result.warnings.length === 0;
  const remaining =
    result.timeRemainingMs === undefined
      ? "Sem exp: o token não declara expiração."
      : result.timeRemainingMs > 0
        ? `Expira em ${formatDuration(result.timeRemainingMs)}`
        : `Expirado há ${formatDuration(result.timeRemainingMs)}`;
  claims.innerHTML = [
    fact("Algoritmo declarado", result.algorithm ?? "—"),
    fact("Issued at (iat)", moment(result.timestamps.issuedAt)),
    fact("Expires at (exp)", moment(result.timestamps.expiresAt)),
    fact("Not before (nbf)", moment(result.timestamps.notBefore)),
    fact("Tempo restante", remaining),
    fact("Assinatura", result.signaturePresent ? "Presente, não verificada" : "Ausente"),
  ].join("");
  headerBox.textContent = JSON.stringify(result.header, null, 2);
  lastPayload = JSON.stringify(result.payload, null, 2);
  payloadBox.textContent = lastPayload;
  show(panel, true);
}

on("jwt-decode", "click", decode);
on("jwt-clear", "click", () => {
  // Limpar precisa apagar de verdade: o token não pode continuar em memória
  // esperando o próximo "copiar".
  input.value = "";
  lastPayload = "";
  headerBox.textContent = "";
  payloadBox.textContent = "";
  claims.innerHTML = "";
  warnings.innerHTML = "";
  warnings.hidden = true;
  clearError(errorBox);
  show(panel, false);
  input.focus();
});
on("jwt-copy", "click", (button) => {
  if (lastPayload) void copyText(button, lastPayload);
});
runOnCtrlEnter([input], decode);
