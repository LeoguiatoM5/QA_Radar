import type { FailOn, Issue, ScanSummary } from "./types.js";

export function summarizeIssues(issues: Issue[]): ScanSummary {
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const errors = issues.filter((issue) => issue.severity === "error").length;

  return { warnings, errors, total: warnings + errors };
}

export function passesQualityGate(summary: ScanSummary, failOn: FailOn): boolean {
  if (failOn === "none") return true;
  if (failOn === "warning") return summary.total === 0;
  return summary.errors === 0;
}

export function deduplicateIssues(issues: Issue[]): Issue[] {
  const unique = new Map<string, Issue>();

  for (const issue of issues) {
    const key = [
      issue.category,
      issue.severity,
      issue.message,
      issue.method,
      issue.status,
      issue.url,
      issue.resourceType,
      issue.source,
      issue.evidence?.selector,
    ].join("\u0000");
    const existing = unique.get(key);

    if (existing) {
      existing.occurrences += issue.occurrences;
    } else {
      unique.set(key, { ...issue });
    }
  }

  return [...unique.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.category.localeCompare(b.category);
  });
}
