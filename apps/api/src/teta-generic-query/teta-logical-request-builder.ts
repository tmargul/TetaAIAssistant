import { LEGACY_LLM_SQL_FENCE_POLICY } from './teta-legacy-llm-sql-fence.policy';
import {
  computeInputFingerprint,
  computeSemanticFingerprint,
  makeRequestId,
} from './teta-logical-readonly-request.contract';
import {
  STAGE3K1_ANALYSIS_CONTRACT_VERSION,
  STAGE3K1_CONTRACT_VERSION,
  STAGE3K1_INTENT,
  deriveLegacyStatus,
  type CapabilitySupportLevel,
  type ClassifyResult,
  type GenericQueryAnalysisResult,
  type InterpretationStatus,
  type LogicalFilter,
  type LogicalReadonlyRequest,
  type LogicalRequestedField,
  type LogicalRelation,
  type RoutingDecision,
} from './teta-logical-readonly-request.types';
import { buildClarificationFromCatalog } from './teta-generic-query-clarification';
import {
  findCanonical,
  findSurface,
  normalizePolishQuery,
  parseGenericQueryLanguage,
} from './teta-generic-query-language.service';
import { resolveRoutingWinner } from './teta-generic-query-route-adapters';
import type { Stage3k1Configs } from './teta-query-capability-registry';
import { getCapabilityStatus, type QueryCapabilityId } from './teta-query-capability.types';

function markCap(id: QueryCapabilityId, recognized: QueryCapabilityId[], unsupported: QueryCapabilityId[]) {
  if (!recognized.includes(id)) recognized.push(id);
  if (getCapabilityStatus(id) === 'recognized_but_not_supported' && !unsupported.includes(id)) {
    unsupported.push(id);
  }
}

function configVersions(configs: Stage3k1Configs): Record<string, string> {
  return {
    language: configs.language.version,
    routing: configs.routing.version,
    capabilities: configs.capabilities.version,
  };
}

export function classifyGenericQuery(query: string, configs: Stage3k1Configs): ClassifyResult {
  const { decision } = resolveRoutingWinner(query, configs.language, configs.routing);
  const parsed = parseGenericQueryLanguage(query, configs.language, configs.monthNames);
  return {
    queryNormalized: normalizePolishQuery(query, configs.language),
    routing: decision,
    intentCandidate: decision.winner === 'generic_readonly_query' ? STAGE3K1_INTENT : null,
    markers: parsed.markers,
  };
}

function buildGenericLogicalRequest(
  query: string,
  configs: Stage3k1Configs,
  routingDecision: RoutingDecision,
  inputFingerprint: string,
  requestId: string,
): LogicalReadonlyRequest {
  const parsed = parseGenericQueryLanguage(query, configs.language, configs.monthNames);
  const recognized: QueryCapabilityId[] = [];
  const unsupported: QueryCapabilityId[] = [];
  const clarifications: LogicalReadonlyRequest['clarifications'] = [];
  const evidenceHints: LogicalReadonlyRequest['evidenceHints'] = [];
  const filters: LogicalFilter[] = [];
  const relations: LogicalRelation[] = [];
  let filterSeq = 0;

  const employee = findCanonical(parsed, 'employee');
  const position = findCanonical(parsed, 'position');
  const ou = findCanonical(parsed, 'organizational_unit');
  const contracts = findCanonical(parsed, 'employment_contract');
  const activeEmp = findCanonical(parsed, 'active_employment');
  const health = findCanonical(parsed, 'health_examination');
  const dept = findSurface(parsed, 'department');
  const compensation = findSurface(parsed, 'compensation');
  const location = findSurface(parsed, 'location');
  const empDate = findSurface(parsed, 'employment_date');

  const employeeFromConfig = configs.language.canonicalConcepts.find(
    (c) => c.kind === 'entity' && c.refs.some((r) => r.includes(':employee')),
  );

  let rootEntity = {
    conceptKey: employee?.conceptKey ?? null,
    surfaceMeaningKey: employee?.conceptKey ?? null,
    surfaceText: employee?.surfaceText ?? '',
    resolutionStatus: (employee?.resolutionStatus ?? 'unresolved') as
      | 'resolved'
      | 'ambiguous'
      | 'unresolved',
  };

  if (contracts && parsed.topN != null) {
    rootEntity = {
      conceptKey: contracts.conceptKey,
      surfaceMeaningKey: contracts.conceptKey,
      surfaceText: contracts.surfaceText,
      resolutionStatus: 'unresolved',
    };
  }

  const requestedFields: LogicalRequestedField[] = [];
  if (position && (employee || parsed.temporalKind === 'history')) {
    markCap('projection', recognized, unsupported);
    requestedFields.push({
      conceptKey: position.conceptKey,
      surfaceMeaningKey: position.conceptKey,
      surfaceText: position.surfaceText,
      resolutionStatus:
        parsed.temporalKind === 'history' ? 'unresolved' : position.resolutionStatus,
      role: 'projection',
    });
    if (!employee && parsed.temporalKind === 'history' && employeeFromConfig) {
      rootEntity = {
        conceptKey: employeeFromConfig.conceptKey,
        surfaceMeaningKey: employeeFromConfig.conceptKey,
        surfaceText: employeeFromConfig.labels[0] ?? '',
        resolutionStatus: 'resolved',
      };
    }
  }

  if (compensation) {
    requestedFields.push({
      conceptKey: null,
      surfaceMeaningKey: compensation.surfaceMeaningKey,
      surfaceText: compensation.surfaceText,
      resolutionStatus: 'ambiguous',
      role: 'projection',
    });
    markCap('projection', recognized, unsupported);
    const c = buildClarificationFromCatalog('compensation', configs.language);
    if (c) clarifications.push(c);
    if (!employee && employeeFromConfig) {
      rootEntity = {
        conceptKey: employeeFromConfig.conceptKey,
        surfaceMeaningKey: employeeFromConfig.conceptKey,
        surfaceText: employeeFromConfig.labels[0] ?? '',
        resolutionStatus: 'resolved',
      };
    }
  }

  for (const raw of parsed.identityRawTexts) {
    filterSeq += 1;
    filters.push({
      filterId: `f-identity-${filterSeq}`,
      conceptKey: null,
      surfaceMeaningKey: 'employee_identity',
      surfaceText: raw,
      operator: 'matches_identity',
      value: { kind: 'identity', rawText: raw },
      resolutionStatus: 'resolved',
      temporalMeaning: null,
    });
    evidenceHints.push({
      kind: 'pattern' as const,
      ref: 'identity',
      note: 'Logical identity only — no Oracle column mapping',
    });
  }
  for (const id of parsed.leadingZeroIds) {
    filterSeq += 1;
    filters.push({
      filterId: `f-empno-${filterSeq}`,
      conceptKey: null,
      surfaceMeaningKey: 'employee_identity',
      surfaceText: id,
      operator: 'matches_identity',
      value: { kind: 'identity', rawText: id },
      resolutionStatus: 'resolved',
      temporalMeaning: null,
    });
  }

  if (ou) {
    relations.push({
      conceptKey: ou.conceptKey,
      surfaceMeaningKey: ou.conceptKey,
      surfaceText: ou.surfaceText,
      resolutionStatus: ou.resolutionStatus,
    });
    let ouValueText = ou.surfaceText;
    for (const pat of configs.language.relationValuePatterns ?? []) {
      if (pat.surfaceMeaningKey !== ou.conceptKey && pat.surfaceMeaningKey !== 'organizational_unit') {
        continue;
      }
      const unitMatch = query.match(new RegExp(pat.regex, 'i'));
      if (unitMatch?.[1]) {
        ouValueText = unitMatch[1];
        break;
      }
    }
    filterSeq += 1;
    filters.push({
      filterId: `f-ou-${filterSeq}`,
      conceptKey: ou.conceptKey,
      surfaceMeaningKey: ou.conceptKey,
      surfaceText: ouValueText,
      operator: 'equals',
      value: { kind: 'literal', text: ouValueText },
      resolutionStatus: 'resolved',
      temporalMeaning: null,
    });
    markCap('filter_equals', recognized, unsupported);
  }

  if (activeEmp) {
    relations.push({
      conceptKey: activeEmp.conceptKey,
      surfaceMeaningKey: activeEmp.conceptKey,
      surfaceText: activeEmp.surfaceText,
      resolutionStatus: activeEmp.resolutionStatus,
    });
  }

  if (parsed.afterDateIso || empDate) {
    markCap('filter_comparison', recognized, unsupported);
    const empDateCfg = configs.language.surfaceMeanings.find((s) =>
      s.refs.some((r) => r.includes('employment-date')),
    );
    filterSeq += 1;
    filters.push({
      filterId: `f-emp-date-${filterSeq}`,
      conceptKey: null,
      surfaceMeaningKey: empDate?.surfaceMeaningKey ?? empDateCfg?.surfaceMeaningKey ?? null,
      surfaceText: empDate?.surfaceText ?? empDateCfg?.labels[0] ?? '',
      operator: 'comparison',
      value: parsed.afterDateIso
        ? { kind: 'date', isoDate: parsed.afterDateIso }
        : { kind: 'empty' },
      resolutionStatus: 'ambiguous',
      temporalMeaning: null,
    });
    const c = buildClarificationFromCatalog('employment_date', configs.language);
    if (c) clarifications.push(c);
  }

  if (parsed.hasWithout && health) {
    markCap('negative_existence', recognized, unsupported);
    markCap('current_record', recognized, unsupported);
    filterSeq += 1;
    filters.push({
      filterId: `f-neg-${filterSeq}`,
      conceptKey: health.conceptKey,
      surfaceMeaningKey: health.conceptKey,
      surfaceText: health.surfaceText,
      operator: 'existence_absent',
      value: { kind: 'empty' },
      resolutionStatus: 'resolved',
      temporalMeaning: 'current',
    });
    relations.push({
      conceptKey: health.conceptKey,
      surfaceMeaningKey: health.conceptKey,
      surfaceText: health.surfaceText,
      resolutionStatus: 'resolved',
    });
  }

  if (location) {
    filterSeq += 1;
    filters.push({
      filterId: `f-loc-${filterSeq}`,
      conceptKey: null,
      surfaceMeaningKey: location.surfaceMeaningKey,
      surfaceText: location.surfaceText,
      operator: 'like',
      value: { kind: 'literal', text: location.surfaceText },
      resolutionStatus: 'unresolved',
      temporalMeaning: null,
    });
    markCap('filter_like', recognized, unsupported);
  }

  if (dept) {
    const c = buildClarificationFromCatalog('department', configs.language);
    if (c) clarifications.push(c);
  }

  if (parsed.temporalKind === 'current') markCap('current_record', recognized, unsupported);
  if (parsed.temporalKind === 'history') markCap('history', recognized, unsupported);
  if (parsed.temporalKind === 'as_of') markCap('as_of', recognized, unsupported);
  if (parsed.temporalKind === 'date_range') markCap('filter_date_range', recognized, unsupported);

  const groupBy: LogicalRequestedField[] = [];
  if (parsed.wantsCount) markCap('aggregate_count', recognized, unsupported);
  if (parsed.wantsGroupBy) {
    markCap('group_by', recognized, unsupported);
    if (dept) {
      groupBy.push({
        conceptKey: null,
        surfaceMeaningKey: dept.surfaceMeaningKey,
        surfaceText: dept.surfaceText,
        resolutionStatus: 'ambiguous',
        role: 'grouping',
      });
    }
  }

  if (parsed.topN != null) markCap('top_n', recognized, unsupported);
  const ordering: LogicalReadonlyRequest['ordering'] = [];
  if (parsed.wantsNewestOrdering) {
    markCap('ordering', recognized, unsupported);
    const newestSurface = configs.language.requestShapeMarkers.newest?.[0] ?? '';
    ordering.push({
      conceptKey: contracts?.conceptKey ?? null,
      surfaceMeaningKey: contracts?.conceptKey ?? null,
      surfaceText: newestSurface,
      direction: 'descending' as const,
      resolutionStatus: 'unresolved' as const,
    });
  }

  if (filters.length > 1) markCap('boolean_and', recognized, unsupported);

  let answerShape: LogicalReadonlyRequest['answerShape'] = 'unknown';
  if (parsed.wantsCount || parsed.wantsGroupBy) answerShape = 'aggregate';
  else if (parsed.temporalKind === 'history') answerShape = 'list';
  else if (parsed.markers.includes('show') || parsed.markers.includes('which')) {
    if (requestedFields.length && parsed.identityRawTexts.length) {
      answerShape = 'single_value';
    } else answerShape = 'list';
  }
  if (ou && employee) answerShape = 'table';
  if (compensation) answerShape = 'single_value';

  let interpretationStatus: InterpretationStatus = 'resolved';
  let capabilityStatus: CapabilitySupportLevel = 'supported';

  if (clarifications.length) interpretationStatus = 'needs_clarification';
  if (location) interpretationStatus = interpretationStatus === 'resolved' ? 'unresolved' : interpretationStatus;
  if (contracts && parsed.topN != null) interpretationStatus = 'unresolved';

  if (
    !employee &&
    !position &&
    !ou &&
    !contracts &&
    !compensation &&
    !dept &&
    !location &&
    !health &&
    !parsed.wantsCount &&
    parsed.identityRawTexts.length === 0
  ) {
    interpretationStatus = 'unresolved';
  }

  if (unsupported.length > 0) {
    capabilityStatus = recognized.some((c) => getCapabilityStatus(c) === 'supported_now')
      ? 'partially_supported'
      : 'unsupported';
  }
  // If any unsupported capability recognized, overall not execution-ready
  if (unsupported.length > 0) capabilityStatus = 'unsupported';

  // Clarification / unresolved interpretation must not advertise execution readiness
  if (
    (interpretationStatus === 'needs_clarification' || interpretationStatus === 'unresolved') &&
    capabilityStatus === 'supported'
  ) {
    capabilityStatus = 'unsupported';
  }

  if (parsed.temporalKind === 'history') {
    capabilityStatus = 'unsupported';
    evidenceHints.push({
      kind: 'capability',
      ref: 'history',
      note: 'History recognized; position-history subject not approved for generic path',
    });
  }
  if (contracts && parsed.topN != null) {
    capabilityStatus = 'unsupported';
    evidenceHints.push({
      kind: 'capability',
      ref: 'top_n',
      note: 'Top-N recognized; employment_contract list subject unresolved for generic path',
    });
  }
  if (ou && employee && !clarifications.length && !location && parsed.temporalKind !== 'history') {
    // interpreted, but filter_equals unsupported downstream
    if (interpretationStatus === 'resolved') {
      /* keep */
    }
    evidenceHints.push({
      kind: 'lexicon',
      ref: 'organizational_unit',
      note: 'Logical OU filter recognized; Stage 3C execution not opened in 3K.1',
    });
  }

  for (const c of parsed.canonicalConcepts) {
    evidenceHints.push({ kind: 'lexicon', ref: c.conceptKey, note: `matched:${c.surfaceText}` });
  }
  for (const s of parsed.surfaceMeanings) {
    evidenceHints.push({
      kind: 'lexicon',
      ref: s.surfaceMeaningKey,
      note: `surface:${s.surfaceText}`,
    });
  }

  const status = deriveLegacyStatus(interpretationStatus, capabilityStatus);

  const draft: Omit<
    LogicalReadonlyRequest,
    | 'logicalRequestFingerprintSha256'
    | 'requestId'
    | 'inputFingerprintSha256'
    | 'semanticFingerprintSha256'
  > = {
    contractVersion: STAGE3K1_CONTRACT_VERSION,
    intent: STAGE3K1_INTENT,
    rootEntity,
    requestedFields,
    filters,
    relations,
    temporalScope: {
      kind: parsed.temporalKind,
      value: parsed.temporalValue,
      resolutionStatus: 'resolved',
      surfaceText: parsed.temporalSurface,
    },
    aggregation: {
      requested: parsed.wantsCount || parsed.wantsGroupBy,
      operations: parsed.wantsCount ? ['count'] : [],
      groupBy,
    },
    ordering,
    limit: parsed.topN,
    answerShape,
    interpretationStatus,
    capabilityStatus,
    status,
    clarifications,
    unsupportedCapabilities: unsupported,
    recognizedCapabilities: recognized,
    routingDecision,
    evidenceHints,
    legacyLlmSqlFallbackPolicy: LEGACY_LLM_SQL_FENCE_POLICY,
  };

  const semanticFingerprintSha256 = computeSemanticFingerprint(draft);
  return {
    ...draft,
    requestId,
    inputFingerprintSha256: inputFingerprint,
    semanticFingerprintSha256,
    logicalRequestFingerprintSha256: semanticFingerprintSha256,
  };
}

export function analyzeGenericQuery(
  query: string,
  configs: Stage3k1Configs,
): GenericQueryAnalysisResult {
  const queryNormalized = normalizePolishQuery(query, configs.language);
  const inputFingerprintSha256 = computeInputFingerprint(queryNormalized, configVersions(configs));
  const requestId = makeRequestId(inputFingerprintSha256);
  const { decision, rejection } = resolveRoutingWinner(query, configs.language, configs.routing);

  if (rejection || decision.winner === 'rejected') {
    return {
      contractVersion: STAGE3K1_ANALYSIS_CONTRACT_VERSION,
      analysisKind: 'rejected',
      requestId,
      inputFingerprintSha256,
      queryNormalized,
      routingDecision: decision,
      interpretationStatus: 'rejected',
      capabilityStatus: 'not_applicable',
      executionEligibility: 'blocked',
      logicalRequest: null,
      mutationRejected: rejection?.kind === 'mutation',
      rawSqlRejected: rejection?.kind === 'raw_sql',
      promptInjectionRejected: rejection?.kind === 'prompt_injection',
      legacyLlmSqlFallbackPolicy: LEGACY_LLM_SQL_FENCE_POLICY,
    };
  }

  if (
    decision.winner === 'dedicated_deterministic_engine' ||
    decision.winner === 'payroll_engine' ||
    decision.winner === 'application_help' ||
    decision.winner === 'runtime_knowledge_3j2f'
  ) {
    return {
      contractVersion: STAGE3K1_ANALYSIS_CONTRACT_VERSION,
      analysisKind: 'delegated',
      requestId,
      inputFingerprintSha256,
      queryNormalized,
      routingDecision: decision,
      interpretationStatus: 'delegated',
      capabilityStatus: 'not_applicable',
      executionEligibility: 'not_applicable',
      logicalRequest: null,
      mutationRejected: false,
      rawSqlRejected: false,
      promptInjectionRejected: false,
      legacyLlmSqlFallbackPolicy: LEGACY_LLM_SQL_FENCE_POLICY,
    };
  }

  const logicalRequest = buildGenericLogicalRequest(
    query,
    configs,
    decision,
    inputFingerprintSha256,
    requestId,
  );

  return {
    contractVersion: STAGE3K1_ANALYSIS_CONTRACT_VERSION,
    analysisKind: 'generic',
    requestId,
    inputFingerprintSha256,
    queryNormalized,
    routingDecision: decision,
    interpretationStatus: logicalRequest.interpretationStatus,
    capabilityStatus: logicalRequest.capabilityStatus,
    executionEligibility: 'not_evaluated',
    logicalRequest,
    mutationRejected: false,
    rawSqlRejected: false,
    promptInjectionRejected: false,
    legacyLlmSqlFallbackPolicy: LEGACY_LLM_SQL_FENCE_POLICY,
  };
}

/** @deprecated Prefer analyzeGenericQuery — kept for build-request CLI convenience. */
export function buildLogicalReadonlyRequest(
  query: string,
  configs: Stage3k1Configs,
): LogicalReadonlyRequest | null {
  return analyzeGenericQuery(query, configs).logicalRequest;
}
