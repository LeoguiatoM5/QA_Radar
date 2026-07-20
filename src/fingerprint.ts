import { createHash } from "node:crypto";
import type { Issue, IssueInput } from "./types.js";

function normalizeUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.username = "";
    url.password = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function normalizeMessage(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b\d{4}-\d{2}-\d{2}t\S+\b/gi, "<timestamp>")
    .replace(/\b\d+\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
}

export function identifyIssue(issue: IssueInput): Issue {
  const identity = [
    issue.ruleId,
    issue.method ?? "",
    issue.status ?? "",
    issue.resourceType ?? "",
    normalizeUrl(issue.url),
    issue.evidence?.selector ?? "",
    normalizeMessage(issue.message),
  ].join("\u0000");

  return {
    ...issue,
    fingerprint: createHash("sha256").update(identity).digest("hex"),
  };
}
