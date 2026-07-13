export type BrowserName = "chromium" | "firefox" | "webkit";
export type IssueCategory =
  | "console"
  | "javascript"
  | "http"
  | "network"
  | "navigation"
  | "element"
  | "accessibility";
export type Severity = "warning" | "error";
export type FailOn = "none" | Severity;
export type ReportFormat = "console" | "json" | "html" | "all";
export type ScreenshotMode = "never" | "on-failure" | "always";

export interface ScanOptions {
  url: string;
  browser: BrowserName;
  headed: boolean;
  timeoutMs: number;
  settleMs: number;
  outputDir: string;
  format: ReportFormat;
  screenshot: ScreenshotMode;
  failOn: FailOn;
  ignoredStatuses: Set<number>;
  ignoredUrlPatterns: RegExp[];
}

export interface Issue {
  category: IssueCategory;
  severity: Severity;
  title?: string;
  impact?: string;
  recommendation?: string;
  message: string;
  method: string | undefined;
  status: number | undefined;
  url: string | undefined;
  resourceType: string | undefined;
  source: string | undefined;
  occurrences: number;
  evidence?: IssueEvidence;
}

export interface IssueEvidence {
  selector: string;
  element: string;
  label: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | undefined;
}

export interface ScanSummary {
  warnings: number;
  errors: number;
  total: number;
}

export interface ScanReport {
  tool: "QA Radar";
  version: string;
  startedAt: string;
  durationMs: number;
  targetUrl: string;
  finalUrl: string;
  title: string;
  mainStatus: number | undefined;
  browser: BrowserName;
  passed: boolean;
  failOn: FailOn;
  summary: ScanSummary;
  issues: Issue[];
  screenshotPath: string | undefined;
}
