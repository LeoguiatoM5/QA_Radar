import { currentEnvironment, ENVIRONMENT_CHANGE_EVENT, esc, signInAndReturn } from "./shared.js";

/**
 * Alertas: o que pede atenção agora, para a conta inteira.
 *
 * Os números vêm prontos de `GET /api/v1/alerts` — o servidor já pagina e
 * compara, este script só desenha o que chega. Sem filtro de propósito: a
 * granularidade é a conta, não a aplicação.
 */
type ExecutionKind = "scan" | "journey" | "api";

interface ExecutionEntry {
  id: string;
  kind: ExecutionKind;
  createdAt: string;
  title: string;
  detail: string;
  outcome: "passed" | "failed" | "running";
  durationMs?: number;
  applicationId?: string;
  applicationName?: string;
  href: string;
}

interface RegressionAlert {
  currentPassRate: number;
  previousPassRate: number;
  droppedPoints: number;
}

interface AlertsSummary {
  failures: ExecutionEntry[];
  regression?: RegressionAlert;
  windowDays: number;
  truncated: boolean;
  thresholdPoints: number;
  minSample: number;
}

const KIND_LABELS: Record<ExecutionKind, string> = { scan: "Inspeção", journey: "Jornada", api: "Teste de API" };

const unavailable = document.querySelector<HTMLElement>("#alerts-unavailable");
const errorBox = document.querySelector<HTMLElement>("#alerts-error");
const regressionPanel = document.querySelector<HTMLElement>("#alert-regression");
const regressionTitle = document.querySelector<HTMLElement>("#alert-regression-title");
const regressionDetail = document.querySelector<HTMLElement>("#alert-regression-detail");
const list = document.querySelector<HTMLElement>("#alerts-list");
const count = document.querySelector<HTMLElement>("#alerts-count");

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
}

/** `1,4s` para o que passa de um segundo, `420ms` para o resto. */
function duration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function entryHtml(entry: ExecutionEntry): string {
  const meta = [when(entry.createdAt), entry.detail, entry.applicationName].filter(Boolean).join(" · ");
  return (
    `<a class="reports-entry" href="${esc(entry.href)}">` +
    `<i aria-hidden="true"></i>` +
    `<span class="reports-main"><span class="reports-title">${esc(entry.title)}</span><span class="reports-meta">${esc(meta)}</span></span>` +
    `<span class="reports-kind">${esc(KIND_LABELS[entry.kind])}</span>` +
    `<span class="reports-duration">${esc(duration(entry.durationMs))}</span>` +
    `</a>`
  );
}

function paintRegression(summary: AlertsSummary): void {
  if (!regressionPanel) return;
  regressionPanel.hidden = false;
  // "Sem alerta" e "seção vazia sem explicação" não são a mesma coisa — a
  // tela dizia a segunda quando queria dizer a primeira (BUG-13). O painel
  // agora sempre aparece, com o limiar configurado quando não há queda.
  regressionPanel.classList.toggle("ok", !summary.regression);
  if (!summary.regression) {
    if (regressionTitle) regressionTitle.textContent = "Nenhuma queda na taxa de sucesso";
    if (regressionDetail) {
      regressionDetail.textContent = `Nenhuma queda de ${summary.thresholdPoints}pp ou mais nos últimos ${summary.windowDays} dias, com pelo menos ${summary.minSample} execuções decididas no período anterior para comparar. Ajustável em Configurações › Alertas.`;
    }
    return;
  }
  if (regressionTitle) regressionTitle.textContent = `A taxa de sucesso caiu ${summary.regression.droppedPoints}pp`;
  if (regressionDetail) {
    regressionDetail.textContent = `De ${summary.regression.previousPassRate}% para ${summary.regression.currentPassRate}%, comparado aos ${summary.windowDays} dias anteriores.`;
  }
}

function paintList(summary: AlertsSummary): void {
  if (!list) return;
  if (!summary.failures.length) {
    list.innerHTML = `<p class="hint">Nenhuma execução com falha nos últimos ${summary.windowDays} dias.</p>`;
    if (count) count.textContent = "";
    return;
  }
  list.innerHTML = summary.failures.map(entryHtml).join("");
  if (count) count.textContent = `${summary.failures.length} falha(s)`;
}

function paint(summary: AlertsSummary): void {
  paintRegression(summary);
  paintList(summary);
}

let loading = false;

async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  clearError();
  try {
    const environment = currentEnvironment();
    const response = await fetch(environment ? `/api/v1/alerts?ambiente=${encodeURIComponent(environment)}` : "/api/v1/alerts");
    if (response.status === 401) {
      signInAndReturn();
      return;
    }
    if (!response.ok) {
      showError("Não foi possível carregar os alertas agora.");
      return;
    }
    paint((await response.json()) as AlertsSummary);
  } catch {
    showError("Não foi possível falar com o servidor do QA Radar.");
  } finally {
    loading = false;
  }
}

window.addEventListener(ENVIRONMENT_CHANGE_EVENT, () => void load());

void (async () => {
  // A página inteira depende de conta: sem sessão não há o que resumir, e
  // mandar para a entrada é mais útil do que mostrar uma tela vazia.
  try {
    const session = (await (await fetch("/api/v1/auth/me")).json()) as { authenticated?: boolean; loginAvailable?: boolean };
    if (!session.loginAvailable) {
      offline("Os Alertas dependem de conta, e este servidor está sem banco de dados.");
      if (list) list.innerHTML = "";
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
  await load();
})();
