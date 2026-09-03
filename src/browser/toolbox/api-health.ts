import { HEALTH_STATE_LABELS, MAX_HEALTH_CHECKS, formatEnvironmentReport, summarizeHealth, type HealthCheckOutcome, type HealthState } from "../../toolbox/health.js";
import { clearError, copyText, esc, need, on, show, showError } from "./ui.js";

const form = need<HTMLFormElement>("health-form");
const errorBox = need("health-error");
const panel = need("health-result-panel");
const rowsBox = need("health-rows");
const resultRows = need("health-rows-result");
const summaryBox = need("health-summary");
const runButton = need<HTMLButtonElement>("health-run");
const expected = need<HTMLInputElement>("health-expected");
const maxTime = need<HTMLInputElement>("health-max-time");

let outcomes: HealthCheckOutcome[] = [];
let sequence = 0;

const STATE_CLASS: Record<HealthState, string> = { healthy: "tool-status-ok", degraded: "tool-status-warning", failed: "tool-status-fail" };

function addRow(name: string, url: string): void {
  if (rowsBox.children.length >= MAX_HEALTH_CHECKS) return;
  sequence += 1;
  const id = `health-row-${sequence}`;
  const row = document.createElement("div");
  row.className = "health-row";
  row.innerHTML =
    `<div class="tool-field"><label for="${id}-name">Serviço</label><input id="${id}-name" class="health-name" value="${esc(name)}" placeholder="Auth" maxlength="60"></div>` +
    `<div class="tool-field"><label for="${id}-url">URL</label><input id="${id}-url" class="health-url" type="url" value="${esc(url)}" placeholder="https://api.exemplo.com/health"></div>` +
    `<div class="tool-field"><label for="${id}-method">Método</label><select id="${id}-method" class="health-method"><option>GET</option><option>HEAD</option></select></div>` +
    '<button type="button" class="secondary health-remove" aria-label="Remover endpoint">×</button>';
  row.querySelector(".health-remove")?.addEventListener("click", () => {
    row.remove();
    if (!rowsBox.children.length) addRow("", "");
  });
  rowsBox.appendChild(row);
}

interface RequestedCheck {
  name: string;
  url: string;
  method: string;
}

function value(row: Element, selector: string): string {
  return row.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value.trim() ?? "";
}

function checks(): RequestedCheck[] {
  return [...rowsBox.querySelectorAll(".health-row")]
    .map((row) => ({ name: value(row, ".health-name"), url: value(row, ".health-url"), method: value(row, ".health-method") }))
    .filter((check) => check.url);
}

function render(): void {
  const summary = summarizeHealth(outcomes);
  summaryBox.innerHTML =
    `<span class="tool-status ${STATE_CLASS[summary.state]}">Environment Status: ${HEALTH_STATE_LABELS[summary.state]}</span>` +
    `<span class="tool-summary-text">${summary.checked} verificados · ${summary.healthy} healthy · ${summary.degraded} degraded · ${summary.failed} failed</span>`;
  resultRows.innerHTML = outcomes
    .map(
      (outcome) =>
        `<tr><th scope="row">${esc(outcome.name)}</th><td>${outcome.status === undefined ? "—" : `${esc(String(outcome.status))} ${esc(outcome.statusText ?? "")}`}</td><td>${outcome.durationMs === undefined ? "—" : `${esc(String(outcome.durationMs))} ms`}</td><td>${esc(outcome.contentType ?? "—")}</td><td><span class="tool-status ${STATE_CLASS[outcome.state]}">${HEALTH_STATE_LABELS[outcome.state]}</span>${outcome.reason ? `<small class="health-reason">${esc(outcome.reason)}</small>` : ""}</td></tr>`,
    )
    .join("");
  show(panel, true);
}

async function run(event?: Event): Promise<void> {
  event?.preventDefault();
  clearError(errorBox);
  const list = checks();
  if (!list.length) {
    showError(errorBox, "Informe ao menos uma URL.");
    return;
  }
  runButton.disabled = true;
  const label = runButton.textContent;
  runButton.innerHTML = '<i class="loader"></i>Verificando';
  try {
    const response = await fetch("/api/v1/toolbox/health-checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checks: list, expectedStatus: Number(expected.value), maxResponseTimeMs: Number(maxTime.value) }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; outcomes?: HealthCheckOutcome[] };
    if (!response.ok) {
      showError(errorBox, body.error ?? "Não foi possível verificar agora.");
      show(panel, false);
      return;
    }
    outcomes = body.outcomes ?? [];
    render();
  } catch {
    showError(errorBox, "Não foi possível falar com o servidor do QA Radar.");
    show(panel, false);
  } finally {
    runButton.disabled = false;
    runButton.textContent = label;
  }
}

form.addEventListener("submit", (event) => void run(event));
on("health-add", "click", () => addRow("", ""));
on("health-clear", "click", () => {
  rowsBox.innerHTML = "";
  outcomes = [];
  addRow("", "");
  clearError(errorBox);
  show(panel, false);
});
on("health-copy", "click", (button) => {
  if (outcomes.length) void copyText(button, formatEnvironmentReport(outcomes));
});
addRow("", "");
