/**
 * Prefixo dos artefatos de uma execução no armazenamento durável.
 *
 * Distinto do id cru de propósito: as análises usam o próprio id como prefixo,
 * e os dois espaços de nome compartilham o mesmo bucket.
 */
export function codeArtifactPrefix(id: string): string {
  return `code-${id}`;
}

export interface CodeExecutionJob {
  id: string;
  outputDir: string;
  status: "passed" | "failed";
  report: unknown;
  accessTokenHash: string;
  failureDetails?: string;
  /** Quando a execução terminou, em ISO 8601. */
  createdAt: string;
  /** Nulo = execução anônima: só o token de acesso abre. */
  ownerId: string | undefined;
  /** Aplicação a que a execução pertence. Nulo = avulsa. */
  applicationId: string | undefined;
}

export class CodeExecutionJobStore {
  readonly #jobs = new Map<string, CodeExecutionJob>();
  #active = false;

  isActive(): boolean {
    return this.#active;
  }

  start(): void {
    this.#active = true;
  }

  finish(): void {
    this.#active = false;
  }

  get(id: string): CodeExecutionJob | undefined {
    return this.#jobs.get(id);
  }

  set(job: CodeExecutionJob): void {
    this.#jobs.set(job.id, job);
  }

  delete(id: string): void {
    this.#jobs.delete(id);
  }
}
