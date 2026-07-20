import { access, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanOptions, ScanReport } from "./types.js";

export interface StoredRun {
  runPath: string;
  baselinePath: string | undefined;
  promoted: boolean;
}

export interface HistoryEntry {
  startedAt: string;
  passed: boolean;
  scanStatus: ScanReport["scanStatus"];
  durationMs: number;
  browser: ScanReport["browser"];
  summary: ScanReport["summary"];
  pages: number;
  newIssues: number | undefined;
}

export interface ProjectHistory {
  project: string;
  environment: string;
  baselineStartedAt: string | undefined;
  runs: HistoryEntry[];
}

function validIdentifier(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}

function projectDir(options: ScanOptions): string | undefined {
  if (!options.project || !options.historyDir) return undefined;
  return join(options.historyDir, options.project, options.environment ?? "default");
}

export function historyBaselinePath(options: ScanOptions): string | undefined {
  const directory = projectDir(options);
  return directory ? join(directory, "baseline.json") : undefined;
}

export async function findHistoryBaseline(options: ScanOptions): Promise<string | undefined> {
  const path = historyBaselinePath(options);
  if (!path) return undefined;
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function storeRun(report: ScanReport, options: ScanOptions): Promise<StoredRun | undefined> {
  const directory = projectDir(options);
  if (!directory) return undefined;
  const runsDir = join(directory, "runs");
  await mkdir(runsDir, { recursive: true });
  const runName = `${report.startedAt.replaceAll(":", "-")}-${report.browser}.json`;
  const runPath = join(runsDir, runName);
  await writeJsonAtomic(runPath, report);

  const baselinePath = join(directory, "baseline.json");
  const promoted = report.scanStatus === "completed" && (report.passed || options.acceptBaseline === true);
  if (promoted) await copyFile(runPath, baselinePath);

  return { runPath, baselinePath: promoted ? baselinePath : undefined, promoted };
}

async function reportFromFile(path: string): Promise<ScanReport | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ScanReport;
  } catch {
    return undefined;
  }
}

export async function listProjectHistory(
  historyDir: string,
  project: string,
  environment: string,
  limit = 20,
): Promise<ProjectHistory> {
  if (!validIdentifier(project) || !validIdentifier(environment)) {
    throw new Error("Projeto ou ambiente inválido para consulta de histórico.");
  }
  const directory = join(historyDir, project.toLowerCase(), environment.toLowerCase());
  let names: string[] = [];
  try {
    names = await readdir(join(directory, "runs"));
  } catch {
    names = [];
  }
  const candidates = names.filter((name) => name.endsWith(".json")).sort().reverse().slice(0, limit);
  const reports = (await Promise.all(candidates.map((name) => reportFromFile(join(directory, "runs", name)))))
    .filter((report): report is ScanReport => Boolean(report))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const baseline = await reportFromFile(join(directory, "baseline.json"));
  return {
    project: project.toLowerCase(),
    environment: environment.toLowerCase(),
    baselineStartedAt: baseline?.startedAt,
    runs: reports.map((report) => ({
      startedAt: report.startedAt,
      passed: report.passed,
      scanStatus: report.scanStatus,
      durationMs: report.durationMs,
      browser: report.browser,
      summary: report.summary,
      pages: report.pages?.length ?? 1,
      newIssues: report.comparison?.newIssues,
    })),
  };
}
