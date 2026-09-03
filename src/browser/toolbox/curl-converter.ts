import { convertCurl, formatCurl, isSecretHeader, maskParsedCurl, parseCurl, type CurlTarget, type ParsedCurlRequest } from "../../toolbox/curl.js";
import { clearError, copyText, esc, message, need, on, runOnCtrlEnter, selectTab, show, showError } from "./ui.js";

const input = need<HTMLTextAreaElement>("curl-input");
const errorBox = need("curl-error");
const panel = need("curl-result-panel");
const facts = need("curl-facts");
const output = need("curl-output");

let parsed: ParsedCurlRequest | null = null;
let target: CurlTarget = "playwright";

function fact(term: string, value: string, secret = false): string {
  return `<div><dt>${esc(term)}</dt><dd${secret ? ' class="tool-secret"' : ""}>${esc(value)}</dd></div>`;
}

function paint(): void {
  if (!parsed) return;
  output.textContent = convertCurl(parsed, target);
}

function convert(): void {
  clearError(errorBox);
  try {
    parsed = parseCurl(input.value);
    const masked = maskParsedCurl(parsed);
    const items = [fact("Método", masked.method), fact("URL", masked.url)];
    for (const param of masked.query) items.push(fact(`Query · ${param.name}`, param.value));
    for (const header of masked.headers) items.push(fact(`Header · ${header.name}`, header.value, isSecretHeader(header.name)));
    if (masked.basicAuth) items.push(fact("Basic auth", masked.basicAuth, true));
    if (masked.body !== undefined) items.push(fact("Body", masked.body.length > 400 ? `${masked.body.slice(0, 400)}…` : masked.body));
    facts.innerHTML = items.join("");
    paint();
    show(panel, true);
  } catch (error) {
    parsed = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível interpretar o comando."));
  }
}

on("curl-convert", "click", convert);
on("curl-format", "click", () => {
  clearError(errorBox);
  try {
    input.value = formatCurl(input.value);
  } catch (error) {
    showError(errorBox, message(error, "Comando inválido."));
  }
});
on("curl-clear", "click", () => {
  input.value = "";
  parsed = null;
  output.textContent = "";
  facts.innerHTML = "";
  clearError(errorBox);
  show(panel, false);
  input.focus();
});
on("curl-copy", "click", (button) => {
  if (parsed) void copyText(button, convertCurl(parsed, target));
});
for (const tab of document.querySelectorAll<HTMLElement>("[data-curl-target]")) {
  tab.addEventListener("click", () => {
    target = (tab.dataset.curlTarget ?? "playwright") as CurlTarget;
    selectTab("data-curl-target", tab);
    paint();
  });
}
runOnCtrlEnter([input], convert);
