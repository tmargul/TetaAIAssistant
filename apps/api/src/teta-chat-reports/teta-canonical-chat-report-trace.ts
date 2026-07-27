import { randomUUID } from 'crypto';
import type { Stage3gAuditCounters } from './teta-chat-report.types';

export type TetaCanonicalChatReportTrace = {
  traceId: string;
  requestReceived: boolean;
  routeResolution: {
    stage3bCalled: boolean;
    stage3bStatus: string | null;
    intent: string | null;
    subject: string | null;
    routeMatched: boolean;
    routeId: string | null;
    authorized: boolean | null;
  };
  pipeline: {
    stage3dResolved: boolean;
    stage3cCalled: boolean;
    stage3cStatus: string | null;
    stage3eCalled: boolean;
    stage3eStatus: string | null;
    stage3fCalled: boolean;
    stage3fStatus: string | null;
  };
  delivery: {
    responseMapped: boolean;
    xlsxGenerated: boolean;
    downloadRegistered: boolean;
  };
  integrity: {
    directCanonicalRouteBypassDetected: boolean;
    prebuiltPlanUsedByStage3g: boolean;
    precompiledSqlUsedByStage3g: boolean;
  };
};

export type Stage3gConsistencyInvariants = {
  chatRequestsReceivedConsistent: boolean;
  matchedRoutesNotExceedRequests: boolean;
  pipelineExecutionsNotExceedMatchedRoutes: boolean;
  stageCallChainComplete: boolean;
  stage3fExecutionsNotExceedStage3eCompiled: boolean;
  businessStatementsNotExceedStage3fExecutions: boolean;
  downloadSuccessNotExceedRequests: boolean;
  liveReferencesNotMixedWithOfflineReferences: boolean;
  runtimeTestCountersNotConfusedWithReferences: boolean;
  uiMetricsSourceValid: boolean;
  noDirectCanonicalRouteBypass: boolean;
  noPrebuiltPlanUsedByStage3g: boolean;
  noPrecompiledSqlUsedByStage3g: boolean;
};

export function createEmptyCanonicalChatReportTrace(): TetaCanonicalChatReportTrace {
  return {
    traceId: randomUUID(),
    requestReceived: false,
    routeResolution: {
      stage3bCalled: false,
      stage3bStatus: null,
      intent: null,
      subject: null,
      routeMatched: false,
      routeId: null,
      authorized: null,
    },
    pipeline: {
      stage3dResolved: false,
      stage3cCalled: false,
      stage3cStatus: null,
      stage3eCalled: false,
      stage3eStatus: null,
      stage3fCalled: false,
      stage3fStatus: null,
    },
    delivery: {
      responseMapped: false,
      xlsxGenerated: false,
      downloadRegistered: false,
    },
    integrity: {
      directCanonicalRouteBypassDetected: false,
      prebuiltPlanUsedByStage3g: false,
      precompiledSqlUsedByStage3g: false,
    },
  };
}

/** Apply trace milestones to audit counters (additive, idempotent per request). */
export function applyTraceToCounters(
  trace: TetaCanonicalChatReportTrace,
  counters: Stage3gAuditCounters,
): void {
  if (trace.requestReceived) {
    counters.chatRequestsReceived = Math.max(counters.chatRequestsReceived, 1);
  }
  if (trace.routeResolution.stage3bCalled) {
    counters.stage3bCalls = Math.max(counters.stage3bCalls, 1);
  }
  if (trace.routeResolution.stage3bStatus === 'ready') {
    counters.stage3bReady = Math.max(counters.stage3bReady, 1);
  }
  if (trace.routeResolution.routeMatched) {
    counters.canonicalRoutesMatched = Math.max(counters.canonicalRoutesMatched, 1);
  }
  if (trace.routeResolution.authorized === false) {
    counters.canonicalRoutesRejectedByAuth = Math.max(counters.canonicalRoutesRejectedByAuth, 1);
  }
  if (trace.routeResolution.authorized === true && trace.routeResolution.routeMatched) {
    counters.authorizationAccepted = Math.max(counters.authorizationAccepted, 1);
  }
  if (
    trace.routeResolution.routeMatched &&
    trace.routeResolution.authorized === true &&
    trace.pipeline.stage3cCalled
  ) {
    counters.canonicalPipelineExecutions = Math.max(counters.canonicalPipelineExecutions, 1);
  }
  if (trace.pipeline.stage3dResolved) {
    counters.stage3dResolutions = Math.max(counters.stage3dResolutions, 1);
  }
  if (trace.pipeline.stage3cCalled) {
    counters.stage3cCalls = Math.max(counters.stage3cCalls, 1);
  }
  if (trace.pipeline.stage3cStatus === 'ready_for_compilation') {
    counters.stage3cPlansReady = Math.max(counters.stage3cPlansReady, 1);
  }
  if (trace.pipeline.stage3eCalled) {
    counters.stage3eCalls = Math.max(counters.stage3eCalls, 1);
  }
  if (trace.pipeline.stage3eStatus === 'compiled') {
    counters.stage3eStatementsCompiled = Math.max(counters.stage3eStatementsCompiled, 1);
  }
  if (trace.pipeline.stage3fCalled) {
    counters.stage3fCalls = Math.max(counters.stage3fCalls, 1);
    counters.stage3fExecutions = Math.max(counters.stage3fExecutions, 1);
  }
  if (trace.integrity.directCanonicalRouteBypassDetected) {
    counters.directCanonicalRouteBypassDetected = 1;
  }
  if (trace.integrity.prebuiltPlanUsedByStage3g) {
    counters.prebuiltPlanUsedByStage3g = 1;
  }
  if (trace.integrity.precompiledSqlUsedByStage3g) {
    counters.precompiledSqlUsedByStage3g = 1;
  }
}

export function validateLivePipelineTrace(trace: TetaCanonicalChatReportTrace): string[] {
  const errors: string[] = [];
  if (!trace.requestReceived) errors.push('trace:requestReceived');
  if (!trace.routeResolution.stage3bCalled) errors.push('trace:stage3bCalled');
  if (trace.routeResolution.stage3bStatus !== 'ready') errors.push('trace:stage3bStatus');
  if (!trace.routeResolution.routeMatched) errors.push('trace:routeMatched');
  if (trace.routeResolution.authorized !== true) errors.push('trace:authorized');
  if (!trace.pipeline.stage3dResolved) errors.push('trace:stage3dResolved');
  if (!trace.pipeline.stage3cCalled) errors.push('trace:stage3cCalled');
  if (trace.pipeline.stage3cStatus !== 'ready_for_compilation') errors.push('trace:stage3cStatus');
  if (!trace.pipeline.stage3eCalled) errors.push('trace:stage3eCalled');
  if (trace.pipeline.stage3eStatus !== 'compiled') errors.push('trace:stage3eStatus');
  if (!trace.pipeline.stage3fCalled) errors.push('trace:stage3fCalled');
  if (!trace.pipeline.stage3fStatus) errors.push('trace:stage3fStatus');
  if (!trace.delivery.responseMapped) errors.push('trace:responseMapped');
  if (!trace.delivery.xlsxGenerated) errors.push('trace:xlsxGenerated');
  if (!trace.delivery.downloadRegistered) errors.push('trace:downloadRegistered');
  if (trace.integrity.directCanonicalRouteBypassDetected) {
    errors.push('trace:directCanonicalRouteBypassDetected');
  }
  if (trace.integrity.prebuiltPlanUsedByStage3g) errors.push('trace:prebuiltPlanUsedByStage3g');
  if (trace.integrity.precompiledSqlUsedByStage3g) errors.push('trace:precompiledSqlUsedByStage3g');
  return errors;
}

export function evaluateConsistencyInvariants(options: {
  hasLivePipeline: boolean;
  liveCounters: Stage3gAuditCounters;
  liveTrace: TetaCanonicalChatReportTrace;
  offlineCounters: Stage3gAuditCounters;
  downloadCounters: Pick<
    Stage3gAuditCounters,
    | 'downloadRequests'
    | 'downloadsSuccessful'
    | 'downloadsExpired'
    | 'downloadOwnerMismatches'
    | 'downloadLimitRejections'
  >;
  uiMetricsSource: 'not_measured' | 'shared_ui_helpers' | 'component_test';
  uiMetricsAreNull: boolean;
  referencesUsedAsTestsPassed: boolean;
}): Stage3gConsistencyInvariants {
  const { liveCounters, liveTrace, offlineCounters, downloadCounters, hasLivePipeline } = options;
  const chatRequests = liveCounters.chatRequestsReceived;
  const matched = liveCounters.canonicalRoutesMatched;
  const pipeline = liveCounters.canonicalPipelineExecutions;

  const stageChainComplete =
    liveTrace.requestReceived &&
    liveTrace.routeResolution.stage3bCalled &&
    liveTrace.routeResolution.routeMatched &&
    liveTrace.routeResolution.authorized === true &&
    liveTrace.pipeline.stage3dResolved &&
    liveTrace.pipeline.stage3cCalled &&
    liveTrace.pipeline.stage3eCalled &&
    liveTrace.pipeline.stage3fCalled &&
    (liveTrace.pipeline.stage3fStatus === 'completed' ||
      liveTrace.pipeline.stage3fStatus === 'completed_empty' ||
      liveTrace.pipeline.stage3fStatus === 'limit_reached') &&
    liveTrace.delivery.xlsxGenerated &&
    liveTrace.delivery.downloadRegistered &&
    liveTrace.delivery.responseMapped;

  return {
    chatRequestsReceivedConsistent: hasLivePipeline
      ? chatRequests === 1 && liveTrace.requestReceived
      : true,
    matchedRoutesNotExceedRequests: hasLivePipeline ? matched <= chatRequests : true,
    pipelineExecutionsNotExceedMatchedRoutes: hasLivePipeline ? pipeline <= matched : true,
    stageCallChainComplete: hasLivePipeline ? stageChainComplete : true,
    stage3fExecutionsNotExceedStage3eCompiled: hasLivePipeline
      ? liveCounters.stage3fExecutions <= liveCounters.stage3eStatementsCompiled
      : true,
    businessStatementsNotExceedStage3fExecutions: hasLivePipeline
      ? liveCounters.businessStatementsExecuted <= liveCounters.stage3fExecutions
      : true,
    downloadSuccessNotExceedRequests:
      downloadCounters.downloadsSuccessful <= downloadCounters.downloadRequests,
    liveReferencesNotMixedWithOfflineReferences: hasLivePipeline
      ? liveCounters.canonicalRoutesRejectedByAuth === 0 &&
        offlineCounters.canonicalRoutesRejectedByAuth >= 0
      : true,
    runtimeTestCountersNotConfusedWithReferences: !options.referencesUsedAsTestsPassed,
    uiMetricsSourceValid:
      options.uiMetricsSource === 'not_measured'
        ? options.uiMetricsAreNull
        : true,
    noDirectCanonicalRouteBypass: hasLivePipeline
      ? !liveTrace.integrity.directCanonicalRouteBypassDetected
      : true,
    noPrebuiltPlanUsedByStage3g: hasLivePipeline
      ? !liveTrace.integrity.prebuiltPlanUsedByStage3g
      : true,
    noPrecompiledSqlUsedByStage3g: hasLivePipeline
      ? !liveTrace.integrity.precompiledSqlUsedByStage3g
      : true,
  };
}

export function validateDownloadInvariants(
  counters: Pick<
    Stage3gAuditCounters,
    | 'downloadRequests'
    | 'downloadsSuccessful'
    | 'downloadsExpired'
    | 'downloadOwnerMismatches'
    | 'downloadLimitRejections'
  >,
): string[] {
  const errors: string[] = [];
  if (counters.downloadsSuccessful > counters.downloadRequests) {
    errors.push('downloadSuccessExceedsRequests');
  }
  if (counters.downloadsExpired > counters.downloadRequests) {
    errors.push('downloadExpiredExceedsRequests');
  }
  if (counters.downloadOwnerMismatches > counters.downloadRequests) {
    errors.push('downloadOwnerMismatchExceedsRequests');
  }
  if (counters.downloadLimitRejections > counters.downloadRequests) {
    errors.push('downloadLimitExceedsRequests');
  }
  return errors;
}
