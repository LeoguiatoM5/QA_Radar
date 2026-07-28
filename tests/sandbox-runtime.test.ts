import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, it } from "node:test";
import type { SpawnProcess } from "../src/code-execution.js";
import { dockerEgressProxyArguments, dockerSandboxArguments, runDockerSandbox, type DockerSandboxConfig, type SandboxExecutionRequest } from "../src/sandbox-runtime.js";

const REQUEST: SandboxExecutionRequest = {
  executionId: "11111111-1111-4111-8111-111111111111",
  code: "import { test } from '@playwright/test'; test('ok', () => {});",
  limits: {
    timeoutMs: 30_000,
    maxOutputBytes: 4_096,
    maxMemoryMiB: 256,
  },
};

const CONFIG: DockerSandboxConfig = {
  image: "qa-radar-sandbox-job:test",
  cpuLimit: 0.5,
  pidsLimit: 64,
  maxMemoryMiB: 512,
  maxTimeoutMs: 300_000,
};

interface FakeChild extends ChildProcess {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (() => true) as ChildProcess["kill"];
  return child;
}

describe("runtime Docker do sandbox", () => {
  it("fixa isolamento, recursos e ausência de rede ou mounts do host", () => {
    const args = dockerSandboxArguments(REQUEST, CONFIG);
    assert.deepEqual(args.slice(0, 4), ["run", "--rm", "--interactive", "--name"]);
    assert.ok(args.includes("none"));
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("ALL"));
    assert.ok(args.includes("no-new-privileges:true"));
    assert.ok(args.includes("seccomp=builtin"));
    assert.ok(args.includes("64"));
    assert.ok(args.includes("0.5"));
    assert.equal(args.filter((argument) => argument === "256m").length, 2);
    assert.equal(
      args.some((argument) => argument === "--volume" || argument === "-v"),
      false,
    );
    assert.equal(args.at(-1), CONFIG.image);
  });

  it("mantém o job sem rede direta e compartilha apenas o socket efêmero de egress", () => {
    const config: DockerSandboxConfig = {
      ...CONFIG,
      networkPolicy: "public-egress",
      egressMaxBytes: 8_388_608,
      egressMaxConnections: 16,
    };
    const jobArgs = dockerSandboxArguments(REQUEST, config);
    const proxyArgs = dockerEgressProxyArguments(REQUEST, config);
    const jobNetwork = jobArgs.indexOf("--network");
    const proxyNetwork = proxyArgs.indexOf("--network");

    assert.equal(jobArgs[jobNetwork + 1], "none");
    assert.equal(proxyArgs[proxyNetwork + 1], "bridge");
    assert.ok(jobArgs.includes("QA_RADAR_EGRESS_PROXY=1"));
    assert.ok(jobArgs.some((argument) => argument.includes("dst=/run/egress,readonly")));
    assert.ok(proxyArgs.some((argument) => argument.includes("dst=/run/egress") && !argument.includes("readonly")));
    assert.ok(proxyArgs.includes("QA_RADAR_EGRESS_MAX_BYTES=8388608"));
    assert.ok(proxyArgs.includes("QA_RADAR_EGRESS_MAX_CONNECTIONS=16"));
    assert.equal(
      jobArgs.some((argument) => argument.includes("host.docker.internal")),
      false,
    );
  });

  it("envia o código por stdin, valida o resultado e remove o container", async () => {
    const calls: Array<{ args: readonly string[]; options: SpawnOptions }> = [];
    let input = "";
    const spawnProcess: SpawnProcess = (_command, args, options) => {
      calls.push({ args, options });
      const child = fakeChild();
      if (args[0] === "run") {
        child.stdin.on("data", (chunk) => {
          input += chunk.toString();
        });
        child.stdin.on("finish", () => {
          child.stdout.end(JSON.stringify({ exitCode: 0, stdout: "ok", stderr: "" }));
          process.nextTick(() => child.emit("close", 0));
        });
      } else {
        process.nextTick(() => child.emit("close", 0));
      }
      return child;
    };

    const result = await runDockerSandbox(REQUEST, { ...CONFIG, spawnProcess });

    assert.deepEqual(result, { exitCode: 0, stdout: "ok", stderr: "" });
    assert.equal(JSON.parse(input).code, REQUEST.code);
    assert.equal(calls[0]?.args[0], "run");
    assert.deepEqual(calls[1]?.args.slice(0, 2), ["rm", "--force"]);
  });

  it("rejeita recursos acima do teto antes de iniciar o Docker", async () => {
    await assert.rejects(
      runDockerSandbox(
        {
          ...REQUEST,
          limits: { ...REQUEST.limits, maxMemoryMiB: 1024 },
        },
        CONFIG,
      ),
      /memória solicitada excede/,
    );
  });
});
