import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CodeExecutionOptions, CodeExecutionResult } from "./code-execution.js";

export const SANDBOX_PROTOCOL_VERSION = "1.0";
const DEFAULT_CLOCK_SKEW_MS = 5 * 60_000;
const RESPONSE_ENVELOPE_BYTES = 64 * 1024;

export interface HostedCodeExecutionOptions extends CodeExecutionOptions {
  code: string;
}

export type HostedCodeRunner = (
  options: HostedCodeExecutionOptions,
) => Promise<CodeExecutionResult>;

export interface SandboxClientOptions {
  baseUrl: string;
  signingSecret: string;
  allowInsecureHttp?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  requestId?: () => string;
}

export interface SandboxSignatureInput {
  timestamp: string;
  requestId: string;
  body: string;
}

export function sandboxRequestSignature(
  secret: string,
  input: SandboxSignatureInput,
): string {
  return createHmac("sha256", secret)
    .update(`${input.timestamp}\n${input.requestId}\n${input.body}`, "utf8")
    .digest("hex");
}

export function verifySandboxRequestSignature(
  secret: string,
  input: SandboxSignatureInput & { signature: string },
  now = Date.now(),
  maxClockSkewMs = DEFAULT_CLOCK_SKEW_MS,
): boolean {
  const issuedAt = Date.parse(input.timestamp);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > maxClockSkewMs) return false;
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) return false;
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  const actual = Buffer.from(input.signature, "hex");
  const expected = Buffer.from(sandboxRequestSignature(secret, input), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class SandboxRequestVerifier {
  private readonly consumed = new Map<string, number>();

  constructor(
    private readonly secret: string,
    private readonly maxClockSkewMs = DEFAULT_CLOCK_SKEW_MS,
    private readonly maxRememberedRequests = 10_000,
  ) {}

  verifyAndConsume(
    input: SandboxSignatureInput & { signature: string },
    now = Date.now(),
  ): boolean {
    for (const [requestId, expiresAt] of this.consumed) {
      if (expiresAt < now) this.consumed.delete(requestId);
    }
    if (this.consumed.has(input.requestId)) return false;
    if (this.consumed.size >= this.maxRememberedRequests) return false;
    if (!verifySandboxRequestSignature(this.secret, input, now, this.maxClockSkewMs)) return false;
    this.consumed.set(input.requestId, now + this.maxClockSkewMs);
    return true;
  }
}

function sandboxEndpoint(baseUrl: string, allowInsecureHttp: boolean): URL {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("QA_RADAR_SANDBOX_URL não pode conter credenciais, query ou fragmento.");
  }
  if (base.protocol !== "https:" && !(allowInsecureHttp && base.protocol === "http:")) {
    throw new Error("QA_RADAR_SANDBOX_URL deve usar HTTPS.");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL("v1/executions", base);
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`A resposta do sandbox excedeu o limite de ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sandboxResult(value: unknown, executionId: string, maxOutputBytes: number): CodeExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("O sandbox retornou um envelope inválido.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SANDBOX_PROTOCOL_VERSION || record.executionId !== executionId) {
    throw new Error("O sandbox retornou versão ou identificador incompatível.");
  }
  if (
    !Number.isInteger(record.exitCode)
    || typeof record.stdout !== "string"
    || typeof record.stderr !== "string"
  ) {
    throw new Error("O sandbox retornou um resultado de execução inválido.");
  }
  if (Buffer.byteLength(record.stdout, "utf8") + Buffer.byteLength(record.stderr, "utf8") > maxOutputBytes) {
    throw new Error("O sandbox retornou saída acima do limite contratado.");
  }
  return {
    exitCode: record.exitCode as number,
    stdout: record.stdout,
    stderr: record.stderr,
  };
}

export function createSandboxCodeRunner(config: SandboxClientOptions): HostedCodeRunner {
  if (Buffer.byteLength(config.signingSecret, "utf8") < 32 || Buffer.byteLength(config.signingSecret, "utf8") > 512) {
    throw new Error("QA_RADAR_SANDBOX_SIGNING_SECRET deve ter entre 32 e 512 bytes.");
  }
  const endpoint = sandboxEndpoint(config.baseUrl, config.allowInsecureHttp === true);
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? Date.now;
  const requestId = config.requestId ?? randomUUID;

  return async (options): Promise<CodeExecutionResult> => {
    const executionId = randomUUID();
    const timestamp = new Date(now()).toISOString();
    const nonce = requestId();
    const body = JSON.stringify({
      schemaVersion: SANDBOX_PROTOCOL_VERSION,
      executionId,
      code: options.code,
      headed: false,
      limits: {
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
        maxMemoryMiB: options.maxMemoryMiB,
      },
    });
    const signature = sandboxRequestSignature(config.signingSecret, {
      timestamp,
      requestId: nonce,
      body,
    });
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qa-radar-protocol": SANDBOX_PROTOCOL_VERSION,
        "x-qa-radar-request-id": nonce,
        "x-qa-radar-timestamp": timestamp,
        "x-qa-radar-signature": signature,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs + 5_000),
    });
    const responseText = await boundedResponseText(
      response,
      options.maxOutputBytes + RESPONSE_ENVELOPE_BYTES,
    );
    if (!response.ok) {
      throw new Error(`O sandbox recusou a execução (${response.status}): ${responseText.slice(0, 2_000)}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(responseText);
    } catch {
      throw new Error("O sandbox retornou JSON inválido.");
    }
    return sandboxResult(value, executionId, options.maxOutputBytes);
  };
}
