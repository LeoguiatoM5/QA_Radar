#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";
import { loadEnvironmentConfig, SERVER_OPTION_DEFAULTS } from "./env.js";
import { createSandboxCodeRunner } from "./sandbox-client.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
import { PostgresScanJobRepository } from "./scan-job-repository.js";
import { NO_SCAN_JOB_PERSISTENCE, createScanJobPersistence } from "./scan-job-persistence.js";
import { NO_ARTIFACT_STORAGE, createS3ArtifactStorage } from "./artifact-storage.js";
import { PostgresIdempotencyKeys, type IdempotencyKeys } from "./idempotency-store.js";
import { createDerivedAccessTokenIssuer, createRandomAccessTokenIssuer } from "./access-token.js";

try {
  const env = loadEnvironmentConfig();
  const hostedCodeRunner = env.sandbox ? createSandboxCodeRunner({ baseUrl: env.sandbox.url, signingSecret: env.sandbox.signingSecret }) : undefined;

  // As migrations rodam antes de a porta abrir: subir atendendo requisições
  // contra um schema desatualizado daria erro por requisição, muito mais difícil
  // de diagnosticar do que uma falha clara no boot.
  const database = env.databaseUrl ? createDatabase(env.databaseUrl) : undefined;
  let scanJobs = NO_SCAN_JOB_PERSISTENCE;
  let idempotencyKeys: IdempotencyKeys | undefined;
  if (database) {
    const result = await runMigrations(database);
    console.log(`Banco conectado. Migrations aplicadas agora: ${result.applied.length > 0 ? result.applied.join(", ") : "nenhuma"}.`);
    scanJobs = createScanJobPersistence({
      repository: new PostgresScanJobRepository(database),
      retentionMs: env.serverOptions.retentionMs ?? SERVER_OPTION_DEFAULTS.retentionMs,
      onError: (operation, error) =>
        console.error(
          JSON.stringify({
            source: "qa-radar",
            event: "scan_job.persistence_failed",
            timestamp: new Date().toISOString(),
            operation,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
    });
    idempotencyKeys = new PostgresIdempotencyKeys(database, env.serverOptions.retentionMs ?? SERVER_OPTION_DEFAULTS.retentionMs);
  } else {
    console.log("Sem QA_RADAR_DATABASE_URL: estado em memória, perdido a cada reinício.");
  }

  // Configurado e inacessível é pior que não configurado: o boot falha aqui em
  // vez de deixar cada análise subir artefato para lugar nenhum.
  const artifacts = env.artifactStorage ? await createS3ArtifactStorage(env.artifactStorage) : NO_ARTIFACT_STORAGE;
  console.log(
    env.artifactStorage
      ? `Artefatos duráveis no bucket ${env.artifactStorage.bucket}${env.artifactStorage.endpoint ? ` (${env.artifactStorage.endpoint})` : ""}.`
      : "Artefatos só em disco: um contêiner recriado leva os relatórios junto.",
  );

  // Sem segredo, o token volta a ser aleatório: a repetição de uma criação
  // deixa de reemitir token depois de um reinício, que é o comportamento
  // anterior. Degradação consciente, não falha.
  const accessTokens = env.accessTokenSecret ? createDerivedAccessTokenIssuer(env.accessTokenSecret) : createRandomAccessTokenIssuer();
  if (!env.accessTokenSecret && env.databaseUrl) {
    console.log("Sem QA_RADAR_ACCESS_TOKEN_SECRET: a repetição de uma criação não reemite token após reinício.");
  }

  const server = createQaRadarServer({ ...env.serverOptions, hostedCodeRunner, scanJobs, artifacts, accessTokens, idempotencyKeys });
  server.listen(env.port, env.host, () => {
    console.log(`\nQA Radar Web disponível em http://${env.host}:${env.port}`);
    console.log("Pressione Ctrl+C para encerrar.\n");
  });

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} recebido, encerrando.`);
    server.close(() => {
      void database?.close().finally(() => process.exit(0));
      if (!database) process.exit(0);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(signal));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
