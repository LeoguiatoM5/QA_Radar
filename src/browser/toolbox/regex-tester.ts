import { formatRegexResult, testRegex, type RegexMatchResult, type RegexTestResult } from "../../toolbox/regex-tester.js";
import { clearError, copyText, esc, message, need, on, runOnCtrlEnter, show, showError } from "./ui.js";

const pattern = need<HTMLInputElement>("regex-pattern");
const flags = need<HTMLInputElement>("regex-flags");
const subject = need<HTMLTextAreaElement>("regex-subject");
const errorBox = need("regex-error");
const panel = need("regex-result-panel");
const summary = need("regex-summary");
const warnings = need("regex-warnings");
const linesBox = need("regex-lines");
const matchesBox = need("regex-matches");

let last: RegexTestResult | null = null;

function grupos(match: RegexMatchResult): string {
  const uteis = match.groups.filter((group) => group.value !== undefined);
  return uteis.length ? uteis.map((group) => `<code>${esc(group.name)}</code>: ${esc(group.value)}`).join("<br>") : "—";
}

function run(): void {
  clearError(errorBox);
  try {
    last = testRegex(pattern.value, flags.value, subject.value);
    const linhasComCasamento = new Set(last.matches.map((match) => match.line)).size;
    summary.innerHTML =
      last.matches.length === 0
        ? '<span class="tool-status tool-status-warning">SEM CASAMENTO</span><span class="tool-summary-text">A expressão é válida, mas não casou com nada do texto.</span>'
        : `<span class="tool-status tool-status-ok">${last.matches.length} CASAMENTO(S)</span><span class="tool-summary-text">em ${linhasComCasamento} de ${last.lines.length} linha(s)</span>`;
    warnings.innerHTML = last.warnings.map((aviso) => `<li>${esc(aviso)}</li>`).join("");
    warnings.hidden = last.warnings.length === 0;
    linesBox.innerHTML = last.lines
      .map(
        (line) =>
          `<div class="regex-line-row ${line.matched ? "matched" : ""}"><span class="regex-line-number">${line.number}</span><code>${line.text === "" ? "<i>(vazia)</i>" : esc(line.text)}</code></div>`,
      )
      .join("");
    matchesBox.innerHTML = last.matches
      .map(
        (match, index) =>
          `<tr><th scope="row">${index + 1}</th><td>${match.line}</td><td>${match.index}</td><td><code>${match.value === "" ? "<i>(vazio)</i>" : esc(match.value)}</code></td><td>${grupos(match)}</td></tr>`,
      )
      .join("");
    show(panel, true);
  } catch (error) {
    last = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível testar a expressão."));
  }
}

on("regex-run", "click", run);
on("regex-clear", "click", () => {
  pattern.value = "";
  subject.value = "";
  last = null;
  summary.innerHTML = "";
  linesBox.innerHTML = "";
  matchesBox.innerHTML = "";
  warnings.innerHTML = "";
  warnings.hidden = true;
  clearError(errorBox);
  show(panel, false);
  pattern.focus();
});
on("regex-copy", "click", (button) => {
  if (last) void copyText(button, formatRegexResult(last));
});
runOnCtrlEnter([pattern, flags, subject], run);
