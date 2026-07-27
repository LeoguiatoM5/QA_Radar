import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerOptions, OperationalEvent } from "../server.js";
import type { JobQueue, ScanJob } from "../job-queue.js";
import type { LegacyJourneyRegistry, JourneyJob } from "../legacy-journey-registry.js";
import type { CodegenSessionStore, CodegenSession } from "../codegen-session-store.js";
import type { CodeExecutionJobStore, CodeExecutionJob } from "../code-execution-job-store.js";
import type { JourneyRunResult } from "../journey-runner.js";

/**
 * Shared state and helpers threaded into every route module's tryHandle().
 * Built once per createQaRadarServer() call; route modules never construct
 * their own copies of jobQueue/legacyJourneys/etc, so cross-feature checks
 * (e.g. a scan blocking a legacy journey and vice versa) stay correct.
 */
export interface RequestContext {
  config: ServerOptions;
  jobQueue: JobQueue;
  legacyJourneys: LegacyJourneyRegistry;
  codegenSessions: CodegenSessionStore;
  codeExecutionJobs: CodeExecutionJobStore;
  queueStats: () => { active: number; queued: number; jobs: number };
  schedule: () => void;
  consumeRateLimit: (request: IncomingMessage, response: ServerResponse) => boolean;
  clientAddress: (request: IncomingMessage) => string;
  isLocalRequest: (request: IncomingMessage) => boolean;
  requireCodeModeEnabled: (response: ServerResponse) => boolean;
  requireCodeModeCreation: (request: IncomingMessage, response: ServerResponse, allowRemoteAdmin: boolean) => boolean;
  logOperational: (event: OperationalEvent) => void;
  targetOrigin: (job: ScanJob) => string;
  expireJob: (job: ScanJob) => void;
  expireJourney: (job: JourneyJob) => void;
  expireCodegen: (session: CodegenSession) => void;
  expireCodeExecution: (job: CodeExecutionJob) => void;
  loadCodeExecutionJob: (id: string) => Promise<CodeExecutionJob | undefined>;
  codeReportAsJourney: (job: CodeExecutionJob) => Promise<JourneyRunResult>;
  publicJourney: (report: JourneyRunResult) => JourneyRunResult;
}

export type RouteHandler = (
  context: RequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => Promise<boolean>;
