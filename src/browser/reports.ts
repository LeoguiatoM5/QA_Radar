import { currentEnvironment, ENVIRONMENT_CHANGE_EVENT, esc, signInAndReturn } from "./shared.js";

/**
 * Relatórios: a linha do tempo consultável das três origens.
 *
 * Os filtros de aplicação, tipo e período vão para a consulta — é o servidor
 * que corta, porque o histórico de uma conta ativa não cabe no navegador. A
 * busca por texto refina o que já veio, e a tela diz isso em voz alta: um filtro
 * que parece consultar tudo mas só olha a página carregada é pior do que um
 * filtro assumidamente local.
 */
interface ExecutionEntry {
  id: string;
  kind: "scan" | "journey" | "api";
  createdAt: string;
  title: string;
  detail: string;
  outcome: "passed" | "failed" | "running";
  durationMs?: number;
  applicationId?: string;
  applicationName?: string;
  href: string;
}

const KIND_LABELS: Record<ExecutionEntry["kind"], string> = { scan: "Inspeção", journey: "Jornada", api: "API" };

const PAGE_SIZE = 50;

const unavailable = document.querySelector<HTMLElement>("#reports-unavailable");
const applicationSelect = document.querySelector<HTMLSelectElement>("#reports-application");
const kindSelect = document.querySelector<HTMLSelectElement>("#reports-kind");
const periodSelect = document.querySelector<HTMLSelectElement>("#reports-period");
const searchField = document.querySelector<HTMLInputElement>("#reports-search");
const list = document.querySelector<HTMLElement>("#reports-list");
const countLabel = document.querySelector<HTMLElement>("#reports-count");
const errorBox = document.querySelector<HTMLElement>("#reports-error");
const moreButton = document.querySelector<HTMLButtonElement>("#reports-more");
const summaryNote = document.querySelector<HTMLElement>("#reports-summary-note");

let loaded: ExecutionEntry[] = [];
let cursor: string | undefined;
let loading = false;

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
  for (const field of [applicationSelect, kindSelect, periodSelect, searchField]) if (field) field.disabled = true;
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
  const dot = entry.outcome === "passed" ? "pass" : entry.outcome === "running" ? "running" : "";
  return (
    `<a class="reports-entry" href="${esc(entry.href)}">` +
    `<i class="${dot}" aria-hidden="true"></i>` +
    `<span class="reports-main"><span class="reports-title">${esc(entry.title)}</span><span class="reports-meta">${esc(meta)}</span></span>` +
    `<span class="reports-kind">${esc(KIND_LABELS[entry.kind])}</span>` +
    `<span class="reports-duration">${esc(duration(entry.durationMs))}</span>` +
    `</a>`
  );
}

/** O que a busca por texto deixa passar, dentro do que já foi carregado. */
function visible(): ExecutionEntry[] {
  const term = searchField?.value.trim().toLocaleLowerCase("pt-BR") ?? "";
  if (!term) return loaded;
  return loaded.filter((entry) => `${entry.title} ${entry.detail} ${entry.applicationName ?? ""}`.toLocaleLowerCase("pt-BR").includes(term));
}

function paintSummary(entries: readonly ExecutionEntry[]): void {
  const finished = entries.filter((entry) => entry.outcome !== "running");
  const passed = finished.filter((entry) => entry.outcome === "passed").length;
  const failed = finished.length - passed;
  const set = (id: string, value: string): void => {
    const field = document.querySelector<HTMLElement>(`#${id}`);
    if (field) field.textContent = value;
  };
  set("reports-total", String(entries.length));
  set("reports-passed", String(passed));
  set("reports-failed", String(failed));
  set("reports-rate", finished.length ? `${Math.round((passed / finished.length) * 100)}%` : "—");
  if (summaryNote) {
    // O número é sobre o que está carregado, e a nota diz isso. Um resumo que
    // parece do período inteiro mas só cobre a primeira página é um número
    // errado com cara de certo.
    summaryNote.textContent = cursor
      ? `Calculado sobre as ${entries.length} execuções carregadas. Há mais no período — use "Carregar mais".`
      : `Calculado sobre as ${entries.length} execuções do período.`;
  }
}

function paint(): void {
  if (!list) return;
  const entries = visible();
  list.innerHTML = entries.length
    ? entries.map(entryHtml).join("")
    : loaded.length
      ? '<p class="hint">Nenhuma execução carregada bate com a busca.</p>'
      : '<p class="hint">Nenhuma execução no período escolhido. Rode uma Inspeção, uma Jornada ou um Teste de API para começar.</p>';
  if (countLabel) countLabel.textContent = entries.length === loaded.length ? "" : `${entries.length} de ${loaded.length} carregadas`;
  if (moreButton) moreButton.hidden = !cursor;
  paintSummary(entries);
}

/** O `de` da consulta, a partir do período escolhido. */
function since(): string | undefined {
  const days = Number(periodSelect?.value ?? "");
  if (!days) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function load(append: boolean): Promise<void> {
  if (loading) return;
  loading = true;
  if (moreButton) moreButton.disabled = true;
  clearError();
  try {
    const params = new URLSearchParams({ limite: String(PAGE_SIZE) });
    if (applicationSelect?.value) params.set("aplicacao", applicationSelect.value);
    if (kindSelect?.value) params.set("tipo", kindSelect.value);
    const environment = currentEnvironment();
    if (environment) params.set("ambiente", environment);
    const from = since();
    if (from) params.set("de", from);
    if (append && cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/v1/executions?${params.toString()}`);
    if (response.status === 401) {
      signInAndReturn();
      return;
    }
    if (!response.ok) {
      showError("Não foi possível carregar o histórico agora.");
      return;
    }
    const body = (await response.json()) as { executions?: ExecutionEntry[]; nextCursor?: string };
    const entries = body.executions ?? [];
    loaded = append ? [...loaded, ...entries] : entries;
    cursor = body.nextCursor;
    paint();
  } catch {
    showError("Não foi possível falar com o servidor do QA Radar.");
  } finally {
    loading = false;
    if (moreButton) moreButton.disabled = false;
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
    // Vindo do histórico de uma aplicação, a página já abre filtrada nela.
    const wanted = new URLSearchParams(location.search).get("aplicacao");
    if (wanted && [...applicationSelect.options].some((option) => option.value === wanted)) applicationSelect.value = wanted;
  } catch {
    // Sem a lista, o filtro fica em "Todas" — a linha do tempo continua inteira.
  }
}

for (const field of [applicationSelect, kindSelect, periodSelect]) {
  field?.addEventListener("change", () => void load(false));
}
searchField?.addEventListener("input", paint);
moreButton?.addEventListener("click", () => void load(true));
window.addEventListener(ENVIRONMENT_CHANGE_EVENT, () => void load(false));

void (async () => {
  // A página inteira depende de conta: sem sessão não há histórico a consultar,
  // e mandar para a entrada é mais útil do que mostrar uma lista vazia.
  try {
    const session = (await (await fetch("/api/v1/auth/me")).json()) as { authenticated?: boolean; loginAvailable?: boolean };
    if (!session.loginAvailable) {
      offline("Relatórios dependem de conta, e este servidor está sem banco de dados. O histórico continua na Visão geral, por navegador.");
      if (list) list.innerHTML = "";
      if (moreButton) moreButton.hidden = true;
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
  await load(false);
})();
