import { readExecutionHistory, MAX_HISTORY_PAGE, type ExecutionEntry, type ExecutionHistorySources, type ExecutionKind } from "./execution-history.js";
import type { HistoryCursor } from "./history-query.js";

/**
 * O resumo de qualidade da conta: a mesma linha do tempo de Relatórios, só que
 * somada em vez de listada.
 *
 * "Tendência" e "por aplicação" exigem ver **tudo** do período de uma vez, não
 * uma página por chamada — por isso este módulo pagina a linha do tempo
 * internamente e devolve só o total. Não existe consulta SQL de agregação por
 * trás: nas três tabelas o filtro de dono e aplicação já é o de sempre, e no
 * volume de uma conta em Beta somar em memória depois de buscar é simples e
 * correto. `MAX_QUALITY_ENTRIES` é o limite disso — acima dele os números
 * viram aproximados, marcados por `truncated`, em vez de a resposta demorar
 * sem fim.
 */
export interface QualityCounts {
  total: number;
  passed: number;
  failed: number;
  running: number;
  /** 0 a 100. `undefined` quando nenhuma execução do grupo terminou. */
  passRate: number | undefined;
}

export interface QualityApplicationSummary extends QualityCounts {
  applicationId: string | undefined;
  applicationName: string | undefined;
  lastRunAt: string;
}

export interface QualityDailyBucket {
  /** `YYYY-MM-DD`, recortado do `createdAt` em ISO 8601 (UTC). */
  date: string;
  total: number;
  passed: number;
  failed: number;
}

export interface QualitySummary {
  current: QualityCounts;
  /** Ausente sem período definido — "desde o começo" não tem um anterior para comparar. */
  previous: QualityCounts | undefined;
  byKind: Record<ExecutionKind, QualityCounts>;
  /** Até `MAX_QUALITY_APPLICATIONS`, da maior contagem de execuções para a menor. */
  byApplication: QualityApplicationSummary[];
  /** Vazio fora do período; com período, um ponto por dia, inclusive os sem execução. */
  daily: QualityDailyBucket[];
  truncated: boolean;
}

const KINDS: readonly ExecutionKind[] = ["scan", "journey", "api"];

/** Acima disto os números do resumo viram aproximados em vez de a resposta não voltar. */
export const MAX_QUALITY_ENTRIES = 4000;

/** Até quantas aplicações a tabela mostra — o resto continua contando para o resumo geral. */
export const MAX_QUALITY_APPLICATIONS = 10;

function counts(entries: readonly ExecutionEntry[]): QualityCounts {
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const entry of entries) {
    if (entry.outcome === "passed") passed += 1;
    else if (entry.outcome === "failed") failed += 1;
    else running += 1;
  }
  const decided = passed + failed;
  return { total: entries.length, passed, failed, running, passRate: decided ? Math.round((passed / decided) * 100) : undefined };
}

function byKindCounts(entries: readonly ExecutionEntry[]): Record<ExecutionKind, QualityCounts> {
  const result = {} as Record<ExecutionKind, QualityCounts>;
  for (const kind of KINDS) result[kind] = counts(entries.filter((entry) => entry.kind === kind));
  return result;
}

function byApplicationSummary(entries: readonly ExecutionEntry[]): QualityApplicationSummary[] {
  const groups = new Map<string, ExecutionEntry[]>();
  for (const entry of entries) {
    const key = entry.applicationId ?? "";
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  const rows = [...groups.entries()].map(([key, list]) => ({
    ...counts(list),
    applicationId: key || undefined,
    applicationName: key ? list[0]?.applicationName : undefined,
    lastRunAt: list.reduce((latest, entry) => (entry.createdAt > latest ? entry.createdAt : latest), list[0]!.createdAt),
  }));
  rows.sort((a, b) => b.total - a.total || b.lastRunAt.localeCompare(a.lastRunAt));
  return rows.slice(0, MAX_QUALITY_APPLICATIONS);
}

/** Um ponto por dia entre `sinceIso` e agora, com zero nos dias sem execução. */
function dailyBuckets(entries: readonly ExecutionEntry[], sinceIso: string | undefined): QualityDailyBucket[] {
  if (!sinceIso) return [];
  const byDate = new Map<string, { total: number; passed: number; failed: number }>();
  for (const entry of entries) {
    const date = entry.createdAt.slice(0, 10);
    const bucket = byDate.get(date) ?? { total: 0, passed: 0, failed: 0 };
    bucket.total += 1;
    if (entry.outcome === "passed") bucket.passed += 1;
    else if (entry.outcome === "failed") bucket.failed += 1;
    byDate.set(date, bucket);
  }
  const cursor = new Date(`${sinceIso.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date();
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { total: 0, passed: 0, failed: 0 });
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value }));
}

/** O mesmo comprimento de período, imediatamente anterior a `sinceIso`. */
function previousPeriodStart(sinceIso: string): string {
  const start = Date.parse(sinceIso);
  return new Date(start - (Date.now() - start)).toISOString();
}

/** Soma `entries` (que já cobrem período atual e anterior) nas duas janelas. */
export function aggregateQualitySummary(entries: readonly ExecutionEntry[], currentSince: string | undefined, previousSince: string | undefined, truncated = false): QualitySummary {
  const current = currentSince ? entries.filter((entry) => entry.createdAt >= currentSince) : entries;
  const hasWindow = Boolean(currentSince && previousSince);
  const previous = hasWindow ? entries.filter((entry) => entry.createdAt >= previousSince! && entry.createdAt < currentSince!) : [];
  return {
    current: counts(current),
    previous: hasWindow ? counts(previous) : undefined,
    byKind: byKindCounts(current),
    byApplication: byApplicationSummary(current),
    daily: dailyBuckets(current, currentSince),
    truncated,
  };
}

export interface QualitySummaryOptions {
  since?: string | undefined;
  applicationId?: string | undefined;
}

export async function computeQualitySummary(sources: ExecutionHistorySources, ownerId: string, options: QualitySummaryOptions): Promise<QualitySummary> {
  const currentSince = options.since;
  const previousSince = currentSince ? previousPeriodStart(currentSince) : undefined;
  // Busca as duas janelas juntas quando há período: uma só varredura cobre
  // tanto o atual quanto o anterior, e a separação acontece depois, em memória.
  const fetchSince = previousSince ?? currentSince;

  const entries: ExecutionEntry[] = [];
  let cursor: HistoryCursor | undefined;
  let truncated = false;
  for (;;) {
    const page = await readExecutionHistory(sources, ownerId, {
      ...(options.applicationId ? { applicationId: options.applicationId } : {}),
      ...(fetchSince ? { since: fetchSince } : {}),
      ...(cursor ? { before: cursor } : {}),
      limit: MAX_HISTORY_PAGE,
    });
    entries.push(...page.entries);
    if (!page.nextCursor) break;
    if (entries.length >= MAX_QUALITY_ENTRIES) {
      truncated = true;
      break;
    }
    cursor = page.nextCursor;
  }

  return aggregateQualitySummary(entries, currentSince, previousSince, truncated);
}
