import { boundaryCasesToCsv, formatBoundaryCases, generateBoundaryCases, type BoundaryCase, type BoundaryFieldType, type BoundarySpec } from "../../toolbox/boundary-values.js";
import { clearError, copyText, downloadFile, esc, message, need, on, show, showError, stamp } from "./ui.js";

const form = need<HTMLFormElement>("boundary-form");
const errorBox = need("boundary-error");
const panel = need("boundary-result-panel");
const rows = need("boundary-rows");
const type = need<HTMLSelectElement>("boundary-type");
const stepField = need("boundary-step-field");
const step = need<HTMLInputElement>("boundary-step");
const field = need<HTMLInputElement>("boundary-field");
const minimum = need<HTMLInputElement>("boundary-min");
const maximum = need<HTMLInputElement>("boundary-max");

let lastCases: BoundaryCase[] = [];

const PRESETS: Record<BoundaryFieldType, [string, string]> = {
  integer: ["18", "65"],
  decimal: ["0.01", "999.99"],
  "string-length": ["3", "20"],
  date: ["2026-01-01", "2026-12-31"],
};

function chosenType(): BoundaryFieldType {
  return type.value as BoundaryFieldType;
}

function syncType(): void {
  stepField.hidden = chosenType() !== "decimal";
  const preset = PRESETS[chosenType()] as [string, string] | undefined;
  if (preset) {
    minimum.value = preset[0];
    maximum.value = preset[1];
  }
  minimum.placeholder = preset ? preset[0] : "";
  maximum.placeholder = preset ? preset[1] : "";
}

function render(cases: readonly BoundaryCase[]): void {
  rows.innerHTML = cases
    .map(
      (item) =>
        `<tr class="${item.valid ? "boundary-valid" : "boundary-invalid"}"><th scope="row">${esc(item.id)}</th><td><code>${esc(item.display)}</code></td><td><span class="tool-status ${item.valid ? "tool-status-ok" : "tool-status-fail"}">${item.valid ? "VALID" : "INVALID"}</span></td><td>${esc(item.title)}</td></tr>`,
    )
    .join("");
}

function run(event?: Event): void {
  event?.preventDefault();
  clearError(errorBox);
  try {
    const spec: BoundarySpec = { field: field.value, type: chosenType(), minimum: minimum.value, maximum: maximum.value };
    if (spec.type === "decimal") spec.step = Number(step.value);
    lastCases = generateBoundaryCases(spec);
    render(lastCases);
    show(panel, true);
  } catch (error) {
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível gerar os casos."));
  }
}

type.addEventListener("change", syncType);
form.addEventListener("submit", run);
on("boundary-clear", "click", () => {
  lastCases = [];
  clearError(errorBox);
  show(panel, false);
  field.value = "";
  minimum.value = "";
  maximum.value = "";
  field.focus();
});
on("boundary-copy", "click", (button) => {
  if (lastCases.length) void copyText(button, formatBoundaryCases(lastCases));
});
on("boundary-download", "click", () => {
  if (lastCases.length) downloadFile(`boundary-values-${stamp()}.csv`, boundaryCasesToCsv(lastCases), "text/csv");
});
syncType();
