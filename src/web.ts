#!/usr/bin/env node
import { createQaRadarServer } from "./server.js";
import { loadEnvironmentConfig } from "./env.js";
import { createSandboxCodeRunner } from "./sandbox-client.js";

try {
  const env = loadEnvironmentConfig();
  const hostedCodeRunner = env.sandbox ? createSandboxCodeRunner({ baseUrl: env.sandbox.url, signingSecret: env.sandbox.signingSecret }) : undefined;
  const server = createQaRadarServer({ ...env.serverOptions, hostedCodeRunner });
  server.listen(env.port, env.host, () => {
    console.log(`\nQA Radar Web disponível em http://${env.host}:${env.port}`);
    console.log("Pressione Ctrl+C para encerrar.\n");
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
