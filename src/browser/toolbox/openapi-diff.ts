import { API_CHANGE_LABELS, diffOpenApi, formatOpenApiDiff, type ApiChangeImpact, type OpenApiDiffResult } from "../../toolbox/openapi-diff.js";
import { parseYaml } from "../../toolbox/yaml.js";
import type { JsonValue } from "../../toolbox/json-value.js";
import { clearError, copyText, esc, message, need, on, selectTab, show, showError } from "./ui.js";

const left = need<HTMLTextAreaElement>("oas-left");
const right = need<HTMLTextAreaElement>("oas-right");
const errorBox = need("oas-error");
const panel = need("oas-result-panel");
const summary = need("oas-summary");
const listaBox = need("oas-changes");
const vazio = need("oas-empty");

let last: OpenApiDiffResult | null = null;
let filtro = "todas";

const CLASSE: Record<ApiChangeImpact, string> = { breaking: "diff-removed", note: "diff-changed", addition: "diff-added" };

function paint(): void {
  if (!last) return;
  const visiveis = last.changes.filter((change) => filtro === "todas" || change.impact === filtro);
  listaBox.innerHTML = visiveis
    .map(
      (change) =>
        `<div class="diff-entry ${CLASSE[change.impact]}"><span class="diff-kind">${API_CHANGE_LABELS[change.impact]}</span><div class="diff-body"><code class="diff-path">${esc(change.location)}</code><div class="diff-values">${esc(change.message)}</div><small class="diff-types">${esc(change.pointer)}</small></div></div>`,
    )
    .join("");
  show(vazio, visiveis.length === 0);
}

function ler(campo: HTMLTextAreaElement, rotulo: string): JsonValue {
  try {
    return parseYaml(campo.value);
  } catch (error) {
    throw new Error(`${rotulo}: ${message(error, "documento inválido.")}`);
  }
}

function run(): void {
  clearError(errorBox);
  try {
    last = diffOpenApi(ler(left, "Contrato atual"), ler(right, "Contrato novo"));
    summary.innerHTML =
      `<span class="tool-status ${last.breaking ? "tool-status-fail" : "tool-status-ok"}">${last.breaking ? "HÁ QUEBRA" : "COMPATÍVEL"}</span>` +
      `<span class="tool-summary-text">${esc(last.from)} → ${esc(last.to)} · ${last.counts.breaking} breaking · ${last.counts.note} note · ${last.counts.addition} addition</span>`;
    paint();
    show(panel, true);
  } catch (error) {
    last = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível comparar."));
  }
}

on("oas-run", "click", run);
on("oas-swap", "click", () => {
  const buffer = left.value;
  left.value = right.value;
  right.value = buffer;
  if (last) run();
});
on("oas-clear", "click", () => {
  left.value = "";
  right.value = "";
  last = null;
  listaBox.innerHTML = "";
  summary.innerHTML = "";
  clearError(errorBox);
  show(panel, false);
  left.focus();
});
on("oas-copy", "click", (button) => {
  if (last) void copyText(button, formatOpenApiDiff(last));
});
for (const aba of document.querySelectorAll<HTMLElement>("[data-oas-filter]")) {
  aba.addEventListener("click", () => {
    filtro = aba.dataset.oasFilter ?? "todas";
    selectTab("data-oas-filter", aba);
    paint();
  });
}
