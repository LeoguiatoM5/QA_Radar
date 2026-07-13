#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";

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
  const server = createQaRadarServer();
  server.listen(port, host, () => {
    console.log(`\nQA Radar Web disponível em http://${host}:${port}`);
    console.log("Pressione Ctrl+C para encerrar.\n");
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
