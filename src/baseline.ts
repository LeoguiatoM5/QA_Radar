import { readFile } from "node:fs/promises";
import type { Issue, ScanComparison } from "./types.js";
import { summarizeIssues } from "./quality.js";

export interface BaselineReport {
  schemaVersion: string;
  startedAt: string;
  issues: Issue[];
}

function isIssue(value: unknown): value is Issue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Issue>;
  return typeof candidate.ruleId === "string" &&
    typeof candidate.fingerprint === "string" &&
    (candidate.severity === "warning" || candidate.severity === "error");
}

export async function loadBaseline(path: string): Promise<BaselineReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível carregar o baseline "${path}": ${detail}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("O baseline não contém um relatório válido.");
  const report = parsed as Partial<BaselineReport>;
  if (report.schemaVersion !== "1.0" || typeof report.startedAt !== "string" ||
      !Array.isArray(report.issues) || !report.issues.every(isIssue)) {
    throw new Error("O baseline é incompatível. Gere-o com um QA Radar que suporte o schema 1.0.");
  }
  return report as BaselineReport;
}

function withoutBaselineStatus(issue: Issue): Issue {
  const copy = { ...issue };
  delete copy.baselineStatus;
  return copy;
}

export function compareWithBaseline(currentIssues: Issue[], baseline: BaselineReport): ScanComparison {
  const currentFingerprints = new Set(currentIssues.map((issue) => issue.fingerprint));
  const baselineFingerprints = new Set(baseline.issues.map((issue) => issue.fingerprint));
  for (const issue of currentIssues) {
    issue.baselineStatus = baselineFingerprints.has(issue.fingerprint) ? "existing" : "new";
  }
  const newIssues = currentIssues.filter((issue) => !baselineFingerprints.has(issue.fingerprint));
  const existingIssues = currentIssues.length - newIssues.length;
  const resolvedIssues = baseline.issues
    .filter((issue) => !currentFingerprints.has(issue.fingerprint))
    .map(withoutBaselineStatus);

  return {
    baselineStartedAt: baseline.startedAt,
    newIssues: newIssues.length,
    existingIssues,
    resolvedIssues,
    newSummary: summarizeIssues(newIssues),
  };
}

export function emptyBaseline(): BaselineReport {
  return { schemaVersion: "1.0", startedAt: "", issues: [] };
}
