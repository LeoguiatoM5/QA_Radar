import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerOptions, OperationalEvent } from "../server.js";
import type { JobQueue, ScanJob } from "../job-queue.js";
import type { LegacyJourneyRegistry, JourneyJob } from "../legacy-journey-registry.js";
import type { CodegenSessionStore, CodegenSession } from "../codegen-session-store.js";
import type { CodeExecutionJobStore, CodeExecutionJob } from "../code-execution-job-store.js";
import type { JourneyRunResult } from "../journey-runner.js";
import type { DashboardActivityStore } from "../dashboard-activity-store.js";
import type { IdempotencyKeys } from "../idempotency-store.js";
import type { ScanJobPersistence } from "../scan-job-persistence.js";
import type { ArtifactStorage } from "../artifact-storage.js";
import type { AccessTokenIssuer } from "../access-token.js";
import type { IdentityStore, User } from "../identity.js";
import type { OAuthProvider } from "../oauth.js";
import type { EmailSender } from "../email.js";
import type { RateLimiter } from "../rate-limit.js";

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
  dashboardActivity: DashboardActivityStore;
  idempotencyKeys: IdempotencyKeys;
  /** Espelha os jobs no banco. Inerte quando não há QA_RADAR_DATABASE_URL. */
  scanJobs: ScanJobPersistence;
  /** Artefatos duráveis. Inerte sem configuração: só disco, como hoje. */
  artifacts: ArtifactStorage;
  /** Emite o token de acesso de uma análise. */
  accessTokens: AccessTokenIssuer;
  /** Ausente = login indisponível; o produto segue anônimo. */
  identity: IdentityStore | undefined;
  oauthProvider: OAuthProvider | undefined;
  /** Inerte sem provedor: confirmação e recuperação de senha ficam indisponíveis. */
  emailSender: EmailSender;
  /**
   * Limite próprio das rotas de conta, separado do limite geral de análises.
   *
   * Compartilhar o contador deixaria uma rajada de tentativas de senha consumir
   * a cota de quem só quer rodar uma análise, e vice-versa.
   */
  authRateLimiter: RateLimiter;
  /** Usuário da sessão desta requisição, se houver. */
  currentUser: (request: IncomingMessage) => Promise<User | undefined>;
  /**
   * Prefixo com que o cliente chamou a API nesta requisição: `/api/v1` ou o
   * `/api` legado. Toda rota que devolve um caminho da própria API (cookie de
   * acesso, URL de artefato) tem de usar este valor, não uma constante.
   */
  apiPrefix: string;
  queueStats: () => { active: number; queued: number; jobs: number };
  schedule: () => void;
  consumeRateLimit: (request: IncomingMessage, response: ServerResponse) => boolean;
  clientAddress: (request: IncomingMessage) => string;
  isLocalRequest: (request: IncomingMessage) => boolean;
  requireCodeModeEnabled: (response: ServerResponse) => boolean;
  requireCodeModeCreation: (request: IncomingMessage, response: ServerResponse, allowRemoteAdmin: boolean) => Promise<boolean>;
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

export type RouteHandler = (context: RequestContext, request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
