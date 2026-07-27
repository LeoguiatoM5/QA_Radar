import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { CodeExecutionResult, SpawnProcess } from "./code-execution.js";

const RESULT_ENVELOPE_BYTES = 64 * 1024;
const PROXY_STARTUP_TIMEOUT_MS = 10_000;

export interface SandboxExecutionRequest {
  executionId: string;
  code: string;
  limits: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxMemoryMiB: number;
  };
}

export type SandboxNetworkPolicy = "none" | "public-egress";

export interface DockerSandboxConfig {
  image: string;
  cpuLimit: number;
  pidsLimit: number;
  maxMemoryMiB: number;
  maxTimeoutMs: number;
  networkPolicy?: SandboxNetworkPolicy;
  egressMaxBytes?: number;
  egressMaxConnections?: number;
  dockerCommand?: string;
  spawnProcess?: SpawnProcess;
}

export interface DockerSandboxReadiness {
  dockerVersion: string;
  image: string;
}

function executionSuffix(executionId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId)) {
    throw new Error("Identificador de execução inválido.");
  }
  return executionId.toLowerCase();
}

function containerName(executionId: string): string {
  return `qa-radar-job-${executionSuffix(executionId)}`;
}

function proxyContainerName(executionId: string): string {
  return `qa-radar-egress-${executionSuffix(executionId)}`;
}

function egressVolumeName(executionId: string): string {
  return `qa-radar-egress-${executionSuffix(executionId)}`;
}

function memoryLimit(request: SandboxExecutionRequest, config: DockerSandboxConfig): number {
  return Math.min(request.limits.maxMemoryMiB, config.maxMemoryMiB);
}

export function dockerSandboxArguments(
  request: SandboxExecutionRequest,
  config: DockerSandboxConfig,
): string[] {
  const name = containerName(request.executionId);
  const memoryMiB = memoryLimit(request, config);
  const publicEgress = config.networkPolicy === "public-egress";
  return [
    "run",
    "--rm",
    "--interactive",
    "--name", name,
    "--hostname", "sandbox",
    "--init",
    "--stop-timeout", "1",
    "--network", "none",
    "--ipc", "private",
    "--read-only",
    "--tmpfs", "/work:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=128m,uid=10001,gid=10001,mode=1777",
    "--shm-size", "64m",
    "--user", "10001:10001",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--security-opt", "seccomp=builtin",
    "--pids-limit", String(config.pidsLimit),
    "--cpus", String(config.cpuLimit),
    "--memory", `${memoryMiB}m`,
    "--memory-swap", `${memoryMiB}m`,
    "--ulimit", `nproc=${config.pidsLimit}:${config.pidsLimit}`,
    "--ulimit", "nofile=1024:1024",
    "--ulimit", "core=0:0",
    "--env", "CI=1",
    "--env", "HOME=/tmp",
    "--env", "TMPDIR=/tmp",
    "--env", "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
    ...(publicEgress
      ? [
          "--env", "QA_RADAR_EGRESS_PROXY=1",
          "--mount", `type=volume,src=${egressVolumeName(request.executionId)},dst=/run/egress,readonly`,
        ]
      : []),
    "--workdir", "/work",
    config.image,
  ];
}

export function dockerEgressProxyArguments(
  request: SandboxExecutionRequest,
  config: DockerSandboxConfig,
): string[] {
  return [
    "run",
    "--rm",
    "--name", proxyContainerName(request.executionId),
    "--hostname", "egress",
    "--init",
    "--stop-timeout", "1",
    "--network", "bridge",
    "--ipc", "private",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=1777",
    "--user", "10001:10001",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--security-opt", "seccomp=builtin",
    "--pids-limit", "64",
    "--cpus", "0.25",
    "--memory", "128m",
    "--memory-swap", "128m",
    "--ulimit", "nofile=1024:1024",
    "--ulimit", "core=0:0",
    "--mount", `type=volume,src=${egressVolumeName(request.executionId)},dst=/run/egress`,
    "--env", `QA_RADAR_EGRESS_MAX_BYTES=${config.egressMaxBytes ?? 64 * 1024 * 1024}`,
    "--env", `QA_RADAR_EGRESS_MAX_CONNECTIONS=${config.egressMaxConnections ?? 32}`,
    "--entrypoint", "node",
    config.image,
    "/app/dist/sandbox-egress-proxy.js",
    "/run/egress/proxy.sock",
  ];
}

function waitForExit(child: ChildProcess, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve();
    };
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, timeoutMs);
    child.once("error", finish);
    child.once("close", finish);
  });
}

async function dockerCleanupCommand(
  dockerCommand: string,
  args: readonly string[],
  spawnProcess: SpawnProcess,
): Promise<void> {
  const cleanup = spawnProcess(
    dockerCommand,
    args,
    { stdio: "ignore", windowsHide: true },
  );
  await waitForExit(cleanup);
}

function dockerCommand(
  command: string,
  args: readonly string[],
  spawnProcess: SpawnProcess,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const append = (target: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > RESULT_ENVELOPE_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("A saída de controle do Docker excedeu o limite."));
        return;
      }
      target.push(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => append(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => append(stderr, chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8").trim());
      else reject(new Error(
        `O Docker recusou a preparação do sandbox: ${Buffer.concat(stderr).toString("utf8").slice(-2_000)}`,
      ));
    });
  });
}

export async function checkDockerSandboxReadiness(
  config: DockerSandboxConfig,
): Promise<DockerSandboxReadiness> {
  const dockerCommandName = config.dockerCommand ?? "docker";
  const spawnProcess = config.spawnProcess ?? spawn;
  const dockerVersion = await dockerCommand(
    dockerCommandName,
    ["version", "--format", "{{.Server.Version}}"],
    spawnProcess,
  );
  await dockerCommand(
    dockerCommandName,
    ["image", "inspect", config.image, "--format", "{{.Id}}"],
    spawnProcess,
  );
  return { dockerVersion, image: config.image };
}

function waitForProxyReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdout);
      child.stderr?.removeListener("data", onStderr);
      if (error) reject(error);
      else resolve();
    };
    const onStdout = (chunk: Buffer | string): void => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > 8 * 1024) {
        finish(new Error("O proxy de egress excedeu o limite de inicialização."));
      } else if (stdout.split(/\r?\n/).includes("READY")) {
        finish();
      }
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (code: number | null): void => finish(new Error(
      `O proxy de egress encerrou antes de ficar pronto (${code ?? 1}): ${Buffer.concat(stderr).toString("utf8").slice(-2_000)}`,
    ));
    const deadline = setTimeout(
      () => finish(new Error("O proxy de egress não ficou pronto dentro do limite.")),
      timeoutMs,
    );
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function parseContainerResult(
  raw: string,
  request: SandboxExecutionRequest,
): CodeExecutionResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("O job sandbox retornou JSON inválido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("O job sandbox retornou um resultado inválido.");
  }
  const result = value as Record<string, unknown>;
  if (
    !Number.isInteger(result.exitCode)
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
  ) {
    throw new Error("O job sandbox retornou um resultado inválido.");
  }
  const outputBytes = Buffer.byteLength(result.stdout, "utf8")
    + Buffer.byteLength(result.stderr, "utf8");
  if (outputBytes > request.limits.maxOutputBytes) {
    throw new Error("O job sandbox retornou saída acima do limite contratado.");
  }
  return {
    exitCode: result.exitCode as number,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function executeJobContainer(
  child: ChildProcess,
  request: SandboxExecutionRequest,
  timeoutMs: number,
): Promise<CodeExecutionResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outerLimit = request.limits.maxOutputBytes + RESULT_ENVELOPE_BYTES;
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, result?: CodeExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else {
        resolve(result as CodeExecutionResult);
      }
    };
    const append = (target: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > outerLimit) {
        finish(new Error(`A saída bruta do container excedeu o limite de ${outerLimit} bytes.`));
        return;
      }
      target.push(buffer);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => append(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => append(stderr, chunk));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString("utf8").slice(-2_000);
        finish(new Error(`O container sandbox encerrou com código ${code ?? 1}: ${details}`));
        return;
      }
      try {
        finish(undefined, parseContainerResult(Buffer.concat(stdout).toString("utf8"), request));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin?.once("error", (error) => finish(error));
    const deadline = setTimeout(
      () => finish(new Error(`A execução sandbox excedeu o limite de ${request.limits.timeoutMs} ms.`)),
      timeoutMs,
    );
    child.stdin?.end(JSON.stringify({
      code: request.code,
      limits: request.limits,
    }));
  });
}

export async function runDockerSandbox(
  request: SandboxExecutionRequest,
  config: DockerSandboxConfig,
): Promise<CodeExecutionResult> {
  if (request.limits.timeoutMs > config.maxTimeoutMs) {
    throw new Error("O timeout solicitado excede o limite do runner.");
  }
  if (request.limits.maxMemoryMiB > config.maxMemoryMiB) {
    throw new Error("A memória solicitada excede o limite do runner.");
  }

  const docker = config.dockerCommand ?? "docker";
  const spawnProcess = config.spawnProcess ?? spawn;
  const jobName = containerName(request.executionId);
  const proxyName = proxyContainerName(request.executionId);
  const volumeName = egressVolumeName(request.executionId);
  const publicEgress = config.networkPolicy === "public-egress";
  const expiresAt = Date.now() + request.limits.timeoutMs;
  let proxyProcess: ChildProcess | undefined;
  let volumeCreated = false;

  try {
    if (publicEgress) {
      await dockerCommand(docker, ["volume", "create", volumeName], spawnProcess);
      volumeCreated = true;
      proxyProcess = spawnProcess(
        docker,
        dockerEgressProxyArguments(request, config),
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const startupBudget = Math.min(
        PROXY_STARTUP_TIMEOUT_MS,
        Math.max(1, expiresAt - Date.now()),
      );
      await waitForProxyReady(proxyProcess, startupBudget);
    }

    const remainingMs = Math.max(1, expiresAt - Date.now());
    const child = spawnProcess(
      docker,
      dockerSandboxArguments(request, config),
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      } satisfies SpawnOptions,
    );
    return await executeJobContainer(child, request, remainingMs);
  } finally {
    await Promise.all([
      dockerCleanupCommand(docker, ["rm", "--force", jobName], spawnProcess),
      ...(publicEgress
        ? [dockerCleanupCommand(docker, ["rm", "--force", proxyName], spawnProcess)]
        : []),
    ]);
    proxyProcess?.kill("SIGKILL");
    if (volumeCreated) {
      await dockerCleanupCommand(docker, ["volume", "rm", "--force", volumeName], spawnProcess);
    }
  }
}
