import { TIMESTAMP_SOURCE_LABELS, describeTimestamp, parseTimestampInput } from "../../toolbox/timestamp.js";
import { clearError, copyText, esc, message, need, on, show, showError } from "./ui.js";

const input = need<HTMLInputElement>("timestamp-input");
const errorBox = need("timestamp-error");
const panel = need("timestamp-result-panel");
const summary = need("timestamp-summary");
const warnings = need("timestamp-warnings");
const facts = need("timestamp-facts");

let last: Array<[string, string]> | null = null;

function fact(termo: string, valor: string): string {
  return `<div><dt>${esc(termo)}</dt><dd>${esc(valor)}</dd></div>`;
}

function run(): void {
  clearError(errorBox);
  try {
    const leitura = parseTimestampInput(input.value);
    const breakdown = describeTimestamp(leitura.epochMs);
    last = [
      ["Interpretado como", TIMESTAMP_SOURCE_LABELS[leitura.source]],
      ["Epoch (segundos)", String(breakdown.epochSeconds)],
      ["Epoch (milissegundos)", String(breakdown.epochMilliseconds)],
      ["ISO 8601 (UTC)", breakdown.iso],
      ["UTC por extenso", breakdown.utc],
      [`Fuso local (${breakdown.timeZone})`, breakdown.local],
      // BUG-27 do relatório de 04/09/2026: o dia da semana é calculado no
      // fuso local (mesma fonte de `Fuso local`, na linha de cima), mas o
      // rótulo não dizia — perto da meia-noite, UTC e local caem em dias
      // diferentes, e a tela já mostra os dois horários por extenso lado a
      // lado sem dizer qual deles este dia da semana acompanha.
      ["Dia da semana (fuso local)", breakdown.weekday],
      ["Relativo a agora", breakdown.relative],
    ];
    summary.innerHTML = `<span class="tool-status tool-status-ok">${TIMESTAMP_SOURCE_LABELS[leitura.source].toUpperCase()}</span><span class="tool-summary-text">${esc(breakdown.relative)}</span>`;
    warnings.innerHTML = leitura.warnings.map((aviso) => `<li>${esc(aviso)}</li>`).join("");
    warnings.hidden = leitura.warnings.length === 0;
    facts.innerHTML = last.map(([termo, valor]) => fact(termo, valor)).join("");
    show(panel, true);
  } catch (error) {
    last = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível converter."));
  }
}

on("timestamp-run", "click", run);
on("timestamp-now", "click", () => {
  input.value = "";
  run();
});
on("timestamp-clear", "click", () => {
  input.value = "";
  last = null;
  facts.innerHTML = "";
  summary.innerHTML = "";
  warnings.innerHTML = "";
  warnings.hidden = true;
  clearError(errorBox);
  show(panel, false);
  input.focus();
});
on("timestamp-copy", "click", (button) => {
  if (last) void copyText(button, last.map(([termo, valor]) => `${termo}: ${valor}`).join("\n"));
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    run();
  }
});
