import type { ApiCollectionRepository } from "./api-collection-repository.js";
import type { CodeExecutionRepository } from "./code-execution-repository.js";
import type { ApplicationRepository } from "./application-repository.js";
import type { ScanJobPersistence } from "./scan-job-persistence.js";
import { compareHistory, type HistoryCursor, type HistoryQuery } from "./history-query.js";

/**
 * O histórico das três origens como uma linha do tempo só.
 *
 * Inspeção, Jornada e Testes de API guardam em tabelas diferentes porque
 * descrevem coisas diferentes. Mas a pergunta de quem abre Relatórios não é
 * "quais análises rodaram" — é "o que aconteceu", e a resposta não pode obrigar
 * a pessoa a cruzar três listas de horários na cabeça.
 *
 * A junção acontece aqui, e não num `union all` no banco, por uma razão
 * concreta: as três tabelas têm colunas diferentes e nenhuma delas conhece as
 * outras. Um `union all` exigiria que cada repositório soubesse o formato dos
 * vizinhos, e uma coluna nova em qualquer um deles quebraria os três.
 */
export type ExecutionKind = "scan" | "journey" | "api";

export interface ExecutionEntry {
  id: string;
  kind: ExecutionKind;
  /** Instante em ISO 8601. É por ele que a linha do tempo ordena e pagina. */
  createdAt: string;
  /** Como a linha se chama: a URL analisada, o nome do teste, o método e a rota. */
  title: string;
  /** A segunda linha: contagem de erros, de testes, o status HTTP. */
  detail: string;
  /** `passed` quando não houve erro; `failed` no resto; `running` no que ainda corre. */
  outcome: "passed" | "failed" | "running";
  durationMs: number | undefined;
  applicationId: string | undefined;
  applicationName: string | undefined;
  /** Para onde a linha leva quando clicada. Vazio quando não há para onde ir. */
  href: string;
}

export interface ExecutionHistoryFilter extends HistoryQuery {
  /** Origens a incluir. Vazio = todas. */
  kinds?: readonly ExecutionKind[] | undefined;
}

export interface ExecutionHistoryPage {
  entries: ExecutionEntry[];
  /**
   * Cursor da próxima página, ou ausente quando acabou.
   *
   * É o `createdAt` da última linha devolvida: a próxima chamada pede tudo
   * anterior a ele. Por data, e não por deslocamento, porque uma execução nova
   * chegando entre duas páginas empurraria a lista e faria a segunda repetir o
   * que a primeira já mostrou.
   */
  nextCursor: HistoryCursor | undefined;
}

export interface ExecutionHistorySources {
  scanJobs: ScanJobPersistence;
  codeExecutions: CodeExecutionRepository | undefined;
  apiCollections: ApiCollectionRepository | undefined;
  applications: ApplicationRepository | undefined;
}

/** Teto por página. Acima disto a tela vira rolagem infinita sem ninguém ler. */
export const MAX_HISTORY_PAGE = 100;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Host e caminho, para o título não virar uma URL inteira com query string. */
function shortTarget(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Execução";
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return raw;
  }
}

/** Título do primeiro teste do relatório do Playwright, quando houver. */
function firstSpecTitle(node: unknown): string | undefined {
  const suite = record(node);
  for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
    const title = record(spec).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  for (const child of Array.isArray(suite.suites) ? suite.suites : []) {
    const found = firstSpecTitle(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Lê uma página da linha do tempo.
 *
 * Cada origem devolve até `limit` linhas anteriores ao cursor; o merge ordena e
 * corta em `limit`. Isso é suficiente e correto: a página tem no máximo `limit`
 * linhas, então nenhuma linha descartada aqui poderia ter entrado nela — ela é
 * mais antiga que todas as `limit` que ficaram, e vai aparecer na página
 * seguinte, que pede a partir do cursor certo.
 */
export async function readExecutionHistory(sources: ExecutionHistorySources, ownerId: string, filter: ExecutionHistoryFilter): Promise<ExecutionHistoryPage> {
  const limit = Math.min(Math.max(1, filter.limit), MAX_HISTORY_PAGE);
  const query: HistoryQuery = { applicationId: filter.applicationId, since: filter.since, before: filter.before, limit };
  const wants = (kind: ExecutionKind): boolean => !filter.kinds?.length || filter.kinds.includes(kind);

  const [scans, journeys, apiRuns, applications] = await Promise.all([
    wants("scan") ? sources.scanJobs.listHistory(ownerId, query) : Promise.resolve([]),
    wants("journey") && sources.codeExecutions ? sources.codeExecutions.listHistory(ownerId, query) : Promise.resolve([]),
    wants("api") && sources.apiCollections ? sources.apiCollections.listRunHistory(ownerId, query) : Promise.resolve([]),
    // O nome da aplicação vem de uma consulta só, e não de um `join` por linha:
    // uma conta tem dezenas de aplicações e centenas de execuções.
    sources.applications?.listByOwner(ownerId, { includeArchived: true }) ?? Promise.resolve([]),
  ]);

  const nameOf = new Map(applications.map((application) => [application.id, application.name]));
  const entries: ExecutionEntry[] = [];

  for (const scan of scans) {
    const summary = record(scan.report?.summary);
    const errors = number(summary.errors);
    const warnings = number(summary.warnings);
    const done = scan.status === "completed";
    entries.push({
      id: scan.id,
      kind: "scan",
      createdAt: scan.createdAt,
      title: shortTarget(scan.report?.targetUrl ?? scan.options.url),
      detail: done ? `${errors} erro(s) · ${warnings} aviso(s)` : (scan.error ?? scan.status),
      outcome: done ? (scan.report?.passed === false ? "failed" : "passed") : scan.status === "failed" || scan.status === "cancelled" ? "failed" : "running",
      durationMs: scan.report?.durationMs,
      applicationId: scan.applicationId,
      applicationName: scan.applicationId ? nameOf.get(scan.applicationId) : undefined,
      href: `/scanner?execucao=${encodeURIComponent(scan.id)}`,
    });
  }

  for (const journey of journeys) {
    const stats = record(record(journey.report).stats);
    const expected = number(stats.expected);
    const unexpected = number(stats.unexpected);
    const passed = journey.status === "passed";
    entries.push({
      id: journey.id,
      kind: "journey",
      createdAt: journey.createdAt,
      title: firstSpecTitle(record(journey.report)) ?? "Jornada Playwright",
      detail: passed ? `${expected} teste(s) OK` : `${unexpected} falha(s)`,
      outcome: passed ? "passed" : "failed",
      durationMs: typeof stats.duration === "number" ? stats.duration : undefined,
      applicationId: journey.applicationId,
      applicationName: journey.applicationId ? nameOf.get(journey.applicationId) : undefined,
      href: `/api/v1/code-executions/${journey.id}/code-evidence.html`,
    });
  }

  for (const run of apiRuns) {
    const ok = run.status !== undefined && run.status < 400;
    entries.push({
      id: run.id,
      kind: "api",
      createdAt: run.createdAt,
      title: `${run.method} ${shortTarget(run.url)}`,
      detail: run.status === undefined ? "Falha de conexão" : `${run.status} ${run.statusText ?? ""}`.trim(),
      outcome: ok ? "passed" : "failed",
      durationMs: run.durationMs,
      applicationId: run.applicationId,
      applicationName: run.applicationId ? nameOf.get(run.applicationId) : undefined,
      // Os Testes de API não têm relatório guardado: só metadado. Mandar para a
      // página é honesto; inventar um link de resultado que abre vazio não é.
      href: "/api-tests",
    });
  }

  entries.sort(compareHistory);
  const page = entries.slice(0, limit);
  // Há mais quando alguma origem encheu o limite (pode haver linha mais antiga
  // não lida) ou quando o merge descartou linhas que não couberam na página.
  const maybeMore = entries.length > limit || scans.length === limit || journeys.length === limit || apiRuns.length === limit;
  const last = page[page.length - 1];
  return { entries: page, nextCursor: maybeMore && last ? { createdAt: last.createdAt, id: last.id } : undefined };
}
