import { activityTarget, esc, recordActivity, signInAndReturn, sleep } from "./shared.js";

/**
 * Cliente da Inspeção: formulário, acompanhamento da execução e resultado.
 *
 * O ciclo é sempre o mesmo — o formulário cria a análise, o `poll` acompanha o
 * progresso até um estado terminal, e o `render` monta o resultado com os
 * artefatos baixados do servidor.
 */
interface Issue {
  severity: string;
  category: string;
  title?: string;
  message: string;
  impact?: string;
  recommendation?: string;
  url?: string;
  occurrences?: number;
  baselineStatus?: string;
  evidence?: { label: string; selector: string };
}

interface PagePerformance {
  ttfbMs?: number;
  lcpMs?: number;
  cls?: number;
}

interface Report {
  passed: boolean;
  scanStatus?: string;
  title?: string;
  targetUrl: string;
  browser: string;
  durationMs: number;
  mainStatus?: number;
  project?: string;
  summary: { errors: number; warnings: number };
  issues: Issue[];
  pages?: Array<{ performance?: PagePerformance }>;
  performance?: PagePerformance;
  comparison?: { newIssues: number; existingIssues: number; resolvedIssues: unknown[] };
}

interface Progress {
  stage: string;
  percent: number;
  discoveredPages?: number;
  completedPages?: number;
  currentUrl?: string;
}

interface Job {
  id: string;
  status: string;
  error?: string;
  progress?: Progress;
  queuePosition?: number;
  screenshotAvailable?: boolean;
  report: Report;
}

const form = document.querySelector<HTMLFormElement>("#scan-form");
const button = document.querySelector<HTMLButtonElement>("#submit");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel");
const errorBox = document.querySelector<HTMLElement>("#error");
const results = document.querySelector<HTMLElement>("#results");
const turnstileBlock = document.querySelector<HTMLElement>("#turnstile-block");

let currentJobId: string | undefined;

const globals = globalThis as typeof globalThis & { onTurnstileSuccess?: () => void; onTurnstileExpired?: () => void; onTurnstileError?: () => void; turnstile?: { reset: () => void } };
globals.onTurnstileSuccess = () => {
  if (turnstileBlock) turnstileBlock.hidden = true;
};
globals.onTurnstileExpired = () => {
  if (turnstileBlock) turnstileBlock.hidden = false;
};
globals.onTurnstileError = () => {
  if (turnstileBlock) turnstileBlock.hidden = false;
};

const scanTab = document.querySelector<HTMLButtonElement>("#scan-tab");
const helpTab = document.querySelector<HTMLButtonElement>("#help-tab");
const scanPanel = document.querySelector<HTMLElement>("#scan-panel");
const helpPanel = document.querySelector<HTMLElement>("#help-panel");

function selectTab(name: "scan" | "help"): void {
  if (!scanTab || !helpTab || !scanPanel || !helpPanel) return;
  const help = name === "help";
  scanTab.classList.toggle("active", !help);
  helpTab.classList.toggle("active", help);
  scanTab.setAttribute("aria-selected", String(!help));
  helpTab.setAttribute("aria-selected", String(help));
  scanPanel.hidden = help;
  helpPanel.hidden = !help;
}

if (scanTab && helpTab) {
  scanTab.addEventListener("click", () => selectTab("scan"));
  helpTab.addEventListener("click", () => selectTab("help"));
}

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

const historyButton = document.querySelector<HTMLButtonElement>("#history-button");
const historyPanel = document.querySelector<HTMLElement>("#history-panel");

interface HistoryRun {
  startedAt: string;
  browser: string;
  scanStatus?: string;
  pages: number;
  durationMs: number;
  summary: { errors: number; warnings: number };
  newIssues?: number;
  passed: boolean;
}

async function loadHistory(): Promise<void> {
  if (!historyButton || !historyPanel) return;
  const project = document.querySelector<HTMLInputElement>("#project")?.value.trim() ?? "";
  const environment = document.querySelector<HTMLInputElement>("#environment")?.value.trim() ?? "";
  if (!project) {
    showError("Informe um projeto para consultar o histórico.");
    return;
  }
  historyButton.disabled = true;
  historyButton.textContent = "Carregando histórico…";
  try {
    const response = await fetch(`/api/history?project=${encodeURIComponent(project)}&environment=${encodeURIComponent(environment)}`);
    const history = (await response.json()) as { runs?: HistoryRun[]; baselineStartedAt?: string; error?: string };
    if (!response.ok) throw new Error(history.error ?? "Não foi possível consultar o histórico.");
    const runs = history.runs ?? [];
    historyPanel.hidden = false;
    text("#history-count", `${runs.length} execução(ões)`);
    text("#history-baseline", history.baselineStartedAt ? `Baseline: ${new Date(history.baselineStartedAt).toLocaleString("pt-BR")}` : "Nenhum baseline aprovado");
    const list = document.querySelector<HTMLElement>("#history-list");
    if (list) {
      list.innerHTML = runs.length
        ? runs
            .map(
              (run) =>
                `<div class="history-entry"><i class="history-dot ${run.passed ? "pass" : ""}"></i>` +
                `<div><strong>${esc(new Date(run.startedAt).toLocaleString("pt-BR"))} · ${esc(run.browser)}</strong>` +
                `<small>${run.scanStatus === "partial" ? "Execução parcial" : "Execução completa"} · ${run.pages} página(s) · ${(run.durationMs / 1000).toFixed(1)}s</small></div>` +
                `<div class="history-stats">${run.summary.errors} erro(s)<br>${run.summary.warnings} aviso(s)${run.newIssues === undefined ? "" : `<br>${run.newIssues} novo(s)`}</div></div>`,
            )
            .join("")
        : '<div class="history-entry"><div></div><div><strong>Nenhuma execução encontrada</strong><small>Execute uma análise para iniciar o histórico.</small></div></div>';
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "Não foi possível consultar o histórico.");
  } finally {
    historyButton.disabled = false;
    historyButton.textContent = "Consultar histórico";
  }
}

historyButton?.addEventListener("click", () => void loadHistory());

function running(): void {
  if (errorBox) errorBox.style.display = "none";
  results?.classList.add("visible");
  results?.scrollIntoView({ behavior: "smooth", block: "start" });
  const status = document.querySelector<HTMLElement>("#status");
  if (status) {
    status.className = "status running";
    status.innerHTML = '<i class="loader"></i>Executando';
  }
  text("#result-title", "Analisando aplicação");
  text("#comparison", "");
  for (const id of ["errors", "warnings", "http", "duration", "ttfb", "lcp", "cls"]) text(`#${id}`, "—");
  text("#pages", document.querySelector<HTMLInputElement>("#sitemap")?.checked ? "…" : "1");
  const issues = document.querySelector<HTMLElement>("#issues");
  if (issues) issues.innerHTML = '<div class="issue issue-note"><div class="message">O navegador está carregando e observando a página…</div></div>';
  const actions = document.querySelector<HTMLElement>("#actions");
  if (actions) actions.innerHTML = "";
  const frame = document.querySelector<HTMLIFrameElement>("#report-frame");
  if (frame) frame.hidden = true;
  const progress = document.querySelector<HTMLElement>("#progress");
  if (progress) progress.hidden = false;
  text("#progress-text", "Preparando análise…");
  const bar = document.querySelector<HTMLElement>("#progress-bar");
  if (bar) bar.style.width = "0%";
  if (cancelButton) {
    cancelButton.hidden = true;
    cancelButton.disabled = false;
  }
}

const STAGES: Record<string, string> = {
  queued: "Aguardando na fila",
  "discovering-sitemap": "Descobrindo páginas do sitemap",
  "launching-browser": "Iniciando navegador",
  navigating: "Carregando página",
  inspecting: "Inspecionando página",
  "capturing-evidence": "Gerando evidência visual",
  consolidating: "Consolidando resultados",
  "writing-reports": "Gerando relatórios",
  completed: "Análise concluída",
  cancelled: "Análise cancelada",
};

function renderProgress(progress: Progress | undefined, status: string, queuePosition: number | undefined): void {
  if (!progress) return;
  const total = progress.discoveredPages;
  const done = progress.completedPages;
  const queued = status === "queued";
  const bar = document.querySelector<HTMLElement>("#progress-bar");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`;
  const stage = STAGES[progress.stage] ?? "Executando análise";
  text(
    "#progress-text",
    queued ? `${stage}${queuePosition ? ` · posição ${queuePosition}` : ""}…` : `${stage}${total ? ` · ${done} de ${total} página(s)${progress.currentUrl ? ` · ${progress.currentUrl}` : ""}` : "…"}`,
  );
  if (total) text("#pages", `${done}/${total}`);
}

let artifactUrls: string[] = [];

async function artifact(base: string, name: string, createUrl = true): Promise<{ url?: string; text?: string }> {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`Não foi possível carregar ${name}.`);
  const blob = await response.blob();
  const url = createUrl ? URL.createObjectURL(blob) : undefined;
  if (url) artifactUrls.push(url);
  return { ...(url ? { url } : {}), ...(name === "report.html" ? { text: await blob.text() } : {}) };
}

const CATEGORIES: Record<string, string> = {
  console: "Navegador",
  javascript: "JavaScript",
  http: "Carregamento",
  network: "Rede",
  navigation: "Navegação",
  performance: "Performance",
  "best-practices": "Boas práticas",
  seo: "SEO",
  element: "Elemento da página",
  accessibility: "Acessibilidade",
};

function renderIssue(issue: Issue): string {
  return (
    `<div class="issue"><span class="badge ${esc(issue.severity)}">${issue.severity === "error" ? "Erro" : "Aviso"}</span>` +
    `<span class="category">${esc(CATEGORIES[issue.category] ?? issue.category)}</span>` +
    `<div class="message"><strong>${esc(issue.title ?? issue.message)}</strong>` +
    (issue.baselineStatus ? ` <small>· ${issue.baselineStatus === "new" ? "NOVO" : "EXISTENTE"}</small>` : "") +
    (issue.occurrences && issue.occurrences > 1 ? ` (${issue.occurrences}x)` : "") +
    (issue.impact ? `<p><b>Impacto:</b> ${esc(issue.impact)}</p>` : "") +
    (issue.recommendation ? `<p><b>Como verificar:</b> ${esc(issue.recommendation)}</p>` : "") +
    (issue.url ? `<code>${esc(issue.url)}</code>` : "") +
    (issue.evidence ? `<span class="evidence-ref">${esc(issue.evidence.label)} · ${esc(issue.evidence.selector)}</span>` : "") +
    `<details><summary>Detalhe técnico</summary><code>${esc(issue.message)}</code></details></div></div>`
  );
}

async function render(job: Job): Promise<void> {
  const r = job.report;
  if (cancelButton) cancelButton.hidden = true;
  const bar = document.querySelector<HTMLElement>("#progress-bar");
  if (bar) bar.style.width = "100%";
  text("#progress-text", "Análise concluída.");
  const status = document.querySelector<HTMLElement>("#status");
  if (status) {
    status.className = `status ${r.passed ? "pass" : "fail"}`;
    status.textContent = `${r.passed ? "APROVADO" : "REPROVADO"}${r.scanStatus === "partial" ? " · PARCIAL" : ""}`;
  }
  text("#result-title", r.title || new URL(r.targetUrl).hostname);
  text("#errors", String(r.summary.errors));
  text("#warnings", String(r.summary.warnings));
  text("#http", String(r.mainStatus ?? "N/A"));
  text("#duration", `${(r.durationMs / 1000).toFixed(1)}s`);
  text("#pages", String(r.pages?.length ?? 1));

  const pageMetrics = (r.pages ?? []).map((page) => page.performance).filter((value): value is PagePerformance => Boolean(value));
  const average = (name: "ttfbMs" | "lcpMs"): number | undefined => (pageMetrics.length ? Math.round(pageMetrics.reduce((sum, page) => sum + (page[name] ?? 0), 0) / pageMetrics.length) : undefined);
  const perf = r.performance ?? (pageMetrics.length ? { ttfbMs: average("ttfbMs"), lcpMs: average("lcpMs"), cls: Math.max(...pageMetrics.map((page) => page.cls ?? 0)) } : undefined);
  text("#ttfb", perf?.ttfbMs === undefined ? "N/A" : `${perf.ttfbMs} ms`);
  text("#lcp", perf?.lcpMs === undefined ? "N/A" : `${perf.lcpMs} ms`);
  text("#cls", String(perf?.cls ?? "N/A"));
  text("#comparison", r.comparison ? `${r.comparison.newIssues} novo(s) · ${r.comparison.existingIssues} existente(s) · ${r.comparison.resolvedIssues.length} resolvido(s)` : "");

  const list = document.querySelector<HTMLElement>("#issues");
  if (list) list.innerHTML = r.issues.length ? r.issues.map(renderIssue).join("") : '<div class="issue issue-note"><div class="message">Nenhum problema encontrado. Tudo limpo por aqui.</div></div>';

  const issueCount = (category: string): number => r.issues.filter((issue) => issue.category === category).length;
  const qualityScore = (count: number): number => Math.max(0, Math.min(100, 100 - count * 14));
  recordActivity({
    id: `scan-${job.id}`,
    type: "scan",
    title: r.title || activityTarget(r.targetUrl),
    detail: `${r.pages?.length ?? 1} página(s) · ${r.browser}`,
    status: r.passed ? "success" : "error",
    errors: r.summary.errors,
    warnings: r.summary.warnings,
    durationMs: r.durationMs,
    href: "/scanner",
    scores: {
      http: r.mainStatus && r.mainStatus < 400 ? 100 : 35,
      performance: perf?.lcpMs === undefined ? undefined : Math.max(0, Math.min(100, Math.round(110 - perf.lcpMs / 35))),
      accessibility: qualityScore(issueCount("accessibility")),
      dom: qualityScore(issueCount("element") + issueCount("seo")),
      javascript: qualityScore(issueCount("javascript") + issueCount("console")),
    },
  });

  for (const url of artifactUrls) URL.revokeObjectURL(url);
  artifactUrls = [];
  const base = `/api/scans/${job.id}/`;
  const html = await artifact(base, "report.html", false);
  const json = await artifact(base, "report.json");
  const junit = await artifact(base, "report.junit.xml");
  const sarif = await artifact(base, "report.sarif.json");
  const shot = job.screenshotAvailable ? await artifact(base, "screenshot.png") : undefined;

  let reportHtml = html.text ?? "";
  if (shot?.url) reportHtml = reportHtml.replace('src="screenshot.png"', `src="${shot.url}"`);
  reportHtml = reportHtml.replaceAll('href="pages/', `href="${base}pages/`);
  const reportUrl = URL.createObjectURL(new Blob([reportHtml], { type: "text/html" }));
  artifactUrls.push(reportUrl);
  const actions = document.querySelector<HTMLElement>("#actions");
  if (actions) {
    actions.innerHTML =
      `<a href="${reportUrl}" target="_blank">Abrir relatório HTML ↗</a>` +
      `<a href="${json.url}" download="qa-radar-report.json">Baixar JSON</a>` +
      `<a href="${junit.url}" download="qa-radar-report.junit.xml">JUnit</a>` +
      `<a href="${sarif.url}" download="qa-radar-report.sarif.json">SARIF</a>` +
      (shot?.url ? `<a href="${shot.url}" target="_blank">Ver evidência anotada</a>` : "");
  }
  const frame = document.querySelector<HTMLIFrameElement>("#report-frame");
  if (frame) {
    frame.srcdoc = reportHtml;
    frame.hidden = false;
  }
  if (historyButton && r.project) await loadHistory();
}

async function poll(id: string): Promise<void> {
  for (;;) {
    const response = await fetch(`/api/scans/${id}`);
    const job = (await response.json()) as Job & { error?: string };
    if (!response.ok) throw new Error(job.error ?? "Não foi possível consultar a análise.");
    renderProgress(job.progress, job.status, job.queuePosition);
    if (job.status === "completed") {
      await render(job);
      return;
    }
    if (job.status === "cancelled") throw new Error("A análise foi cancelada.");
    if (job.status === "failed") throw new Error(job.error ?? "A análise falhou.");
    await sleep(800);
  }
}

/**
 * Reabre uma análise do histórico (`/scanner?execucao=…`, vindo de Relatórios).
 *
 * Reusa `poll`: para uma análise já concluída, a primeira leitura já vem
 * `completed` e ele renderiza direto — não precisa de um caminho à parte.
 */
async function restoreExecution(id: string): Promise<void> {
  results?.classList.add("visible");
  results?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (errorBox) errorBox.style.display = "none";
  const status = document.querySelector<HTMLElement>("#status");
  if (status) {
    status.className = "status running";
    status.innerHTML = '<i class="loader"></i>Carregando';
  }
  text("#result-title", "Carregando análise salva…");
  const progress = document.querySelector<HTMLElement>("#progress");
  if (progress) progress.hidden = false;
  text("#progress-text", "Buscando o resultado salvo…");
  try {
    await poll(id);
  } catch (error) {
    // Estado terminal e explícito, nunca "carregando" ao lado de "falhou": quem
    // clicou num link do histórico precisa saber que o resultado sumiu, não
    // ficar olhando para um formulário em branco sem explicação.
    if (progress) progress.hidden = true;
    if (status) {
      status.className = "status fail";
      status.textContent = "NÃO DISPONÍVEL";
    }
    text("#result-title", "Análise não encontrada");
    const message = error instanceof Error ? error.message : "Não foi possível carregar esta análise.";
    showError(/não encontrada|expirad/i.test(message) ? "Esta análise não está mais disponível — o histórico guarda o resultado só por um tempo limitado." : message);
  }
}

const wantedExecution = new URLSearchParams(location.search).get("execucao");
if (wantedExecution) void restoreExecution(wantedExecution);

cancelButton?.addEventListener("click", () => {
  if (!currentJobId) return;
  cancelButton.disabled = true;
  cancelButton.textContent = "Cancelando…";
  void (async () => {
    try {
      const response = await fetch(`/api/scans/${currentJobId}/cancel`, { method: "POST" });
      const job = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(job.error ?? "Não foi possível cancelar a análise.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Não foi possível cancelar a análise.");
      cancelButton.disabled = false;
      cancelButton.textContent = "Cancelar";
    }
  })();
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!button) return;
  button.disabled = true;
  button.innerHTML = '<i class="loader"></i>Iniciando';
  running();
  const formData = new FormData(form);
  const data: Record<string, unknown> = Object.fromEntries(formData);
  data.timeoutMs = Number(data.timeoutMs);
  data.settleMs = Number(data.settleMs);
  data.maxPages = Number(data.maxPages);
  for (const flag of ["sitemap", "accessibility", "regressionsOnly", "acceptBaseline"]) data[flag] = formData.has(flag);
  void (async () => {
    try {
      const response = await fetch("/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const job = (await response.json()) as { id: string; error?: string };
      if (response.status === 401) {
        signInAndReturn();
        return;
      }
      if (!response.ok) throw new Error(job.error ?? "Não foi possível iniciar a análise.");
      currentJobId = job.id;
      if (cancelButton) cancelButton.hidden = false;
      button.innerHTML = '<i class="loader"></i>Analisando';
      await poll(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível iniciar a análise.";
      showError(message);
      const status = document.querySelector<HTMLElement>("#status");
      if (status) {
        status.className = "status fail";
        status.textContent = message.includes("cancelada") ? "CANCELADA" : "FALHA NA EXECUÇÃO";
      }
      // `running()` já deixou o painel em "Analisando…"/"Preparando análise…";
      // sem isto o selo de falha convive com três avisos de "está rodando" ao
      // mesmo tempo, e o usuário fica esperando algo que nunca vai terminar.
      text("#result-title", "Análise não concluída");
      text("#comparison", "");
      for (const id of ["errors", "warnings", "http", "duration", "ttfb", "lcp", "cls", "pages"]) text(`#${id}`, "—");
      const issues = document.querySelector<HTMLElement>("#issues");
      if (issues) issues.innerHTML = "";
      const progress = document.querySelector<HTMLElement>("#progress");
      if (progress) progress.hidden = true;
    } finally {
      currentJobId = undefined;
      if (cancelButton) {
        cancelButton.hidden = true;
        cancelButton.textContent = "Cancelar";
      }
      globals.turnstile?.reset();
      if (turnstileBlock) turnstileBlock.hidden = false;
      button.disabled = false;
      button.textContent = "Executar novo scanner";
    }
  })();
});

/**
 * Seletor de aplicação da Inspeção.
 *
 * Nasce oculto e só aparece para quem tem conta com aplicação cadastrada:
 * anônimo e servidor sem banco não teriam o que escolher, e um campo vazio ali
 * só levantaria a pergunta "o que é isso?".
 */
const scanApplicationPicker = document.querySelector<HTMLElement>("#application-picker");
const scanApplicationSelect = document.querySelector<HTMLSelectElement>("#scan-application");

async function loadScanApplications(): Promise<void> {
  if (!scanApplicationPicker || !scanApplicationSelect) return;
  try {
    const response = await fetch("/api/v1/applications");
    if (!response.ok) return;
    const applications = ((await response.json()) as { applications?: Array<{ id: string; name: string; baseUrl: string }> }).applications ?? [];
    if (!applications.length) return;
    for (const application of applications) {
      const option = document.createElement("option");
      option.value = application.id;
      option.textContent = application.name;
      option.dataset.baseUrl = application.baseUrl;
      scanApplicationSelect.append(option);
    }
    scanApplicationPicker.hidden = false;
    // Vindo de "Inspecionar" na lista de aplicações, já chega escolhida.
    const wanted = new URLSearchParams(location.search).get("aplicacao");
    if (wanted && applications.some((application) => application.id === wanted)) scanApplicationSelect.value = wanted;
    const urlField = document.querySelector<HTMLInputElement>("#url");
    const fillUrl = (): void => {
      const chosen = scanApplicationSelect.selectedOptions[0];
      // Só preenche o que está vazio: sobrescrever a URL digitada seria apagar
      // o trabalho de quem quer inspecionar uma página específica.
      if (chosen?.dataset.baseUrl && urlField && !urlField.value) urlField.value = chosen.dataset.baseUrl;
    };
    scanApplicationSelect.addEventListener("change", fillUrl);
    fillUrl();
  } catch {
    // Sem aplicações disponíveis o seletor simplesmente não aparece.
  }
}

void loadScanApplications();
