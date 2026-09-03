import { readExecutionHistory, MAX_HISTORY_PAGE, type ExecutionEntry, type ExecutionHistorySources } from "./execution-history.js";
import { computeQualitySummary, MAX_QUALITY_ENTRIES, type QualitySummary } from "./quality-summary.js";
import type { HistoryCursor } from "./history-query.js";

/**
 * Alertas: o que pede atenção agora, computado sobre a mesma linha do tempo de
 * Relatórios e Central de qualidade — não uma tabela nova.
 *
 * Granularidade "por conta" (decisão do usuário, 03/09/2026): um resumo só,
 * sem quebra por aplicação. Canal "só painel" nesta entrega: nenhum e-mail
 * sai daqui, e por isso não existe fila nem "o que já foi notificado" — a
 * tela sempre computa o estado atual do zero.
 */
export interface RegressionAlert {
  currentPassRate: number;
  previousPassRate: number;
  droppedPoints: number;
}

export interface AlertsSummary {
  /** As mais recentes primeiro, até MAX_ALERT_FAILURES. */
  failures: ExecutionEntry[];
  regression: RegressionAlert | undefined;
  windowDays: number;
  truncated: boolean;
}

/** Janela fixa para os dois gatilhos: falhas recentes e a comparação de taxa de sucesso. */
export const ALERT_WINDOW_DAYS = 7;

/** Até quantas falhas recentes a tela lista. */
export const MAX_ALERT_FAILURES = 20;

/** Queda mínima, em pontos percentuais, para a taxa de sucesso virar alerta. */
export const REGRESSION_THRESHOLD_POINTS = 15;

/** Execuções decididas mínimas no período anterior — evita alerta nascido de amostra pequena. */
export const REGRESSION_MIN_SAMPLE = 5;

/** Deriva o alerta de regressão de um resumo já calculado, sem refazer a consulta. */
export function evaluateRegression(summary: QualitySummary): RegressionAlert | undefined {
  const previous = summary.previous;
  const current = summary.current;
  if (!previous || previous.passRate === undefined || current.passRate === undefined) return undefined;
  if (previous.passed + previous.failed < REGRESSION_MIN_SAMPLE) return undefined;
  const droppedPoints = previous.passRate - current.passRate;
  if (droppedPoints < REGRESSION_THRESHOLD_POINTS) return undefined;
  return { currentPassRate: current.passRate, previousPassRate: previous.passRate, droppedPoints };
}

/** Pagina a linha do tempo da janela e separa as falhas, com o mesmo teto de segurança da Central de qualidade. */
async function collectFailures(sources: ExecutionHistorySources, ownerId: string, since: string): Promise<{ failures: ExecutionEntry[]; truncated: boolean }> {
  const failures: ExecutionEntry[] = [];
  let cursor: HistoryCursor | undefined;
  let scanned = 0;
  let truncated = false;
  for (;;) {
    const page = await readExecutionHistory(sources, ownerId, { since, before: cursor, limit: MAX_HISTORY_PAGE });
    for (const entry of page.entries) if (entry.outcome === "failed") failures.push(entry);
    scanned += page.entries.length;
    if (!page.nextCursor || failures.length >= MAX_ALERT_FAILURES) break;
    if (scanned >= MAX_QUALITY_ENTRIES) {
      truncated = true;
      break;
    }
    cursor = page.nextCursor;
  }
  return { failures: failures.slice(0, MAX_ALERT_FAILURES), truncated };
}

export async function computeAlerts(sources: ExecutionHistorySources, ownerId: string): Promise<AlertsSummary> {
  const since = new Date(Date.now() - ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [quality, { failures, truncated }] = await Promise.all([computeQualitySummary(sources, ownerId, { since }), collectFailures(sources, ownerId, since)]);
  return { failures, regression: evaluateRegression(quality), windowDays: ALERT_WINDOW_DAYS, truncated: truncated || quality.truncated };
}
