import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runPlaywrightCodeWorker } from "../src/code-worker-client.js";

describe("worker Playwright integration", () => {
  it("executa o teste fora do processo HTTP e devolve o relatório", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qa-radar-worker-integration-"));
    await writeFile(
      join(outputDir, "qa-radar.spec.ts"),
      ["import { test, expect } from 'playwright/test';", "test('worker isolado', async () => {", "  expect(2 + 2).toBe(4);", "});"].join("\n"),
      "utf8",
    );

    try {
      const result = await runPlaywrightCodeWorker({
        outputDir,
        headed: false,
        timeoutMs: 30_000,
        maxOutputBytes: 1024 * 1024,
        maxMemoryMiB: 256,
        projectRoot: process.cwd(),
      });
      assert.ok(result.stdout, JSON.stringify(result));
      const report = JSON.parse(result.stdout) as { stats?: { expected?: number } };
      assert.equal(result.exitCode, 0, result.stderr || result.stdout);
      assert.equal(report.stats?.expected, 1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
