import type { GenericQueryAnalysisResult } from '../teta-generic-query/teta-logical-readonly-request.types';
import type { LogicalReadonlyRequest } from '../teta-generic-query/teta-logical-readonly-request.types';
import { STAGE3K1_CONTRACT_VERSION } from '../teta-generic-query/teta-logical-readonly-request.types';
import {
  STAGE3D_BINDINGS_VERSION,
  STAGE3D_LANGUAGE_VERSION,
  STAGE3D_ONTOLOGY_VERSION,
  type SemanticSourceBinding,
} from '../teta-business-semantics/teta-business-semantics.types';
import {
  clarificationCompensation,
  clarificationDepartment,
  clarificationEmploymentDate,
  clarificationTwoApprovedCandidates,
  evidenceFromReuse,
} from './teta-semantic-clarification.service';
import {
  isPlanningReadyReuse,
  resolveApprovalReuse,
  SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY,
  type Stage3k2aConfigs,
} from './teta-generic-semantic-binding.policy';
import {
  computeSemanticBindingInputFingerprint,
  computeSemanticBindingResultFingerprint,
} from './teta-semantic-binding-fingerprint';
import { withPlanningEligibility, derivePlanningReadiness } from './teta-generic-semantic-binding.contract';
import type {
  ApprovalReuseStatus,
  DependencyVector,
  GraphEvidenceValidator,
  SemanticBindingStatus,
  TetaGenericSemanticBindingResult,
  TetaSemanticElementBinding,
  TetaSemanticEvidenceTrace,
  TetaSemanticClarification,
  SemanticReusePolicyFile,
} from './teta-generic-semantic-binding.types';
import {
  STAGE3K2A_CONTRACT_VERSION,
  STAGE3K2A_REUSE_POLICY_VERSION,
} from './teta-generic-semantic-binding.types';

const BHP_SUBJECT = 'occupational_health_examinations';

export type TemporalLogicalTarget =
  | 'current_position'
  | 'health_examination_currentness'
  | 'employment_current'
  | 'location_current'
  | 'position_history'
  | 'unspecified_current'
  | 'none';

export type BindOptions = {
  configs: Stage3k2aConfigs;
  graph?: GraphEvidenceValidator | null;
  overrideGraphSourceHash?: string;
  /** S4 — uses SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY through resolveApprovalReuse. */
  forceTwoCandidateClarification?: boolean;
  fixturePolicyOverride?: SemanticReusePolicyFile;
  /** S3 — inject opaque discovered diagnostic into evidence trace only. */
  injectDiscoveredDiagnostic?: boolean;
  freeGraphDiscoveryAttempts?: number;
  shortestPathAutoSelections?: number;
};

export type BindOutput = {
  result: TetaGenericSemanticBindingResult;
  evidenceTrace: TetaSemanticEvidenceTrace;
  counters: BindCounters;
};

export type BindCounters = {
  freeGraphDiscoveryAttempts: number;
  shortestPathAutoSelections: number;
  bhpSubjectPromotedToGeneric: number;
  bhpOuPathPromotedToGeneric: number;
  currentPositionUsedAsHistory: number;
  currentMonthExamUsedAsNegativeExistence: number;
  discoveredBindingsUsedForPlanning: number;
  unapprovedBindingsUsedForPlanning: number;
  newCanonicalConceptsIntroduced: number;
  newOracleMappingsIntroduced: number;
  temporalBindingsAttachedToWrongLogicalTarget: number;
  approvedBindingsRemainingFreshAfterDependencyMismatch: number;
  discoveredCandidatesObserved: number;
  discoveredCandidatesRetainedForDiagnostics: number;
  discoveredCandidatesExposedInRuntime: number;
  discoveredBindingsMarkedPlanningEligible: number;
  syntheticReusableRolesBypassingPolicyEvaluator: number;
};

function emptyCounters(extra?: Partial<BindCounters>): BindCounters {
  return {
    freeGraphDiscoveryAttempts: 0,
    shortestPathAutoSelections: 0,
    bhpSubjectPromotedToGeneric: 0,
    bhpOuPathPromotedToGeneric: 0,
    currentPositionUsedAsHistory: 0,
    currentMonthExamUsedAsNegativeExistence: 0,
    discoveredBindingsUsedForPlanning: 0,
    unapprovedBindingsUsedForPlanning: 0,
    newCanonicalConceptsIntroduced: 0,
    newOracleMappingsIntroduced: 0,
    temporalBindingsAttachedToWrongLogicalTarget: 0,
    approvedBindingsRemainingFreshAfterDependencyMismatch: 0,
    discoveredCandidatesObserved: 0,
    discoveredCandidatesRetainedForDiagnostics: 0,
    discoveredCandidatesExposedInRuntime: 0,
    discoveredBindingsMarkedPlanningEligible: 0,
    syntheticReusableRolesBypassingPolicyEvaluator: 0,
    ...extra,
  };
}

function findSource(configs: Stage3k2aConfigs, role: string): SemanticSourceBinding | null {
  const subj = configs.bindings.subjects.find((s) => s.subject === BHP_SUBJECT);
  return subj?.sources.find((s) => s.role === role) ?? null;
}

function findProjection(configs: Stage3k2aConfigs, role: string) {
  const subj = configs.bindings.subjects.find((s) => s.subject === BHP_SUBJECT);
  return subj?.projections.find((s) => s.role === role) ?? null;
}

function findTemporal(configs: Stage3k2aConfigs, role: string) {
  const subj = configs.bindings.subjects.find((s) => s.subject === BHP_SUBJECT);
  return subj?.temporals.find((s) => s.role === role) ?? null;
}

function findValuePath(configs: Stage3k2aConfigs, role: string) {
  const subj = configs.bindings.subjects.find((s) => s.subject === BHP_SUBJECT);
  return subj?.valuePaths.find((s) => s.role === role) ?? null;
}

function buildElement(args: {
  logicalElementId: string;
  surfaceText: string;
  surfaceMeaningKey: string | null;
  requestedConceptKey: string | null;
  resolvedRoleKey: string | null;
  reuse: ApprovalReuseStatus;
  bindingStatus: SemanticBindingStatus;
  warnings?: string[];
  temporalSemantics?: string | null;
  temporalLogicalTarget?: string | null;
  relationUsage?: TetaSemanticElementBinding['relationUsage'];
  valueKind?: TetaSemanticElementBinding['valueKind'];
  approvedBindingRefs?: string[];
  dependencyIndependent?: boolean;
  selectionRequired?: boolean;
}): TetaSemanticElementBinding {
  const planning = isPlanningReadyReuse(args.reuse);
  const base = {
    logicalElementId: args.logicalElementId,
    surfaceText: args.surfaceText,
    surfaceMeaningKey: args.surfaceMeaningKey,
    requestedConceptKey: args.requestedConceptKey,
    resolvedBusinessConceptKey: args.resolvedRoleKey,
    resolvedRoleKey: args.resolvedRoleKey,
    bindingStatus: args.bindingStatus,
    evidenceStatus: evidenceFromReuse(args.reuse),
    approvalReuseStatus: args.reuse,
    selectionRequired: args.selectionRequired ?? false,
    applicability: {
      subjectScope: BHP_SUBJECT,
      genericReuseAllowed: planning,
    },
    temporalSemantics: args.temporalSemantics ?? null,
    temporalLogicalTarget: args.temporalLogicalTarget ?? null,
    relationUsage: args.relationUsage ?? null,
    valueKind: args.valueKind ?? null,
    approvedBindingRefs: args.approvedBindingRefs ?? [],
    dependencyIndependent: args.dependencyIndependent ?? false,
    requiredAuthorizationScopes: [] as string[],
    requiredDataDomains: [] as string[],
    warnings: [...(args.warnings ?? []), ...(planning ? [] : ['auth_status_not_evaluated'])],
  };
  return withPlanningEligibility(base);
}

function applyStaleAndGraph(
  el: TetaSemanticElementBinding,
  stale: boolean,
  graph: GraphEvidenceValidator | null | undefined,
  nodeId: string | null,
  trace: TetaSemanticEvidenceTrace,
): TetaSemanticElementBinding {
  let next = { ...el };
  if (nodeId) {
    trace.graphNodeIds.push(nodeId);
    if (graph && !graph.nodeExists(nodeId)) {
      next = {
        ...next,
        bindingStatus: 'invalid',
        evidenceStatus: 'missing',
        warnings: [...next.warnings, 'approved_binding_node_missing_in_graph'],
      };
      trace.validationReasons.push(`missing_node:${nodeId}`);
    }
  }
  if (stale && !next.dependencyIndependent && isDependencyBoundElement(next)) {
    next = markStale(next);
    trace.validationReasons.push('stale_graph_hash');
  }
  return withPlanningEligibility(next);
}

function isDependencyBoundElement(el: TetaSemanticElementBinding): boolean {
  if (el.dependencyIndependent) return false;
  if (el.approvedBindingRefs.length > 0) return true;
  return (
    el.approvalReuseStatus === 'approved_exact_scope' ||
    el.approvalReuseStatus === 'approved_reusable_role' ||
    el.approvalReuseStatus === 'approved_scope_restricted' ||
    el.approvalReuseStatus === 'approved_scope_mismatch'
  );
}

function markStale(el: TetaSemanticElementBinding): TetaSemanticElementBinding {
  let evidenceStatus = el.evidenceStatus;
  if (evidenceStatus === 'proven') evidenceStatus = 'partial';
  return withPlanningEligibility({
    ...el,
    bindingStatus: 'stale',
    evidenceStatus,
    warnings: el.warnings.includes('graphSourceHash_mismatch_stale')
      ? el.warnings
      : [...el.warnings, 'graphSourceHash_mismatch_stale'],
  });
}

/** Propagate graphSourceHash mismatch to every Stage3D-derived dependency-bound element. */
function propagateStaleness(
  els: Array<TetaSemanticElementBinding | null>,
  stale: boolean,
  counters: BindCounters,
): Array<TetaSemanticElementBinding | null> {
  if (!stale) return els;
  return els.map((el) => {
    if (!el) return el;
    if (!isDependencyBoundElement(el)) return el;
    if (el.bindingStatus === 'unresolved' && el.approvedBindingRefs.length === 0) return el;
    // Already invalid from missing node — keep invalid (distinct from hash mismatch)
    if (el.bindingStatus === 'invalid') return el;
    if (el.bindingStatus !== 'stale' && (el.bindingStatus === 'approved' || el.approvedBindingRefs.length > 0)) {
      // Fresh approved remaining after mismatch would be counted as error later
    }
    return markStale(el);
  });
}

export function inferTemporalLogicalTarget(req: LogicalReadonlyRequest): TemporalLogicalTarget {
  if (req.temporalScope.kind === 'history') return 'position_history';
  if (req.temporalScope.kind !== 'current' && req.temporalScope.kind !== 'unspecified') {
    return 'none';
  }

  const wantsPosition = req.requestedFields.some(
    (f) => f.conceptKey === 'position' || f.surfaceMeaningKey === 'position',
  );
  const hasHealthRelation = req.relations.some((r) => r.conceptKey === 'health_examination');
  const hasHealthNeg = req.filters.some(
    (f) => f.operator === 'existence_absent' && f.conceptKey === 'health_examination',
  );
  const hasHealthCurrentFilter = req.filters.some(
    (f) =>
      f.surfaceMeaningKey === 'health_examination_currentness' ||
      (f.conceptKey === 'health_examination' && f.temporalMeaning === 'current'),
  );
  const hasEmployment =
    req.rootEntity.conceptKey === 'employment_contract' ||
    req.filters.some((f) => f.surfaceMeaningKey === 'employment_date') ||
    req.requestedFields.some(
      (f) =>
        f.surfaceMeaningKey === 'employment_contract' || f.conceptKey === 'employment_contract',
    );
  const hasLocation = req.filters.some((f) => f.surfaceMeaningKey === 'location');

  // Health exam currentness / negative existence — never current_position
  if (
    (hasHealthNeg || hasHealthCurrentFilter || (hasHealthRelation && !wantsPosition)) &&
    (req.temporalScope.kind === 'current' || hasHealthNeg)
  ) {
    return 'health_examination_currentness';
  }
  if (hasEmployment && !wantsPosition && req.temporalScope.kind === 'current') {
    return 'employment_current';
  }
  if (hasLocation && !wantsPosition && req.temporalScope.kind === 'current') {
    return 'location_current';
  }
  if (wantsPosition && req.temporalScope.kind === 'current') return 'current_position';
  if (req.temporalScope.kind === 'current') return 'unspecified_current';
  return 'none';
}

function classifyIdentitySurface(raw: string): {
  slot: 'employee_identity.name' | 'employee_identity.employee_number' | 'employee_identity.internal_id';
  surfaceMeaningKey: string;
} {
  const t = raw.trim();
  if (/^0\d+$/.test(t) || /^\d{3,}$/.test(t)) {
    return { slot: 'employee_identity.employee_number', surfaceMeaningKey: 'employee_identity.employee_number' };
  }
  if (/^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+(\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)+$/.test(t)) {
    return { slot: 'employee_identity.name', surfaceMeaningKey: 'employee_identity.name' };
  }
  return { slot: 'employee_identity.name', surfaceMeaningKey: 'employee_identity.name' };
}

function emptyDraft(
  partial: Omit<
    TetaGenericSemanticBindingResult,
    'semanticBindingInputFingerprint' | 'semanticBindingResultFingerprint'
  >,
): Omit<
  TetaGenericSemanticBindingResult,
  'semanticBindingInputFingerprint' | 'semanticBindingResultFingerprint'
> {
  return partial;
}

export function bindFromAnalysis(
  analysis: GenericQueryAnalysisResult,
  options: BindOptions,
): BindOutput {
  const { configs } = options;
  const counters = emptyCounters({
    freeGraphDiscoveryAttempts: options.freeGraphDiscoveryAttempts ?? 0,
    shortestPathAutoSelections: options.shortestPathAutoSelections ?? 0,
  });

  const expectedHash = configs.bindings.graphSourceHash;
  const effectiveHash = options.overrideGraphSourceHash ?? expectedHash;
  const stale = effectiveHash !== expectedHash;

  const dependencyVector: DependencyVector = {
    graphSourceHash: effectiveHash,
    ontologyVersion: STAGE3D_ONTOLOGY_VERSION,
    semanticBindingsVersion: STAGE3D_BINDINGS_VERSION,
    businessLanguageVersion: STAGE3D_LANGUAGE_VERSION,
    lexiconVersion: null,
    stage3k1ContractVersion: STAGE3K1_CONTRACT_VERSION,
    stage3k2BindingContractVersion: STAGE3K2A_CONTRACT_VERSION,
    semanticReusePolicyVersion: STAGE3K2A_REUSE_POLICY_VERSION,
  };

  const sourceAnalysisFingerprint =
    analysis.logicalRequest?.semanticFingerprintSha256 ?? analysis.inputFingerprintSha256;

  const inputFingerprint = computeSemanticBindingInputFingerprint({
    sourceAnalysisFingerprint,
    policyVersion: configs.reusePolicy.version,
    dependencyVector,
  });

  const trace: TetaSemanticEvidenceTrace = {
    contractVersion: STAGE3K2A_CONTRACT_VERSION,
    graphSourceHash: options.graph?.graphSourceHash ?? effectiveHash,
    expectedGraphSourceHash: expectedHash,
    stage3dBindingRefs: [],
    graphNodeIds: [],
    graphEdgeIds: [],
    graphPathIds: [],
    conflicts: [],
    validationReasons: [],
    diagnosticCandidates: [],
  };

  if (options.injectDiscoveredDiagnostic) {
    counters.discoveredCandidatesObserved = 1;
    counters.discoveredCandidatesRetainedForDiagnostics = 1;
    counters.discoveredCandidatesExposedInRuntime = 0;
    counters.discoveredBindingsUsedForPlanning = 0;
    counters.discoveredBindingsMarkedPlanningEligible = 0;
    trace.diagnosticCandidates.push({
      diagnosticId: 'synthetic_discovered_s3',
      status: 'discovered',
      opaque: true,
      retainedForDiagnostics: true,
      exposedInRuntime: false,
      usedForPlanning: false,
    });
    trace.validationReasons.push('discovered_candidate_diagnostics_only');
  }

  const finish = (
    draft: Omit<
      TetaGenericSemanticBindingResult,
      'semanticBindingInputFingerprint' | 'semanticBindingResultFingerprint'
    >,
  ): BindOutput => ({
    result: {
      ...draft,
      semanticBindingInputFingerprint: inputFingerprint,
      semanticBindingResultFingerprint: computeSemanticBindingResultFingerprint(draft),
    },
    evidenceTrace: trace,
    counters,
  });

  if (analysis.analysisKind === 'delegated') {
    return finish(
      emptyDraft({
        contractVersion: STAGE3K2A_CONTRACT_VERSION,
        sourceAnalysisFingerprint,
        resultStatus: 'delegated',
        rootBinding: null,
        fieldBindings: [],
        filterBindings: [],
        relationBindings: [],
        temporalBinding: null,
        aggregationTargets: [],
        orderingTarget: null,
        resultGrain: null,
        clarifications: [],
        warnings: ['delegated_no_semantic_binding'],
        executionEligibility: 'not_applicable',
        planningReadiness: 'not_applicable',
        dependencyVector,
      }),
    );
  }

  if (analysis.analysisKind === 'rejected') {
    return finish(
      emptyDraft({
        contractVersion: STAGE3K2A_CONTRACT_VERSION,
        sourceAnalysisFingerprint,
        resultStatus: 'rejected',
        rootBinding: null,
        fieldBindings: [],
        filterBindings: [],
        relationBindings: [],
        temporalBinding: null,
        aggregationTargets: [],
        orderingTarget: null,
        resultGrain: null,
        clarifications: [],
        warnings: ['rejected_no_semantic_binding'],
        executionEligibility: 'blocked',
        planningReadiness: 'blocked',
        dependencyVector,
      }),
    );
  }

  const req = analysis.logicalRequest;
  if (!req) {
    return finish(
      emptyDraft({
        contractVersion: STAGE3K2A_CONTRACT_VERSION,
        sourceAnalysisFingerprint,
        resultStatus: 'unresolved',
        rootBinding: null,
        fieldBindings: [],
        filterBindings: [],
        relationBindings: [],
        temporalBinding: null,
        aggregationTargets: [],
        orderingTarget: null,
        resultGrain: null,
        clarifications: [],
        warnings: ['missing_logical_request'],
        executionEligibility: 'not_evaluated',
        planningReadiness: 'blocked',
        dependencyVector,
      }),
    );
  }

  const clarifications: TetaSemanticClarification[] = [];
  const fieldBindings: TetaSemanticElementBinding[] = [];
  const filterBindings: TetaSemanticElementBinding[] = [];
  const relationBindings: TetaSemanticElementBinding[] = [];
  const aggregationTargets: TetaSemanticElementBinding[] = [];
  let orderingTarget: TetaSemanticElementBinding | null = null;
  let temporalBinding: TetaSemanticElementBinding | null = null;
  const warnings: string[] = [];

  // Root
  let rootBinding: TetaSemanticElementBinding | null = null;
  const rootKey = req.rootEntity.conceptKey;
  if (rootKey === 'employee') {
    const src = findSource(configs, 'employee');
    const reuse = resolveApprovalReuse('employee', BHP_SUBJECT, configs.reusePolicy);
    let el = buildElement({
      logicalElementId: 'root:employee',
      surfaceText: req.rootEntity.surfaceText,
      surfaceMeaningKey: req.rootEntity.surfaceMeaningKey,
      requestedConceptKey: 'employee',
      resolvedRoleKey: src ? 'employee' : null,
      reuse: src ? reuse : 'not_approved',
      bindingStatus: src ? (src.status as SemanticBindingStatus) : 'unresolved',
      approvedBindingRefs: src ? [`stage3d:${BHP_SUBJECT}:source:employee`] : [],
    });
    if (src) {
      trace.stage3dBindingRefs.push(`source:employee`);
      el = applyStaleAndGraph(el, false, options.graph, src.logicalObjectNodeId, trace);
    }
    rootBinding = el;
  } else if (rootKey === 'employment_contract') {
    rootBinding = buildElement({
      logicalElementId: 'root:employment_contract',
      surfaceText: req.rootEntity.surfaceText,
      surfaceMeaningKey: req.rootEntity.surfaceMeaningKey,
      requestedConceptKey: 'employment_contract',
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      warnings: ['employment_contract_not_generic_subject'],
    });
  } else if (rootKey) {
    rootBinding = buildElement({
      logicalElementId: `root:${rootKey}`,
      surfaceText: req.rootEntity.surfaceText,
      surfaceMeaningKey: req.rootEntity.surfaceMeaningKey,
      requestedConceptKey: rootKey,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
    });
  }

  // Fields
  for (const f of req.requestedFields) {
    if (f.conceptKey === 'position' || f.surfaceMeaningKey === 'position') {
      if (req.temporalScope.kind === 'history') {
        fieldBindings.push(
          buildElement({
            logicalElementId: `field:position_history:${f.surfaceText}`,
            surfaceText: f.surfaceText,
            surfaceMeaningKey: f.surfaceMeaningKey,
            requestedConceptKey: 'position_history',
            resolvedRoleKey: null,
            reuse: 'not_approved',
            bindingStatus: 'unresolved',
            warnings: [
              'current_position_non_applicable_for_history',
              'position_history_binding_unresolved',
            ],
            temporalSemantics: 'history',
            temporalLogicalTarget: 'position_history',
          }),
        );
        continue;
      }
      const proj = findProjection(configs, 'position_name');
      const src = findSource(configs, 'current_position');
      const reuse = resolveApprovalReuse('current_position', BHP_SUBJECT, configs.reusePolicy);
      const vpReuse = resolveApprovalReuse('position_name', BHP_SUBJECT, configs.reusePolicy);
      let el = buildElement({
        logicalElementId: `field:position:${f.surfaceText}`,
        surfaceText: f.surfaceText,
        surfaceMeaningKey: f.surfaceMeaningKey,
        requestedConceptKey: f.conceptKey,
        resolvedRoleKey: 'current_position',
        reuse,
        bindingStatus: src ? (src.status as SemanticBindingStatus) : 'unresolved',
        valueKind: proj ? 'display_business_value' : 'business_value',
        approvedBindingRefs: [
          ...(src ? [`stage3d:${BHP_SUBJECT}:source:current_position`] : []),
          ...(proj ? [`stage3d:${BHP_SUBJECT}:projection:position_name`] : []),
        ],
        warnings: [
          'mapped_to_current_position_not_generic_position',
          ...(vpReuse === 'approved_scope_restricted' ? ['display_path_scope_restricted'] : []),
        ],
        temporalSemantics: 'current',
        temporalLogicalTarget: 'current_position',
      });
      if (src) {
        trace.stage3dBindingRefs.push('source:current_position');
        el = applyStaleAndGraph(el, false, options.graph, src.logicalObjectNodeId, trace);
      }
      if (findValuePath(configs, 'position_name')) {
        trace.stage3dBindingRefs.push('valuePath:position_name');
      }
      fieldBindings.push(el);
    } else if (f.surfaceMeaningKey === 'compensation') {
      fieldBindings.push(
        buildElement({
          logicalElementId: `field:compensation`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: 'compensation',
          requestedConceptKey: null,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
          warnings: ['compensation_no_schema_binding'],
        }),
      );
      clarifications.push(clarificationCompensation());
    } else {
      fieldBindings.push(
        buildElement({
          logicalElementId: `field:${f.surfaceMeaningKey ?? f.conceptKey ?? 'unknown'}`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: f.surfaceMeaningKey,
          requestedConceptKey: f.conceptKey,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
        }),
      );
    }
  }

  // Filters
  for (const f of req.filters) {
    if (f.operator === 'matches_identity' && f.value.kind === 'identity') {
      const raw = f.value.rawText;
      const id = classifyIdentitySurface(raw);
      const numProj = findProjection(configs, 'employee_number');
      const reuse = resolveApprovalReuse('employee_number', BHP_SUBJECT, configs.reusePolicy);
      let el = buildElement({
        logicalElementId: `filter:identity:${raw}`,
        surfaceText: raw,
        surfaceMeaningKey: id.surfaceMeaningKey,
        requestedConceptKey: null,
        resolvedRoleKey:
          id.slot === 'employee_identity.employee_number' && numProj ? 'employee_number' : null,
        reuse: id.slot === 'employee_identity.employee_number' && numProj ? reuse : 'not_approved',
        bindingStatus:
          id.slot === 'employee_identity.employee_number' && numProj
            ? (numProj.status as SemanticBindingStatus)
            : 'unresolved',
        valueKind: 'business_value',
        warnings:
          id.slot === 'employee_identity.employee_number'
            ? ['leading_zero_preserved_as_string']
            : ['identity_name_unbound_formally'],
        approvedBindingRefs:
          id.slot === 'employee_identity.employee_number' && numProj
            ? [`stage3d:${BHP_SUBJECT}:projection:employee_number`]
            : [],
      });
      if (/^0\d+$/.test(raw.trim()) && id.slot !== 'employee_identity.employee_number') {
        el = withPlanningEligibility({ ...el, warnings: [...el.warnings, 'identity_slot_error'] });
      }
      if (numProj && id.slot === 'employee_identity.employee_number') {
        // projections may not have node ids — still Stage3D-derived via refs
        el = applyStaleAndGraph(el, false, options.graph, null, trace);
      }
      filterBindings.push(el);
    } else if (f.surfaceMeaningKey === 'location') {
      filterBindings.push(
        buildElement({
          logicalElementId: `filter:location`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: 'location',
          requestedConceptKey: null,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
          warnings: ['location_no_approved_semantics_no_graph_search'],
        }),
      );
    } else if (f.surfaceMeaningKey === 'employment_date') {
      filterBindings.push(
        buildElement({
          logicalElementId: `filter:employment_date`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: 'employment_date',
          requestedConceptKey: null,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
        }),
      );
      clarifications.push(clarificationEmploymentDate());
      const active = findSource(configs, 'active_employment');
      if (active) {
        const reuse = resolveApprovalReuse('active_employment', BHP_SUBJECT, configs.reusePolicy);
        let el = buildElement({
          logicalElementId: 'filter:active_employment_support',
          surfaceText: 'active_employment',
          surfaceMeaningKey: null,
          requestedConceptKey: 'active_employment',
          resolvedRoleKey: 'active_employment',
          reuse,
          bindingStatus: active.status as SemanticBindingStatus,
          relationUsage: 'filter_only',
          approvedBindingRefs: [`stage3d:${BHP_SUBJECT}:source:active_employment`],
          warnings: ['active_employment_filter_only_not_employment_date'],
        });
        el = applyStaleAndGraph(el, false, options.graph, active.logicalObjectNodeId, trace);
        filterBindings.push(el);
        trace.stage3dBindingRefs.push('source:active_employment');
      }
    } else if (f.conceptKey === 'organizational_unit' || f.surfaceMeaningKey === 'organizational_unit') {
      filterBindings.push(
        buildElement({
          logicalElementId: `filter:ou`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: 'organizational_unit',
          requestedConceptKey: 'organizational_unit',
          resolvedRoleKey: null,
          reuse: 'approved_scope_restricted',
          bindingStatus: 'unresolved',
          relationUsage: 'filter_only',
          warnings: ['generic_employee_to_ou_not_approved', 'bhp_ou_via_position_not_used'],
        }),
      );
    } else if (f.operator === 'existence_absent' && f.conceptKey === 'health_examination') {
      const src = findSource(configs, 'health_examination');
      const reuse = resolveApprovalReuse('health_examination', BHP_SUBJECT, configs.reusePolicy);
      let el = buildElement({
        logicalElementId: 'filter:neg_health_exam',
        surfaceText: f.surfaceText,
        surfaceMeaningKey: 'health_examination',
        requestedConceptKey: 'health_examination',
        resolvedRoleKey: src ? 'health_examination' : null,
        reuse: src ? reuse : 'not_approved',
        bindingStatus: src ? (src.status as SemanticBindingStatus) : 'unresolved',
        warnings: [
          'negative_existence_not_bound',
          'current_month_exam_validity_not_used_as_negative_existence',
        ],
        approvedBindingRefs: src ? [`stage3d:${BHP_SUBJECT}:source:health_examination`] : [],
      });
      if (src) {
        el = applyStaleAndGraph(el, false, options.graph, src.logicalObjectNodeId, trace);
        trace.stage3dBindingRefs.push('source:health_examination');
      }
      filterBindings.push(el);
      filterBindings.push(
        buildElement({
          logicalElementId: 'filter:neg_existence_currentness',
          surfaceText: 'bez aktualnych',
          surfaceMeaningKey: 'health_examination_currentness',
          requestedConceptKey: null,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
          temporalLogicalTarget: 'health_examination_currentness',
          warnings: ['no_current_exam_semantics_missing'],
        }),
      );
    } else {
      filterBindings.push(
        buildElement({
          logicalElementId: `filter:${f.filterId}`,
          surfaceText: f.surfaceText,
          surfaceMeaningKey: f.surfaceMeaningKey,
          requestedConceptKey: f.conceptKey,
          resolvedRoleKey: null,
          reuse: 'not_approved',
          bindingStatus: 'unresolved',
        }),
      );
    }
  }

  // Relations
  for (const r of req.relations) {
    if (r.conceptKey === 'organizational_unit') {
      relationBindings.push(
        buildElement({
          logicalElementId: 'relation:employee_ou',
          surfaceText: r.surfaceText,
          surfaceMeaningKey: 'organizational_unit',
          requestedConceptKey: 'organizational_unit',
          resolvedRoleKey: null,
          reuse: 'approved_scope_restricted',
          bindingStatus: 'unresolved',
          relationUsage: 'row_producing',
          warnings: ['bhp_ou_path_not_promoted_to_generic'],
        }),
      );
    } else if (r.conceptKey === 'health_examination') {
      const src = findSource(configs, 'health_examination');
      const reuse = resolveApprovalReuse('health_examination', BHP_SUBJECT, configs.reusePolicy);
      let el = buildElement({
        logicalElementId: 'relation:health_examination',
        surfaceText: r.surfaceText,
        surfaceMeaningKey: r.surfaceMeaningKey,
        requestedConceptKey: 'health_examination',
        resolvedRoleKey: 'health_examination',
        reuse: src ? reuse : 'not_approved',
        bindingStatus: src ? (src.status as SemanticBindingStatus) : 'unresolved',
        approvedBindingRefs: src ? [`stage3d:${BHP_SUBJECT}:source:health_examination`] : [],
      });
      if (src) el = applyStaleAndGraph(el, false, options.graph, src.logicalObjectNodeId, trace);
      relationBindings.push(el);
    } else if (r.conceptKey === 'active_employment') {
      const src = findSource(configs, 'active_employment');
      const reuse = resolveApprovalReuse('active_employment', BHP_SUBJECT, configs.reusePolicy);
      let el = buildElement({
        logicalElementId: 'relation:active_employment',
        surfaceText: r.surfaceText,
        surfaceMeaningKey: r.surfaceMeaningKey,
        requestedConceptKey: 'active_employment',
        resolvedRoleKey: 'active_employment',
        reuse: src ? reuse : 'not_approved',
        bindingStatus: src ? (src.status as SemanticBindingStatus) : 'unresolved',
        relationUsage: 'filter_only',
        approvedBindingRefs: src ? [`stage3d:${BHP_SUBJECT}:source:active_employment`] : [],
      });
      if (src) el = applyStaleAndGraph(el, false, options.graph, src.logicalObjectNodeId, trace);
      relationBindings.push(el);
    }
  }

  // Temporal — target-scoped (never global current → current_position)
  const temporalTarget = inferTemporalLogicalTarget(req);
  if (temporalTarget === 'position_history') {
    temporalBinding = buildElement({
      logicalElementId: 'temporal:history',
      surfaceText: req.temporalScope.surfaceText ?? 'historia',
      surfaceMeaningKey: null,
      requestedConceptKey: null,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      temporalSemantics: 'history',
      temporalLogicalTarget: 'position_history',
      warnings: ['current_position_not_used_as_history', 'position_history_missing'],
    });
  } else if (temporalTarget === 'health_examination_currentness') {
    temporalBinding = buildElement({
      logicalElementId: 'temporal:health_examination_currentness',
      surfaceText: req.temporalScope.surfaceText ?? 'aktualnych',
      surfaceMeaningKey: 'health_examination_currentness',
      requestedConceptKey: null,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      temporalSemantics: 'current',
      temporalLogicalTarget: 'health_examination_currentness',
      warnings: [
        'health_exam_currentness_unresolved',
        'current_position_temporal_not_applicable',
      ],
    });
    if (temporalBinding.resolvedRoleKey === 'current_position_on_oracle_sysdate') {
      counters.temporalBindingsAttachedToWrongLogicalTarget += 1;
    }
  } else if (temporalTarget === 'employment_current') {
    temporalBinding = buildElement({
      logicalElementId: 'temporal:employment_current',
      surfaceText: req.temporalScope.surfaceText ?? 'aktualna',
      surfaceMeaningKey: 'employment_current',
      requestedConceptKey: null,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      temporalSemantics: 'current',
      temporalLogicalTarget: 'employment_current',
      warnings: ['employment_current_temporal_unresolved', 'current_position_temporal_not_applicable'],
    });
  } else if (temporalTarget === 'location_current') {
    temporalBinding = buildElement({
      logicalElementId: 'temporal:location_current',
      surfaceText: req.temporalScope.surfaceText ?? 'aktualny',
      surfaceMeaningKey: 'location',
      requestedConceptKey: null,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      temporalSemantics: 'current',
      temporalLogicalTarget: 'location_current',
      warnings: ['location_current_temporal_unresolved', 'current_position_temporal_not_applicable'],
    });
  } else if (temporalTarget === 'current_position') {
    const t = findTemporal(configs, 'current_position_on_oracle_sysdate');
    const reuse = resolveApprovalReuse(
      'current_position_on_oracle_sysdate',
      BHP_SUBJECT,
      configs.reusePolicy,
    );
    temporalBinding = buildElement({
      logicalElementId: 'temporal:current_position',
      surfaceText: req.temporalScope.surfaceText ?? 'aktualne',
      surfaceMeaningKey: 'position',
      requestedConceptKey: 'position',
      resolvedRoleKey: t ? 'current_position_on_oracle_sysdate' : null,
      reuse: t ? reuse : 'not_approved',
      bindingStatus: t ? (t.status as SemanticBindingStatus) : 'unresolved',
      temporalSemantics: 'current',
      temporalLogicalTarget: 'current_position',
      approvedBindingRefs: t
        ? [`stage3d:${BHP_SUBJECT}:temporal:current_position_on_oracle_sysdate`]
        : [],
      warnings: t ? ['temporal_role_scope_restricted_to_bhp_subject'] : [],
    });
    if (t) {
      trace.stage3dBindingRefs.push('temporal:current_position_on_oracle_sysdate');
      // No node id on temporal role — still Stage3D-derived via approvedBindingRefs
      temporalBinding = applyStaleAndGraph(temporalBinding, false, options.graph, null, trace);
    }
  } else if (temporalTarget === 'unspecified_current') {
    temporalBinding = buildElement({
      logicalElementId: 'temporal:unspecified_current',
      surfaceText: req.temporalScope.surfaceText ?? 'aktualne',
      surfaceMeaningKey: null,
      requestedConceptKey: null,
      resolvedRoleKey: null,
      reuse: 'not_approved',
      bindingStatus: 'unresolved',
      temporalSemantics: 'current',
      temporalLogicalTarget: 'unspecified_current',
      warnings: ['temporal_target_unspecified_no_current_position_fallback'],
    });
  }

  // Guard: never attach current_position temporal to non-position targets
  if (
    temporalBinding?.resolvedRoleKey === 'current_position_on_oracle_sysdate' &&
    temporalBinding.temporalLogicalTarget !== 'current_position'
  ) {
    counters.temporalBindingsAttachedToWrongLogicalTarget += 1;
  }

  // Aggregation / department
  if (req.aggregation.requested) {
    for (const g of req.aggregation.groupBy) {
      if (g.surfaceMeaningKey === 'department') {
        aggregationTargets.push(
          buildElement({
            logicalElementId: 'agg:department',
            surfaceText: g.surfaceText,
            surfaceMeaningKey: 'department',
            requestedConceptKey: null,
            resolvedRoleKey: null,
            reuse: 'not_approved',
            bindingStatus: 'unresolved',
            warnings: ['department_not_auto_bound_to_ou'],
          }),
        );
        clarifications.push(clarificationDepartment());
      }
    }
  }

  if (req.ordering.length || req.limit != null) {
    if (req.rootEntity.conceptKey === 'employment_contract') {
      orderingTarget = buildElement({
        logicalElementId: 'order:employment_contract',
        surfaceText: req.ordering[0]?.surfaceText ?? 'najnowszych',
        surfaceMeaningKey: null,
        requestedConceptKey: 'employment_contract',
        resolvedRoleKey: null,
        reuse: 'not_approved',
        bindingStatus: 'unresolved',
        warnings: ['employment_contract_list_root_unresolved'],
      });
    }
  }

  if (options.forceTwoCandidateClarification) {
    const override = options.fixturePolicyOverride ?? SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY;
    if (!override.fixturePolicyOverride || override.fixturePolicyOverride.productionPolicy !== false) {
      counters.syntheticReusableRolesBypassingPolicyEvaluator += 1;
    }
    const clar = clarificationTwoApprovedCandidates(override);
    // Prove evaluator path: statuses must match resolveApprovalReuse
    for (const c of clar.candidates) {
      if (!c.roleKey) {
        counters.syntheticReusableRolesBypassingPolicyEvaluator += 1;
        continue;
      }
      const expected = resolveApprovalReuse(c.roleKey, 'generic_test', override);
      if (c.approvalReuseStatus !== expected) {
        counters.syntheticReusableRolesBypassingPolicyEvaluator += 1;
      }
    }
    clarifications.push(clar);
  }

  let resultGrain: string | null = 'employee';
  if (req.temporalScope.kind === 'history') resultGrain = 'position_history_record';
  if (req.rootEntity.conceptKey === 'employment_contract') resultGrain = 'employment_contract';
  if (req.aggregation.groupBy.some((g) => g.surfaceMeaningKey === 'department')) {
    resultGrain = 'organizational_unit_group';
  }
  if (resultGrain === 'health_examination') {
    counters.bhpSubjectPromotedToGeneric += 1;
    resultGrain = 'employee';
  }

  // Propagate dependency-hash staleness to all Stage3D-derived elements
  if (stale) {
    rootBinding = rootBinding ? (propagateStaleness([rootBinding], true, counters)[0] ?? null) : null;
    const nextFields = propagateStaleness(fieldBindings, true, counters).filter(
      Boolean,
    ) as TetaSemanticElementBinding[];
    fieldBindings.splice(0, fieldBindings.length, ...nextFields);
    const nextFilters = propagateStaleness(filterBindings, true, counters).filter(
      Boolean,
    ) as TetaSemanticElementBinding[];
    filterBindings.splice(0, filterBindings.length, ...nextFilters);
    const nextRels = propagateStaleness(relationBindings, true, counters).filter(
      Boolean,
    ) as TetaSemanticElementBinding[];
    relationBindings.splice(0, relationBindings.length, ...nextRels);
    temporalBinding = temporalBinding
      ? (propagateStaleness([temporalBinding], true, counters)[0] ?? null)
      : null;
    const nextAgg = propagateStaleness(aggregationTargets, true, counters).filter(
      Boolean,
    ) as TetaSemanticElementBinding[];
    aggregationTargets.splice(0, aggregationTargets.length, ...nextAgg);
    orderingTarget = orderingTarget
      ? (propagateStaleness([orderingTarget], true, counters)[0] ?? null)
      : null;
  }

  if (stale) warnings.push('dependency_graphSourceHash_stale');

  const allEls = [
    rootBinding,
    ...fieldBindings,
    ...filterBindings,
    ...relationBindings,
    temporalBinding,
    ...aggregationTargets,
    orderingTarget,
  ].filter(Boolean) as TetaSemanticElementBinding[];

  if (stale) {
    for (const el of allEls) {
      if (
        isDependencyBoundElement(el) &&
        el.approvedBindingRefs.length > 0 &&
        el.bindingStatus !== 'stale' &&
        el.bindingStatus !== 'invalid'
      ) {
        counters.approvedBindingsRemainingFreshAfterDependencyMismatch += 1;
      }
    }
  }

  for (const el of allEls) {
    if (isPlanningReadyReuse(el.approvalReuseStatus) && el.bindingStatus === 'discovered') {
      counters.discoveredBindingsUsedForPlanning += 1;
    }
    if (el.bindingStatus === 'discovered' && el.planningEligibility === 'eligible') {
      counters.discoveredBindingsMarkedPlanningEligible += 1;
    }
    if (
      el.approvalReuseStatus === 'not_approved' &&
      el.bindingStatus === 'approved' &&
      el.evidenceStatus === 'proven'
    ) {
      counters.unapprovedBindingsUsedForPlanning += 1;
    }
  }

  let resultStatus: TetaGenericSemanticBindingResult['resultStatus'] = 'unresolved';
  if (clarifications.length) resultStatus = 'needs_clarification';
  else {
    const anyPartial = allEls.some(
      (e) =>
        e.approvalReuseStatus === 'approved_scope_restricted' ||
        e.bindingStatus === 'stale' ||
        e.evidenceStatus === 'partial' ||
        (e.resolvedRoleKey != null && e.approvalReuseStatus !== 'not_approved'),
    );
    const anyUnresolvedCritical = allEls.some(
      (e) =>
        e.bindingStatus === 'unresolved' &&
        (e.logicalElementId.includes('history') ||
          e.logicalElementId.includes('employment_contract') ||
          e.logicalElementId.includes('location') ||
          e.logicalElementId.includes('neg_existence')),
    );
    if (
      anyPartial &&
      !allEls.every((e) => e.evidenceStatus === 'proven' && isPlanningReadyReuse(e.approvalReuseStatus))
    ) {
      resultStatus = 'partially_bound';
    }
    if (anyUnresolvedCritical && !anyPartial && !clarifications.length) {
      resultStatus = 'unresolved';
    }
    const allProven =
      allEls.length > 0 &&
      allEls.every((e) => e.evidenceStatus === 'proven' && isPlanningReadyReuse(e.approvalReuseStatus));
    if (allProven) resultStatus = 'semantically_bound';
  }

  if (
    resultStatus === 'semantically_bound' &&
    allEls.some((e) => e.approvalReuseStatus === 'approved_scope_restricted')
  ) {
    resultStatus = 'partially_bound';
  }

  const planningReadiness = derivePlanningReadiness({
    resultStatus,
    elements: allEls,
    clarifications,
  });

  const draft = emptyDraft({
    contractVersion: STAGE3K2A_CONTRACT_VERSION,
    sourceAnalysisFingerprint,
    resultStatus,
    rootBinding,
    fieldBindings,
    filterBindings,
    relationBindings,
    temporalBinding,
    aggregationTargets,
    orderingTarget,
    resultGrain,
    clarifications,
    warnings,
    executionEligibility: 'not_evaluated',
    planningReadiness,
    dependencyVector,
  });

  return finish(draft);
}
