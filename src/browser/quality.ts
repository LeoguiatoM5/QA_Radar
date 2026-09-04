import { currentEnvironment, ENVIRONMENT_CHANGE_EVENT, esc, signInAndReturn } from "./shared.js";

/**
 * Central de qualidade: o resumo da conta, não a lista de execuções.
 *
 * Os números vêm prontos de `GET /api/v1/quality/summary` — o servidor já soma
 * a linha do tempo, porque o histórico de uma conta ativa não cabe em memória
 * no navegador. Este script só desenha o que chega.
 */
type ExecutionKind = "scan" | "journey" | "api";

interface QualityCounts {
  total: number;
  passed: number;
  failed: number;
  running: number;
  passRate?: number;
}

interface QualityApplicationSummary extends QualityCounts {
  applicationId?: string;
  applicationName?: string;
  lastRunAt: string;
}

interface QualityDailyBucket {
  date: string;
  total: number;
  passed: number;
  failed: number;
}

interface QualitySummary {
  current: QualityCounts;
  previous?: QualityCounts;
  byKind: Record<ExecutionKind, QualityCounts>;
  byApplication: QualityApplicationSummary[];
  daily: QualityDailyBucket[];
  truncated: boolean;
}

const KIND_LABELS: Record<ExecutionKind, string> = { scan: "Inspeção", journey: "Jornada", api: "Teste de API" };
const KIND_ORDER: readonly ExecutionKind[] = ["scan", "journey", "api"];

const unavailable = document.querySelector<HTMLElement>("#quality-unavailable");
const applicationSelect = document.querySelector<HTMLSelectElement>("#quality-application");
const periodSelect = document.querySelector<HTMLSelectElement>("#quality-period");
const errorBox = document.querySelector<HTMLElement>("#quality-error");
const truncatedHint = document.querySelector<HTMLElement>("#quality-truncated-hint");
const summaryNote = document.querySelector<HTMLElement>("#quality-summary-note");
const trend = document.querySelector<HTMLElement>("#quality-trend");
const trendNote = document.querySelector<HTMLElement>("#quality-trend-note");
const trendLegend = document.querySelector<HTMLElement>("#quality-trend-legend");
/** Abaixo disto o gráfico é quase todo traço vazio — a barra isolada que o
 * relatório de 04/09/2026 (BUG-21) descreveu não comunicava tendência
 * nenhuma. Um aviso explícito diz mais do que 96% de área em branco. */
const MIN_TREND_EXECUTIONS = 3;
const kindGrid = document.querySelector<HTMLElement>("#quality-kind-grid");
const appTable = document.querySelector<HTMLElement>("#quality-app-table");

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function clearError(): void {
  if (!errorBox) return;
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

function offline(reason: string): void {
  if (!unavailable) return;
  unavailable.textContent = reason;
  unavailable.hidden = false;
  for (const field of [applicationSelect, periodSelect]) if (field) field.disabled = true;
}

function set(id: string, value: string): void {
  const field = document.querySelector<HTMLElement>(`#${id}`);
  if (field) field.textContent = value;
}

function rate(value: number | undefined): string {
  return value === undefined ? "—" : `${value}%`;
}

function relativeWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function paintSummary(summary: QualitySummary): void {
  set("quality-total", String(summary.current.total));
  set("quality-passed", String(summary.current.passed));
  set("quality-failed", String(summary.current.failed));
  set("quality-rate", rate(summary.current.passRate));

  const delta = document.querySelector<HTMLElement>("#quality-rate-delta");
  if (delta) {
    const before = summary.previous?.passRate;
    const after = summary.current.passRate;
    if (before === undefined || after === undefined) {
      delta.className = "quality-delta";
      delta.textContent = "";
    } else {
      const difference = after - before;
      delta.className = `quality-delta${difference > 0 ? " good" : difference < 0 ? " bad" : ""}`;
      delta.textContent = difference ? `${Math.abs(difference)}pp vs período anterior` : "";
    }
  }

  if (summaryNote) {
    summaryNote.textContent = summary.previous
      ? `Calculado sobre ${summary.current.total} execução(ões) do período, contra ${summary.previous.total} no período anterior.`
      : `Calculado sobre ${summary.current.total} execução(ões) desde o começo. Sem período, não há um anterior para comparar.`;
  }

  if (truncatedHint) truncatedHint.hidden = !summary.truncated;
}

function paintTrend(summary: QualitySummary): void {
  if (!trend) return;
  if (!summary.daily.length) {
    trend.innerHTML = '<p class="hint">Escolha um período para ver a tendência diária.</p>';
    if (trendNote) trendNote.textContent = "";
    if (trendLegend) trendLegend.hidden = true;
    return;
  }
  if (summary.current.total < MIN_TREND_EXECUTIONS) {
    const faltam = MIN_TREND_EXECUTIONS - summary.current.total;
    trend.innerHTML = `<p class="hint">Dados insuficientes para uma tendência confiável: ${summary.current.total} execução(ões) no período. Rode mais ${faltam} para começar a ver o gráfico.</p>`;
    if (trendNote) trendNote.textContent = "";
    if (trendLegend) trendLegend.hidden = true;
    return;
  }
  if (trendLegend) trendLegend.hidden = false;
  const max = Math.max(1, ...summary.daily.map((day) => day.total));
  const scale = 100; // altura máxima da barra, em pixels — bate com a altura do container no CSS
  trend.innerHTML = summary.daily
    .map((day) => {
      const label = `${new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}: ${day.total} execução(ões), ${day.passed} sem falha, ${day.failed} com falha`;
      // Dia sem execução vira um traço neutro, não uma barra "em execução" — o
      // amarelo é para execução de verdade ainda em andamento, não para vazio.
      if (!day.total) return `<div class="quality-bar quality-bar-empty" style="height:3px" title="${esc(label)}"></div>`;
      const height = Math.max(6, Math.round((day.total / max) * scale));
      const passedHeight = Math.round((day.passed / day.total) * 100);
      const failedHeight = Math.round((day.failed / day.total) * 100);
      const runningHeight = Math.max(0, 100 - passedHeight - failedHeight);
      return `<div class="quality-bar" style="height:${height}px" title="${esc(label)}"><b style="height:${failedHeight}%"></b><u style="height:${runningHeight}%"></u><i style="height:${passedHeight}%"></i></div>`;
    })
    .join("");
  if (trendNote) trendNote.textContent = `${summary.daily[0]?.date} a ${summary.daily[summary.daily.length - 1]?.date}`;
}

function paintKinds(summary: QualitySummary): void {
  if (!kindGrid) return;
  kindGrid.innerHTML = KIND_ORDER.map((kind) => {
    const counts = summary.byKind[kind];
    return `<div class="quality-kind-card"><small>${esc(KIND_LABELS[kind])}</small><strong>${rate(counts.passRate)}</strong><em>${counts.total} execução(ões) · ${counts.passed} sem falha · ${counts.failed} com falha</em></div>`;
  }).join("");
}

function paintApplications(summary: QualitySummary): void {
  if (!appTable) return;
  if (!summary.byApplication.length) {
    appTable.innerHTML = '<p class="hint">Nenhuma execução no período escolhido. Rode uma Inspeção, uma Jornada ou um Teste de API para começar.</p>';
    return;
  }
  appTable.innerHTML = summary.byApplication
    .map((application) => {
      const rateClass = application.passRate === undefined ? "" : application.passRate >= 85 ? "high" : application.passRate < 50 ? "low" : "";
      return (
        `<div class="quality-app-row">` +
        `<span class="quality-app-name">${esc(application.applicationName ?? "Sem aplicação")}</span>` +
        `<span class="quality-app-count">${application.total} execução(ões)</span>` +
        `<span class="quality-app-rate ${rateClass}">${rate(application.passRate)}</span>` +
        `<span class="quality-app-last">${esc(relativeWhen(application.lastRunAt))}</span>` +
        `</div>`
      );
    })
    .join("");
}

function paint(summary: QualitySummary): void {
  paintSummary(summary);
  paintTrend(summary);
  paintKinds(summary);
  paintApplications(summary);
}

/** O `de` da consulta, a partir do período escolhido. */
function since(): string | undefined {
  const days = Number(periodSelect?.value ?? "");
  if (!days) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

let loading = false;

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  clearError();
  try {
    const params = new URLSearchParams();
    if (applicationSelect?.value) params.set("aplicacao", applicationSelect.value);
    const environment = currentEnvironment();
    if (environment) params.set("ambiente", environment);
    const from = since();
    if (from) params.set("de", from);
    const response = await fetch(`/api/v1/quality/summary?${params.toString()}`);
    if (response.status === 401) {
      signInAndReturn();
      return;
    }
    if (!response.ok) {
      showError("Não foi possível carregar o resumo agora.");
      return;
    }
    paint((await response.json()) as QualitySummary);
  } catch {
    showError("Não foi possível falar com o servidor do QA Radar.");
  } finally {
    loading = false;
  }
}

async function loadApplications(): Promise<void> {
  if (!applicationSelect) return;
  try {
    const response = await fetch("/api/v1/applications?arquivadas=1");
    if (!response.ok) return;
    for (const application of ((await response.json()) as { applications?: Array<{ id: string; name: string }> }).applications ?? []) {
      const option = document.createElement("option");
      option.value = application.id;
      option.textContent = application.name;
      applicationSelect.append(option);
    }
    const wanted = new URLSearchParams(location.search).get("aplicacao");
    if (wanted && [...applicationSelect.options].some((option) => option.value === wanted)) applicationSelect.value = wanted;
  } catch {
    // Sem a lista, o filtro fica em "Todas" — o resumo continua o da conta inteira.
  }
}

for (const field of [applicationSelect, periodSelect]) {
  field?.addEventListener("change", () => void load());
}
window.addEventListener(ENVIRONMENT_CHANGE_EVENT, () => void load());

void (async () => {
  // A página inteira depende de conta: sem sessão não há o que somar, e mandar
  // para a entrada é mais útil do que mostrar zeros.
  try {
    const session = (await (await fetch("/api/v1/auth/me")).json()) as { authenticated?: boolean; loginAvailable?: boolean };
    if (!session.loginAvailable) {
      offline("A Central de qualidade depende de conta, e este servidor está sem banco de dados.");
      if (trend) trend.innerHTML = "";
      if (trendLegend) trendLegend.hidden = true;
      if (kindGrid) kindGrid.innerHTML = "";
      if (appTable) appTable.innerHTML = "";
      return;
    }
    if (!session.authenticated) {
      signInAndReturn();
      return;
    }
  } catch {
    // Sem resposta do /auth/me, tenta carregar mesmo assim: o 401 da consulta
    // resolve pelo mesmo caminho.
  }
  await loadApplications();
  await load();
})();
