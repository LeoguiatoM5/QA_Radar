import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createSandboxCodeRunner } from "../src/sandbox-client.js";
import { createSandboxRunnerServer } from "../src/sandbox-runner.js";
import { dockerSandboxArguments, runDockerSandbox, type DockerSandboxConfig, type SandboxExecutionRequest } from "../src/sandbox-runtime.js";

const IMAGE = process.env.QA_RADAR_SANDBOX_JOB_IMAGE ?? "qa-radar-sandbox-job:3.2.0";
const CONFIG: DockerSandboxConfig = {
  image: IMAGE,
  cpuLimit: 0.5,
  pidsLimit: 256,
  maxMemoryMiB: 512,
  maxTimeoutMs: 60_000,
  networkPolicy: "public-egress",
  egressMaxBytes: 16 * 1024 * 1024,
  egressMaxConnections: 16,
};
const ISOLATED_CONFIG: DockerSandboxConfig = { ...CONFIG, networkPolicy: "none" };

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function docker(args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    child.stdin.end();
  });
}

async function homologatePlaywrightJob(): Promise<void> {
  const secret = "sandbox-homologation-secret-with-32-bytes";
  const server = createSandboxRunnerServer(
    secret,
    {
      maxCodeBytes: 256 * 1024,
      maxOutputBytes: 1024 * 1024,
      maxMemoryMiB: 512,
      maxTimeoutMs: 60_000,
    },
    CONFIG,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const runner = createSandboxCodeRunner({
    baseUrl: `http://127.0.0.1:${address.port}`,
    signingSecret: secret,
    allowInsecureHttp: true,
  });
  try {
    const result = await runner({
      outputDir: "não-enviado",
      headed: false,
      code: `
      import { test, expect } from "playwright/test";
      test("egress público controlado", async ({ page }) => {
        const httpResponse = await page.goto("http://example.com", { waitUntil: "domcontentloaded" });
        expect(httpResponse?.status()).toBeLessThan(400);
        await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toHaveText("Example Domain");
        for (const url of [
          "http://169.254.169.254/latest/meta-data/",
          "http://host.docker.internal:4173/",
          "http://10.0.0.1/",
          "https://example.com:444/",
        ]) {
          let blocked = false;
          try {
            const response = await page.goto(url, { timeout: 1_000 });
            blocked = response?.status() === 403;
          } catch {
            blocked = true;
          }
          expect(blocked).toBe(true);
        }
      });
    `,
      timeoutMs: 60_000,
      maxOutputBytes: 1024 * 1024,
      maxMemoryMiB: 512,
    });
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout) as {
      stats?: { expected?: number; unexpected?: number };
    };
    assert.equal(report.stats?.expected, 1);
    assert.equal(report.stats?.unexpected, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function homologateTimeoutCleanup(): Promise<void> {
  const executionId = "66666666-6666-4666-8666-777777777777";
  await assert.rejects(
    runDockerSandbox(
      {
        executionId,
        code: `
        import { test } from "playwright/test";
        test("cpu abusiva", () => { while (true) {} });
      `,
        limits: {
          timeoutMs: 15_000,
          maxOutputBytes: 64 * 1024,
          maxMemoryMiB: 512,
        },
      },
      CONFIG,
    ),
    /excedeu o limite de 15000 ms/,
  );
  const inspect = await docker(["inspect", `qa-radar-job-${executionId}`]);
  const proxyInspect = await docker(["inspect", `qa-radar-egress-${executionId}`]);
  const volumeInspect = await docker(["volume", "inspect", `qa-radar-egress-${executionId}`]);
  assert.notEqual(inspect.code, 0, "O container em timeout deveria ter sido destruído.");
  assert.notEqual(proxyInspect.code, 0, "O proxy em timeout deveria ter sido destruído.");
  assert.notEqual(volumeInspect.code, 0, "O volume em timeout deveria ter sido destruído.");
}

async function homologateKernelControls(): Promise<Record<string, unknown>> {
  const request: SandboxExecutionRequest = {
    executionId: "77777777-7777-4777-8777-777777777777",
    code: "",
    limits: {
      timeoutMs: 15_000,
      maxOutputBytes: 64 * 1024,
      maxMemoryMiB: 256,
    },
  };
  const args = dockerSandboxArguments(request, ISOLATED_CONFIG);
  args.splice(args.length - 1, 0, "--entrypoint", "node");
  args.push(
    "-e",
    `
      const fs = require("node:fs");
      const read = path => fs.readFileSync(path, "utf8").trim();
      let rootReadOnly = false;
      try { fs.writeFileSync("/escape", "blocked"); } catch { rootReadOnly = true; }
      fs.writeFileSync("/work/allowed", "temporary");
      const status = read("/proc/self/status");
      const result = {
        uid: process.getuid(),
        gid: process.getgid(),
        rootReadOnly,
        temporaryWrite: read("/work/allowed") === "temporary",
        interfaces: fs.readdirSync("/sys/class/net").sort(),
        memoryMax: read("/sys/fs/cgroup/memory.max"),
        pidsMax: read("/sys/fs/cgroup/pids.max"),
        cpuMax: read("/sys/fs/cgroup/cpu.max"),
        noNewPrivileges: /^NoNewPrivs:\\s+1$/m.test(status),
        capabilities: /^CapEff:\\s+0+$/m.test(status),
      };
      process.stdout.write(JSON.stringify(result));
    `,
  );
  const result = await docker(args);
  assert.equal(result.code, 0, result.stderr);
  const evidence = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(evidence.uid, 10001);
  assert.equal(evidence.gid, 10001);
  assert.equal(evidence.rootReadOnly, true);
  assert.equal(evidence.temporaryWrite, true);
  assert.deepEqual(evidence.interfaces, ["lo"]);
  assert.equal(evidence.memoryMax, String(256 * 1024 * 1024));
  assert.equal(evidence.pidsMax, "256");
  assert.match(String(evidence.cpuMax), /^50000 100000$/);
  assert.equal(evidence.noNewPrivileges, true);
  assert.equal(evidence.capabilities, true);

  const inspect = await docker(["inspect", "qa-radar-job-77777777-7777-4777-8777-777777777777"]);
  assert.notEqual(inspect.code, 0, "O container deveria ter sido destruído após o probe.");
  return evidence;
}

await homologatePlaywrightJob();
await homologateTimeoutCleanup();
const evidence = await homologateKernelControls();
console.log(
  JSON.stringify(
    {
      status: "approved",
      image: IMAGE,
      jobNetwork: "none",
      egressPolicy: "public-egress",
      ...evidence,
    },
    null,
    2,
  ),
);
