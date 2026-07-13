#!/usr/bin/env node
import { parseCli, HELP } from "./cli.js";
import { printConsoleReport, writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import { VERSION } from "./version.js";

export async function run(args: string[]): Promise<number> {
  try {
    const parsed = parseCli(args);
    if (parsed.action === "help") {
      console.log(HELP);
      return 0;
    }
    if (parsed.action === "version") {
      console.log(VERSION);
      return 0;
    }

    const options = parsed.options;
    if (!options) throw new Error("Configuração da análise ausente.");
    console.log(`Analisando ${options.url}...`);
    const report = await scan(options);
    printConsoleReport(report);
    const paths = await writeReports(report, options);
    for (const path of paths) console.log(`Relatório:  ${path}`);
    return report.passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nERRO: ${message}`);
    return 2;
  }
}

process.exitCode = await run(process.argv.slice(2));
