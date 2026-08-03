#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";
import { loadEnvironmentConfig, SERVER_OPTION_DEFAULTS } from "./env.js";
import { createSandboxCodeRunner } from "./sandbox-client.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
import { PostgresScanJobRepository } from "./scan-job-repository.js";
import { NO_SCAN_JOB_PERSISTENCE, createScanJobPersistence } from "./scan-job-persistence.js";

try {
  const env = loadEnvironmentConfig();
  const hostedCodeRunner = env.sandbox ? createSandboxCodeRunner({ baseUrl: env.sandbox.url, signingSecret: env.sandbox.signingSecret }) : undefined;

  // As migrations rodam antes de a porta abrir: subir atendendo requisições
  // contra um schema desatualizado daria erro por requisição, muito mais difícil
  // de diagnosticar do que uma falha clara no boot.
  const database = env.databaseUrl ? createDatabase(env.databaseUrl) : undefined;
  let scanJobs = NO_SCAN_JOB_PERSISTENCE;
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
    // Jobs deixados em `running` pertencem a uma instância que não existe mais:
    // ninguém vai concluí-los, então ficariam "em execução" para sempre.
    const orphans = await scanJobs.recoverOrphans();
    if (orphans.length > 0) console.log(`Análises órfãs de uma instância anterior encerradas: ${orphans.length}.`);
  } else {
    console.log("Sem QA_RADAR_DATABASE_URL: estado em memória, perdido a cada reinício.");
  }

  const server = createQaRadarServer({ ...env.serverOptions, hostedCodeRunner, scanJobs });
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
