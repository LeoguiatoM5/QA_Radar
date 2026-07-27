import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  codeExecutionArguments,
  codeExecutionEnvironment,
  runPlaywrightCode,
  terminateProcessTree,
  type SpawnProcess,
} from "../src/code-execution.js";
import {
  CODE_WORKER_RESULT_FILE,
  codeWorkerArguments,
  runPlaywrightCodeWorker,
} from "../src/code-worker-client.js";

interface FakeChild {
  child: ChildProcess;
  stdout: PassThrough;
  stderr: PassThrough;
  events: EventEmitter;
  killed: string[];
}

function createFakeChild(pid = 1234): FakeChild {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const killed: string[] = [];
  Object.assign(events, {
    pid,
    stdout,
    stderr,
    kill: (signal?: string) => {
      killed.push(signal ?? "SIGTERM");
      return true;
    },
  });
  return { child: events as unknown as ChildProcess, stdout, stderr, events, killed };
}

describe("executor de código Playwright", () => {
  it("repassa somente variáveis de ambiente permitidas", () => {
    assert.deepEqual(codeExecutionEnvironment({
      PATH: "bin",
      TEMP: "temp",
      PLAYWRIGHT_BROWSERS_PATH: "browsers",
      DATABASE_URL: "postgres://secret",
      API_TOKEN: "secret",
      QA_RADAR_CODE_MODE_ADMIN_TOKEN: "admin-secret",
    }), {
      CI: "1",
      PATH: "bin",
      TEMP: "temp",
      PLAYWRIGHT_BROWSERS_PATH: "browsers",
    });
  });

  it("inclui limite de memória e diretório de evidências nos argumentos", () => {
    const args = codeExecutionArguments(
      "C:\\app",
      "C:\\result",
      true,
      384,
      "C:\\app\\node_modules\\tsx\\dist\\loader.mjs",
    );
    assert.equal(args[0], "--max-old-space-size=384");
    assert.ok(args.includes("--headed"));
    assert.ok(args.some((argument) => argument.includes("test-results")));
  });

  it("coleta stdout e stderr até o encerramento do processo", async () => {
    const fake = createFakeChild();
    const spawnProcess: SpawnProcess = () => {
      queueMicrotask(() => {
        fake.stdout.write('{"stats":{"expected":1}}');
        fake.stderr.write("aviso");
        fake.events.emit("close", 0);
      });
      return fake.child;
    };

    const result = await runPlaywrightCode({
      outputDir: "resultado",
      headed: false,
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      maxMemoryMiB: 256,
      spawnProcess,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"stats":{"expected":1}}');
    assert.equal(result.stderr, "aviso");
  });

  it("encerra a árvore quando a saída acumulada excede o limite", async () => {
    const fake = createFakeChild();
    let terminated = false;
    const spawnProcess: SpawnProcess = () => {
      queueMicrotask(() => fake.stdout.write("saída grande demais"));
      return fake.child;
    };

    await assert.rejects(
      runPlaywrightCode({
        outputDir: "resultado",
        headed: false,
        timeoutMs: 1_000,
        maxOutputBytes: 5,
        maxMemoryMiB: 256,
        spawnProcess,
        terminate: async () => { terminated = true; },
      }),
      /saída da execução excedeu o limite de 5 bytes/,
    );
    assert.equal(terminated, true);
  });

  it("encerra a árvore quando a execução excede o tempo máximo", async () => {
    const fake = createFakeChild();
    let terminated = false;

    await assert.rejects(
      runPlaywrightCode({
        outputDir: "resultado",
        headed: false,
        timeoutMs: 20,
        maxOutputBytes: 1_024,
        maxMemoryMiB: 256,
        spawnProcess: () => fake.child,
        terminate: async () => { terminated = true; },
      }),
      /execução excedeu o limite de 20 ms/,
    );
    assert.equal(terminated, true);
  });

  it("usa taskkill para encerrar toda a árvore no Windows", async () => {
    const fake = createFakeChild(9876);
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const spawnProcess: SpawnProcess = (command, args, options) => {
      calls.push({ command, args, options });
      const killer = createFakeChild(9999);
      queueMicrotask(() => killer.events.emit("exit", 0));
      return killer.child;
    };

    await terminateProcessTree(fake.child, "win32", spawnProcess);

    assert.equal(calls[0]?.command, "taskkill");
    assert.deepEqual(calls[0]?.args, ["/PID", "9876", "/T", "/F"]);
  });

  it("inicia um módulo worker separado com limites explícitos", () => {
    // Constrói o moduleUrl e o loader a partir de caminhos nativos do SO atual,
    // em vez de literais fixos de um único SO, para o teste valer tanto no
    // Windows quanto no Linux/CI.
    const moduleUrl = pathToFileURL(join(process.cwd(), "qa-radar", "src", "code-worker-client.ts")).href;
    const loaderPath = join(process.cwd(), "qa-radar", "node_modules", "tsx", "dist", "loader.mjs");
    const args = codeWorkerArguments({
      outputDir: "resultado",
      headed: false,
      timeoutMs: 30_000,
      maxOutputBytes: 4_096,
      maxMemoryMiB: 256,
      projectRoot: "projeto",
    }, moduleUrl, loaderPath);

    assert.deepEqual(args.slice(0, 4), [
      "--max-old-space-size=128",
      "--import",
      pathToFileURL(loaderPath).href,
      fileURLToPath(new URL("./code-worker.ts", moduleUrl)),
    ]);
    assert.deepEqual(args.slice(-6), [
      "resultado",
      "false",
      "30000",
      "4096",
      "256",
      "projeto",
    ]);
  });

  it("recebe o resultado do Playwright pelo arquivo privado do worker", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-worker-"));
    const expected = { exitCode: 0, stdout: '{"ok":true}', stderr: "" };
    await writeFile(join(outputDir, CODE_WORKER_RESULT_FILE), JSON.stringify(expected));
    const fake = createFakeChild();

    try {
      const result = await runPlaywrightCodeWorker({
        outputDir,
        headed: false,
        timeoutMs: 1_000,
        maxOutputBytes: 4_096,
        maxMemoryMiB: 256,
        spawnProcess: () => {
          queueMicrotask(() => fake.events.emit("close", 0));
          return fake.child;
        },
      });
      assert.deepEqual(result, expected);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
