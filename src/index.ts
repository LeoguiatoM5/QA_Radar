#!/usr/bin/env node
import { parseCli, HELP } from "./cli.js";
import { createGitHubAnnotations, printConsoleReport, writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import { VERSION } from "./version.js";
import { findHistoryBaseline, storeRun } from "./history.js";
import { scanSitemap } from "./suite.js";

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
    const automaticBaseline = options.baselinePath ? undefined : await findHistoryBaseline(options);
    const effectiveOptions = automaticBaseline ? { ...options, baselinePath: automaticBaseline } : options;
    console.log(`Analisando ${options.url}...`);
    if (automaticBaseline) console.log(`Baseline:   ${automaticBaseline}`);
    const report = effectiveOptions.sitemap ? await scanSitemap(effectiveOptions) : await scan(effectiveOptions);
    printConsoleReport(report);
    if (options.githubAnnotations) {
      for (const annotation of createGitHubAnnotations(report)) console.log(annotation);
    }
    const paths = await writeReports(report, options);
    for (const path of paths) console.log(`Relatório:  ${path}`);
    const stored = await storeRun(report, effectiveOptions);
    if (stored) {
      console.log(`Histórico:  ${stored.runPath}`);
      if (stored.promoted) console.log(`Baseline:   ${stored.baselinePath}`);
      else console.log("Baseline:   mantido (a execução foi reprovada)");
    }
    return report.passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nERRO: ${message}`);
    return 2;
  }
}

process.exitCode = await run(process.argv.slice(2));
