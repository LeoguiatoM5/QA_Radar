import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const CODE_ENVIRONMENT_ALLOWLIST = new Set(["COMSPEC", "HOME", "LOCALAPPDATA", "PATH", "PATHEXT", "PLAYWRIGHT_BROWSERS_PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "USERPROFILE"]);

export type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface CodeExecutionOptions {
  outputDir: string;
  headed: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryMiB: number;
  projectRoot?: string;
  spawnProcess?: SpawnProcess;
  terminate?: (child: ChildProcess) => Promise<void>;
}

export interface CodeExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function codeExecutionEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: "1" };
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && CODE_ENVIRONMENT_ALLOWLIST.has(name.toUpperCase())) {
      environment[name] = value;
    }
  }
  return environment;
}

export function codeExecutionArguments(projectRoot: string, outputDir: string, headed: boolean, maxMemoryMiB: number, tsxLoaderPath?: string): string[] {
  const loaderPath = tsxLoaderPath ?? createRequire(join(projectRoot, "package.json")).resolve("tsx");
  return [
    `--max-old-space-size=${maxMemoryMiB}`,
    "--import",
    pathToFileURL(loaderPath).href,
    join(projectRoot, "node_modules", "playwright", "cli.js"),
    "test",
    "qa-radar.spec.ts",
    ...(headed ? ["--headed"] : []),
    "--reporter=json",
    `--output=${join(outputDir, "test-results")}`,
  ];
}

export async function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, spawnProcess: SpawnProcess = spawn): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill("SIGKILL");
    return;
  }

  if (platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawnProcess("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("error", () => {
        child.kill("SIGKILL");
        resolve();
      });
      killer.once("exit", (code) => {
        if (code !== 0) child.kill("SIGKILL");
        resolve();
      });
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export async function runPlaywrightCode(options: CodeExecutionOptions): Promise<CodeExecutionResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(process.execPath, codeExecutionArguments(projectRoot, options.outputDir, options.headed, options.maxMemoryMiB), {
    cwd: options.outputDir,
    env: {
      ...codeExecutionEnvironment(),
      NODE_PATH: join(projectRoot, "node_modules"),
    },
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const terminate = options.terminate ?? ((processToStop) => terminateProcessTree(processToStop));

  return new Promise<CodeExecutionResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(deadline);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void terminate(child).then(
        () => reject(error),
        () => reject(error),
      );
    };
    const append = (target: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        fail(new Error(`A saída da execução excedeu o limite de ${options.maxOutputBytes} bytes.`));
        return;
      }
      target.push(buffer);
    };
    const onStdout = (chunk: Buffer | string): void => append(stdout, chunk);
    const onStderr = (chunk: Buffer | string): void => append(stderr, chunk);
    const onError = (error: Error): void => fail(error);
    const onClose = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    const deadline = setTimeout(() => fail(new Error(`A execução excedeu o limite de ${options.timeoutMs} ms.`)), options.timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}
