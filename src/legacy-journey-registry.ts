import type { JourneyRunResult } from "./journey-runner.js";

export type JourneyJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface JourneyJob {
  id: string;
  status: JourneyJobStatus;
  createdAt: string;
  outputDir: string;
  accessTokenHash: string;
  controller: AbortController;
  cancelRequested: boolean;
  report?: JourneyRunResult;
  error?: string;
}

/**
 * Tracks the disabled-by-default declarative JSON journey feature (legacy,
 * not part of the live product). Isolated from the live "Modo Jornada de
 * Playwright" (code-execution) state on purpose.
 */
export class LegacyJourneyRegistry {
  #jobs = new Map<string, JourneyJob>();
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

  get(id: string): JourneyJob | undefined {
    return this.#jobs.get(id);
  }

  set(job: JourneyJob): void {
    this.#jobs.set(job.id, job);
  }

  delete(id: string): void {
    this.#jobs.delete(id);
  }
}
