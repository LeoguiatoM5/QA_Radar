import type { ChildProcess } from "node:child_process";

export interface CodegenSession {
  id: string;
  outputDir: string;
  outputPath: string;
  process: ChildProcess;
  active: boolean;
  accessTokenHash: string;
}

export class CodegenSessionStore {
  #sessions = new Map<string, CodegenSession>();

  get(id: string): CodegenSession | undefined {
    return this.#sessions.get(id);
  }

  set(session: CodegenSession): void {
    this.#sessions.set(session.id, session);
  }

  hasActive(): boolean {
    return [...this.#sessions.values()].some((session) => session.active);
  }

  delete(id: string): void {
    this.#sessions.delete(id);
  }
}
