import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertHostedPlaywrightCode } from "./code-policy.js";
import { SANDBOX_PROTOCOL_VERSION, SandboxRequestVerifier } from "./sandbox-client.js";
import { runDockerSandbox, checkDockerSandboxReadiness, type DockerSandboxConfig, type SandboxExecutionRequest, type SandboxNetworkPolicy } from "./sandbox-runtime.js";

const MAX_REQUEST_BYTES = 512 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RunnerLimits {
  maxCodeBytes: number;
  maxOutputBytes: number;
  maxMemoryMiB: number;
  maxTimeoutMs: number;
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} deve ser um inteiro positivo.`);
  return value;
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} deve ser um número positivo.`);
  return value;
}

function networkPolicy(raw: string | undefined): SandboxNetworkPolicy {
  const value = raw ?? "none";
  if (value !== "none" && value !== "public-egress") {
    throw new Error("QA_RADAR_SANDBOX_NETWORK_POLICY deve ser none ou public-egress.");
  }
  return value;
}

async function rawBody(request: IncomingMessage): Promise<string> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "Corpo da requisição acima do limite.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_REQUEST_BYTES) throw new HttpError(413, "Corpo da requisição acima do limite.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function integerField(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HttpError(400, `${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value as number;
}

function parseExecutionRequest(raw: string, limits: RunnerLimits): SandboxExecutionRequest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Envelope de execução inválido.");
  }
  const body = value as Record<string, unknown>;
  const rawLimits = body.limits;
  if (
    body.schemaVersion !== SANDBOX_PROTOCOL_VERSION ||
    typeof body.executionId !== "string" ||
    !UUID_PATTERN.test(body.executionId) ||
    typeof body.code !== "string" ||
    !body.code.trim() ||
    body.headed !== false ||
    !rawLimits ||
    typeof rawLimits !== "object" ||
    Array.isArray(rawLimits)
  ) {
    throw new HttpError(400, "Envelope de execução inválido.");
  }
  if (Buffer.byteLength(body.code, "utf8") > limits.maxCodeBytes) {
    throw new HttpError(413, "Código acima do limite do runner.");
  }
  try {
    assertHostedPlaywrightCode(body.code);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
  const requested = rawLimits as Record<string, unknown>;
  return {
    executionId: body.executionId,
    code: body.code,
    limits: {
      timeoutMs: integerField(requested.timeoutMs, "timeoutMs", 1_000, limits.maxTimeoutMs),
      maxOutputBytes: integerField(requested.maxOutputBytes, "maxOutputBytes", 1_024, limits.maxOutputBytes),
      maxMemoryMiB: integerField(requested.maxMemoryMiB, "maxMemoryMiB", 128, limits.maxMemoryMiB),
    },
  };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string") throw new HttpError(401, "Autenticação do sandbox inválida.");
  return value;
}

function runnerConfiguration(): {
  host: string;
  port: number;
  concurrency: number;
  secret: string;
  limits: RunnerLimits;
  docker: DockerSandboxConfig;
} {
  // Normalização idêntica à do lado do QA Radar (ver env.ts): o segredo chega
  // por .env/painel e um \n acidental viraria um 401 sem diagnóstico.
  const secret = process.env.QA_RADAR_SANDBOX_SIGNING_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512) {
    throw new Error("QA_RADAR_SANDBOX_SIGNING_SECRET deve ter entre 32 e 512 bytes.");
  }
  const maxTimeoutMs = positiveInteger(process.env.QA_RADAR_SANDBOX_MAX_EXECUTION_MS, 300_000, "QA_RADAR_SANDBOX_MAX_EXECUTION_MS");
  const maxMemoryMiB = positiveInteger(process.env.QA_RADAR_SANDBOX_MAX_MEMORY_MIB, 512, "QA_RADAR_SANDBOX_MAX_MEMORY_MIB");
  return {
    host: process.env.QA_RADAR_SANDBOX_HOST ?? "127.0.0.1",
    port: positiveInteger(process.env.QA_RADAR_SANDBOX_PORT, 4180, "QA_RADAR_SANDBOX_PORT"),
    concurrency: positiveInteger(process.env.QA_RADAR_SANDBOX_CONCURRENCY, 1, "QA_RADAR_SANDBOX_CONCURRENCY"),
    secret,
    limits: {
      maxCodeBytes: positiveInteger(process.env.QA_RADAR_SANDBOX_MAX_CODE_BYTES, 256 * 1024, "QA_RADAR_SANDBOX_MAX_CODE_BYTES"),
      maxOutputBytes: positiveInteger(process.env.QA_RADAR_SANDBOX_MAX_OUTPUT_BYTES, 1024 * 1024, "QA_RADAR_SANDBOX_MAX_OUTPUT_BYTES"),
      maxMemoryMiB,
      maxTimeoutMs,
    },
    docker: {
      image: process.env.QA_RADAR_SANDBOX_JOB_IMAGE ?? "qa-radar-sandbox-job:3.2.0",
      cpuLimit: positiveNumber(process.env.QA_RADAR_SANDBOX_CPUS, 0.5, "QA_RADAR_SANDBOX_CPUS"),
      pidsLimit: positiveInteger(process.env.QA_RADAR_SANDBOX_PIDS, 256, "QA_RADAR_SANDBOX_PIDS"),
      maxMemoryMiB,
      maxTimeoutMs,
      networkPolicy: networkPolicy(process.env.QA_RADAR_SANDBOX_NETWORK_POLICY),
      egressMaxBytes: positiveInteger(process.env.QA_RADAR_SANDBOX_EGRESS_MAX_BYTES, 64 * 1024 * 1024, "QA_RADAR_SANDBOX_EGRESS_MAX_BYTES"),
      egressMaxConnections: positiveInteger(process.env.QA_RADAR_SANDBOX_EGRESS_MAX_CONNECTIONS, 32, "QA_RADAR_SANDBOX_EGRESS_MAX_CONNECTIONS"),
      ...(process.env.QA_RADAR_DOCKER_COMMAND ? { dockerCommand: process.env.QA_RADAR_DOCKER_COMMAND } : {}),
    },
  };
}

export function createSandboxRunnerServer(
  secret: string,
  limits: RunnerLimits,
  docker: DockerSandboxConfig,
  maxConcurrency = 1,
  runSandbox: typeof runDockerSandbox = runDockerSandbox,
  readiness: () => Promise<unknown> = () => checkDockerSandboxReadiness(docker),
): ReturnType<typeof createServer> {
  const verifier = new SandboxRequestVerifier(secret);
  let active = 0;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://sandbox.invalid");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { status: "ok", protocol: SANDBOX_PROTOCOL_VERSION });
        return;
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        try {
          const details = await readiness();
          json(response, 200, { status: "ready", protocol: SANDBOX_PROTOCOL_VERSION, details });
        } catch {
          json(response, 503, { status: "not_ready", protocol: SANDBOX_PROTOCOL_VERSION });
        }
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/v1/executions" || url.search) {
        throw new HttpError(404, "Rota não encontrada.");
      }
      if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        throw new HttpError(415, "Content-Type deve ser application/json.");
      }
      if (request.headers["x-qa-radar-protocol"] !== SANDBOX_PROTOCOL_VERSION) {
        throw new HttpError(400, "Versão do protocolo incompatível.");
      }
      const body = await rawBody(request);
      const signatureInput = {
        timestamp: requiredHeader(request, "x-qa-radar-timestamp"),
        requestId: requiredHeader(request, "x-qa-radar-request-id"),
        signature: requiredHeader(request, "x-qa-radar-signature"),
        body,
      };
      if (!verifier.verifyAndConsume(signatureInput)) {
        throw new HttpError(401, "Autenticação do sandbox inválida ou já consumida.");
      }
      if (active >= maxConcurrency) throw new HttpError(429, "Runner sandbox sem capacidade disponível.");
      const execution = parseExecutionRequest(body, limits);
      active += 1;
      try {
        const result = await runSandbox(execution, docker);
        json(response, 200, {
          schemaVersion: SANDBOX_PROTOCOL_VERSION,
          executionId: execution.executionId,
          ...result,
        });
      } finally {
        active -= 1;
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Falha interna ao executar o sandbox.";
      if (!response.headersSent) json(response, status, { error: message });
      else response.destroy();
      if (!(error instanceof HttpError)) console.error(error);
    }
  });
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPoint === import.meta.url) {
  const configuration = runnerConfiguration();
  const server = createSandboxRunnerServer(configuration.secret, configuration.limits, configuration.docker, configuration.concurrency);
  server.listen(configuration.port, configuration.host, () => {
    console.log(`QA Radar sandbox runner em http://${configuration.host}:${configuration.port}`);
  });
}
