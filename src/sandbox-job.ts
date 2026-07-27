import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPlaywrightCode, type CodeExecutionResult } from "./code-execution.js";
import { assertHostedPlaywrightCode } from "./code-policy.js";
import {
  closeSandboxEgressRelay,
  startSandboxEgressRelay,
} from "./sandbox-egress-relay.js";

const WORK_DIR = "/work";
const INPUT_LIMIT_BYTES = 512 * 1024;

interface JobInput {
  code: string;
  limits: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxMemoryMiB: number;
  };
}

async function readInput(): Promise<JobInput> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > INPUT_LIMIT_BYTES) throw new Error("Entrada do job acima do limite.");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<JobInput>;
  if (
    typeof value.code !== "string"
    || !value.limits
    || !Number.isInteger(value.limits.timeoutMs)
    || !Number.isInteger(value.limits.maxOutputBytes)
    || !Number.isInteger(value.limits.maxMemoryMiB)
  ) {
    throw new Error("Entrada do job inválida.");
  }
  return value as JobInput;
}

async function main(): Promise<void> {
  const input = await readInput();
  assertHostedPlaywrightCode(input.code);
  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(join(WORK_DIR, "qa-radar.spec.ts"), input.code, {
    encoding: "utf8",
    mode: 0o600,
  });
  const egressEnabled = process.env.QA_RADAR_EGRESS_PROXY === "1";
  const relay = egressEnabled ? await startSandboxEgressRelay() : undefined;
  try {
    if (egressEnabled) {
      await writeFile(join(WORK_DIR, "playwright.config.ts"), `
        import { defineConfig } from "playwright/test";
        export default defineConfig({
          workers: 1,
          use: { proxy: { server: "http://127.0.0.1:3128" } },
        });
      `, { encoding: "utf8", mode: 0o600 });
    }
    const result = await runPlaywrightCode({
      outputDir: WORK_DIR,
      headed: false,
      timeoutMs: input.limits.timeoutMs,
      maxOutputBytes: input.limits.maxOutputBytes,
      maxMemoryMiB: input.limits.maxMemoryMiB,
      projectRoot: "/app",
    });
    process.stdout.write(JSON.stringify(result));
  } finally {
    if (relay) await closeSandboxEgressRelay(relay);
  }
}

main().catch((error: unknown) => {
  const result: CodeExecutionResult = {
    exitCode: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  };
  process.stdout.write(JSON.stringify(result));
});
