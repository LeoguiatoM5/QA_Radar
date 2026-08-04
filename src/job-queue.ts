import type { ScanOptions, ScanProgress, ScanReport } from "./types.js";
import { transitionJob, type JobStatus } from "./job-state.js";

export type { JobStatus };

export interface ScanJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  options: ScanOptions;
  report: ScanReport | undefined;
  error: string | undefined;
  progress: ScanProgress;
  controller: AbortController;
  cancelRequested: boolean;
  accessTokenHash: string;
  /** Conta dona. Ausente = anônima, acessível só pelo token. */
  ownerId: string | undefined;
  /** Aplicação a que a análise pertence. Ausente = análise avulsa. */
  applicationId: string | undefined;
}

export interface QueueStats {
  active: number;
  queued: number;
  jobs: number;
}

export class JobQueue {
  readonly #jobs = new Map<string, ScanJob>();
  readonly #pending: string[] = [];
  #active = 0;

  get(id: string): ScanJob | undefined {
    return this.#jobs.get(id);
  }

  enqueue(job: ScanJob): void {
    this.#jobs.set(job.id, job);
    this.#pending.push(job.id);
  }

  takeNext(concurrency: number): ScanJob | undefined {
    if (this.#active >= concurrency) return undefined;
    for (;;) {
      const id = this.#pending.shift();
      if (!id) return undefined;
      const job = this.#jobs.get(id);
      if (!job || job.status !== "queued") continue;
      this.#active += 1;
      transitionJob(job, "running");
      return job;
    }
  }

  finish(): void {
    if (this.#active === 0) throw new Error("Não há análise ativa para finalizar.");
    this.#active -= 1;
  }

  cancelQueued(id: string): boolean {
    const job = this.#jobs.get(id);
    if (!job || job.status !== "queued") return false;
    const index = this.#pending.indexOf(id);
    if (index >= 0) this.#pending.splice(index, 1);
    transitionJob(job, "cancelled");
    return true;
  }

  delete(id: string): void {
    this.#jobs.delete(id);
  }

  position(id: string): number | undefined {
    const index = this.#pending.indexOf(id);
    return index >= 0 ? index + 1 : undefined;
  }

  stats(): QueueStats {
    return { active: this.#active, queued: this.#pending.length, jobs: this.#jobs.size };
  }
}
