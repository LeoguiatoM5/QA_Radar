import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPlaywrightCode } from "./code-execution.js";
import { CODE_WORKER_RESULT_FILE } from "./code-worker-client.js";

function positiveInteger(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} deve ser um número inteiro positivo.`);
  }
  return value;
}

async function main(): Promise<void> {
  const [outputDir, headedRaw, timeoutRaw, maxOutputRaw, maxMemoryRaw, projectRoot] = process.argv.slice(2);
  if (!outputDir || !projectRoot || !["true", "false"].includes(headedRaw ?? "")) {
    throw new Error("Parâmetros inválidos para o worker Playwright.");
  }

  const result = await runPlaywrightCode({
    outputDir,
    headed: headedRaw === "true",
    timeoutMs: positiveInteger(timeoutRaw, "timeoutMs"),
    maxOutputBytes: positiveInteger(maxOutputRaw, "maxOutputBytes"),
    maxMemoryMiB: positiveInteger(maxMemoryRaw, "maxMemoryMiB"),
    projectRoot,
  });
  await writeFile(join(outputDir, CODE_WORKER_RESULT_FILE), JSON.stringify(result), { encoding: "utf8", mode: 0o600 });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
