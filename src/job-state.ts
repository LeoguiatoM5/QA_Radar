/**
 * Máquina de estados dos jobs.
 *
 * Antes disto o ciclo de vida de um job existia só implicitamente, em seis
 * atribuições diretas a `job.status` espalhadas entre a fila e o agendador.
 * Nada impedia um job concluído de voltar a "running", e a única descrição das
 * transições válidas era o próprio código que as executava.
 */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Estados finais: uma vez alcançados, o job não muda mais. */
export const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

/** Única definição das transições permitidas. Lista vazia = estado final. */
const ALLOWED_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  // Um job na fila pode ser cancelado antes de chegar a vez dele.
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class IllegalJobTransitionError extends Error {
  readonly from: JobStatus;
  readonly to: JobStatus;

  constructor(from: JobStatus, to: JobStatus) {
    super(`Transição de job inválida: ${from} → ${to}.`);
    this.name = "IllegalJobTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTerminalJobStatus(status: JobStatus): status is TerminalJobStatus {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Aplica uma transição, recusando as que a máquina não prevê.
 *
 * Lança em vez de ignorar em silêncio: uma transição ilegal é sempre bug de
 * chamador, e engoli-la deixaria o job num estado que não corresponde ao que
 * de fato aconteceu com ele.
 */
export function transitionJob<T extends { status: JobStatus }>(job: T, to: JobStatus): void {
  if (!canTransitionJob(job.status, to)) throw new IllegalJobTransitionError(job.status, to);
  job.status = to;
}
