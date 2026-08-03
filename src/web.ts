#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";
import { loadEnvironmentConfig } from "./env.js";
import { createSandboxCodeRunner } from "./sandbox-client.js";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";

try {
  const env = loadEnvironmentConfig();
  const hostedCodeRunner = env.sandbox ? createSandboxCodeRunner({ baseUrl: env.sandbox.url, signingSecret: env.sandbox.signingSecret }) : undefined;

  // As migrations rodam antes de a porta abrir: subir atendendo requisições
  // contra um schema desatualizado daria erro por requisição, muito mais difícil
  // de diagnosticar do que uma falha clara no boot.
  const database = env.databaseUrl ? createDatabase(env.databaseUrl) : undefined;
  if (database) {
    const result = await runMigrations(database);
    console.log(`Banco conectado. Migrations aplicadas agora: ${result.applied.length > 0 ? result.applied.join(", ") : "nenhuma"}.`);
  } else {
    console.log("Sem QA_RADAR_DATABASE_URL: estado em memória, perdido a cada reinício.");
  }

  const server = createQaRadarServer({ ...env.serverOptions, hostedCodeRunner });
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
