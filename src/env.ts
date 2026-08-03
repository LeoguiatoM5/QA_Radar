import type { ServerOptions } from "./server.js";
import type { ArtifactStorageConfig } from "./artifact-storage.js";

export function codeModeEnabledForHost(host: string, setting?: string): boolean {
  // Um painel de hospedagem pode criar a chave sem valor (Render faz isso com
  // envVars marcadas `sync: false` antes do primeiro preenchimento). Tratar ""
  // como "não informado" evita derrubar o processo no boot por causa disso.
  const value = setting?.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== undefined && value !== "") {
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
  /**
   * Ausente = tudo em memória, como sempre. A persistência é opcional para que
   * a CLI e o dashboard local não passem a exigir um banco para rodar.
   */
  databaseUrl: string | undefined;
  /**
   * Ausente = artefatos só em disco. No Render o disco é efêmero, então sem
   * isto todo relatório morre no próximo deploy.
   */
  artifactStorage: ArtifactStorageConfig | undefined;
}

/**
 * Bucket, chave e segredo andam juntos: configurar só parte deles é engano de
 * quem configurou, e falhar no boot é melhor do que descobrir que nada subiu
 * quando o primeiro relatório sumir.
 */
function artifactStorageFromEnvironment(source: NodeJS.ProcessEnv): ArtifactStorageConfig | undefined {
  const bucket = source.QA_RADAR_STORAGE_BUCKET?.trim();
  const accessKeyId = source.QA_RADAR_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = source.QA_RADAR_STORAGE_SECRET_ACCESS_KEY?.trim();
  const provided = [bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (provided === 0) return undefined;
  if (provided < 3) {
    throw new Error("Configure QA_RADAR_STORAGE_BUCKET, QA_RADAR_STORAGE_ACCESS_KEY_ID e QA_RADAR_STORAGE_SECRET_ACCESS_KEY em conjunto.");
  }
  return {
    bucket: bucket ?? "",
    accessKeyId: accessKeyId ?? "",
    secretAccessKey: secretAccessKey ?? "",
    // O R2 da Cloudflare exige a região "auto"; a AWS usa a região do bucket.
    region: source.QA_RADAR_STORAGE_REGION?.trim() || "auto",
    endpoint: source.QA_RADAR_STORAGE_ENDPOINT?.trim() || undefined,
  };
}

export function loadEnvironmentConfig(source: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const host = source.HOST ?? "127.0.0.1";
  const sandboxUrl = source.QA_RADAR_SANDBOX_URL?.trim();
  // O segredo é comparado byte a byte com o do runner. Um \n ou espaço colado
  // junto no painel da hospedagem quebraria o HMAC com um 401 sem explicação,
  // então os dois lados normalizam igual (ver sandbox-runner.ts).
  const sandboxSigningSecret = source.QA_RADAR_SANDBOX_SIGNING_SECRET?.trim();
  if (Boolean(sandboxUrl) !== Boolean(sandboxSigningSecret)) {
    throw new Error("Configure QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto.");
  }
  return {
    host,
    port: portFromEnvironment(source),
    sandbox: sandboxUrl && sandboxSigningSecret ? { url: sandboxUrl, signingSecret: sandboxSigningSecret } : undefined,
    databaseUrl: source.QA_RADAR_DATABASE_URL?.trim() || undefined,
    artifactStorage: artifactStorageFromEnvironment(source),
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
