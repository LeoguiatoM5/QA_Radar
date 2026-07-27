#!/usr/bin/env node
import { codeModeEnabledForHost, createQaRadarServer } from "./server.js";
import { createSandboxCodeRunner } from "./sandbox-client.js";

function positiveIntegerFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} deve ser um número inteiro positivo.`);
  return value;
}

function portFromEnvironment(): number {
  const raw = process.env.PORT ?? "4173";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número entre 1 e 65535.");
  }
  return port;
}

try {
  const port = portFromEnvironment();
  const host = process.env.HOST ?? "127.0.0.1";
  const allowPrivateTargets = process.env.QA_RADAR_ALLOW_PRIVATE_TARGETS === "true";
  const trustProxy = process.env.QA_RADAR_TRUST_PROXY === "true";
  const allowHistory = process.env.QA_RADAR_ENABLE_HISTORY === "true";
  // A Jornada Playwright usa execução direta apenas no runtime seguro atual.
  const allowCodeMode = codeModeEnabledForHost(host, process.env.QA_RADAR_ENABLE_CODE_MODE);
  const sandboxUrl = process.env.QA_RADAR_SANDBOX_URL?.trim();
  const sandboxSigningSecret = process.env.QA_RADAR_SANDBOX_SIGNING_SECRET;
  if (Boolean(sandboxUrl) !== Boolean(sandboxSigningSecret)) {
    throw new Error("Configure QA_RADAR_SANDBOX_URL e QA_RADAR_SANDBOX_SIGNING_SECRET em conjunto.");
  }
  const hostedCodeRunner = sandboxUrl && sandboxSigningSecret
    ? createSandboxCodeRunner({ baseUrl: sandboxUrl, signingSecret: sandboxSigningSecret })
    : undefined;
  const server = createQaRadarServer({
    allowPrivateTargets,
    trustProxy,
    allowHistory,
    allowCodeMode,
    codeModeAdminToken: process.env.QA_RADAR_CODE_MODE_ADMIN_TOKEN,
    hostedCodeRunner,
    concurrency: positiveIntegerFromEnvironment("QA_RADAR_CONCURRENCY", 2),
    maxQueueSize: positiveIntegerFromEnvironment("QA_RADAR_MAX_QUEUE_SIZE", 20),
    rateLimitMax: positiveIntegerFromEnvironment("QA_RADAR_RATE_LIMIT_MAX", 10),
    retentionMs: positiveIntegerFromEnvironment("QA_RADAR_RETENTION_MS", 60 * 60_000),
    maxJobDurationMs: positiveIntegerFromEnvironment("QA_RADAR_MAX_JOB_DURATION_MS", 5 * 60_000),
    maxCodeExecutionDurationMs: positiveIntegerFromEnvironment("QA_RADAR_MAX_CODE_EXECUTION_MS", 5 * 60_000),
    maxCodeOutputBytes: positiveIntegerFromEnvironment("QA_RADAR_MAX_CODE_OUTPUT_BYTES", 1024 * 1024),
    maxCodeMemoryMiB: positiveIntegerFromEnvironment("QA_RADAR_MAX_CODE_MEMORY_MIB", 512),
    maxCodegenDurationMs: positiveIntegerFromEnvironment("QA_RADAR_MAX_CODEGEN_DURATION_MS", 10 * 60_000),
    maxSitemapPages: positiveIntegerFromEnvironment("QA_RADAR_MAX_SITEMAP_PAGES", 20),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
  });
  server.listen(port, host, () => {
    console.log(`\nQA Radar Web disponível em http://${host}:${port}`);
    console.log("Pressione Ctrl+C para encerrar.\n");
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
