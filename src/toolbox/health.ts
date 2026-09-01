/**
 * Regras do API Health Checker.
 *
 * Só a decisão: dado o que voltou de um endpoint, ele está saudável, degradado
 * ou falho? A chamada em si mora na rota, porque precisa da política de rede do
 * servidor — o navegador não consegue medir um endpoint de terceiro por causa
 * do CORS, e deixar o servidor buscar qualquer URL sem guarda seria um SSRF.
 */

export type HealthState = "healthy" | "degraded" | "failed";

export interface HealthCheckRequest {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expectedStatus: number;
  maxResponseTimeMs: number;
}

export interface HealthCheckOutcome {
  name: string;
  url: string;
  status: number | undefined;
  statusText: string | undefined;
  contentType: string | undefined;
  durationMs: number | undefined;
  state: HealthState;
  /** Por que não está saudável. Vazio quando está. */
  reason: string | undefined;
}

export interface HealthSummary {
  state: HealthState;
  checked: number;
  healthy: number;
  degraded: number;
  failed: number;
}

export const HEALTH_STATE_LABELS: Record<HealthState, string> = {
  healthy: "HEALTHY",
  degraded: "DEGRADED",
  failed: "FAILED",
};

export const MAX_HEALTH_CHECKS = 10;
export const DEFAULT_EXPECTED_STATUS = 200;
export const DEFAULT_MAX_RESPONSE_TIME_MS = 1000;
export const MAX_ALLOWED_RESPONSE_TIME_MS = 60_000;

export interface HealthObservation {
  status: number;
  durationMs: number;
}

/**
 * Status errado é falha; status certo e lento é degradação.
 *
 * A ordem importa: um 500 rápido não é "degradado por ser rápido", é falha. E
 * um 200 lento não é falha — o serviço responde, só não no tempo combinado.
 */
export function evaluateHealth(observation: HealthObservation, expectation: Pick<HealthCheckRequest, "expectedStatus" | "maxResponseTimeMs">): { state: HealthState; reason: string | undefined } {
  if (observation.status !== expectation.expectedStatus) {
    return { state: "failed", reason: `Esperado ${expectation.expectedStatus}, recebido ${observation.status}.` };
  }
  if (observation.durationMs > expectation.maxResponseTimeMs) {
    return { state: "degraded", reason: `Respondeu em ${observation.durationMs} ms, acima do limite de ${expectation.maxResponseTimeMs} ms.` };
  }
  return { state: "healthy", reason: undefined };
}

/** O ambiente vale o pior dos seus serviços. */
export function summarizeHealth(outcomes: readonly HealthCheckOutcome[]): HealthSummary {
  const healthy = outcomes.filter((outcome) => outcome.state === "healthy").length;
  const degraded = outcomes.filter((outcome) => outcome.state === "degraded").length;
  const failed = outcomes.filter((outcome) => outcome.state === "failed").length;
  const state: HealthState = failed > 0 ? "failed" : degraded > 0 ? "degraded" : "healthy";
  return { state, checked: outcomes.length, healthy, degraded, failed };
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

/**
 * Relatório em texto puro, alinhado por espaços.
 *
 * Texto puro, e não Markdown, porque é o único formato que sobrevive igual no
 * Slack, no Teams, no Jira, no Azure DevOps e no GitHub — que é exatamente onde
 * este texto vai ser colado.
 */
export function formatEnvironmentReport(outcomes: readonly HealthCheckOutcome[], summary: HealthSummary = summarizeHealth(outcomes)): string {
  const nameWidth = Math.max(7, ...outcomes.map((outcome) => outcome.name.length));
  const rows = outcomes.map((outcome) => {
    const status = outcome.status === undefined ? "---" : String(outcome.status);
    const duration = outcome.durationMs === undefined ? "---" : `${outcome.durationMs}ms`;
    return `${padRight(outcome.name, nameWidth)}  ${padLeft(status, 5)}  ${padLeft(duration, 8)}  ${HEALTH_STATE_LABELS[outcome.state]}`;
  });
  return [
    `Environment Status: ${HEALTH_STATE_LABELS[summary.state]}`,
    "",
    ...rows,
    "",
    `${summary.checked} services checked`,
    `${summary.healthy} healthy`,
    `${summary.degraded} degraded`,
    `${summary.failed} failed`,
  ].join("\n");
}
