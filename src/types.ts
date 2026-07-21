export type BrowserName = "chromium" | "firefox" | "webkit";
export type IssueCategory =
  | "console"
  | "javascript"
  | "http"
  | "network"
  | "navigation"
  | "performance"
  | "element"
  | "accessibility";
export type Severity = "warning" | "error";
export type FailOn = "none" | Severity;
export type ReportFormat = "console" | "json" | "html" | "junit" | "sarif" | "all";
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
  baselinePath?: string;
  regressionsOnly?: boolean;
  project?: string;
  environment?: string;
  historyDir?: string;
  acceptBaseline?: boolean;
  githubAnnotations?: boolean;
  sitemap?: boolean;
  maxPages?: number;
  publicNetworkOnly?: boolean;
}

export interface ScanProgress {
  discoveredPages: number;
  completedPages: number;
  currentUrl: string | undefined;
  percent: number;
  stage?: ScanStage;
}

export type ScanStage =
  | "queued"
  | "discovering-sitemap"
  | "launching-browser"
  | "navigating"
  | "inspecting"
  | "capturing-evidence"
  | "consolidating"
  | "writing-reports"
  | "completed"
  | "cancelled";

export interface ScanControl {
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  onStage?: (stage: ScanStage) => void;
}

export interface Issue {
  ruleId: string;
  fingerprint: string;
  baselineStatus?: "new" | "existing";
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

export type IssueInput = Omit<Issue, "fingerprint">;

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

export interface PerformanceMetrics {
  ttfbMs: number | undefined;
  fcpMs: number | undefined;
  lcpMs: number | undefined;
  cls: number | undefined;
  domContentLoadedMs: number | undefined;
  loadMs: number | undefined;
}

export interface ScanPageResult {
  url: string;
  finalUrl: string;
  title: string;
  mainStatus: number | undefined;
  durationMs: number;
  scanStatus: "completed" | "partial";
  summary: ScanSummary;
  performance: PerformanceMetrics | undefined;
  outputDir: string;
}

export interface ScanComparison {
  baselineStartedAt: string | undefined;
  newIssues: number;
  existingIssues: number;
  resolvedIssues: Issue[];
  newSummary: ScanSummary;
}

export interface ScanReport {
  tool: "QA Radar";
  schemaVersion: "1.0";
  version: string;
  startedAt: string;
  durationMs: number;
  scanStatus: "completed" | "partial";
  targetUrl: string;
  finalUrl: string;
  title: string;
  mainStatus: number | undefined;
  browser: BrowserName;
  project?: string;
  environment?: string;
  passed: boolean;
  failOn: FailOn;
  gateScope: "all" | "regressions";
  summary: ScanSummary;
  performance?: PerformanceMetrics;
  pages?: ScanPageResult[];
  comparison?: ScanComparison;
  issues: Issue[];
  screenshotPath: string | undefined;
}
