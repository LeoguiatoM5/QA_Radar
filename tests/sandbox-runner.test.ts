import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { sandboxRequestSignature } from "../src/sandbox-client.js";
import {
  createSandboxRunnerServer,
  type RunnerLimits,
} from "../src/sandbox-runner.js";
import type { DockerSandboxConfig, SandboxExecutionRequest } from "../src/sandbox-runtime.js";

const SECRET = "runner-test-secret-com-pelo-menos-32-bytes";
const LIMITS: RunnerLimits = {
  maxCodeBytes: 256 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxMemoryMiB: 512,
  maxTimeoutMs: 300_000,
};
const DOCKER: DockerSandboxConfig = {
  image: "qa-radar-sandbox-job:test",
  cpuLimit: 0.5,
  pidsLimit: 64,
  maxMemoryMiB: 512,
  maxTimeoutMs: 300_000,
};

const servers: ReturnType<typeof createSandboxRunnerServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function start(
  runSandbox: (
    request: SandboxExecutionRequest,
    config: DockerSandboxConfig,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): Promise<string> {
  const server = createSandboxRunnerServer(SECRET, LIMITS, DOCKER, 1, runSandbox);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function signedRequest(body: string, requestId: string): RequestInit {
  const timestamp = new Date().toISOString();
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qa-radar-protocol": "1.0",
      "x-qa-radar-request-id": requestId,
      "x-qa-radar-timestamp": timestamp,
      "x-qa-radar-signature": sandboxRequestSignature(SECRET, {
        timestamp,
        requestId,
        body,
      }),
    },
    body,
  };
}

describe("servidor do runner sandbox", () => {
  it("autentica, valida e correlaciona a execução", async () => {
    let received: SandboxExecutionRequest | undefined;
    const baseUrl = await start(async (request) => {
      received = request;
      return { exitCode: 0, stdout: "relatório", stderr: "" };
    });
    const body = JSON.stringify({
      schemaVersion: "1.0",
      executionId: "22222222-2222-4222-8222-222222222222",
      code: "import { test } from '@playwright/test'; test('ok', () => {});",
      headed: false,
      limits: {
        timeoutMs: 30_000,
        maxOutputBytes: 4_096,
        maxMemoryMiB: 256,
      },
    });

    const response = await fetch(`${baseUrl}/v1/executions`, signedRequest(
      body,
      "33333333-3333-4333-8333-333333333333",
    ));
    const result = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(result.executionId, received?.executionId);
    assert.equal(result.stdout, "relatório");
  });

  it("recusa replay e código fora da política antes de criar container", async () => {
    let executions = 0;
    const baseUrl = await start(async () => {
      executions += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const body = JSON.stringify({
      schemaVersion: "1.0",
      executionId: "44444444-4444-4444-8444-444444444444",
      code: "import fs from 'node:fs';",
      headed: false,
      limits: {
        timeoutMs: 30_000,
        maxOutputBytes: 4_096,
        maxMemoryMiB: 256,
      },
    });
    const init = signedRequest(body, "55555555-5555-4555-8555-555555555555");

    const policyResponse = await fetch(`${baseUrl}/v1/executions`, init);
    const replayResponse = await fetch(`${baseUrl}/v1/executions`, init);

    assert.equal(policyResponse.status, 400);
    assert.equal(replayResponse.status, 401);
    assert.equal(executions, 0);
  });
});
