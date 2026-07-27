export interface CodeExecutionJob {
  id: string;
  outputDir: string;
  status: "passed" | "failed";
  report: unknown;
  accessTokenHash: string;
  failureDetails?: string;
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
