import { formatJsonText } from "../../toolbox/json-diff.js";
import { formatSchemaValidation, validateJsonSchema, type SchemaValidationResult } from "../../toolbox/json-schema.js";
import { parseJsonInput } from "../../toolbox/json-value.js";
import { clearError, copyText, esc, message, need, on, runOnCtrlEnter, show, showError } from "./ui.js";

const schemaBox = need<HTMLTextAreaElement>("schema-input");
const payloadBox = need<HTMLTextAreaElement>("schema-payload");
const errorBox = need("schema-error");
const panel = need("schema-result-panel");
const summary = need("schema-summary");
const tabela = need("schema-violations");
const naoSuportado = need("schema-unsupported");

let last: SchemaValidationResult | null = null;

function run(): void {
  clearError(errorBox);
  try {
    const schema = parseJsonInput(schemaBox.value, "Schema");
    const payload = parseJsonInput(payloadBox.value, "Payload");
    last = validateJsonSchema(schema, payload);
    summary.innerHTML = last.valid
      ? '<span class="tool-status tool-status-ok">VÁLIDO</span><span class="tool-summary-text">O payload atende ao schema.</span>'
      : `<span class="tool-status tool-status-fail">${last.violations.length} VIOLAÇÃO(ÕES)</span><span class="tool-summary-text">O payload não atende ao schema.</span>`;
    tabela.innerHTML = last.violations
      .map(
        (violation) =>
          `<tr><th scope="row"><code>${esc(violation.instancePath)}</code></th><td><code>${esc(violation.keyword)}</code><small class="schema-pointer">${esc(violation.schemaPath)}</small></td><td>${esc(violation.message)}</td></tr>`,
      )
      .join("");
    naoSuportado.innerHTML = last.unsupported.map((keyword) => `<li>Palavra-chave não avaliada por este validador: <code>${esc(keyword)}</code></li>`).join("");
    naoSuportado.hidden = last.unsupported.length === 0;
    show(panel, true);
  } catch (error) {
    last = null;
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível validar."));
  }
}

on("schema-run", "click", run);
on("schema-format", "click", () => {
  clearError(errorBox);
  try {
    if (schemaBox.value.trim()) schemaBox.value = formatJsonText(schemaBox.value, "Schema");
    if (payloadBox.value.trim()) payloadBox.value = formatJsonText(payloadBox.value, "Payload");
  } catch (error) {
    showError(errorBox, message(error, "JSON inválido."));
  }
});
on("schema-clear", "click", () => {
  schemaBox.value = "";
  payloadBox.value = "";
  last = null;
  tabela.innerHTML = "";
  summary.innerHTML = "";
  naoSuportado.innerHTML = "";
  naoSuportado.hidden = true;
  clearError(errorBox);
  show(panel, false);
  schemaBox.focus();
});
on("schema-copy", "click", (button) => {
  if (last) void copyText(button, formatSchemaValidation(last));
});
runOnCtrlEnter([schemaBox, payloadBox], run);
