import type { ServerOptions } from "./server.js";

export function codeModeEnabledForHost(host: string, setting?: string): boolean {
  if (setting === "true") return true;
  if (setting === "false") return false;
  if (setting !== undefined) {
    throw new Error("QA_RADAR_ENABLE_CODE_MODE deve ser true ou false.");
  }
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function positiveIntegerFromEnvironment(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} deve ser um número inteiro positivo.`);
  return value;
}

function portFromEnvironment(source: NodeJS.ProcessEnv): number {
  const raw = source.PORT ?? "4173";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número entre 1 e 65535.");
  }
  return port;
}

function booleanFromEnvironment(source: NodeJS.ProcessEnv, name: string): boolean {
  return source[name] === "true";
}

export const SERVER_OPTION_DEFAULTS = {
  concurrency: 2,
  maxQueueSize: 20,
  rateLimitMax: 10,
  retentionMs: 60 * 60_000,
  maxJobDurationMs: 5 * 60_000,
  maxCodeExecutionDurationMs: 5 * 60_000,
  maxCodeOutputBytes: 1024 * 1024,
  maxCodeMemoryMiB: 512,
  maxCodegenDurationMs: 10 * 60_000,
  maxSitemapPages: 20,
} as const;

export interface EnvironmentConfig {
  host: string;
  port: number;
  serverOptions: Partial<ServerOptions>;
  sandbox: { url: string; signingSecret: string } | undefined;
}

export function loadEnvironmentConfig(source: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const host = source.HOST ?? "127.0.0.1";
  const sandboxUrl = source.QA_RADAR_SANDBOX_URL?.trim();
  const sandboxSigningSecret = source.QA_RADAR_SANDBOX_SIGNING_SECRET;
  if (Boolean(sandboxUrl) !== Boolean(sandboxSigningSecret)) {
    throw new Error("Configure QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto.");
  }
  return {
    host,
    port: portFromEnvironment(source),
    sandbox: sandboxUrl && sandboxSigningSecret ? { url: sandboxUrl, signingSecret: sandboxSigningSecret } : undefined,
    serverOptions: {
      allowPrivateTargets: booleanFromEnvironment(source, "QA_RADAR_ALLOW_PRIVATE_TARGETS"),
      trustProxy: booleanFromEnvironment(source, "QA_RADAR_TRUST_PROXY"),
      allowHistory: booleanFromEnvironment(source, "QA_RADAR_ENABLE_HISTORY"),
      allowCodeMode: codeModeEnabledForHost(host, source.QA_RADAR_ENABLE_CODE_MODE),
      codeModeAdminToken: source.QA_RADAR_CODE_MODE_ADMIN_TOKEN,
      concurrency: positiveIntegerFromEnvironment(source, "QA_RADAR_CONCURRENCY", SERVER_OPTION_DEFAULTS.concurrency),
      maxQueueSize: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_QUEUE_SIZE", SERVER_OPTION_DEFAULTS.maxQueueSize),
      rateLimitMax: positiveIntegerFromEnvironment(source, "QA_RADAR_RATE_LIMIT_MAX", SERVER_OPTION_DEFAULTS.rateLimitMax),
      retentionMs: positiveIntegerFromEnvironment(source, "QA_RADAR_RETENTION_MS", SERVER_OPTION_DEFAULTS.retentionMs),
      maxJobDurationMs: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_JOB_DURATION_MS", SERVER_OPTION_DEFAULTS.maxJobDurationMs),
      maxCodeExecutionDurationMs: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_CODE_EXECUTION_MS", SERVER_OPTION_DEFAULTS.maxCodeExecutionDurationMs),
      maxCodeOutputBytes: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_CODE_OUTPUT_BYTES", SERVER_OPTION_DEFAULTS.maxCodeOutputBytes),
      maxCodeMemoryMiB: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_CODE_MEMORY_MIB", SERVER_OPTION_DEFAULTS.maxCodeMemoryMiB),
      maxCodegenDurationMs: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_CODEGEN_DURATION_MS", SERVER_OPTION_DEFAULTS.maxCodegenDurationMs),
      maxSitemapPages: positiveIntegerFromEnvironment(source, "QA_RADAR_MAX_SITEMAP_PAGES", SERVER_OPTION_DEFAULTS.maxSitemapPages),
      turnstileSiteKey: source.TURNSTILE_SITE_KEY,
      turnstileSecretKey: source.TURNSTILE_SECRET_KEY,
    },
  };
}
