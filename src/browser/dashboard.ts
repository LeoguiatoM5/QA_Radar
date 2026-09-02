/**
 * Visão geral: execuções recentes, sinal ao vivo e mapa de qualidade.
 *
 * A lista vem de três lugares que se somam pelo id: o `localStorage` deste
 * navegador, a cópia por sessão no servidor e — para quem entrou — o histórico
 * da conta. A mesma análise aparece em mais de um e não pode ser listada duas
 * vezes.
 */
type ActivityType = "scan" | "journey" | "api";
type Axis = "http" | "performance" | "accessibility" | "dom" | "javascript";

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  detail?: string;
  status?: "success" | "error";
  errors?: number;
  warnings?: number;
  durationMs?: number;
  /** Época em milissegundos no caminho local; ISO 8601 vindo da conta. */
  createdAt?: number | string | undefined;
  href?: string;
  scores?: Partial<Record<Axis, number>>;
}

const AXES: readonly Axis[] = ["http", "performance", "accessibility", "dom", "javascript"];
const AXIS_NAMES: Record<Axis, string> = { http: "HTTP", performance: "Performance", accessibility: "Acessibilidade", dom: "DOM", javascript: "JavaScript" };

const dashboardActivityKey = "qa-radar-activity";
const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
const dashboardEsc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => escapes[char] ?? char);

/**
 * Momento da execução, em milissegundos.
 *
 * O caminho local grava época em número e o histórico da conta devolve ISO
 * 8601. Ordenar a lista misturada com `Number(...)` fazia o ISO virar `NaN`, o
 * comparador devolver `NaN` e a ordem simplesmente não acontecer — dava para
 * ver no Sinal ao vivo, com 18:18 e 19:38 embaixo de 10:17.
 */
function timeValue(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const timeOf = (activity: Activity): number => timeValue(activity.createdAt);

interface LegacyApiEntry {
  method?: string;
  url?: string;
  displayUrl?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  createdAt?: number;
}

function loadDashboardActivity(): Activity[] {
  try {
    // Chave ausente é quem nunca usou o dashboard e ainda pode ter histórico
    // antigo dos Testes de API para migrar. Chave presente e vazia é quem acabou
    // de limpar, e repovoar a lista com o legado desfaria o que a pessoa pediu.
    const raw = localStorage.getItem(dashboardActivityKey);
    if (raw !== null) {
      const stored: unknown = JSON.parse(raw);
      if (Array.isArray(stored)) return stored as Activity[];
    }
  } catch {
    // Armazenamento indisponível ou conteúdo corrompido: segue para o legado.
  }
  try {
    const apiHistory: unknown = JSON.parse(localStorage.getItem("qa-radar-api-history") ?? "[]");
    if (!Array.isArray(apiHistory)) return [];
    return (apiHistory as LegacyApiEntry[]).map((item, index) => {
      let target = String(item.displayUrl ?? item.url ?? "API");
      try {
        const url = new URL(target);
        target = url.host + url.pathname;
      } catch {
        // Não era URL absoluta: mostra o texto como veio.
      }
      const failed = !item.status || item.status >= 400;
      return {
        id: `legacy-api-${index}`,
        type: "api",
        title: `${item.method ?? "GET"} ${target}`,
        detail: item.status ? `${item.status} ${item.statusText ?? ""}` : "Falha de conexão",
        status: failed ? "error" : "success",
        errors: failed ? 1 : 0,
        warnings: 0,
        durationMs: item.durationMs ?? 0,
        createdAt: item.createdAt,
        href: `/api-tests?activity=${Number(item.createdAt ?? 0)}`,
        scores: { http: failed ? 30 : 100 },
      } satisfies Activity;
    });
  } catch {
    return [];
  }
}

function dashboardTime(value: Activity["createdAt"]): string {
  const date = new Date(timeValue(value) || Date.now());
  const minutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function dashboardDuration(value: unknown): string {
  const milliseconds = Number(value ?? 0);
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(milliseconds / 60_000)}min`;
}

function activityMeta(item: Activity): { label: string; icon: string } {
  if (item.type === "scan") return { label: "INSPEÇÃO", icon: "overview" };
  if (item.type === "journey") return { label: "JORNADA", icon: "journey" };
  return { label: "API", icon: "api" };
}

/** "12 erros" / "1 erro" / "-" quando não há medição para o eixo. */
function dashboardCount(value: unknown, singular: string, plural: string): string {
  const total = Number(value ?? 0);
  return total ? `${total} ${total === 1 ? singular : plural}` : "-";
}

function dashboardScore(value: number, suffix: string): string {
  return Number.isFinite(value) ? `${value} ${suffix}` : "-";
}

let dashboardFilter: "all" | ActivityType = "all";
let dashboardShowAll = false;
let dashboardActivities: Activity[] = loadDashboardActivity();

const dashboardLiveState = document.querySelector<HTMLElement>("#dashboard-live-state");

function setDashboardLiveState(state: string, label: string): void {
  if (!dashboardLiveState) return;
  dashboardLiveState.dataset.state = state;
  dashboardLiveState.title = label;
  const description = dashboardLiveState.querySelector<HTMLElement>(".sr-only");
  if (description) description.textContent = label;
}

function mergeDashboardActivity(activity: unknown): void {
  if (!activity || typeof activity !== "object" || typeof (activity as Activity).id !== "string") return;
  const merged = new Map(dashboardActivities.map((item) => [item.id, item]));
  merged.set((activity as Activity).id, activity as Activity);
  dashboardActivities = [...merged.values()];
  renderDashboard();
}

/** Devolve o painel ao estado de quem nunca executou nada. */
function clearDashboardPanels(recent: HTMLElement | null, signals: HTMLElement | null): void {
  if (recent) recent.innerHTML = "";
  if (signals) signals.innerHTML = "";
  // Sem execuções o radar mostra só a grade: nada de polígono sugerindo dados.
  const area = document.querySelector<SVGElement>(".radar-area");
  if (area) area.style.opacity = "0";
  for (const dot of document.querySelectorAll<SVGElement>(".radar-dot")) dot.style.opacity = "0";
  for (const axis of AXES) {
    const label = document.querySelector<HTMLElement>(`#radar-value-${axis}`);
    if (label) label.textContent = "—";
  }
  const index = document.querySelector<HTMLElement>("#dashboard-quality-index");
  if (index) index.textContent = "—";
  const qualityLabel = document.querySelector<HTMLElement>("#dashboard-quality-label");
  if (qualityLabel) qualityLabel.textContent = "Sem dados";
  document.querySelector<HTMLElement>(".radar-visual")?.setAttribute("aria-label", "Mapa de qualidade sem dados");
  // Sem execução nenhuma, "da sua conta" não qualifica lista alguma.
  const accountBadge = document.querySelector<HTMLElement>("#dashboard-source");
  if (accountBadge) accountBadge.hidden = true;
  for (const id of ["errors", "warnings"]) {
    const field = document.querySelector<HTMLElement>(`#dashboard-${id}`);
    if (field) field.textContent = "0";
    const delta = document.querySelector<HTMLElement>(`#dashboard-${id}-delta`);
    if (delta) {
      delta.className = "quality-delta";
      delta.textContent = "";
    }
  }
}

function renderRun(item: Activity): string {
  const meta = activityMeta(item);
  const failed = item.status === "error";
  const href = dashboardEsc(item.href ?? "/");
  const performance = Number(item.scores?.performance);
  const accessibility = Number(item.scores?.accessibility);
  const createdAt = new Date(timeOf(item) || Date.now());
  const errors = Number(item.errors ?? 0);
  const warnings = Number(item.warnings ?? 0);
  const title = dashboardEsc(item.title);
  // item.detail é o resultado ("200 OK", "1 falha(s)"), não o ambiente: ele
  // acompanha o título, e a coluna de ambiente mostra de fato o ambiente.
  return (
    `<div class="dashboard-run"><span class="run-kind icon-${meta.icon}"><i></i></span>` +
    `<a class="run-title" href="${href}"><strong>${title}</strong><small>${dashboardEsc(item.detail ?? meta.label)}</small></a>` +
    `<span class="run-environment">Local</span>` +
    `<span class="run-status ${failed ? "error" : "success"}"><i></i>${failed ? "ERRO" : "SUCESSO"}</span>` +
    `<span class="run-errors ${errors ? "has-value" : ""}">${dashboardCount(errors, "erro", "erros")}</span>` +
    `<span class="run-warnings ${warnings ? "has-value" : ""}">${dashboardCount(warnings, "aviso", "avisos")}</span>` +
    `<span class="run-score ${Number.isFinite(performance) ? "has-value" : ""}">${dashboardScore(performance, "perf.")}</span>` +
    `<span class="run-score ${Number.isFinite(accessibility) ? "has-value" : ""}">${dashboardScore(accessibility, "acess.")}</span>` +
    `<time datetime="${createdAt.toISOString()}" title="${dashboardTime(item.createdAt)}">${createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>` +
    `<span class="run-duration">${dashboardDuration(item.durationMs)}</span>` +
    `<a class="run-play" href="${href}" aria-label="Executar novamente ${title}">▷</a>` +
    `<a class="run-action" href="${href}" aria-label="Abrir ${title}">›</a></div>`
  );
}

function renderSignal(item: Activity): string {
  const meta = activityMeta(item);
  const level = item.status === "error" ? "error" : Number(item.warnings ?? 0) ? "warning" : "success";
  const label = level === "error" ? "ERRO" : level === "warning" ? "AVISO" : "SUCESSO";
  const time = new Date(timeOf(item) || Date.now()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    `<a class="signal-event ${level}" href="${dashboardEsc(item.href ?? "/")}"><time>${time}</time><i></i>` +
    `<span><b>${label}</b><strong>${dashboardEsc(item.title)}</strong><small>${dashboardEsc(item.detail ?? meta.label)}</small></span></a>`
  );
}

/** Desenha o polígono e devolve a média de cada eixo. */
function renderRadar(activities: Activity[]): Partial<Record<Axis, number>> {
  const values: Partial<Record<Axis, number>> = {};
  for (const axis of AXES) {
    const samples = activities
      .slice(0, 12)
      .map((item) => Number(item.scores?.[axis]))
      .filter(Number.isFinite);
    if (samples.length) values[axis] = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    const label = document.querySelector<HTMLElement>(`#radar-value-${axis}`);
    if (label) label.textContent = values[axis] === undefined ? "—" : String(values[axis]);
  }

  // A grade do SVG carrega a geometria; usá-la aqui garante que o vértice de um
  // eixo caia exatamente sobre o anel correspondente.
  const svg = document.querySelector<SVGSVGElement>(".radar-svg");
  if (svg) {
    const center = Number(svg.dataset.radarCenter);
    const maxRadius = Number(svg.dataset.radarRadius);
    const floor = Number(svg.dataset.radarFloor);
    const span = Number(svg.dataset.radarSpan);
    const points = AXES.map((axis, position) => {
      const value = Math.max(0, Math.min(100, Number(values[axis]) || 0));
      const angle = ((-90 + position * 72) * Math.PI) / 180;
      const radius = maxRadius * (floor + span * value);
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      const dot = svg.querySelector<SVGElement>(`[data-radar-point="${axis}"]`);
      if (dot) {
        dot.setAttribute("cx", x.toFixed(1));
        dot.setAttribute("cy", y.toFixed(1));
        dot.style.opacity = Number.isFinite(values[axis]) ? "1" : "0";
      }
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const area = svg.querySelector<SVGElement>(".radar-area");
    if (area) {
      area.setAttribute("points", points);
      area.style.opacity = AXES.some((axis) => Number.isFinite(values[axis])) ? "1" : "0";
    }
  }
  return values;
}

function renderDashboard(): void {
  const activities = dashboardActivities.sort((a, b) => timeOf(b) - timeOf(a)).slice(0, 40);
  const recent = document.querySelector<HTMLElement>("#dashboard-recent-list");
  const signals = document.querySelector<HTMLElement>("#dashboard-signal-list");
  const emptyRecent = document.querySelector<HTMLElement>("#dashboard-recent-empty");
  const emptySignals = document.querySelector<HTMLElement>("#dashboard-signal-empty");
  const historyToggle = document.querySelector<HTMLButtonElement>("#dashboard-history-toggle");
  const filtered = dashboardFilter === "all" ? activities : activities.filter((item) => item.type === dashboardFilter);

  const runCount = document.querySelector<HTMLElement>("#dashboard-run-count");
  if (runCount) {
    runCount.textContent = activities.length ? `${filtered.length === activities.length ? activities.length : `${filtered.length} de ${activities.length}`} local(is)` : "Dados locais";
  }
  if (historyToggle) {
    historyToggle.hidden = !filtered.length;
    historyToggle.textContent = dashboardShowAll ? "Mostrar recentes" : "Ver histórico completo";
    historyToggle.setAttribute("aria-expanded", String(dashboardShowAll));
  }
  const clearButton = document.querySelector<HTMLButtonElement>("#dashboard-clear");
  if (clearButton) clearButton.hidden = !activities.length;

  for (const type of ["scan", "journey", "api"] as const) {
    const label = document.querySelector<HTMLElement>(`#dashboard-last-${type}`);
    const latest = activities.find((item) => item.type === type);
    if (label) label.textContent = latest ? `Última execução ${dashboardTime(latest.createdAt)}` : "Sem execuções recentes";
  }

  if (!activities.length) {
    clearDashboardPanels(recent, signals);
    if (emptyRecent) emptyRecent.hidden = false;
    if (emptySignals) emptySignals.hidden = false;
    return;
  }

  if (emptyRecent) emptyRecent.hidden = filtered.length > 0;
  if (emptySignals) emptySignals.hidden = true;
  if (recent)
    recent.innerHTML = filtered
      .slice(0, dashboardShowAll ? 40 : 6)
      .map(renderRun)
      .join("");
  if (signals) signals.innerHTML = activities.slice(0, 7).map(renderSignal).join("");

  const values = renderRadar(activities);
  const available = AXES.map((axis) => values[axis]).filter((value): value is number => Number.isFinite(value));
  const index = available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : undefined;
  const indexField = document.querySelector<HTMLElement>("#dashboard-quality-index");
  if (indexField) indexField.textContent = index === undefined ? "—" : String(index);
  const qualityLabel = document.querySelector<HTMLElement>("#dashboard-quality-label");
  if (qualityLabel) qualityLabel.textContent = index === undefined ? "Sem dados" : index >= 85 ? "Excelente" : index >= 70 ? "Estável" : index >= 50 ? "Atenção" : "Crítico";

  // O gráfico é `aria-hidden`, então o resumo dos eixos precisa viver no rótulo.
  const axisSummary = AXES.filter((axis) => Number.isFinite(values[axis]))
    .map((axis) => `${AXIS_NAMES[axis]} ${values[axis]}`)
    .join(", ");
  document
    .querySelector<HTMLElement>(".radar-visual")
    ?.setAttribute("aria-label", index === undefined ? "Mapa de qualidade sem dados" : `Índice de qualidade ${index} de 100${axisSummary ? `. ${axisSummary}` : ""}`);

  const day = 86_400_000;
  const elapsed = (item: Activity): number => Date.now() - timeOf(item);
  const lastDay = activities.filter((item) => elapsed(item) < day);
  const previousDay = activities.filter((item) => elapsed(item) >= day && elapsed(item) < day * 2);
  const totalOf = (list: Activity[], field: "errors" | "warnings"): number => list.reduce((sum, item) => sum + Number(item[field] ?? 0), 0);

  // O delta só aparece quando existe janela anterior para comparar — sem isso
  // não há variação real a mostrar.
  const setMetric = (id: string, current: number | undefined, previous: number | undefined): void => {
    const field = document.querySelector<HTMLElement>(`#dashboard-${id}`);
    if (!field) return;
    field.textContent = current === undefined ? "—" : String(current);
    const delta = document.querySelector<HTMLElement>(`#dashboard-${id}-delta`);
    if (!delta) return;
    const difference = current === undefined || previous === undefined ? 0 : current - previous;
    delta.className = `quality-delta${difference > 0 ? " up" : difference < 0 ? " down" : ""}`;
    delta.textContent = difference ? `${Math.abs(difference)} vs 24h` : "";
  };
  setMetric("errors", totalOf(lastDay, "errors"), previousDay.length ? totalOf(previousDay, "errors") : undefined);
  setMetric("warnings", totalOf(lastDay, "warnings"), previousDay.length ? totalOf(previousDay, "warnings") : undefined);
}

renderDashboard();

if ("EventSource" in window) {
  const dashboardStream = new EventSource("/api/dashboard/activity/events");
  dashboardStream.addEventListener("open", () => setDashboardLiveState("connected", "Sinal ao vivo conectado"));
  dashboardStream.addEventListener("message", (event) => {
    try {
      mergeDashboardActivity(JSON.parse(event.data as string));
    } catch {
      // Evento malformado não pode derrubar o restante do fluxo.
    }
  });
  dashboardStream.addEventListener("error", () => setDashboardLiveState("connecting", "Reconectando ao sinal ao vivo"));
  window.addEventListener("pagehide", () => dashboardStream.close(), { once: true });
} else {
  setDashboardLiveState("offline", "Atualização ao vivo indisponível neste navegador");
}

void fetch("/api/dashboard/activity")
  .then(async (response) => {
    if (!response.ok) return;
    const data = (await response.json()) as { activities?: Activity[] };
    if (!Array.isArray(data.activities)) return;
    const merged = new Map(dashboardActivities.map((item) => [item.id, item]));
    for (const item of data.activities) merged.set(item.id, item);
    dashboardActivities = [...merged.values()];
    renderDashboard();
  })
  .catch(() => {
    // Cópia do servidor indisponível: a lista local já está na tela.
  });

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-dashboard-filter]")) {
  button.addEventListener("click", () => {
    dashboardFilter = (button.dataset.dashboardFilter ?? "all") as typeof dashboardFilter;
    dashboardShowAll = false;
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-dashboard-filter]")) item.classList.toggle("active", item === button);
    renderDashboard();
  });
}

document.querySelector<HTMLButtonElement>("#dashboard-history-toggle")?.addEventListener("click", () => {
  dashboardShowAll = !dashboardShowAll;
  renderDashboard();
});

/**
 * Limpar o histórico precisa alcançar as três cópias.
 *
 * O `localStorage` é o que a lista lê primeiro, mas o servidor guarda a mesma
 * coisa por navegador — atrás do cookie do dashboard — e a conta guarda no
 * banco. Apagar qualquer subconjunto delas faria o que sobrasse voltar inteiro
 * no carregamento seguinte.
 */
const dashboardClear = document.querySelector<HTMLButtonElement>("#dashboard-clear");
dashboardClear?.addEventListener("click", () => {
  const source = document.querySelector<HTMLElement>("#dashboard-source");
  const hasAccount = Boolean(source) && !source?.hidden;
  const warning =
    `Apagar ${dashboardCount(dashboardActivities.length, "execução", "execuções")} da Visão geral? A ação não tem volta.` +
    (hasAccount ? "\n\nInclui as análises guardadas na sua conta, com os relatórios delas." : "");
  if (!confirm(warning)) return;
  dashboardClear.disabled = true;
  void (async () => {
    try {
      localStorage.setItem(dashboardActivityKey, "[]");
    } catch {
      // Armazenamento indisponível: as cópias do servidor ainda saem.
    }
    try {
      await fetch("/api/dashboard/activity", { method: "DELETE" });
    } catch {
      // Rede fora: a lista some da tela e a cópia sai na próxima tentativa.
    }
    if (hasAccount) {
      try {
        await fetch("/api/v1/scans", { method: "DELETE" });
      } catch {
        // Idem para o histórico da conta.
      }
    }
    dashboardActivities = [];
    dashboardShowAll = false;
    renderDashboard();
    dashboardClear.disabled = false;
  })();
});

window.addEventListener("storage", (event) => {
  if (event.key !== dashboardActivityKey) return;
  dashboardActivities = loadDashboardActivity();
  renderDashboard();
});

/**
 * Histórico da conta, quando existe.
 *
 * O `localStorage` continua sendo a fonte de quem não tem conta — e é o único
 * histórico possível nesse caminho, que é decisão de produto. Para quem entrou,
 * o servidor manda: é o que faz o histórico sobreviver a outro navegador, a uma
 * limpeza de cache e a um computador diferente.
 */
interface PersistedScan {
  id: string;
  status?: string;
  url?: string;
  createdAt?: string;
  report?: { url?: string; passed?: boolean; durationMs?: number; summary?: { errors?: number; warnings?: number } };
}

function scanToActivity(scan: PersistedScan): Activity {
  const report = scan.report ?? {};
  const summary = report.summary ?? {};
  const errors = Number(summary.errors ?? 0);
  const warnings = Number(summary.warnings ?? 0);
  let target = String(report.url ?? scan.url ?? "Inspeção");
  try {
    const url = new URL(target);
    target = url.host + url.pathname;
  } catch {
    // Não era URL absoluta: mostra o texto como veio.
  }
  return {
    id: scan.id,
    type: "scan",
    title: `Inspeção · ${target}`,
    detail: scan.status === "completed" ? `${dashboardCount(errors, "erro", "erros")} · ${dashboardCount(warnings, "aviso", "avisos")}` : (scan.status ?? ""),
    status: scan.status !== "completed" || report.passed === false ? "error" : "success",
    errors,
    warnings,
    durationMs: Number(report.durationMs ?? 0),
    createdAt: scan.createdAt,
    href: "/scanner",
    scores: {},
  };
}

async function loadAccountHistory(): Promise<void> {
  try {
    const response = await fetch("/api/v1/scans");
    // 401 é o caminho anônimo, não uma falha: segue só com o histórico local.
    if (!response.ok) return;
    const scans = ((await response.json()) as { scans?: PersistedScan[] }).scans ?? [];
    const source = document.querySelector<HTMLElement>("#dashboard-source");
    if (source) source.hidden = false;
    if (!scans.length) return;
    const seen = new Set(dashboardActivities.map((item) => item.id));
    dashboardActivities = [...dashboardActivities, ...scans.filter((scan) => !seen.has(scan.id)).map(scanToActivity)];
    renderDashboard();
  } catch {
    // Sem resposta do servidor, fica só o histórico deste navegador.
  }
}

void loadAccountHistory();

// O navegador carrega este arquivo como módulo ES, com escopo próprio. O
// `export {}` diz o mesmo ao compilador: sem ele os nomes do topo entrariam no
// escopo global e colidiriam com os de outro módulo.
export {};
