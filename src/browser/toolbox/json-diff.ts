import { JSON_DIFF_LABELS, diffJson, formatJsonDiff, formatJsonText, type JsonDiffEntry, type JsonDiffResult } from "../../toolbox/json-diff.js";
import { parseJsonInput, type JsonValue } from "../../toolbox/json-value.js";
import { clearError, copyText, downloadFile, esc, message, need, on, runOnCtrlEnter, show, showError, stamp } from "./ui.js";

const left = need<HTMLTextAreaElement>("diff-left");
const right = need<HTMLTextAreaElement>("diff-right");
const ignore = need<HTMLInputElement>("diff-ignore");
const errorBox = need("diff-error");
const panel = need("diff-result-panel");
const summary = need("diff-summary");
const list = need("diff-list");
const ignored = need("diff-ignored");

let lastResult: JsonDiffResult | null = null;

function ignoreRules(): string[] {
  return ignore.value
    .split(",")
    .map((rule) => rule.trim())
    .filter(Boolean);
}

function preview(value: JsonValue | undefined): string {
  return value === undefined ? "—" : JSON.stringify(value);
}

function renderEntry(entry: JsonDiffEntry): string {
  const rows =
    entry.kind === "added"
      ? `<span class="diff-after">${esc(preview(entry.after))}</span>`
      : entry.kind === "removed"
        ? `<span class="diff-before">${esc(preview(entry.before))}</span>`
        : `<span class="diff-before">${esc(preview(entry.before))}</span><span class="diff-arrow" aria-hidden="true">↓</span><span class="diff-after">${esc(preview(entry.after))}</span>`;
  const types = entry.kind === "type_changed" ? `<small class="diff-types">${esc(entry.beforeKind)} → ${esc(entry.afterKind)}</small>` : "";
  return `<div class="diff-entry diff-${entry.kind}"><span class="diff-kind">${JSON_DIFF_LABELS[entry.kind]}</span><div class="diff-body"><code class="diff-path">${esc(entry.path)}</code><div class="diff-values">${rows}</div>${types}</div></div>`;
}

function run(): void {
  clearError(errorBox);
  try {
    const before = parseJsonInput(left.value, "Original");
    const after = parseJsonInput(right.value, "Comparar com");
    const result = diffJson(before, after, { ignore: ignoreRules() });
    lastResult = result;
    show(panel, true);
    summary.innerHTML = result.equal
      ? '<span class="tool-status tool-status-ok">SEM DIFERENÇAS</span><span class="tool-summary-text">Os dois JSON são equivalentes com as regras aplicadas.</span>'
      : `<span class="tool-status tool-status-warning">${result.entries.length} DIFERENÇA(S)</span><span class="tool-summary-text">${result.counts.added} adicionada(s) · ${result.counts.removed} removida(s) · ${result.counts.changed} alterada(s) · ${result.counts.type_changed} com mudança de tipo</span>`;
    list.innerHTML = result.entries.map(renderEntry).join("");
    if (result.ignored.length) {
      ignored.hidden = false;
      ignored.textContent = `Campos ignorados nesta comparação: ${result.ignored.join(", ")}`;
    } else ignored.hidden = true;
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível comparar."));
  }
}

on("diff-run", "click", run);
on("diff-format", "click", () => {
  clearError(errorBox);
  try {
    if (left.value.trim()) left.value = formatJsonText(left.value, "Original");
    if (right.value.trim()) right.value = formatJsonText(right.value, "Comparar com");
  } catch (error) {
    showError(errorBox, message(error, "JSON inválido."));
  }
});
on("diff-swap", "click", () => {
  const buffer = left.value;
  left.value = right.value;
  right.value = buffer;
  if (lastResult) run();
});
on("diff-clear", "click", () => {
  left.value = "";
  right.value = "";
  ignore.value = "";
  lastResult = null;
  // Esconder o painel não basta: o payload comparado continuaria no DOM,
  // visível no inspetor e em qualquer captura de tela. Numa ferramenta que
  // promete não mandar nada para fora, "Limpar" tem de apagar de verdade.
  list.innerHTML = "";
  summary.innerHTML = "";
  ignored.textContent = "";
  ignored.hidden = true;
  clearError(errorBox);
  show(panel, false);
  left.focus();
});
on("diff-copy", "click", (button) => {
  if (lastResult) void copyText(button, formatJsonDiff(lastResult));
});
on("diff-download", "click", () => {
  if (lastResult) downloadFile(`json-diff-${stamp()}.txt`, formatJsonDiff(lastResult), "text/plain");
});
runOnCtrlEnter([left, right, ignore], run);
