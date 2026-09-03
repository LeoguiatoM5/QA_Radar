import { MAX_PAIRWISE_PARAMETERS, formatPairwiseCases, generatePairwise, pairwiseToCsv, type PairwiseParameter, type PairwiseResult } from "../../toolbox/pairwise.js";
import { clearError, copyText, downloadFile, esc, message, need, on, show, showError, stamp } from "./ui.js";

const form = need<HTMLFormElement>("pairwise-form");
const rowsBox = need("pairwise-rows");
const errorBox = need("pairwise-error");
const panel = need("pairwise-result-panel");
const head = need("pairwise-head");
const body = need("pairwise-body");
const summary = need("pairwise-summary");

let last: PairwiseResult | null = null;
let sequence = 100;

function addRow(nome: string, valores: string): void {
  if (rowsBox.children.length >= MAX_PAIRWISE_PARAMETERS) return;
  sequence += 1;
  const id = `pairwise-${sequence}`;
  const row = document.createElement("div");
  row.className = "pairwise-row";
  row.innerHTML =
    `<div class="tool-field"><label for="${id}-name">Parâmetro</label><input id="${id}-name" class="pairwise-name" maxlength="40" value="${esc(nome)}" placeholder="navegador"></div>` +
    `<div class="tool-field"><label for="${id}-values">Valores</label><input id="${id}-values" class="pairwise-values" value="${esc(valores)}" placeholder="chromium, firefox, webkit"></div>` +
    '<button type="button" class="secondary pairwise-remove" aria-label="Remover parâmetro">×</button>';
  rowsBox.appendChild(row);
}

function field(row: Element, selector: string): string {
  return row.querySelector<HTMLInputElement>(selector)?.value ?? "";
}

function parametros(): PairwiseParameter[] {
  return [...rowsBox.querySelectorAll(".pairwise-row")].map((row) => ({
    name: field(row, ".pairwise-name"),
    values: field(row, ".pairwise-values")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  }));
}

function render(result: PairwiseResult): void {
  const colunas = Object.keys(result.rows[0] ?? {});
  head.innerHTML = `<tr><th scope="col">Caso</th>${colunas.map((coluna) => `<th scope="col">${esc(coluna)}</th>`).join("")}</tr>`;
  body.innerHTML = result.rows.map((row, index) => `<tr><th scope="row">TC${String(index + 1).padStart(3, "0")}</th>${colunas.map((coluna) => `<td>${esc(row[coluna])}</td>`).join("")}</tr>`).join("");
  summary.innerHTML =
    `<span class="tool-status tool-status-ok">${result.rows.length} CASO(S)</span>` +
    `<span class="tool-summary-text">${result.exhaustive} combinações completas · ${result.pairs} pares cobertos · ${result.reduction}% de redução</span>`;
  show(panel, true);
}

function run(event?: Event): void {
  event?.preventDefault();
  clearError(errorBox);
  try {
    last = generatePairwise(parametros());
    render(last);
  } catch (error) {
    last = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível gerar as combinações."));
  }
}

rowsBox.addEventListener("click", (event) => {
  const alvo = event.target;
  const botao = alvo instanceof Element ? alvo.closest(".pairwise-remove") : null;
  botao?.closest(".pairwise-row")?.remove();
  if (botao && !rowsBox.children.length) addRow("", "");
});
form.addEventListener("submit", run);
on("pairwise-add", "click", () => addRow("", ""));
on("pairwise-clear", "click", () => {
  rowsBox.innerHTML = "";
  for (let index = 0; index < 2; index += 1) addRow("", "");
  last = null;
  head.innerHTML = "";
  body.innerHTML = "";
  summary.innerHTML = "";
  clearError(errorBox);
  show(panel, false);
});
on("pairwise-copy", "click", (button) => {
  if (last) void copyText(button, formatPairwiseCases(last.rows));
});
on("pairwise-download", "click", () => {
  if (last) downloadFile(`pairwise-${stamp()}.csv`, pairwiseToCsv(last.rows), "text/csv");
});
