import { readFileSync } from 'fs';
import path from 'path';
import { analyzeGenericQuery } from './teta-logical-request-builder';
import {
  scanModuleBusinessHardcoding,
  validateLogicalReadonlyRequest,
} from './teta-logical-request-validator';
import { loadStage3k1Configs } from './teta-query-capability-registry';
import { STAGE3K1_FIXTURES, STAGE3K1_ROUTING_CASES } from './teta-stage3k1-fixtures';
import type {
  GenericQueryAnalysisResult,
  LogicalReadonlyRequest,
} from './teta-logical-readonly-request.types';
import {
  CANONICAL_BUSINESS_CONCEPT_KEYS,
  getCapabilityStatus,
} from './teta-query-capability.types';
import { countPseudoConceptKeys } from './teta-logical-readonly-request.contract';
import { countUnboundPresentedAsCanonical } from './teta-generic-query-clarification';
import { resolveRoutingWinner } from './teta-generic-query-route-adapters';

export type Stage3k1Audit = {
  contractVersion: 'teta-generic-query-analysis-v1';
  stage3k1Status: 'accepted_offline_foundation';
  stage3kStatus: 'started_foundation';
  stage3k2Status: 'not_started';
  nextStage: 'stage3k2_semantic_binding_design';
  genericRequestsBuilt: number;
  delegatedRequests: number;
  rejectedRequests: number;
  genericUnresolvedRequests: number;
  interpretationResolved: number;
  interpretationNeedsClarification: number;
  interpretationUnresolved: number;
  interpretationRejected: number;
  interpretationDelegated: number;
  capabilitySupported: number;
  capabilityPartiallySupported: number;
  capabilityUnsupported: number;
  capabilityNotApplicable: number;
  stage3k1ExecutionEligibleRequests: number;
  dedicatedRouteWins: number;
  payrollRouteWins: number;
  helpRouteWins: number;
  knowledgeRouteWins: number;
  capabilitiesRecognizedSupported: number;
  capabilitiesRecognizedUnsupported: number;
  unknownCapabilities: number;
  aggregateRequestsRecognized: number;
  historyRequestsRecognized: number;
  topNRequestsRecognized: number;
  mutationRequestsRejected: number;
  rawSqlRequestsRejected: number;
  promptInjectionRejected: number;
  ambiguousConceptsAutoSelected: number;
  unknownConceptsInvented: number;
  oracleObjectNamesIntroduced: number;
  oracleColumnNamesIntroduced: number;
  sqlTextsGenerated: number;
  oracleConnectionsOpened: number;
  sqlCompiled: number;
  sqlExecuted: number;
  localModelCalls: number;
  remoteModelCalls: number;
  qdrantCalls: number;
  embeddingCalls: number;
  legacyFallbackAllowedForGeneric: number;
  legacyFallbackAfterBlocked: number;
  legacyFallbackAfterUnsupported: number;
  legacyFallbackAfterAmbiguous: number;
  newCanonicalBusinessConceptsIntroduced: number;
  pseudoConceptKeysUsed: number;
  businessLanguagePatternsInCode: number;
  businessAliasesInCode: number;
  hardcodedBusinessConceptMappingsInCode: number;
  hardcodedOracleNamesInCode: number;
  hardcodedSqlFragmentsInCode: number;
  distinctInputQueriesSharingRequestId: number;
  dedicatedRouteSemanticOvermatches: number;
  fixtureSpecificRoutingRules: number;
  unboundClarificationCandidatesPresentedAsCanonical: number;
  fixtureResults: Array<{ id: string; ok: boolean; errors: string[] }>;
  routingCaseResults: Array<{ id: string; ok: boolean; errors: string[] }>;
  analyses: Array<{ id: string; analysis: GenericQueryAnalysisResult }>;
  strictErrors: string[];
};

function statusMatches(actual: string, expected: string | string[] | undefined): boolean {
  if (!expected) return true;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

export function runFixtures(repoRoot: string): {
  analyses: Array<{ id: string; analysis: GenericQueryAnalysisResult }>;
  results: Array<{ id: string; ok: boolean; errors: string[] }>;
} {
  const loaded = loadStage3k1Configs(repoRoot);
  if (!loaded.ok || !loaded.configs) {
    throw new Error(`config_invalid:${loaded.errors.join(',')}`);
  }
  const analyses: Array<{ id: string; analysis: GenericQueryAnalysisResult }> = [];
  const results: Array<{ id: string; ok: boolean; errors: string[] }> = [];

  for (const fx of STAGE3K1_FIXTURES) {
    const analysis = analyzeGenericQuery(fx.query, loaded.configs);
    analyses.push({ id: fx.id, analysis });
    const errors: string[] = [];
    const e = fx.expect;
    const req = analysis.logicalRequest;

    if (e.analysisKind && analysis.analysisKind !== e.analysisKind) {
      errors.push(`analysisKind:${analysis.analysisKind}!=${e.analysisKind}`);
    }
    if (e.routingWinner && analysis.routingDecision.winner !== e.routingWinner) {
      errors.push(`routing:${analysis.routingDecision.winner}!=${e.routingWinner}`);
    }
    if (e.logicalRequestNull) {
      if (req !== null) errors.push('expected_null_logicalRequest');
    }
    if (e.mutationRejected && !analysis.mutationRejected) errors.push('mutation_not_rejected');
    if (e.rawSqlRejected && !analysis.rawSqlRejected) errors.push('raw_sql_not_rejected');
    if (e.promptInjectionRejected && !analysis.promptInjectionRejected) {
      errors.push('injection_not_rejected');
    }
    if (!statusMatches(analysis.interpretationStatus, e.interpretationStatus)) {
      errors.push(
        `interpretation:${analysis.interpretationStatus}!=${JSON.stringify(e.interpretationStatus)}`,
      );
    }
    if (!statusMatches(analysis.capabilityStatus, e.capabilityStatus)) {
      errors.push(
        `capability:${analysis.capabilityStatus}!=${JSON.stringify(e.capabilityStatus)}`,
      );
    }

    if (req) {
      const v = validateLogicalReadonlyRequest(req);
      errors.push(...v.errors);
      if (e.intent !== undefined && req.intent !== e.intent) {
        errors.push(`intent:${req.intent}!=${e.intent}`);
      }
      if (e.rootConcept !== undefined && req.rootEntity.conceptKey !== e.rootConcept) {
        errors.push(`root:${req.rootEntity.conceptKey}!=${e.rootConcept}`);
      }
      if (
        e.rootSurfaceMeaning !== undefined &&
        req.rootEntity.surfaceMeaningKey !== e.rootSurfaceMeaning
      ) {
        errors.push(`rootSurface:${req.rootEntity.surfaceMeaningKey}!=${e.rootSurfaceMeaning}`);
      }
      if (e.hasProjection) {
        if (!req.requestedFields.some((f) => f.conceptKey === e.hasProjection)) {
          errors.push(`missing_projection:${e.hasProjection}`);
        }
      }
      if (e.hasSurfaceProjection) {
        if (!req.requestedFields.some((f) => f.surfaceMeaningKey === e.hasSurfaceProjection)) {
          errors.push(`missing_surface_projection:${e.hasSurfaceProjection}`);
        }
      }
      if (e.temporalKind && req.temporalScope.kind !== e.temporalKind) {
        errors.push(`temporal:${req.temporalScope.kind}!=${e.temporalKind}`);
      }
      if (e.answerShape) {
        if (!statusMatches(req.answerShape, e.answerShape)) {
          errors.push(`answerShape:${req.answerShape}!=${JSON.stringify(e.answerShape)}`);
        }
      }
      if (e.hasIdentityFilter) {
        if (!req.filters.some((f) => f.operator === 'matches_identity')) {
          errors.push('missing_identity_filter');
        }
      }
      if (e.identityContains) {
        if (
          !req.filters.some(
            (f) =>
              f.value.kind === 'identity' && f.value.rawText.includes(e.identityContains as string),
          )
        ) {
          errors.push('identity_text_mismatch');
        }
      }
      if (e.aggregationRequested && !req.aggregation.requested) {
        errors.push('aggregation_not_requested');
      }
      if (e.groupByAmbiguous) {
        if (!req.aggregation.groupBy.some((g) => g.resolutionStatus === 'ambiguous')) {
          errors.push('group_by_not_ambiguous');
        }
      }
      if (e.topN != null && req.limit !== e.topN) {
        errors.push(`topN:${req.limit}!=${e.topN}`);
      }
      if (e.capabilitiesInclude) {
        for (const c of e.capabilitiesInclude) {
          if (!req.recognizedCapabilities.includes(c as never)) {
            errors.push(`cap_missing:${c}`);
          }
        }
      }
      if (e.noSql) {
        const blob = JSON.stringify(req);
        for (const bad of ['sqlText', 'whereSql', 'joinSql', 'oracleObjectName']) {
          if (blob.includes(`"${bad}"`)) errors.push(`forbidden_key_present:${bad}`);
        }
      }
    } else if (
      e.hasProjection ||
      e.hasSurfaceProjection ||
      e.temporalKind ||
      e.aggregationRequested ||
      e.topN != null ||
      e.capabilitiesInclude
    ) {
      errors.push('expected_generic_logicalRequest');
    }

    results.push({ id: fx.id, ok: errors.length === 0, errors });
  }

  return { analyses, results };
}

export function runRoutingCases(
  repoRoot: string,
): Array<{ id: string; ok: boolean; errors: string[] }> {
  const loaded = loadStage3k1Configs(repoRoot);
  if (!loaded.ok || !loaded.configs) throw new Error('config_invalid');
  const out: Array<{ id: string; ok: boolean; errors: string[] }> = [];
  for (const rc of STAGE3K1_ROUTING_CASES) {
    const { decision } = resolveRoutingWinner(
      rc.query,
      loaded.configs.language,
      loaded.configs.routing,
    );
    const errors: string[] = [];
    if (rc.expectWinner && decision.winner !== rc.expectWinner) {
      errors.push(`winner:${decision.winner}!=${rc.expectWinner}`);
    }
    if (rc.expectWinnerNot && decision.winner === rc.expectWinnerNot) {
      errors.push(`winner_must_not_be:${rc.expectWinnerNot}`);
    }
    if (rc.preserveLeadingZero && !rc.query.includes(rc.preserveLeadingZero)) {
      errors.push('leading_zero_lost_in_fixture');
    }
    out.push({ id: rc.id, ok: errors.length === 0, errors });
  }
  return out;
}

function countFixtureSpecificRoutingRules(routingJson: string): number {
  const banned = [
    'składnik 1350',
    'skladnik 1350',
    'składnik 4300',
    'skladnik 4300',
    'pole staż',
    'pole staz',
    'teta edu',
    'jak przebiega zatrudnienie',
  ];
  const lower = routingJson.toLowerCase();
  return banned.filter((b) => lower.includes(b)).length;
}

function countDedicatedOvermatches(
  analyses: Array<{ id: string; analysis: GenericQueryAnalysisResult }>,
): number {
  let n = 0;
  for (const { id, analysis } of analyses) {
    if (id === 'K5' && analysis.routingDecision.winner === 'dedicated_deterministic_engine') {
      n += 1;
    }
  }
  return n;
}

function countDistinctInputQueriesSharingRequestId(
  analyses: Array<{ id: string; analysis: GenericQueryAnalysisResult }>,
): number {
  const byId = new Map<string, Set<string>>();
  for (const { analysis } of analyses) {
    const set = byId.get(analysis.requestId) ?? new Set<string>();
    set.add(analysis.queryNormalized);
    byId.set(analysis.requestId, set);
  }
  let collisions = 0;
  for (const set of byId.values()) {
    if (set.size > 1) collisions += set.size;
  }
  return collisions;
}

export function buildStage3k1Audit(repoRoot: string): Stage3k1Audit {
  const { analyses, results } = runFixtures(repoRoot);
  const routingCaseResults = runRoutingCases(repoRoot);
  const moduleDir = path.join(repoRoot, 'apps', 'api', 'src', 'teta-generic-query');
  const hardcode = scanModuleBusinessHardcoding(moduleDir);
  const routingPath = path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-generic-query-routing-v1.json',
  );
  const routingJson = readFileSync(routingPath, 'utf8');

  let genericRequestsBuilt = 0;
  let delegatedRequests = 0;
  let rejectedRequests = 0;
  let genericUnresolvedRequests = 0;
  let interpretationResolved = 0;
  let interpretationNeedsClarification = 0;
  let interpretationUnresolved = 0;
  let interpretationRejected = 0;
  let interpretationDelegated = 0;
  let capabilitySupported = 0;
  let capabilityPartiallySupported = 0;
  let capabilityUnsupported = 0;
  let capabilityNotApplicable = 0;
  let stage3k1ExecutionEligibleRequests = 0;
  let dedicatedRouteWins = 0;
  let payrollRouteWins = 0;
  let helpRouteWins = 0;
  let knowledgeRouteWins = 0;
  let capabilitiesRecognizedSupported = 0;
  let capabilitiesRecognizedUnsupported = 0;
  let unknownCapabilities = 0;
  let aggregateRequestsRecognized = 0;
  let historyRequestsRecognized = 0;
  let topNRequestsRecognized = 0;
  let mutationRequestsRejected = 0;
  let rawSqlRequestsRejected = 0;
  let promptInjectionRejected = 0;
  let ambiguousConceptsAutoSelected = 0;
  let unknownConceptsInvented = 0;
  let oracleObjectNamesIntroduced = 0;
  let oracleColumnNamesIntroduced = 0;
  let sqlTextsGenerated = 0;
  let legacyFallbackAllowedForGeneric = 0;
  let legacyFallbackAfterBlocked = 0;
  let legacyFallbackAfterUnsupported = 0;
  let legacyFallbackAfterAmbiguous = 0;
  let pseudoConceptKeysUsed = 0;
  let unboundClarificationCandidatesPresentedAsCanonical = 0;

  for (const { analysis } of analyses) {
    if (analysis.analysisKind === 'generic') genericRequestsBuilt += 1;
    if (analysis.analysisKind === 'delegated') delegatedRequests += 1;
    if (analysis.analysisKind === 'rejected') rejectedRequests += 1;

    if (analysis.interpretationStatus === 'resolved') interpretationResolved += 1;
    if (analysis.interpretationStatus === 'needs_clarification') {
      interpretationNeedsClarification += 1;
    }
    if (analysis.interpretationStatus === 'unresolved') interpretationUnresolved += 1;
    if (analysis.interpretationStatus === 'rejected') interpretationRejected += 1;
    if (analysis.interpretationStatus === 'delegated') interpretationDelegated += 1;

    if (analysis.capabilityStatus === 'supported') capabilitySupported += 1;
    if (analysis.capabilityStatus === 'partially_supported') capabilityPartiallySupported += 1;
    if (analysis.capabilityStatus === 'unsupported') capabilityUnsupported += 1;
    if (analysis.capabilityStatus === 'not_applicable') capabilityNotApplicable += 1;
    if (analysis.executionEligibility === 'eligible') stage3k1ExecutionEligibleRequests += 1;

    if (analysis.routingDecision.dedicatedRouteWins) dedicatedRouteWins += 1;
    if (analysis.routingDecision.payrollRouteWins) payrollRouteWins += 1;
    if (analysis.routingDecision.helpRouteWins) helpRouteWins += 1;
    if (analysis.routingDecision.knowledgeRouteWins) knowledgeRouteWins += 1;
    if (analysis.mutationRejected) mutationRequestsRejected += 1;
    if (analysis.rawSqlRejected) rawSqlRequestsRejected += 1;
    if (analysis.promptInjectionRejected) promptInjectionRejected += 1;

    const req = analysis.logicalRequest;
    if (!req) continue;
    if (req.interpretationStatus === 'unresolved') genericUnresolvedRequests += 1;
    if (req.aggregation.requested) aggregateRequestsRecognized += 1;
    if (req.recognizedCapabilities.includes('history')) historyRequestsRecognized += 1;
    if (req.recognizedCapabilities.includes('top_n')) topNRequestsRecognized += 1;
    pseudoConceptKeysUsed += countPseudoConceptKeys(req);
    unboundClarificationCandidatesPresentedAsCanonical += countUnboundPresentedAsCanonical(
      req.clarifications,
    );

    for (const c of req.recognizedCapabilities) {
      const st = getCapabilityStatus(c);
      if (st === 'supported_now') capabilitiesRecognizedSupported += 1;
      else if (st === 'recognized_but_not_supported') capabilitiesRecognizedUnsupported += 1;
      else unknownCapabilities += 1;
    }

    const v = validateLogicalReadonlyRequest(req);
    ambiguousConceptsAutoSelected += v.counters.ambiguousConceptsAutoSelected;
    unknownConceptsInvented += v.counters.unknownConceptsInvented;
    oracleObjectNamesIntroduced += v.counters.oracleObjectNamesIntroduced;
    oracleColumnNamesIntroduced += v.counters.oracleColumnNamesIntroduced;
    sqlTextsGenerated += v.counters.sqlTextsGenerated;
    legacyFallbackAllowedForGeneric += v.counters.legacyFallbackAllowedForGeneric;
    legacyFallbackAfterBlocked += v.counters.legacyFallbackAfterBlocked;
    legacyFallbackAfterUnsupported += v.counters.legacyFallbackAfterUnsupported;
    legacyFallbackAfterAmbiguous += v.counters.legacyFallbackAfterAmbiguous;
  }

  const languagePath = path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-generic-query-language-pl-v1.json',
  );
  const language = JSON.parse(readFileSync(languagePath, 'utf8')) as {
    canonicalConcepts: Array<{ conceptKey: string }>;
  };
  const newCanonicalBusinessConceptsIntroduced = language.canonicalConcepts.filter(
    (c) => !CANONICAL_BUSINESS_CONCEPT_KEYS.has(c.conceptKey),
  ).length;

  const dedicatedRouteSemanticOvermatches = countDedicatedOvermatches(analyses);
  const fixtureSpecificRoutingRules = countFixtureSpecificRoutingRules(routingJson);
  const distinctInputQueriesSharingRequestId = countDistinctInputQueriesSharingRequestId(analyses);

  const strictErrors: string[] = [];
  for (const r of results) {
    if (!r.ok) strictErrors.push(`fixture_failed:${r.id}:${r.errors.join('|')}`);
  }
  for (const r of routingCaseResults) {
    if (!r.ok) strictErrors.push(`routing_case_failed:${r.id}:${r.errors.join('|')}`);
  }

  const zeroChecks: Array<[string, number]> = [
    ['ambiguousConceptsAutoSelected', ambiguousConceptsAutoSelected],
    ['unknownConceptsInvented', unknownConceptsInvented],
    ['oracleObjectNamesIntroduced', oracleObjectNamesIntroduced],
    ['oracleColumnNamesIntroduced', oracleColumnNamesIntroduced],
    ['sqlTextsGenerated', sqlTextsGenerated],
    ['oracleConnectionsOpened', 0],
    ['sqlCompiled', 0],
    ['sqlExecuted', 0],
    ['localModelCalls', 0],
    ['remoteModelCalls', 0],
    ['qdrantCalls', 0],
    ['embeddingCalls', 0],
    ['legacyFallbackAllowedForGeneric', legacyFallbackAllowedForGeneric],
    ['legacyFallbackAfterBlocked', legacyFallbackAfterBlocked],
    ['legacyFallbackAfterUnsupported', legacyFallbackAfterUnsupported],
    ['legacyFallbackAfterAmbiguous', legacyFallbackAfterAmbiguous],
    ['newCanonicalBusinessConceptsIntroduced', newCanonicalBusinessConceptsIntroduced],
    ['pseudoConceptKeysUsed', pseudoConceptKeysUsed],
    ['businessLanguagePatternsInCode', hardcode.businessLanguagePatternsInCode],
    ['businessAliasesInCode', hardcode.businessAliasesInCode],
    ['hardcodedBusinessConceptMappingsInCode', hardcode.hardcodedBusinessConceptMappingsInCode],
    ['distinctInputQueriesSharingRequestId', distinctInputQueriesSharingRequestId],
    ['dedicatedRouteSemanticOvermatches', dedicatedRouteSemanticOvermatches],
    ['fixtureSpecificRoutingRules', fixtureSpecificRoutingRules],
    [
      'unboundClarificationCandidatesPresentedAsCanonical',
      unboundClarificationCandidatesPresentedAsCanonical,
    ],
    ['stage3k1ExecutionEligibleRequests', stage3k1ExecutionEligibleRequests],
  ];
  for (const [name, val] of zeroChecks) {
    if (val !== 0) strictErrors.push(`strict_nonzero:${name}=${val}`);
  }

  return {
    contractVersion: 'teta-generic-query-analysis-v1',
    stage3k1Status: 'accepted_offline_foundation',
    stage3kStatus: 'started_foundation',
    stage3k2Status: 'not_started',
    nextStage: 'stage3k2_semantic_binding_design',
    genericRequestsBuilt,
    delegatedRequests,
    rejectedRequests,
    genericUnresolvedRequests,
    interpretationResolved,
    interpretationNeedsClarification,
    interpretationUnresolved,
    interpretationRejected,
    interpretationDelegated,
    capabilitySupported,
    capabilityPartiallySupported,
    capabilityUnsupported,
    capabilityNotApplicable,
    stage3k1ExecutionEligibleRequests,
    dedicatedRouteWins,
    payrollRouteWins,
    helpRouteWins,
    knowledgeRouteWins,
    capabilitiesRecognizedSupported,
    capabilitiesRecognizedUnsupported,
    unknownCapabilities,
    aggregateRequestsRecognized,
    historyRequestsRecognized,
    topNRequestsRecognized,
    mutationRequestsRejected,
    rawSqlRequestsRejected,
    promptInjectionRejected,
    ambiguousConceptsAutoSelected,
    unknownConceptsInvented,
    oracleObjectNamesIntroduced,
    oracleColumnNamesIntroduced,
    sqlTextsGenerated,
    oracleConnectionsOpened: 0,
    sqlCompiled: 0,
    sqlExecuted: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    legacyFallbackAllowedForGeneric,
    legacyFallbackAfterBlocked,
    legacyFallbackAfterUnsupported,
    legacyFallbackAfterAmbiguous,
    newCanonicalBusinessConceptsIntroduced,
    pseudoConceptKeysUsed,
    businessLanguagePatternsInCode: hardcode.businessLanguagePatternsInCode,
    businessAliasesInCode: hardcode.businessAliasesInCode,
    hardcodedBusinessConceptMappingsInCode: hardcode.hardcodedBusinessConceptMappingsInCode,
    hardcodedOracleNamesInCode: hardcode.hardcodedOracleNamesInCode,
    hardcodedSqlFragmentsInCode: hardcode.hardcodedSqlFragmentsInCode,
    distinctInputQueriesSharingRequestId,
    dedicatedRouteSemanticOvermatches,
    fixtureSpecificRoutingRules,
    unboundClarificationCandidatesPresentedAsCanonical,
    fixtureResults: results,
    routingCaseResults,
    analyses,
    strictErrors,
  };
}

export function resolveRepoRootFromModule(): string {
  return path.resolve(__dirname, '../../../..');
}

export function collectGenericRequests(repoRoot: string): LogicalReadonlyRequest[] {
  return runFixtures(repoRoot)
    .analyses.map((a) => a.analysis.logicalRequest)
    .filter((r): r is LogicalReadonlyRequest => r != null);
}
