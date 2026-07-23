#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";

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
  // Jornadas ficam disponíveis no dashboard por padrão; use false para
  // desativar explicitamente em uma implantação que ainda não queira expô-las.
  const allowJourneys = process.env.QA_RADAR_ENABLE_JOURNEYS !== "false";
  const server = createQaRadarServer({
    allowPrivateTargets,
    trustProxy,
    allowHistory,
    allowJourneys,
    concurrency: positiveIntegerFromEnvironment("QA_RADAR_CONCURRENCY", 2),
    maxQueueSize: positiveIntegerFromEnvironment("QA_RADAR_MAX_QUEUE_SIZE", 20),
    rateLimitMax: positiveIntegerFromEnvironment("QA_RADAR_RATE_LIMIT_MAX", 10),
    retentionMs: positiveIntegerFromEnvironment("QA_RADAR_RETENTION_MS", 60 * 60_000),
    maxJobDurationMs: positiveIntegerFromEnvironment("QA_RADAR_MAX_JOB_DURATION_MS", 5 * 60_000),
    maxSitemapPages: positiveIntegerFromEnvironment("QA_RADAR_MAX_SITEMAP_PAGES", 20),
    maxJourneySteps: positiveIntegerFromEnvironment("QA_RADAR_MAX_JOURNEY_STEPS", 20),
    maxJourneyPayloadBytes: positiveIntegerFromEnvironment("QA_RADAR_MAX_JOURNEY_PAYLOAD_BYTES", 32 * 1024),
    maxJourneyDurationMs: positiveIntegerFromEnvironment("QA_RADAR_MAX_JOURNEY_DURATION_MS", 3 * 60_000),
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
