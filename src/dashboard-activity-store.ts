import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DashboardActivityType = "scan" | "journey" | "api";
export type DashboardActivityStatus = "success" | "error";

export interface DashboardActivity {
  id: string;
  type: DashboardActivityType;
  title: string;
  detail: string;
  status: DashboardActivityStatus;
  errors: number;
  warnings: number;
  durationMs: number;
  createdAt: number;
  href: string;
  scores: Partial<Record<"http" | "performance" | "accessibility" | "dom" | "javascript", number>>;
}

function sessionHash(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export class DashboardActivityStore {
  readonly #directory: string;
  readonly #limit: number;
  readonly #writes = new Map<string, Promise<void>>();
  readonly #subscribers = new Map<string, Set<(activity: DashboardActivity) => void>>();

  constructor(resultsDir: string, limit = 40) {
    this.#directory = join(resultsDir, "dashboard-activity");
    this.#limit = limit;
  }

  #path(sessionId: string): string {
    return join(this.#directory, `${sessionHash(sessionId)}.json`);
  }

  async list(sessionId: string): Promise<DashboardActivity[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path(sessionId), "utf8"));
      return Array.isArray(parsed) ? (parsed as DashboardActivity[]).slice(0, this.#limit) : [];
    } catch {
      return [];
    }
  }

  async append(sessionId: string, activity: DashboardActivity): Promise<DashboardActivity[]> {
    const key = sessionHash(sessionId);
    const previous = this.#writes.get(key) ?? Promise.resolve();
    let result: DashboardActivity[] = [];
    const write = previous.then(async () => {
      const current = await this.list(sessionId);
      result = [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, this.#limit);
      await mkdir(this.#directory, { recursive: true });
      const path = this.#path(sessionId);
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    });
    this.#writes.set(key, write);
    try {
      await write;
      for (const subscriber of this.#subscribers.get(key) ?? []) {
        try {
          subscriber(activity);
        } catch {
          // Um cliente desconectado não deve invalidar a atividade já persistida.
        }
      }
      return result;
    } finally {
      if (this.#writes.get(key) === write) this.#writes.delete(key);
    }
  }

  /**
   * Apaga o histórico deste navegador.
   *
   * Entra na mesma fila de escrita do `append` de propósito: apagar enquanto uma
   * atividade está a caminho do disco deixaria o arquivo recriado logo depois,
   * e quem clicou em "limpar" veria a execução voltar sozinha.
   */
  async clear(sessionId: string): Promise<void> {
    const key = sessionHash(sessionId);
    const previous = this.#writes.get(key) ?? Promise.resolve();
    const write = previous.then(async () => {
      await rm(this.#path(sessionId), { force: true });
    });
    this.#writes.set(key, write);
    try {
      await write;
    } finally {
      if (this.#writes.get(key) === write) this.#writes.delete(key);
    }
  }

  subscribe(sessionId: string, subscriber: (activity: DashboardActivity) => void): () => void {
    const key = sessionHash(sessionId);
    const subscribers = this.#subscribers.get(key) ?? new Set();
    subscribers.add(subscriber);
    this.#subscribers.set(key, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) this.#subscribers.delete(key);
    };
  }
}
