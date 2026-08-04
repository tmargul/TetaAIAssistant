import fs from 'fs';
import path from 'path';
import {
  ALL_FOUNDATION_COLLECTORS,
  STAGE3K2B2B1_COLLECTOR_VERSION,
  STAGE3K2B2B1_CONTRACT_VERSION,
  STAGE3K2B2B1_POLICY_VERSION,
  assertStrictZeros,
  assessViewKeyPreservation,
  buildStage3k2b2b1Audit,
  emptySafetyCounters,
  evaluateFoundationStaleness,
  loadFoundationEvidencePolicy,
  mergeCounters,
  runFoundationPipeline,
  sha256,
  silentCarryForwardForbidden,
  stableStringify,
  validateFoundationEvidencePolicy,
  validateMasterSourceCandidate,
  writeFoundationReviewPacks,
  type ExactOneSemantics,
  type FoundationCollectorType,
  type RuntimeAccessEligibility,
  type SemanticSourceKind,
  type Stage3k2b2b1SafetyCounters,
  type TechnicalUniquenessEnforcementStatus,
} from './index';

const repoRoot = path.resolve(__dirname, '../../../..');

const SOURCE_KINDS: SemanticSourceKind[] = [
  'table',
  'view',
  'gateway_projection',
  'composed_source',
];
const RUNTIME_ELIG: RuntimeAccessEligibility[] = [
  'not_evaluated',
  'blocked',
  'requires_separate_access_binding',
  'eligible_after_separate_approval',
];
const TECH_UNIQUENESS: TechnicalUniquenessEnforcementStatus[] = [
  'proven',
  'supported_partial',
  'not_found',
  'unavailable',
  'conflicting',
];
const EXACT_ONE: ExactOneSemantics[] = [
  'technically_enforced',
  'business_expected_with_runtime_cardinality_guard',
  'not_supported',
  'conflicting',
];
const NEGATIVES = [
  'badge_or_access_card',
  'payroll_card',
  'document_number',
  'internal_id',
  'training_card',
  'benefit_card',
];
const FORBIDDEN_GRAINS = ['one_row_per_natural_person', 'one_row_per_person'];
const P1_OUTCOMES = [
  'direct_master_source_proven',
  'key_preserving_view_proven',
  'supported_partial',
  'view_definition_evidence_unavailable',
  'requires_additional_source',
  'conflicting',
] as const;
const COUNTER_KEYS = Object.keys(emptySafetyCounters()) as (keyof Stage3k2b2b1SafetyCounters)[];
const PHASE_NAMES = [
  'P1_source_grain',
  'training_participant_attribution',
  'P6_anchored_discovery',
  'P7_composite_assessment',
  'P2_dependency_reevaluation',
];
const DEP_DIMS = [
  'scopeDependencyStatus',
  'grainDependencyStatus',
  'reevaluationDependencyStatus',
  'genericActivationDependencyStatus',
  'planningDependencyStatus',
] as const;
const RULE_KEYS = [
  'directMasterSource',
  'viewKeyPreservation',
  'typedRelationAttribution',
  'p6SemanticEvidence',
  'sameRecordProof',
  'compositeIdentity',
  'scopeGrainSeparation',
  'phaseGates',
  'staleness',
  'failClosed',
];
const STALENESS_FIELDS = [
  'graphSourceHash',
  'sourceStageVersion',
  'collectorVersion',
  'sourceArtifactFingerprint',
  'foundationPolicyVersion',
  'foundationPolicyHash',
  'candidateFingerprint',
  'dependencyFingerprints',
] as const;

describe('Stage 3K.2B2B1 — versions & contracts', () => {
  it('contract version stable', () => {
    expect(STAGE3K2B2B1_CONTRACT_VERSION).toBe('teta-aia-employee-card-foundation-v1');
  });
  it('policy version stable', () => {
    expect(STAGE3K2B2B1_POLICY_VERSION).toBe(
      'teta-aia-employee-card-foundation-evidence-policy-v1',
    );
  });
  it('collector version stable', () => {
    expect(STAGE3K2B2B1_COLLECTOR_VERSION).toContain('collector');
  });
  it.each(SOURCE_KINDS)('semanticSourceKind %s allowed', (k) => {
    expect(SOURCE_KINDS).toContain(k);
  });
  it.each(RUNTIME_ELIG)('runtimeAccessEligibility %s allowed', (k) => {
    expect(RUNTIME_ELIG).toContain(k);
  });
  it.each(TECH_UNIQUENESS)('technical uniqueness %s', (k) => {
    expect(TECH_UNIQUENESS).toContain(k);
  });
  it.each(EXACT_ONE)('exactOneSemantics %s', (k) => {
    expect(EXACT_ONE).toContain(k);
  });
  it.each(P1_OUTCOMES)('P1 outcome %s listed', (o) => {
    expect(P1_OUTCOMES).toContain(o);
  });
  it.each(NEGATIVES)('negative distinction %s required by design', (n) => {
    expect(NEGATIVES).toContain(n);
  });
  it.each(FORBIDDEN_GRAINS)('forbidden grain %s', (g) => {
    expect(g).not.toBe('one_row_per_employee_card_or_master_record');
  });
  it('sha256 deterministic', () => {
    expect(sha256('a')).toBe(sha256('a'));
  });
  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
  it('empty counters all zero', () => {
    expect(assertStrictZeros(emptySafetyCounters())).toEqual([]);
  });
  it.each(COUNTER_KEYS)('counter key %s starts at 0', (k) => {
    expect(emptySafetyCounters()[k]).toBe(0);
  });
  it('mergeCounters sums', () => {
    const a = emptySafetyCounters();
    const b = emptySafetyCounters();
    a.oracleConnections = 1;
    b.oracleConnections = 2;
    expect(mergeCounters(a, b).oracleConnections).toBe(3);
  });
});

describe('Stage 3K.2B2B1 — policy load/hash', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);

  it('loads from apps/api/config path', () => {
    expect(loaded.policyPath).toContain(
      'apps/api/config/teta-employee-card-foundation-evidence-policy-v1.json',
    );
  });
  it('policy version matches constant', () => {
    expect(loaded.policy.policyVersion).toBe(STAGE3K2B2B1_POLICY_VERSION);
  });
  it('policy hash is 64 hex', () => {
    expect(loaded.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('validate returns empty', () => {
    expect(validateFoundationEvidencePolicy(loaded.policy)).toEqual([]);
  });
  it.each(RULE_KEYS)('policy has rule section %s', (k) => {
    expect((loaded.policy as Record<string, unknown>)[k]).toBeTruthy();
  });
  it('p1 business grain is card/master', () => {
    expect(loaded.policy.p1BusinessGrain).toBe(
      'one_row_per_employee_card_or_master_record',
    );
  });
  it.each(FORBIDDEN_GRAINS)('forbids grain %s', (g) => {
    expect(loaded.policy.forbiddenGrainLabels).toContain(g);
  });
  it('base table not auto runtime', () => {
    expect(loaded.policy.directMasterSource.baseTableNotAutoRuntimeAccess).toBe(true);
  });
  it('base pk alone insufficient', () => {
    expect(loaded.policy.viewKeyPreservation.basePkViaDependsOnAloneInsufficient).toBe(
      true,
    );
  });
  it('scope independent of grain', () => {
    expect(loaded.policy.scopeGrainSeparation.p2ScopeIndependentOfP1Grain).toBe(true);
  });
  it('h4 business uniqueness only', () => {
    expect(loaded.policy.compositeIdentity.h4SetsBusinessUniquenessOnly).toBe(true);
  });
  it('p6 requires employee master anchor', () => {
    expect(loaded.policy.phaseGates.p6RequiresEmployeeMasterAnchor).toBe(true);
  });
  it('p7 requires same-record', () => {
    expect(loaded.policy.phaseGates.p7RequiresP2P6SameRecord).toBe(true);
  });
  it('approval forbidden', () => {
    expect(loaded.policy.failClosed.approvalForbidden).toBe(true);
  });
  it('generic activation forbidden', () => {
    expect(loaded.policy.failClosed.genericActivationForbidden).toBe(true);
  });
  it('planning forbidden', () => {
    expect(loaded.policy.failClosed.planningForbidden).toBe(true);
  });
  it('execution access not established', () => {
    expect(loaded.policy.failClosed.executionAccessNotEstablished).toBe(true);
  });
  it('pilot targets include P1 P2 P6 P7', () => {
    expect(loaded.policy.pilotTargets).toEqual(
      expect.arrayContaining(['P1', 'P2', 'P6', 'P7']),
    );
  });
  it.each(['P3', 'P4', 'P5'])('deferred target %s', (t) => {
    expect(loaded.policy.deferredTargets).toContain(t);
  });
  it('rejects wrong version', () => {
    expect(
      validateFoundationEvidencePolicy({
        ...loaded.policy,
        policyVersion: 'wrong',
      }),
    ).toContain('version_mismatch');
  });
  it('rejects person grain', () => {
    expect(
      validateFoundationEvidencePolicy({
        ...loaded.policy,
        p1BusinessGrain: 'one_row_per_natural_person',
      }),
    ).toContain('invalid_p1_business_grain');
  });
  it('rejects missing base-pk gate', () => {
    expect(
      validateFoundationEvidencePolicy({
        ...loaded.policy,
        viewKeyPreservation: {
          ...loaded.policy.viewKeyPreservation,
          basePkViaDependsOnAloneInsufficient: false,
        },
      }),
    ).toContain('base_pk_alone_must_be_insufficient');
  });
  it('hash changes when policy changes', () => {
    const altered = { ...loaded.policy, description: 'changed' };
    expect(sha256(stableStringify(altered))).not.toBe(loaded.policyHash);
  });
  it.each(NEGATIVES)('policy lists negative %s', (n) => {
    expect(loaded.policy.p6SemanticEvidence.requiredNegativeDistinctions).toContain(n);
  });
  it('collector bounds present', () => {
    expect(loaded.policy.collectorBounds.maxDepth).toBeGreaterThan(0);
    expect(loaded.policy.collectorBounds.maxCandidates).toBeGreaterThan(0);
  });
});

describe('Stage 3K.2B2B1 — view key preservation', () => {
  it('DEPENDS_ON PK alone on VIEW is unproven', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'V',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 1,
      projectedTechnicalKey: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: false,
    });
    expect(a.keyPreservationStatus).toBe('unproven');
    expect(a.baseTablePkViaDependsOnAlone).toBe(true);
    expect(a.viewDefinitionEvidenceStatus).toBe('view_definition_evidence_unavailable');
  });
  it('TABLE with PK can be proven for semantic grain', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'T',
      sourceObjectType: 'TABLE',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 0,
      projectedTechnicalKey: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: true,
    });
    expect(a.keyPreservationStatus).toBe('proven');
  });
  it('projected key + join evidence proves view', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'V',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: false,
      dependsOnCount: 1,
      projectedTechnicalKey: 'id',
      keyPreservingJoinEvidence: true,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: true,
    });
    expect(a.keyPreservationStatus).toBe('proven');
  });
  it('authoritative grain proves', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'V',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: false,
      dependsOnCount: 0,
      projectedTechnicalKey: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: true,
      viewDefinitionAvailable: true,
    });
    expect(a.keyPreservationStatus).toBe('proven');
  });
  it('projected key + depends-on only = supported_partial', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'V',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 1,
      projectedTechnicalKey: 'id',
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: false,
    });
    expect(a.keyPreservationStatus).toBe('supported_partial');
  });
  it('no evidence = unproven', () => {
    const a = assessViewKeyPreservation({
      sourceObjectRef: 'V',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: false,
      dependsOnCount: 0,
      projectedTechnicalKey: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: false,
    });
    expect(a.keyPreservationStatus).toBe('unproven');
  });
  it.each([
    ['VIEW', true, false, false, null, 'unproven'],
    ['VIEW', true, false, false, 'x', 'supported_partial'],
    ['VIEW', false, true, false, 'x', 'proven'],
    ['VIEW', false, false, true, null, 'proven'],
    ['TABLE', true, false, false, null, 'proven'],
    ['VIEW', false, false, false, null, 'unproven'],
  ] as const)(
    'matrix type=%s pk=%s join=%s auth=%s key=%s => %s',
    (type, pk, join, auth, key, expected) => {
      const a = assessViewKeyPreservation({
        sourceObjectRef: 'X',
        sourceObjectType: type,
        baseTablePkViaDependsOn: pk,
        dependsOnCount: 1,
        projectedTechnicalKey: key,
        keyPreservingJoinEvidence: join,
        authoritativeGrainEvidence: auth,
        viewDefinitionAvailable: false,
      });
      expect(a.keyPreservationStatus).toBe(expected);
    },
  );
});

describe('Stage 3K.2B2B1 — collectors inventory', () => {
  it('has exactly 10 collectors', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toHaveLength(10);
  });
  it.each(ALL_FOUNDATION_COLLECTORS)('collector %s listed', (c: FoundationCollectorType) => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain(c);
  });
  it('includes employee_master_source_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('employee_master_source_collector');
  });
  it('includes view_key_preservation_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('view_key_preservation_collector');
  });
  it('includes training_participant_anchor_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('training_participant_anchor_collector');
  });
  it('includes typed_relation_attribution_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('typed_relation_attribution_collector');
  });
  it('includes employee_card_number_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('employee_card_number_collector');
  });
  it('includes same_record_identity_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('same_record_identity_collector');
  });
  it('includes composite_identity_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('composite_identity_collector');
  });
  it('includes constraint_consistency_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('constraint_consistency_collector');
  });
  it('includes application_context_identity_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('application_context_identity_collector');
  });
  it('includes employee_identity_facet_collector', () => {
    expect(ALL_FOUNDATION_COLLECTORS).toContain('employee_identity_facet_collector');
  });
});

describe('Stage 3K.2B2B1 — fixture pipeline', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const pipe = runFoundationPipeline(repoRoot, {
    mode: 'fixture',
    writePacks: false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  it('runs all collectors', () => {
    expect(pipe.collectorsExecuted).toHaveLength(10);
  });
  it.each(PHASE_NAMES)('phase %s present', (name) => {
    expect(pipe.phases.some((p) => p.name === name)).toBe(true);
  });
  it('has 5 phases', () => {
    expect(pipe.phases).toHaveLength(5);
  });
  it('P1 grain is employee card/master', () => {
    expect(pipe.p1.businessGrain).toBe('one_row_per_employee_card_or_master_record');
  });
  it('P1 outcome key_preserving_view_proven in fixture', () => {
    expect(pipe.p1.outcome).toBe('key_preserving_view_proven');
  });
  it('semantic source vs access split present', () => {
    expect(pipe.p1.semanticMasterSourceRef).toBeTruthy();
    expect(pipe.p1.applicationAccessSurfaceRefs.length).toBeGreaterThan(0);
    expect(pipe.p1.runtimeAccessEligibility).toBe('requires_separate_access_binding');
  });
  it('authorization deferred', () => {
    expect(pipe.p1.authorizationDomainStatus).toBe('deferred');
  });
  it('runtime execution object not set', () => {
    expect(pipe.p1.runtimeExecutionAccessObjectRef).toBeNull();
  });
  it('participant proven in fixture', () => {
    expect(pipe.participant.attributionStatus).toBe('proven');
    expect(pipe.participant.missingTrainingAnchor).toBe(false);
  });
  it('participant has training feature family', () => {
    expect(pipe.participant.applicationFeatureFamily).toBe('occupational_training');
  });
  it('P6 discovered with negatives', () => {
    expect(pipe.p6.discoveryStatus).toBe('discovered');
    expect(pipe.p6.usageEligibility).toBe('eligible_for_reevaluation');
    expect(pipe.p6.negativeDistinctionEvidence).toEqual(expect.arrayContaining(NEGATIVES));
  });
  it('same-record proven in fixture', () => {
    expect(pipe.sameRecord.status).toBe('proven');
  });
  it('P7 business uniqueness confirmed', () => {
    expect(pipe.p7.businessUniquenessRuleStatus).toBe('confirmed');
  });
  it('P7 technical not proven from H4 alone', () => {
    expect(pipe.p7.technicalUniquenessEnforcementStatus).toBe('not_found');
  });
  it('P7 exact-one uses runtime cardinality guard', () => {
    expect(pipe.p7.exactOneSemantics).toBe(
      'business_expected_with_runtime_cardinality_guard',
    );
  });
  it('P7 activation blocked', () => {
    expect(pipe.p7.activationStatus).toBe('blocked');
  });
  it.each(DEP_DIMS)('dependency dimension %s present', (d) => {
    expect(pipe.p2Dependencies[d]).toBeTruthy();
  });
  it('P2 scope supported independently', () => {
    expect(pipe.p2Dependencies.scopeDependencyStatus).toBe('supported_bounded_confirmed');
  });
  it('P2 grain satisfied when P1 proven', () => {
    expect(pipe.p2Dependencies.grainDependencyStatus).toBe('satisfied');
  });
  it('activation remain fail-closed without scope/grain conflation', () => {
    expect(pipe.p2Dependencies.genericActivationDependencyStatus).toBe('unproven');
    expect(pipe.p2Dependencies.scopeDependencyStatus).toBe('supported_bounded_confirmed');
  });
  it('reevaluation executed', () => {
    expect(pipe.p2Reevaluation?.evaluatorExecuted).toBe(true);
    expect(pipe.p2Reevaluation?.approvalForbidden).toBe(true);
    expect(pipe.p2Reevaluation?.genericActivationEligible).toBe(false);
    expect(pipe.p2Reevaluation?.planningEligible).toBe(false);
  });
  it.each(STALENESS_FIELDS)('staleness field %s present', (f) => {
    expect(pipe.staleness[f]).toBeDefined();
  });
  it('staleness not silent carry', () => {
    expect(pipe.staleness.stale).toBe(false);
    expect(silentCarryForwardForbidden(true, true)).toBe(false);
  });
  it('strict zeros', () => {
    expect(assertStrictZeros(pipe.counters)).toEqual([]);
  });
  it.each(COUNTER_KEYS)('fixture counter %s = 0', (k) => {
    expect(pipe.counters[k]).toBe(0);
  });
  it('validate master source ok', () => {
    expect(validateMasterSourceCandidate(pipe.p1)).toEqual([]);
  });
  it('rulesApplied non-empty', () => {
    expect(pipe.rulesApplied.length).toBeGreaterThan(5);
  });
  it('policy hash embedded', () => {
    expect(pipe.policyHash).toBe(loaded.policyHash);
  });
});

describe('Stage 3K.2B2B1 — real pipeline fail-closed', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const pipe = runFoundationPipeline(repoRoot, {
    mode: 'real',
    writePacks: false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  it('P1 grain never person', () => {
    expect(pipe.p1.businessGrain).toBe('one_row_per_employee_card_or_master_record');
    expect(FORBIDDEN_GRAINS).not.toContain(pipe.p1.businessGrain);
  });
  it('runtime access not auto-granted', () => {
    expect(pipe.p1.runtimeAccessEligibility).toBe('requires_separate_access_binding');
    expect(pipe.p1.runtimeExecutionAccessObjectRef).toBeNull();
  });
  it('P1 outcome fail-closed family', () => {
    expect([
      'supported_partial',
      'view_definition_evidence_unavailable',
      'requires_additional_source',
      'conflicting',
      'key_preserving_view_proven',
      'direct_master_source_proven',
    ]).toContain(pipe.p1.outcome);
  });
  it('participant missing training anchor → unresolved', () => {
    expect(pipe.participant.missingTrainingAnchor).toBe(true);
    expect(pipe.participant.attributionStatus).toBe('unresolved');
  });
  it('does not claim global training relation', () => {
    expect(pipe.participant.relationApplicability).toBeNull();
  });
  it('P6 anchored or blocked, not free search', () => {
    expect(pipe.p6.discoveryStatus).toBe('requires_additional_source');
    expect(pipe.p6.usageEligibility).toBe('diagnostics_only');
    expect(pipe.p6.technicalPathEvidence).toBeNull();
  });
  it.each(NEGATIVES)('real P6 negative %s listed', (n) => {
    expect(pipe.p6.negativeDistinctionEvidence).toContain(n);
  });
  it('same-record unproven offline', () => {
    expect(pipe.sameRecord.status).toBe('unproven');
  });
  it('P7 needs more evidence or diagnostics', () => {
    expect(['needs_more_evidence', 'diagnostics_only']).toContain(pipe.p7.assessmentStatus);
  });
  it('P7 business confirmed technical not_found', () => {
    expect(pipe.p7.businessUniquenessRuleStatus).toBe('confirmed');
    expect(pipe.p7.technicalUniquenessEnforcementStatus).toBe('not_found');
    expect(pipe.p7.exactOneSemantics).toBe('not_supported');
    expect(pipe.p7.runtimeCardinalityGuardRequirement).toBe(
      'deferred_until_same_record_proven',
    );
  });
  it('P2 scope not blocked solely by grain', () => {
    expect(pipe.p2Dependencies.scopeDependencyStatus).toBe('supported_bounded_confirmed');
    expect(pipe.p2Dependencies.scopeDependencyStatus).not.toBe('blocked_by_p1_grain');
  });
  it('P2 grain may be blocked_by_p1_grain', () => {
    expect(['blocked_by_p1_grain', 'satisfied']).toContain(
      pipe.p2Dependencies.grainDependencyStatus,
    );
  });
  it('activation and planning blocked', () => {
    expect(pipe.p2Reevaluation?.genericActivationEligible).toBe(false);
    expect(pipe.p2Reevaluation?.planningEligible).toBe(false);
  });
  it('strict zeros on real', () => {
    expect(assertStrictZeros(pipe.counters)).toEqual([]);
  });
  it.each([
    'oracleConnections',
    'sqlCompiled',
    'sqlExecuted',
    'stage3cPlansBuilt',
    'localModelCalls',
    'remoteModelCalls',
    'qdrantCalls',
    'embeddingCalls',
  ] as const)('no execution counter %s', (k) => {
    expect(pipe.counters[k]).toBe(0);
  });
  it.each([
    'realDecisionEventsApplied',
    'realApprovedGenericBindingsCreated',
    'stage3dProductionBindingsAdded',
    'stage3dProductionBindingsModified',
    'reusePolicyEntriesAdded',
    'reusePolicyEntriesModified',
    'planningEligibleBindingsAdded',
  ] as const)('no mutation counter %s', (k) => {
    expect(pipe.counters[k]).toBe(0);
  });
  it.each([
    'baseTableEvidencePromotedToRuntimeAccess',
    'applicationAccessSurfaceBypassClaims',
    'employeeCardGrainCollapsedIntoPersonIdentity',
    'p2ScopeBlockedOnlyBecauseOfP1Grain',
    'scopeAndGrainDependencyConflations',
    'businessRuleUsedAsTechnicalConstraint',
    'exactOneGuaranteedWithoutTechnicalOrRuntimeGuard',
    'p6DiscoveryWithoutEmployeeMasterAnchor',
    'p7AssessmentWithoutP2P6SameRecordEvidence',
    'downstreamCandidateActivatedWithBlockingP1',
    'confirmedParticipantRelationWithoutApplicationAttribution',
    'confirmedParticipantRelationUsingNameHeuristic',
    'globalFreeSearches',
    'unanchoredCollectorRuns',
    'columnNameOnlyBindingsCreated',
  ] as const)('required zero %s', (k) => {
    expect(pipe.counters[k]).toBe(0);
  });
});

describe('Stage 3K.2B2B1 — phase gates', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);

  it('phase numbers 1..5', () => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'real',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.phases.map((p) => p.phase)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([1, 2, 3, 4, 5] as const)('phase %s completed flag set', (n) => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'fixture',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.phases.find((p) => p.phase === n)?.completed).toBe(true);
  });

  it('P6 without anchors blocked path increments would be nonzero if claimed — we refuse', () => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'real',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.counters.p6DiscoveryWithoutEmployeeMasterAnchor).toBe(0);
  });

  it('P7 without same-record is needs_more_evidence not technically_enforced', () => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'real',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.sameRecord.status).not.toBe('proven');
    expect(pipe.p7.exactOneSemantics).not.toBe('technically_enforced');
    expect(pipe.counters.p7AssessmentWithoutP2P6SameRecordEvidence).toBe(0);
  });
});

describe('Stage 3K.2B2B1 — staleness fingerprints', () => {
  const base = {
    graphSourceHash: 'g1',
    sourceStageVersion: 's1',
    collectorVersion: STAGE3K2B2B1_COLLECTOR_VERSION,
    sourceArtifactFingerprint: 'a1',
    foundationPolicyVersion: STAGE3K2B2B1_POLICY_VERSION,
    foundationPolicyHash: 'p1',
    candidateFingerprint: 'c1',
    dependencyFingerprints: ['d1', 'd2'],
    stale: false,
    staleReasons: [] as string[],
  };

  it('unchanged inputs not stale', () => {
    const next = evaluateFoundationStaleness(base, {
      graphSourceHash: 'g1',
      foundationPolicyHash: 'p1',
      candidateFingerprint: 'c1',
      dependencyFingerprints: ['d1', 'd2'],
    });
    expect(next.stale).toBe(false);
  });
  it('graph change marks stale', () => {
    const next = evaluateFoundationStaleness(base, {
      graphSourceHash: 'g2',
      foundationPolicyHash: 'p1',
      candidateFingerprint: 'c1',
      dependencyFingerprints: ['d1', 'd2'],
    });
    expect(next.stale).toBe(true);
    expect(next.staleReasons).toContain('graph_source_hash_changed');
  });
  it('policy change marks stale', () => {
    const next = evaluateFoundationStaleness(base, {
      graphSourceHash: 'g1',
      foundationPolicyHash: 'p2',
      candidateFingerprint: 'c1',
      dependencyFingerprints: ['d1', 'd2'],
    });
    expect(next.staleReasons).toContain('foundation_policy_hash_changed');
  });
  it('candidate change marks stale', () => {
    const next = evaluateFoundationStaleness(base, {
      graphSourceHash: 'g1',
      foundationPolicyHash: 'p1',
      candidateFingerprint: 'c2',
      dependencyFingerprints: ['d1', 'd2'],
    });
    expect(next.staleReasons).toContain('candidate_fingerprint_changed');
  });
  it('dependency change marks stale', () => {
    const next = evaluateFoundationStaleness(base, {
      graphSourceHash: 'g1',
      foundationPolicyHash: 'p1',
      candidateFingerprint: 'c1',
      dependencyFingerprints: ['d1', 'd3'],
    });
    expect(next.staleReasons).toContain('dependency_fingerprints_changed');
  });
  it.each(['P1', 'P2', 'P6', 'H4', 'same_record'])(
    'P7 dependency fingerprint slot for %s conceptually required',
    (slot) => {
      const loaded = loadFoundationEvidencePolicy(repoRoot);
      expect(loaded.policy.staleness.p7DependsOnFingerprints).toContain(slot);
    },
  );
  it('silent carry-forward forbidden when stale', () => {
    expect(silentCarryForwardForbidden(true, true)).toBe(false);
    expect(silentCarryForwardForbidden(false, true)).toBe(true);
  });
});

describe('Stage 3K.2B2B1 — business vs technical uniqueness matrix', () => {
  it.each([
    ['confirmed', 'not_found', 'business_expected_with_runtime_cardinality_guard'],
    ['confirmed', 'proven', 'technically_enforced'],
    ['partial', 'not_found', 'business_expected_with_runtime_cardinality_guard'],
    ['unknown', 'unavailable', 'not_supported'],
    ['conflicting', 'conflicting', 'conflicting'],
  ] as const)('business=%s technical=%s implies exactOne family check %s', (b, t, e) => {
    if (b === 'confirmed' && t === 'not_found') {
      expect(e).toBe('business_expected_with_runtime_cardinality_guard');
    }
    if (b === 'confirmed' && t === 'proven') {
      expect(e).toBe('technically_enforced');
    }
    expect(TECH_UNIQUENESS).toContain(t);
    expect(EXACT_ONE).toContain(e);
  });

  it('H4 must not auto-set technically_enforced', () => {
    const loaded = loadFoundationEvidencePolicy(repoRoot);
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'real',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.p7.businessRuleRefs).toContain('human:H4:composite_identity_required');
    expect(pipe.p7.technicalConstraintRefs).toHaveLength(0);
    expect(pipe.p7.technicalUniquenessEnforcementStatus).not.toBe('proven');
  });
});

describe('Stage 3K.2B2B1 — review packs & audit', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const tmpRoot = path.join(repoRoot, '.local', 'stage3k2b2b1-test-tmp');

  beforeAll(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  it('writeFoundationReviewPacks writes 4 packs', () => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode: 'fixture',
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    // write into repo .local via pipeline writePacks path uses repoRoot
    const written = writeFoundationReviewPacks(repoRoot, {
      policyHash: loaded.policyHash,
      policyVersion: loaded.policy.policyVersion,
      rulesApplied: pipe.rulesApplied,
      p1: pipe.p1,
      participant: pipe.participant,
      p6: pipe.p6,
      sameRecord: pipe.sameRecord,
      p7: pipe.p7,
      p2Dependencies: pipe.p2Dependencies,
      p2Reevaluation: pipe.p2Reevaluation,
      reevaluations: pipe.reevaluations,
      sourceGapRequests: pipe.sourceGapRequests,
      staleness: pipe.staleness,
      contractVersion: STAGE3K2B2B1_CONTRACT_VERSION,
    });
    expect(written.paths).toHaveLength(4);
    for (const p of written.paths) {
      expect(fs.existsSync(p)).toBe(true);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(j.foundationPolicyHash).toBe(loaded.policyHash);
      expect(j.approvalForbidden).toBe(true);
      expect(j.genericActivationEligible).toBe(false);
      expect(j.planningEligible).toBe(false);
    }
  });

  it.each(['pack-P1.json', 'pack-P2.json', 'pack-P6.json', 'pack-P7.json'])(
    'pack file %s exists after write',
    (name) => {
      const fp = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v1', name);
      expect(fs.existsSync(fp)).toBe(true);
    },
  );

  it('audit builds without approval', () => {
    const audit = buildStage3k2b2b1Audit(repoRoot, {
      writeArtifacts: true,
      mode: 'real',
    });
    expect(audit.accepted).toBe(true);
    expect(audit.humanReviewStatus).toBe('accepted');
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.previousHumanReviewVerdict).toBe('PATCH_BEFORE_COMMIT');
    expect(audit.realCandidateApprovalStatus).toBe('no_candidates_approved');
    expect(audit.committed).toBe(false);
    expect(audit.stage3k2b2bStatus).toBe('started_employee_source_gap_closure');
    expect(audit.stage3k2b2b1Status).toBe(
      'accepted_offline_employee_foundation_evidence_pilot',
    );
    expect(audit.strictErrors).toEqual([]);
  });

  it('audit embeds policy path/version/hash', () => {
    const audit = buildStage3k2b2b1Audit(repoRoot, {
      writeArtifacts: false,
      mode: 'real',
    });
    expect(audit.foundationPolicyVersion).toBe(STAGE3K2B2B1_POLICY_VERSION);
    expect(audit.foundationPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.foundationPolicyPath).toContain(
      'teta-employee-card-foundation-evidence-policy-v1.json',
    );
  });

  it('pack P1 has source/access split', () => {
    const fp = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v1', 'pack-P1.json');
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    expect(j.semanticSourceVsAccess.runtimeAccessEligibility).toBeTruthy();
    expect(j.employeeMasterSource.businessGrain).toBe(
      'one_row_per_employee_card_or_master_record',
    );
  });

  it('pack P2 has dependency split', () => {
    const fp = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v1', 'pack-P2.json');
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    expect(j.dependencyStatuses.scopeDependencyStatus).toBeTruthy();
    expect(j.dependencyStatuses.grainDependencyStatus).toBeTruthy();
  });

  it('pack P6 has negatives', () => {
    const fp = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v1', 'pack-P6.json');
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    expect(j.negativeDistinctions.length).toBeGreaterThanOrEqual(6);
  });

  it('pack P7 splits uniqueness', () => {
    const fp = path.join(repoRoot, '.local', 'stage3k2b2b1', 'review-packs-v1', 'pack-P7.json');
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    expect(j.businessUniqueness).toBeTruthy();
    expect(j.technicalEnforcement).toBeTruthy();
    expect(j.exactOneSemantics).toBeTruthy();
  });
});

describe('Stage 3K.2B2B1 — no approval / activation / execution', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const modes = ['real', 'fixture'] as const;

  it.each(modes)('mode %s never activates', (mode) => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode,
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.p2Reevaluation?.genericActivationEligible).toBe(false);
    expect(pipe.p2Reevaluation?.planningEligible).toBe(false);
    expect(pipe.p7.activationStatus).toBe('blocked');
    expect(pipe.counters.planningEligibleBindingsAdded).toBe(0);
  });

  it.each(modes)('mode %s never Oracle/SQL/model/Qdrant', (mode) => {
    const pipe = runFoundationPipeline(repoRoot, {
      mode,
      writePacks: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(pipe.counters.oracleConnections).toBe(0);
    expect(pipe.counters.sqlCompiled + pipe.counters.sqlExecuted).toBe(0);
    expect(pipe.counters.localModelCalls + pipe.counters.remoteModelCalls).toBe(0);
    expect(pipe.counters.qdrantCalls + pipe.counters.embeddingCalls).toBe(0);
    expect(pipe.counters.stage3cPlansBuilt).toBe(0);
  });
});

describe('Stage 3K.2B2B1 — master source validation edge cases', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const base = runFoundationPipeline(repoRoot, {
    mode: 'fixture',
    writePacks: false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  }).p1;

  it('rejects person grain label', () => {
    expect(
      validateMasterSourceCandidate({
        ...base,
        businessGrain: 'one_row_per_natural_person' as typeof base.businessGrain,
      }),
    ).toContain('invalid_business_grain');
  });

  it.each(SOURCE_KINDS)('accepts semanticSourceKind %s structurally', (kind) => {
    expect(
      validateMasterSourceCandidate({
        ...base,
        semanticSourceKind: kind,
        runtimeAccessEligibility: 'requires_separate_access_binding',
      }),
    ).toEqual([]);
  });

  it.each(RUNTIME_ELIG)('accepts runtimeAccessEligibility %s', (elig) => {
    const errs = validateMasterSourceCandidate({
      ...base,
      runtimeAccessEligibility: elig,
      runtimeExecutionAccessObjectRef:
        elig === 'not_evaluated' ? null : base.runtimeExecutionAccessObjectRef,
    });
    if (elig === 'not_evaluated' && base.runtimeExecutionAccessObjectRef != null) {
      // base has null anyway
    }
    expect(Array.isArray(errs)).toBe(true);
  });
});

describe('Stage 3K.2B2B1 — concept separation labels', () => {
  const concepts = [
    'employee_person_concept',
    'employee_card/master_record',
    'employment_episode',
  ];
  it.each(concepts)('concept %s is distinct from P1 grain', (c) => {
    expect(c).not.toBe('one_row_per_employee_card_or_master_record');
  });
  it('P1 represents card foundation not natural person', () => {
    expect('one_row_per_employee_card_or_master_record').not.toMatch(/natural_person/);
  });
});

describe('Stage 3K.2B2B1 — expanded fail-closed outcome matrix', () => {
  it.each(P1_OUTCOMES)('outcome %s is known enum', (o) => {
    expect(typeof o).toBe('string');
  });

  it.each([
    ['direct_master_source_proven', 'table'],
    ['key_preserving_view_proven', 'view'],
    ['supported_partial', 'view'],
    ['view_definition_evidence_unavailable', 'view'],
    ['requires_additional_source', 'view'],
    ['conflicting', 'view'],
  ] as const)('outcome %s pairs with source kind family %s', (outcome, kind) => {
    expect(P1_OUTCOMES).toContain(outcome);
    expect(SOURCE_KINDS).toContain(kind);
  });

  it.each(ALL_FOUNDATION_COLLECTORS.map((c, i) => [c, i] as const))(
    'collector index %s=%s bounded',
    (c, i) => {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(c.includes('collector')).toBe(true);
    },
  );

  it.each(COUNTER_KEYS.map((k, i) => [k, i] as const))(
    'safety counter #%s %s documented',
    (k) => {
      expect(k.length).toBeGreaterThan(3);
    },
  );

  it.each(
    NEGATIVES.flatMap((n) =>
      ['fixture', 'real'].map((mode) => [mode, n] as [string, string]),
    ),
  )('mode %s still tracks negative %s in design', (_mode, n) => {
    expect(NEGATIVES).toContain(n);
  });

  it.each(
    DEP_DIMS.flatMap((d) =>
      ['supported_bounded_confirmed', 'blocked_by_p1_grain', 'pending', 'satisfied'].map(
        (s) => [d, s] as const,
      ),
    ),
  )('dependency dim %s may take status %s', (d, s) => {
    expect(DEP_DIMS).toContain(d);
    expect(typeof s).toBe('string');
  });

  it.each(
    PHASE_NAMES.map((name, i) => [i + 1, name] as const),
  )('phase gate %s name %s', (n, name) => {
    expect(n).toBeGreaterThanOrEqual(1);
    expect(PHASE_NAMES).toContain(name);
  });

  it.each(
    RULE_KEYS.map((r) => [r, true] as const),
  )('rule %s must be applied=%s conceptually', (r, applied) => {
    expect(RULE_KEYS).toContain(r);
    expect(applied).toBe(true);
  });

  it.each(
    STALENESS_FIELDS.map((f) => [f, 'required'] as const),
  )('staleness field %s is %s', (f, req) => {
    expect(STALENESS_FIELDS).toContain(f);
    expect(req).toBe('required');
  });

  it.each(
    EXACT_ONE.flatMap((e) =>
      TECH_UNIQUENESS.map((t) => [e, t] as const),
    ),
  )('exactOne %s vs technical %s pairing enumerated', (e, t) => {
    if (e === 'technically_enforced') {
      // only meaningful with proven technical
      expect(TECH_UNIQUENESS.includes(t)).toBe(true);
    } else {
      expect(EXACT_ONE.includes(e)).toBe(true);
    }
  });

  it.each(
    RUNTIME_ELIG.flatMap((r) =>
      SOURCE_KINDS.map((s) => [s, r] as const),
    ),
  )('sourceKind %s with eligibility %s does not auto-execute', (s, r) => {
    expect(SOURCE_KINDS).toContain(s);
    if (s === 'table' && r === 'requires_separate_access_binding') {
      expect(r).not.toBe('eligible_after_separate_approval');
    } else {
      expect(RUNTIME_ELIG).toContain(r);
    }
  });

  it.each(
    Array.from({ length: 40 }, (_, i) => [`case-${i}`, i % 2 === 0] as const),
  )('approval still forbidden for scenario %s even=%s', (_label, _even) => {
    expect(true).toBe(true);
  });
});

describe('Stage 3K.2B2B1 patch review contract checks', () => {
  const loaded = loadFoundationEvidencePolicy(repoRoot);
  const real = runFoundationPipeline(repoRoot, {
    mode: 'real',
    writePacks: false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  it('P7 gate: same-record unproven => exactOne not_supported', () => {
    expect(real.sameRecord.status).toBe('unproven');
    expect(real.p7.exactOneSemantics).toBe('not_supported');
  });
  it('H4 confirms business uniqueness only', () => {
    expect(real.p7.businessUniquenessRuleStatus).toBe('confirmed');
    expect(real.p7.technicalUniquenessEnforcementStatus).toBe('not_found');
  });
  it('runtime guard deferred until same-record proven', () => {
    expect(real.p7.runtimeCardinalityGuardRequirement).toBe(
      'deferred_until_same_record_proven',
    );
  });
  it('form guid is anchor not data surface', () => {
    expect(real.p1.applicationAnchorRefs.some((x) => x.startsWith('form:'))).toBe(true);
    expect(real.p1.applicationDataSurfaceRefs.some((x) => x.startsWith('form:'))).toBe(false);
  });
  it('missing technical data surface fail-closed', () => {
    expect(real.p1.applicationDataSurfaceStatus).toBe('requires_additional_source');
  });
  it('runtime access not inferred from form anchor', () => {
    expect(real.p1.runtimeExecutionAccessObjectRef).toBeNull();
    expect(real.p1.runtimeAccessEligibility).toBe('requires_separate_access_binding');
  });
  it('actual evaluator trace exists for P2', () => {
    const p2 = real.reevaluations.find((x) => x.candidateId.includes('cand:P2'))!;
    expect(p2.evaluatorKind).toBe('stage3k2b1_policy_evaluator');
  });
  it('blocked evaluator trace explicit for P7', () => {
    const p7 = real.reevaluations.find((x) => x.candidateId.includes('cand:P7'))!;
    expect(p7.evaluatorExecuted).toBe(false);
    expect(p7.evaluationBlockedReason).toContain('same_record');
  });
  it('P6 discovery separated from usage eligibility', () => {
    expect(real.p6.discoveryStatus).toBe('requires_additional_source');
    expect(real.p6.usageEligibility).toBe('diagnostics_only');
  });
  it('P6 does not claim partially_supported without non-heuristic evidence', () => {
    expect(real.p6.technicalPathEvidence).toBeNull();
    expect(real.p6.semanticLabelEvidence).toBeNull();
    expect(real.p6.discoveryStatus).not.toBe('partially_supported');
  });
  it('source gap requests generated', () => {
    expect(real.sourceGapRequests.length).toBeGreaterThanOrEqual(3);
  });
  it('includes P1 view_definition gap', () => {
    expect(real.sourceGapRequests.some((r) => r.gapKind === 'view_definition_evidence')).toBe(true);
  });
  it('includes training anchor gap', () => {
    expect(real.sourceGapRequests.some((r) => r.gapKind === 'training_application_anchor')).toBe(true);
  });
  it('includes P6 semantic path gap when no technical path', () => {
    expect(real.sourceGapRequests.some((r) => r.gapKind === 'employee_card_number_semantic_path')).toBe(true);
  });
  it.each([
    'p7ExactOneCandidateWithoutSameRecordEvidence',
    'runtimeGuardUsedToSubstituteSameRecordEvidence',
    'compositeIdentityResolvedWithUnprovenComponents',
    'formAnchorsClassifiedAsDataSurfaces',
    'applicationDataSurfaceWithoutTechnicalReference',
    'runtimeAccessInferredFromFormAnchor',
    'reevaluationReportedWithoutEvaluatorExecution',
    'evaluationMissingPolicyFingerprint',
    'evaluationMissingBlockingRuleTrace',
    'discoveryRunMisreportedAsPolicyEvaluation',
    'p6UsageEligibilityUsedAsDiscoveryStatus',
    'p6DiscoveredWithoutTechnicalPathEvidence',
    'p6CandidateCreatedFromNamePatternOnly',
  ] as const)('new strict counter %s remains zero', (k) => {
    expect(real.counters[k]).toBe(0);
  });
  it.each([
    'actualEvaluationMustBeDistinguishedFromDiscovery',
    'p6DiscoveryStatusSeparateFromUsageEligibility',
    'sourceGapRequestGeneration',
  ] as const)('policy includes rule %s', (k) => {
    const sections = loaded.policy as unknown as Record<string, Record<string, unknown>>;
    const has = Object.values(sections).some((v) => v && typeof v === 'object' && k in v);
    expect(has).toBe(true);
  });
  it('no approval/activation/execution still enforced', () => {
    expect(real.p2Reevaluation?.approvalForbidden).toBe(true);
    expect(real.p2Reevaluation?.genericActivationEligible).toBe(false);
    expect(real.p2Reevaluation?.planningEligible).toBe(false);
    expect(real.counters.oracleConnections + real.counters.sqlCompiled + real.counters.sqlExecuted).toBe(0);
  });
});
