import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";
import { codeExecutionEnvironment, terminateProcessTree, type CodeExecutionOptions, type CodeExecutionResult } from "./code-execution.js";

export const CODE_WORKER_RESULT_FILE = "code-worker-result.json";
const MAX_WORKER_DIAGNOSTIC_BYTES = 64 * 1024;
const WORKER_SHUTDOWN_GRACE_MS = 5_000;

export function codeWorkerArguments(options: CodeExecutionOptions, moduleUrl = import.meta.url, tsxLoaderPath?: string): string[] {
  const modulePath = fileURLToPath(moduleUrl);
  const sourceRuntime = modulePath.endsWith(".ts");
  const workerPath = fileURLToPath(new URL(sourceRuntime ? "./code-worker.ts" : "./code-worker.js", moduleUrl));
  const loaderSpecifier = sourceRuntime ? pathToFileURL(tsxLoaderPath ?? createRequire(moduleUrl).resolve("tsx")).href : undefined;
  return [
    "--max-old-space-size=128",
    ...(loaderSpecifier ? ["--import", loaderSpecifier] : []),
    workerPath,
    options.outputDir,
    String(options.headed),
    String(options.timeoutMs),
    String(options.maxOutputBytes),
    String(options.maxMemoryMiB),
    options.projectRoot ?? process.cwd(),
  ];
}

function isCodeExecutionResult(value: unknown): value is CodeExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.exitCode) && typeof record.stdout === "string" && typeof record.stderr === "string";
}

export async function runPlaywrightCodeWorker(options: CodeExecutionOptions): Promise<CodeExecutionResult> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(process.execPath, codeWorkerArguments(options), {
    cwd: options.outputDir,
    env: codeExecutionEnvironment(),
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const terminate = options.terminate ?? ((processToStop: ChildProcess) => terminateProcessTree(processToStop));

  return new Promise<CodeExecutionResult>((resolve, reject) => {
    const diagnostics: Buffer[] = [];
    let diagnosticBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(deadline);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onDiagnostic);
      child.stderr?.removeListener("data", onDiagnostic);
    };
    const fail = (error: Error, stopWorker: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!stopWorker) {
        reject(error);
        return;
      }
      void terminate(child).then(
        () => reject(error),
        () => reject(error),
      );
    };
    const onDiagnostic = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      diagnosticBytes += buffer.byteLength;
      if (diagnosticBytes > MAX_WORKER_DIAGNOSTIC_BYTES) {
        fail(new Error("A saída de diagnóstico do worker excedeu o limite permitido."), true);
        return;
      }
      diagnostics.push(buffer);
    };
    const onError = (error: Error): void => fail(error, false);
    const onClose = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void (async () => {
        try {
          const result = JSON.parse(await readFile(join(options.outputDir, CODE_WORKER_RESULT_FILE), "utf8")) as unknown;
          if (!isCodeExecutionResult(result)) {
            throw new Error("O worker retornou um resultado inválido.");
          }
          resolve(result);
        } catch (error) {
          const detail = Buffer.concat(diagnostics).toString("utf8").trim();
          const reason = error instanceof Error ? error.message : String(error);
          reject(new Error(`O worker Playwright terminou com código ${code ?? 1} sem resultado válido: ${detail || reason}`));
        }
      })();
    };
    const deadline = setTimeout(
      () => fail(new Error(`O worker Playwright excedeu o limite de ${options.timeoutMs + WORKER_SHUTDOWN_GRACE_MS} ms.`), true),
      options.timeoutMs + WORKER_SHUTDOWN_GRACE_MS,
    );

    child.stdout?.on("data", onDiagnostic);
    child.stderr?.on("data", onDiagnostic);
    child.once("error", onError);
    child.once("close", onClose);
  });
}
