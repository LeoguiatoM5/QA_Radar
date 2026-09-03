import { generateTestData, testDataToCsv, testDataToSql, type TestDataField, type TestDataFieldType, type TestDataMode, type TestDataRow } from "../../toolbox/test-data.js";
import { clearError, copyText, downloadFile, message, need, on, selectTab, show, showError, stamp } from "./ui.js";

const errorBox = need("data-error");
const panel = need("data-result-panel");
const output = need("data-output");
const table = need<HTMLInputElement>("data-table");
const countField = need<HTMLInputElement>("data-count");

type OutputFormat = "json" | "csv" | "sql";

let rows: TestDataRow[] = [];
let format: OutputFormat = "json";

function selectedFields(): TestDataField[] {
  return [...document.querySelectorAll<HTMLInputElement>("[data-field-type]")]
    .filter((box) => box.checked)
    .map((box) => {
      const type = (box.dataset.fieldType ?? "") as TestDataFieldType;
      const key = document.querySelector<HTMLInputElement>(`[data-field-key="${type}"]`);
      const mode = document.querySelector<HTMLSelectElement>(`[data-field-mode="${type}"]`);
      return { type, key: key?.value.trim() ?? "", mode: (mode?.value ?? "valid") as TestDataMode };
    });
}

function serialize(): string {
  if (!rows.length) return "";
  if (format === "csv") return testDataToCsv(rows);
  if (format === "sql") return testDataToSql(rows, table.value.trim());
  return JSON.stringify(rows, null, 2);
}

function paint(): void {
  output.textContent = serialize();
}

function run(): void {
  clearError(errorBox);
  try {
    rows = generateTestData({ fields: selectedFields(), count: Number(countField.value) });
    paint();
    show(panel, true);
  } catch (error) {
    rows = [];
    show(panel, false);
    showError(errorBox, message(error, "Não foi possível gerar a massa."));
  }
}

on("data-generate", "click", run);
on("data-regenerate", "click", run);
on("data-clear", "click", () => {
  rows = [];
  output.textContent = "";
  clearError(errorBox);
  show(panel, false);
  for (const box of document.querySelectorAll<HTMLInputElement>("[data-field-type]")) box.checked = false;
});
for (const tab of document.querySelectorAll<HTMLElement>("[data-data-format]")) {
  tab.addEventListener("click", () => {
    format = (tab.dataset.dataFormat ?? "json") as OutputFormat;
    selectTab("data-data-format", tab);
    paint();
  });
}
on("data-copy", "click", (button) => {
  if (rows.length) void copyText(button, serialize());
});
on("data-download-json", "click", () => {
  if (rows.length) downloadFile(`test-data-${stamp()}.json`, JSON.stringify(rows, null, 2), "application/json");
});
on("data-download-csv", "click", () => {
  if (rows.length) downloadFile(`test-data-${stamp()}.csv`, testDataToCsv(rows), "text/csv");
});
// Marcar o campo já sugere o nome da propriedade; desmarcar não apaga o que a
// pessoa escreveu, para que remarcar não custe digitar de novo.
for (const box of document.querySelectorAll<HTMLInputElement>("[data-field-type]")) {
  box.addEventListener("change", () => {
    if (!box.checked) return;
    const key = document.querySelector<HTMLInputElement>(`[data-field-key="${box.dataset.fieldType ?? ""}"]`);
    if (key && !key.value.trim()) key.value = box.dataset.fieldType ?? "";
  });
}
