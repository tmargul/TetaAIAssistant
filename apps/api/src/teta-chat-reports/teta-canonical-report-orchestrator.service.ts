import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import path from 'path';
import { OracleConnectionService } from '../oracle/oracle-connection.service';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import {
  createOracleReadOnlyAdapter,
  type Stage3fOracleCredentials,
} from '../teta-oracle-executor/teta-oracle-readonly-adapter';
import type {
  Stage3fOracleAdapter,
  Stage3fTrustedChatReportApproval,
} from '../teta-oracle-executor/teta-oracle-executor.types';
import { TetaOracleXlsxExporterService } from '../teta-oracle-executor/teta-oracle-xlsx-exporter.service';
import { createSheetJsWorkbookAdapter } from '../teta-oracle-executor/teta-oracle-xlsx-workbook-adapter';
import {
  buildCanonicalPipeline,
  resolveRepoRootFromCwd,
  type Stage3gCanonicalPipeline,
} from './teta-canonical-pipeline.factory';
import {
  defaultCanonicalChatReportRoutesPath,
  loadCanonicalChatReportRoutes,
} from './teta-chat-report-route-registry';
import { resolveCanonicalChatReportRoute } from './teta-chat-report-route-resolver';
import {
  buildRejectedChatReport,
  mapOracleResultToChatReport,
} from './teta-chat-report-response-mapper';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';
import {
  STAGE3G_BHP_PURPOSE,
  STAGE3G_XLSX_MIME,
  emptyStage3gAuditCounters,
  type Stage3gAuditCounters,
  type Stage3gChatReportResponse,
  type Stage3gProgressStage,
  type Stage3gRouteRegistry,
  type Stage3gTrustedRequestContext,
} from './teta-chat-report.types';
import {
  applyTraceToCounters,
  createEmptyCanonicalChatReportTrace,
  type TetaCanonicalChatReportTrace,
} from './teta-canonical-chat-report-trace';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';

export type Stage3gOrchestratorDeps = {
  pipeline?: Stage3gCanonicalPipeline;
  registry?: Stage3gRouteRegistry;
  executor?: TetaOracleReadOnlyExecutorService;
  exporter?: TetaOracleXlsxExporterService;
  createAdapter?: (credentials: Stage3fOracleCredentials, bindNames: string[]) => Stage3fOracleAdapter;
  resolveCredentials?: () => Stage3fOracleCredentials | null;
  repoRoot?: string;
  downloadRegistry?: TetaReportDownloadRegistryService;
};

export type Stage3gTryHandleResult =
  | { handled: false }
  | {
      handled: true;
      response: Stage3gChatReportResponse;
      legacyFallbackUsed: false;
      counters: Stage3gAuditCounters;
      trace: TetaCanonicalChatReportTrace;
    };

function subjectFromEvidencePlan(plan: TetaEvidencePlan): string | null {
  const entity = plan.entities.find(
    (item) => item.type === 'reportSubject' && typeof item.normalizedValue === 'string',
  );
  return entity?.normalizedValue ?? null;
}
@Injectable()
export class TetaCanonicalReportOrchestratorService {
  private readonly logger = new Logger(TetaCanonicalReportOrchestratorService.name);
  private pipeline: Stage3gCanonicalPipeline | null = null;
  private routeRegistry: Stage3gRouteRegistry | null = null;
  private executor: TetaOracleReadOnlyExecutorService;
  private exporter: TetaOracleXlsxExporterService;
  private createAdapterFn?: Stage3gOrchestratorDeps['createAdapter'];
  private resolveCredentialsOverride?: () => Stage3fOracleCredentials | null;
  private repoRoot: string;

  constructor(
    private readonly downloadRegistry: TetaReportDownloadRegistryService,
    @Optional() private readonly oracleConnection?: OracleConnectionService,
  ) {
    this.executor = new TetaOracleReadOnlyExecutorService();
    this.exporter = new TetaOracleXlsxExporterService();
    this.repoRoot = resolveRepoRootFromCwd();
  }

  /** Test / CLI helper — bypass Nest DI for optional deps. */
  static createForTests(deps: Stage3gOrchestratorDeps): TetaCanonicalReportOrchestratorService {
    const registry = deps.downloadRegistry ?? new TetaReportDownloadRegistryService();
    const service = new TetaCanonicalReportOrchestratorService(registry, undefined);
    if (deps.pipeline) service.pipeline = deps.pipeline;
    if (deps.registry) service.routeRegistry = deps.registry;
    if (deps.executor) service.executor = deps.executor;
    if (deps.exporter) service.exporter = deps.exporter;
    if (deps.createAdapter) service.createAdapterFn = deps.createAdapter;
    if (deps.resolveCredentials) service.resolveCredentialsOverride = deps.resolveCredentials;
    if (deps.repoRoot) service.repoRoot = deps.repoRoot;
    return service;
  }

  getRouteRegistry(): Stage3gRouteRegistry {
    if (!this.routeRegistry) {
      const apiRoot = path.join(this.repoRoot, 'apps', 'api');
      this.routeRegistry = loadCanonicalChatReportRoutes(
        defaultCanonicalChatReportRoutesPath(apiRoot),
      );
    }
    return this.routeRegistry;
  }

  getPipeline(): Stage3gCanonicalPipeline {
    if (!this.pipeline) {
      this.pipeline = buildCanonicalPipeline(this.repoRoot);
    }
    return this.pipeline;
  }

  /**
   * Attempt Stage 3G canonical BHP route. Returns handled:false when the question
   * is not a registered canonical route (legacy chat continues).
   * On auth failure for a matched route: handled:true with rejected response —
   * NEVER falls back to the legacy Oracle agent.
   */
  async tryHandle(
    question: string,
    context: Stage3gTrustedRequestContext,
    onProgress?: (stage: Stage3gProgressStage, message: string) => void,
  ): Promise<Stage3gTryHandleResult> {
    const counters = emptyStage3gAuditCounters();
    const trace = createEmptyCanonicalChatReportTrace();
    trace.requestReceived = true;
    counters.chatRequestsReceived = 1;

    const pipeline = this.getPipeline();
    const registry = this.getRouteRegistry();

    counters.stage3bCalls = 1;
    trace.routeResolution.stage3bCalled = true;
    const evidencePlan = pipeline.evidencePlanner.plan({ question });
    trace.routeResolution.stage3bStatus = evidencePlan.planningStatus;
    trace.routeResolution.intent = evidencePlan.intent?.type ?? null;
    trace.routeResolution.subject = subjectFromEvidencePlan(evidencePlan);
    if (evidencePlan.planningStatus === 'ready') {
      counters.stage3bReady = 1;
    }

    const resolved = resolveCanonicalChatReportRoute({
      evidencePlan,
      registry,
      context,
    });

    if (!resolved.matched) {
      if (resolved.reason === 'disabled') {
        counters.canonicalRoutesDisabled = 1;
      } else {
        counters.canonicalRoutesNotMatched = 1;
      }
      return { handled: false };
    }

    trace.routeResolution.routeMatched = true;
    trace.routeResolution.routeId = resolved.route.routeId;
    trace.routeResolution.authorized = resolved.authorized;
    counters.canonicalRoutesMatched = 1;

    if (!resolved.authorized) {
      counters.canonicalRoutesRejectedByAuth = 1;
      counters.canonicalRouteFallbackToLegacyOracleAgent = 0;
      counters.legacyOracleAgentCallsForCanonicalRoute = 0;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_not_authorized',
        }),
      };
    }

    counters.authorizationAccepted = 1;

    // Stage 3D — subject roles (no SQL generation).
    try {
      pipeline.semanticResolver.resolveSubject(resolved.route.subject);
      trace.pipeline.stage3dResolved = true;
      counters.stage3dResolutions = 1;
    } catch {
      // Subject already validated by Stage 3B/registry; soft continue.
    }

    counters.canonicalPipelineExecutions = 1;
    onProgress?.('planning', 'Rozpoznaję zakres raportu…');

    if (context.signal?.aborted) {
      counters.reportsCancelled = 1;
      counters.chatRequestsCancelled = 1;
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_cancelled',
          status: 'cancelled',
        }),
      };
    }

    onProgress?.('compiling', 'Przygotowuję bezpieczne zapytanie…');
    counters.stage3cCalls = 1;
    trace.pipeline.stage3cCalled = true;
    const queryPlan = pipeline.planQuery(evidencePlan);
    trace.pipeline.stage3cStatus = queryPlan.planStatus;
    if (queryPlan.planStatus !== 'ready_for_compilation') {
      counters.reportsFailed = 1;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_not_ready',
        }),
      };
    }
    counters.stage3cPlansReady = 1;

    counters.stage3eCalls = 1;
    trace.pipeline.stage3eCalled = true;
    const compiled = pipeline.compiler.compile({
      queryPlan,
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    trace.pipeline.stage3eStatus = compiled.compileStatus;
    if (compiled.compileStatus !== 'compiled' || !compiled.sqlText || !compiled.sqlSha256) {
      counters.reportsFailed = 1;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_compilation_failed',
        }),
      };
    }
    counters.stage3eStatementsCompiled = 1;

    if (context.signal?.aborted) {
      counters.reportsCancelled = 1;
      counters.chatRequestsCancelled = 1;
      counters.downloadsRegisteredAfterCancellation = 0;
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_cancelled',
          status: 'cancelled',
        }),
      };
    }

    onProgress?.('executing', 'Pobieram dane z Teta…');

    const credentials = this.resolveCredentials();
    if (!credentials) {
      counters.reportsFailed = 1;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_failed',
        }),
      };
    }

    const approval: Stage3fTrustedChatReportApproval = {
      approvalSource: 'trusted_chat_report_route',
      routeId: resolved.route.routeId,
      authenticatedUserId: context.authenticatedUserId,
      workMode: context.workMode,
      role: context.role,
      expectedSqlSha256: compiled.sqlSha256,
      purpose: STAGE3G_BHP_PURPOSE,
    };

    const adapter =
      this.createAdapterFn?.(credentials, compiled.binds.map((b) => b.name)) ??
      createOracleReadOnlyAdapter({
        credentials,
        bindNames: compiled.binds.map((b) => b.name),
        callTimeoutMs: compiled.limits.statementTimeoutMs,
      });

    const onAbort = () => {
      void adapter.break?.();
    };
    context.signal?.addEventListener('abort', onAbort, { once: true });

    let result;
    try {
      counters.stage3fCalls = 1;
      counters.stage3fExecutions = 1;
      trace.pipeline.stage3fCalled = true;
      result = await this.executor.execute({
        compiled,
        approval,
        adapter,
        expectedSqlSha256: compiled.sqlSha256,
      });
      trace.pipeline.stage3fStatus = result.executionStatus;
    } catch (error) {
      this.logger.warn(
        `Stage 3G execute failed routeId=${resolved.route.routeId} code=canonical_report_failed`,
      );
      counters.reportsFailed = 1;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_failed',
        }),
      };
    } finally {
      context.signal?.removeEventListener('abort', onAbort);
    }

    counters.oracleConnectionsOpened = result.audit.connectionsOpened;
    counters.oracleConnectionsClosed = result.audit.connectionsClosed;
    counters.businessStatementsExecuted = result.audit.businessStatements;
    counters.writesAttempted = result.audit.writeStatements;
    counters.commits = result.audit.commits;
    counters.retries = result.audit.automaticRetries;

    if (context.signal?.aborted) {
      counters.reportsCancelled = 1;
      counters.chatRequestsCancelled = 1;
      counters.oracleStatementsCancelledByClient = 1;
      counters.downloadsRegisteredAfterCancellation = 0;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: 'canonical_report_cancelled',
          status: 'cancelled',
        }),
      };
    }

    if (result.executionStatus === 'timed_out') {
      counters.reportsTimedOut = 1;
      trace.delivery.responseMapped = true;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: mapOracleResultToChatReport({
          result,
          routeId: resolved.route.routeId,
          executionId: randomUUID(),
          download: null,
          errorCode: 'canonical_report_timed_out',
        }),
      };
    }

    if (result.executionStatus === 'rejected') {
      counters.reportsFailed = 1;
      trace.delivery.responseMapped = true;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: mapOracleResultToChatReport({
          result,
          routeId: resolved.route.routeId,
          executionId: randomUUID(),
          download: null,
          errorCode: 'canonical_report_execution_rejected',
        }),
      };
    }

    if (
      result.executionStatus !== 'completed' &&
      result.executionStatus !== 'completed_empty' &&
      result.executionStatus !== 'limit_reached'
    ) {
      counters.reportsFailed = 1;
      trace.delivery.responseMapped = true;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: mapOracleResultToChatReport({
          result,
          routeId: resolved.route.routeId,
          executionId: randomUUID(),
          download: null,
          errorCode: 'canonical_report_failed',
        }),
      };
    }

    onProgress?.('exporting', 'Tworzę plik Excel…');
    const workbook = createSheetJsWorkbookAdapter();
    const exported = await this.exporter.exportToBuffer(result, workbook);
    trace.delivery.xlsxGenerated = true;
    const executionId = randomUUID();

    const registered = this.downloadRegistry.register({
      userId: context.authenticatedUserId,
      sessionId: context.sessionId,
      conversationId: context.conversationId,
      executionId,
      routeId: resolved.route.routeId,
      fileName: exported.fileName,
      mimeType: STAGE3G_XLSX_MIME,
      fileSha256: exported.fileSha256,
      buffer: exported.bytes,
    });

    if (!registered.ok) {
      counters.downloadRegistryLimitRejections = 1;
      counters.reportsFailed = 1;
      applyTraceToCounters(trace, counters);
      return {
        handled: true,
        legacyFallbackUsed: false,
        counters,
        trace,
        response: buildRejectedChatReport({
          routeId: resolved.route.routeId,
          errorCode: registered.code,
        }),
      };
    }

    trace.delivery.downloadRegistered = true;
    counters.downloadTokensIssued = 1;
    counters.tokenHashesStored = 1;
    counters.rawTokensStored = 0;
    counters.reportRowsSentToCurrentClient = result.rowCount;

    if (result.executionStatus === 'completed_empty' || result.rowCount === 0) {
      counters.reportsCompletedEmpty = 1;
    } else if (result.limitReached || result.executionStatus === 'limit_reached') {
      counters.reportsLimitReached = 1;
    } else {
      counters.reportsCompleted = 1;
    }

    const response = mapOracleResultToChatReport({
      result,
      routeId: resolved.route.routeId,
      executionId,
      download: {
        token: registered.token,
        fileName: exported.fileName,
        fileSha256: exported.fileSha256,
        fileSizeBytes: exported.bytes.byteLength,
        expiresAt: registered.expiresAt,
      },
    });
    trace.delivery.responseMapped = true;
    applyTraceToCounters(trace, counters);

    this.logger.log(
      `Stage 3G ok routeId=${resolved.route.routeId} status=${response.status} rows=${response.report.rowCount} cols=${response.report.columnCount}`,
    );

    return {
      handled: true,
      legacyFallbackUsed: false,
      counters,
      trace,
      response,
    };
  }

  private resolveCredentials(): Stage3fOracleCredentials | null {
    if (this.resolveCredentialsOverride) {
      return this.resolveCredentialsOverride();
    }
    const stored = this.oracleConnection?.getStoredConfigWithPassword();
    if (!stored?.password) return null;
    try {
      const connectString = this.oracleConnection!.buildConnectString(stored);
      return {
        user: stored.username,
        password: stored.password,
        connectString,
      };
    } catch {
      return null;
    }
  }
}
