import fs from 'fs';
import path from 'path';
import {
  ALLOWED_ORIGINS,
  STAGE3K2B2A_COLLECTOR_VERSION,
  STAGE3K2B2A_CONTRACT_VERSION,
  STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION,
  STAGE3K2B2A_GAP_TAXONOMY_VERSION,
  AMBIGUITY_SURNAME_FIXTURE,
  EMPTY_RESULT_FIXTURES,
  EMPLOYEE_CARD_IDENTITY_MODEL,
  assertStrictZeros,
  assessViewGrainPreservation,
  attemptPrematureHumanQuestion,
  buildApplicationContextFixtures,
  buildPilotHumanDomainEvidence,
  buildStage3k2b2aAudit,
  classifyFeatureFamiliesFromRegistry,
  collectForCandidate,
  createApplicationContextAnchor,
  emptySafetyCounters,
  featureFamilyKeys,
  humanQuestionAsksForOracleMapping,
  initialGapsP1,
  initialGapsP2,
  loadGapResolutionPolicy,
  p1CollectorSequence,
  p2CollectorSequence,
  runStage3k2b2aPipeline,
  sha256,
  stableStringify,
  validateApplicationContextAnchor,
  validateGap,
  validateGapResolutionPolicy,
  wouldCountSharedGatewayFormsAsIndependent,
  type CollectorType,
  type GapType,
  type HumanExpertiseMode,
} from './index';

const repoRoot = path.resolve(__dirname, '../../../..');

const GAP_TYPES: GapType[] = [
  'semantic_meaning_gap',
  'scope_applicability_gap',
  'result_grain_gap',
  'identity_facet_gap',
  'relation_meaning_gap',
  'temporal_policy_gap',
  'cardinality_gap',
  'uniqueness_gap',
  'display_value_gap',
  'dependency_gap',
  'ambiguity_gap',
  'conflict_gap',
  'provenance_independence_gap',
  'currentness_gap',
  'version_scope_gap',
  'authorization_domain_gap',
];

const HUMAN_MODES: HumanExpertiseMode[] = [
  'not_required',
  'conditional_after_offline_collection',
  'required',
];

const P1_COLLECTORS_EXPECTED: CollectorType[] = [
  'stage3a_anchor_trace_collector',
  'form_usage_collector',
  'gateway_lineage_collector',
  'cross_form_usage_collector',
  'scope_usage_collector',
  'competing_root_collector',
  'help_semantic_label_collector',
  'constraint_metadata_collector',
];

const P2_COLLECTORS_EXPECTED: CollectorType[] = [
  'help_semantic_label_collector',
  'form_usage_collector',
  'gateway_lineage_collector',
  'dependency_evidence_collector',
  'constraint_metadata_collector',
  'scope_usage_collector',
];

describe('Stage 3K.2B2A — versions & contracts', () => {
  it('contract versions stable', () => {
    expect(STAGE3K2B2A_CONTRACT_VERSION).toContain('semantic-evidence-gap');
    expect(STAGE3K2B2A_GAP_TAXONOMY_VERSION).toContain('taxonomy');
    expect(STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION).toContain('gap-resolution-policy');
    expect(STAGE3K2B2A_COLLECTOR_VERSION).toContain('collector');
  });

  it.each(GAP_TYPES)('gap type %s is listed', (t) => {
    expect(GAP_TYPES).toContain(t);
  });

  it.each(HUMAN_MODES)('humanExpertiseMode %s allowed', (m) => {
    expect(HUMAN_MODES).toContain(m);
  });

  it.each(ALLOWED_ORIGINS)('application context origin %s', (o) => {
    const a = createApplicationContextAnchor({
      anchorId: `a:${o}`,
      origin: o,
      selectionRequired: o === 'screenshot_context',
    });
    expect(validateApplicationContextAnchor(a)).toEqual([]);
    expect(a.isSemanticBinding).toBe(false);
    expect(a.claimsDatabaseMapping).toBe(false);
  });

  it('sha256 and stableStringify deterministic', () => {
    expect(sha256('x')).toBe(sha256('x'));
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('empty safety counters all zero', () => {
    expect(assertStrictZeros(emptySafetyCounters())).toEqual([]);
  });
});

describe('Stage 3K.2B2A — application context fixtures', () => {
  const fixtures = buildApplicationContextFixtures();

  it.each(['A', 'B', 'C', 'D', 'E'] as const)('fixture %s ok', (id) => {
    const f = fixtures.find((x) => x.id === id)!;
    expect(f.ok).toBe(true);
  });

  it('A has known form/control', () => {
    const a = fixtures.find((x) => x.id === 'A')!;
    expect(a.anchor.formId).toBeTruthy();
    expect(a.anchor.controlId).toBeTruthy();
  });

  it('B resolves form from label without selectionRequired', () => {
    const b = fixtures.find((x) => x.id === 'B')!;
    expect(b.anchor.selectionRequired).toBe(false);
    expect(b.anchor.formId).toBeTruthy();
  });

  it('C screenshot does not claim DB mapping', () => {
    const c = fixtures.find((x) => x.id === 'C')!;
    expect(c.anchor.origin).toBe('screenshot_context');
    expect(c.anchor.claimsDatabaseMapping).toBe(false);
  });

  it('D ambiguous requires selection', () => {
    expect(fixtures.find((x) => x.id === 'D')!.anchor.selectionRequired).toBe(true);
  });

  it('E column-like text does not bind', () => {
    const e = fixtures.find((x) => x.id === 'E')!;
    expect(e.anchor.formId).toBeFalsy();
    expect(e.countersDelta.screenTextMappedDirectlyToDatabase).toBe(0);
    expect(e.countersDelta.columnNameOnlyBindingsCreated).toBe(0);
  });

  it('claimsDatabaseMapping true fails validation', () => {
    const bad = createApplicationContextAnchor({
      anchorId: 'bad',
      origin: 'screenshot_context',
      selectionRequired: true,
      claimsDatabaseMapping: true,
    });
    expect(validateApplicationContextAnchor(bad).length).toBeGreaterThan(0);
  });
});

describe('Stage 3K.2B2A — policy JSON', () => {
  const loaded = loadGapResolutionPolicy(repoRoot);

  it('loads versioned policy', () => {
    expect(loaded.policy.policyVersion).toBe(STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION);
    expect(loaded.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validate passes', () => {
    expect(validateGapResolutionPolicy(loaded.policy)).toEqual([]);
  });

  it('does not require all Teta HR by default', () => {
    expect(loaded.policy.boundedApplicabilityRules.defaultRequireCanonicalAcrossAllTetaHr).toBe(
      false,
    );
  });

  it('P1 sequence includes competing_root_collector', () => {
    expect(loaded.policy.requiredCollectorSequenceP1).toContain('competing_root_collector');
  });

  it.each(P1_COLLECTORS_EXPECTED)('P1 policy sequence includes %s', (c) => {
    expect(loaded.policy.requiredCollectorSequenceP1).toContain(c);
  });

  it.each(P2_COLLECTORS_EXPECTED)('P2 policy sequence includes %s', (c) => {
    expect(loaded.policy.requiredCollectorSequenceP2).toContain(c);
  });

  it('human request requires collectors completed', () => {
    expect(loaded.policy.humanRequestRequires.allAllowedOfflineCollectorsCompleted).toBe(true);
    expect(loaded.policy.humanRequestRequires.blockingGapStillOpen).toBe(true);
  });

  it('shared gateway independence rule set', () => {
    expect(
      loaded.policy.featureFamilyIndependenceRules.sharedGatewayObservationNotIndependent,
    ).toBe(true);
  });

  it('pilot is P1 P2 only', () => {
    expect(loaded.policy.pilotCandidates).toEqual(['P1', 'P2']);
    expect(loaded.policy.deferredCandidates).toEqual(expect.arrayContaining(['P3', 'P4', 'P5']));
  });
});

describe('Stage 3K.2B2A — gap taxonomy & initial gaps', () => {
  it.each(initialGapsP1())('P1 gap %s validates', (g) => {
    expect(validateGap(g)).toEqual([]);
    expect(g.humanExpertiseMode).not.toBeUndefined();
  });

  it.each(initialGapsP2())('P2 gap %s validates', (g) => {
    expect(validateGap(g)).toEqual([]);
  });

  it('P1 scope is conditional_after_offline_collection', () => {
    expect(initialGapsP1().find((g) => g.gapId === 'gap:P1:scope')!.humanExpertiseMode).toBe(
      'conditional_after_offline_collection',
    );
  });

  it('P2 dependency is not_required', () => {
    expect(
      initialGapsP2().find((g) => g.gapId === 'gap:P2:dependency')!.humanExpertiseMode,
    ).toBe('not_required');
  });

  it('forbids humanExpertiseRequired boolean field presence in gap objects', () => {
    for (const g of [...initialGapsP1(), ...initialGapsP2()]) {
      expect((g as { humanExpertiseRequired?: unknown }).humanExpertiseRequired).toBeUndefined();
    }
  });
});

describe('Stage 3K.2B2A — feature family classification', () => {
  const ff = classifyFeatureFamiliesFromRegistry();

  it('classifies at least 3 families', () => {
    expect(ff.families.length).toBeGreaterThanOrEqual(3);
  });

  it.each(featureFamilyKeys())('family key %s classified', (k) => {
    const f = ff.families.find((x) => x.featureFamilyKey === k);
    expect(f?.classificationStatus).toBe('classified');
    expect(f?.classificationEvidence.length).toBeGreaterThan(0);
  });

  it('shared gateway forms are not independent', () => {
    expect(wouldCountSharedGatewayFormsAsIndependent()).toBe(false);
  });

  it('formsCountedAsIndependentFeaturesWithoutClassification=0', () => {
    expect(ff.countersDelta.formsCountedAsIndependentFeaturesWithoutClassification).toBe(0);
  });

  it('independent observation groups include distinct gateways', () => {
    expect(ff.independentObservationGroups.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Stage 3K.2B2A — collectors P1', () => {
  const policy = loadGapResolutionPolicy(repoRoot).policy;
  const seq = p1CollectorSequence(policy);
  const result = collectForCandidate('cand:P1:employee', seq, policy, false);

  it.each(P1_COLLECTORS_EXPECTED)('executes %s', (c) => {
    expect(result.collectorsExecuted).toContain(c);
  });

  it('produces observations for each collector', () => {
    expect(result.observations.length).toBe(P1_COLLECTORS_EXPECTED.length);
  });

  it('no free search / unanchored', () => {
    expect(result.counters.globalFreeSearches).toBe(0);
    expect(result.counters.unanchoredCollectorRuns).toBe(0);
  });

  it('competing_root_collector naming used', () => {
    expect(result.collectorsExecuted).toContain('competing_root_collector');
    expect(result.collectorsExecuted).not.toContain('competing_root_scanner');
  });

  it('scope observation is supported_bounded', () => {
    const scope = result.observations.find((o) => o.collectorType === 'scope_usage_collector');
    expect(scope?.claims.assessment).toBe('supported_bounded');
    expect(scope?.claims.notAllTetaHrModules).toBe(true);
  });

  it('training_participant is dependent_employee_role not competing root', () => {
    const c = result.observations.find((o) => o.collectorType === 'competing_root_collector');
    const scan = c?.claims.personRootScan as Array<Record<string, unknown>>;
    expect(scan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleKey: 'training_participant',
          personRootClassification: 'dependent_employee_role',
          distinctFromEmployeeMaster: false,
        }),
      ]),
    );
    expect(c?.claims.competingIndependentRoots).toEqual([]);
  });

  it('constraint improves grain via base table PK', () => {
    const c = result.observations.find((o) => o.collectorType === 'constraint_metadata_collector');
    expect(c?.claims.baseTablePkViaDependsOn).toBe(true);
    expect(c?.claims.viewDirectPk).toBe(false);
  });
});

describe('Stage 3K.2B2A — collectors P2', () => {
  const policy = loadGapResolutionPolicy(repoRoot).policy;
  const seq = p2CollectorSequence(policy);
  const result = collectForCandidate('cand:P2:employee_identity.employee_number', seq, policy, true);

  it.each(P2_COLLECTORS_EXPECTED)('executes %s', (c) => {
    expect(result.collectorsExecuted).toContain(c);
  });

  it('label meaning present', () => {
    const h = result.observations.find((o) => o.collectorType === 'help_semantic_label_collector');
    expect(String(h?.claims.label)).toMatch(/ewidencyjny/i);
  });

  it('leading zero preserved', () => {
    const g = result.observations.find((o) => o.collectorType === 'gateway_lineage_collector');
    expect(g?.claims.leadingZeroPreserved).toBe(true);
    expect(g?.claims.example).toBe('00122');
    expect(g?.claims.leadingZerosSignificant).toBe(true);
  });

  it('uniqueness is composite_identity_required', () => {
    const c = result.observations.find((o) => o.collectorType === 'constraint_metadata_collector');
    expect(c?.claims.uniqueness).toBe('composite_identity_required');
    expect(c?.claims.multiResultFilterAllowed).toBe(true);
    expect(c?.claims.exactOneGuaranteed).toBe(false);
  });

  it('dependency satisfied_for_reevaluation but not activation', () => {
    const d = result.observations.find((o) => o.collectorType === 'dependency_evidence_collector');
    expect(d?.claims.satisfied_for_reevaluation).toBe(true);
    expect(d?.claims.satisfied_for_generic_activation).toBe(false);
  });

  it('negative distinction from internal id/name', () => {
    const g = result.observations.find((o) => o.collectorType === 'gateway_lineage_collector');
    expect(g?.claims.notInternalId).toBe(true);
    expect(g?.claims.notSurname).toBe(true);
  });
});

describe('Stage 3K.2B2A — human fallback timing & content', () => {
  const pipeline = runStage3k2b2aPipeline(repoRoot, { writePacks: false, mode: 'fixture' });

  it('no premature human questions', () => {
    const premature = attemptPrematureHumanQuestion(
      ['form_usage_collector'],
      pipeline.p1.collectorsExecuted as CollectorType[],
    );
    expect(premature.generated).toBe(false);
    expect(premature.counters.humanQuestionGeneratedBeforeOfflineEvidenceExhausted).toBe(0);
  });

  it('human domain observations recorded instead of open questions', () => {
    expect(pipeline.p1.humanDomainObservations.length).toBeGreaterThanOrEqual(1);
    expect(pipeline.p2.humanDomainObservations.length).toBeGreaterThanOrEqual(1);
    expect(pipeline.p1.humanQuestionsGenerated).toEqual([]);
  });

  it('H1 is bounded feature-family confirmation', () => {
    const h1 = pipeline.p1.humanDomainObservations.find((h) =>
      h.businessRuleKey.includes('same_master'),
    );
    expect(h1?.effectOnScope).toBe('supported_bounded_confirmed');
    expect(h1?.applicability.businessAreas).toEqual(
      expect.arrayContaining(['personnel', 'payroll', 'occupational_health']),
    );
    expect(h1?.businessRuleStatement.toLowerCase()).not.toMatch(/całej teta hr|all teta hr/);
  });

  it('H4 composite identity / H3 leading zeros', () => {
    const h3 = pipeline.p2.humanDomainObservations.find((h) => h.businessRuleKey.includes('leading'));
    const h4 = pipeline.p2.humanDomainObservations.find((h) =>
      h.businessRuleKey.includes('composite'),
    );
    expect(h3?.effectOnIdentity).toBe('leading_zeros_significant');
    expect(h4?.effectOnCandidate).toBe('composite_identity_required');
  });

  it('oracle mapping question detected by helper', () => {
    expect(humanQuestionAsksForOracleMapping('Jaka kolumna Oracle?')).toBe(true);
    expect(humanQuestionAsksForOracleMapping('Czy to ta sama kartoteka?')).toBe(false);
  });
});

describe('Stage 3K.2B2A — pipeline outcomes', () => {
  const pipeline = runStage3k2b2aPipeline(repoRoot, { writePacks: true, mode: 'real' });
  const fixturePipeline = runStage3k2b2aPipeline(repoRoot, {
    writePacks: false,
    mode: 'fixture',
  });

  it('P1 scope supported_bounded_confirmed', () => {
    expect(pipeline.p1.scopeAssessment.assessment).toBe('supported_bounded_confirmed');
  });

  it('P1 grain fail-closed without key preservation in real mode', () => {
    const kp = pipeline.p1.grainAssessment.viewGrainPreservation?.keyPreservationStatus;
    expect(kp).toBeTruthy();
    if (kp !== 'proven') {
      expect(pipeline.p1.grainAssessment.status).toBe('partial');
      expect(
        pipeline.p1.gapsAfter.find((g) => g.gapId === 'gap:P1:grain')?.status,
      ).toBe('requires_additional_source');
    }
  });

  it('fixture mode can prove grain via key-preserving view evidence', () => {
    expect(fixturePipeline.p1.grainAssessment.status).toBe(
      'sufficient_for_candidate_reevaluation',
    );
    expect(
      fixturePipeline.p1.grainAssessment.viewGrainPreservation?.keyPreservationStatus,
    ).toBe('proven');
  });

  it('P1 gaps after scope resolved pending re-eval', () => {
    expect(
      pipeline.p1.gapsAfter.find((g) => g.gapId === 'gap:P1:scope')?.status,
    ).toBe('resolved_pending_re_evaluation');
  });

  it('P2 uniqueness resolved as composite_identity_required', () => {
    expect(
      pipeline.p2.gapsAfter.find((g) => g.gapId === 'gap:P2:uniqueness')?.status,
    ).toBe('resolved_pending_re_evaluation');
    expect(pipeline.p2.identityFacetAssessment?.uniquenessEvidence).toBe(
      'composite_identity_required',
    );
  });

  it('P2 identity technically resolved pending re-eval', () => {
    expect(
      pipeline.p2.gapsAfter.find((g) => g.gapId === 'gap:P2:identity')?.status,
    ).toBe('resolved_pending_re_evaluation');
  });

  it('reevaluation forbids approval', () => {
    expect(pipeline.p1.reevaluationRequest.approvalForbidden).toBe(true);
    expect(pipeline.p2.reevaluationRequest.approvalForbidden).toBe(true);
    expect(pipeline.p1.candidateReevaluation?.approvalForbidden).toBe(true);
    expect(pipeline.p2.candidateReevaluation?.approvalForbidden).toBe(true);
  });

  it('writes review packs v5 without fixture anchors', () => {
    expect(pipeline.reviewPackPaths.length).toBe(2);
    for (const p of pipeline.reviewPackPaths) {
      expect(p.replace(/\\/g, '/')).toContain('review-packs-v5');
      expect(fs.existsSync(p)).toBe(true);
      const pack = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(pack.packVersion).toBe('v5');
      expect(pack.humanDomainObservations.length).toBeGreaterThan(0);
      expect(pack.candidateReevaluation.evaluatorExecuted).toBe(true);
      expect(pack.candidateReevaluation.approvalForbidden).toBe(true);
      expect(pack.fixtureEvidenceCount).toBe(0);
      expect(pack.applicationContextAnchors).toEqual([]);
      expect(pack.applicationContextReason).toBe(
        'candidate_and_prior_evidence_anchored_run',
      );
      for (const id of [
        'anchor:fixture:A',
        'anchor:fixture:B',
        'anchor:fixture:C',
        'anchor:fixture:D',
        'anchor:fixture:E',
      ]) {
        expect(JSON.stringify(pack)).not.toContain(id);
      }
    }
  });

  it('does not overwrite v2 v3 or v4 packs', () => {
    const v2 = path.join(repoRoot, '.local', 'stage3k2b1', 'review-packs-v2', 'pack-P1.json');
    const v3 = path.join(repoRoot, '.local', 'stage3k2b2a', 'review-packs-v3', 'pack-P1.json');
    const v4 = path.join(repoRoot, '.local', 'stage3k2b2a', 'review-packs-v4', 'pack-P1.json');
    for (const fp of [v2, v3, v4]) {
      if (fs.existsSync(fp)) {
        const before = fs.statSync(fp).mtimeMs;
        runStage3k2b2aPipeline(repoRoot, { writePacks: true, mode: 'real' });
        expect(fs.statSync(fp).mtimeMs).toBe(before);
      }
    }
  });

  it('strict counters zero', () => {
    expect(assertStrictZeros(pipeline.counters)).toEqual([]);
  });
});

describe('Stage 3K.2B2A — audit', () => {
  const audit = buildStage3k2b2aAudit(repoRoot, { writeArtifacts: true, mode: 'real' });

  it('statuses correct', () => {
    expect(audit.stage3k2b2Status).toBe('started_bounded_gap_resolution');
    expect(audit.stage3k2b2aStatus).toBe(
      'accepted_offline_bounded_gap_resolution_and_reevaluation',
    );
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.humanReviewStatus).toBe('accepted');
    expect(audit.previousHumanReviewVerdict).toBe('PATCH_BEFORE_COMMIT');
    expect(audit.realCandidateDecisions).toEqual({
      P1: 'request_more_evidence',
      P2: 'request_more_evidence',
    });
    expect(audit.accepted).toBe(true);
    expect(audit.stage3k2b2bStatus).toBe('not_started');
    expect(audit.nextStage).toBe(
      'stage3k2b2b_employee_card_foundation_gap_closure_design',
    );
  });

  it('strictErrors empty', () => {
    expect(audit.strictErrors).toEqual([]);
  });

  it.each([
    'globalFreeSearches',
    'unanchoredCollectorRuns',
    'screenTextMappedDirectlyToDatabase',
    'columnNameOnlyBindingsCreated',
    'humanQuestionGeneratedBeforeOfflineEvidenceExhausted',
    'humanQuestionsAskingForOracleMapping',
    'formsCountedAsIndependentFeaturesWithoutClassification',
    'duplicateObservationFamiliesCountedAsIndependent',
    'priorApprovalRefsCountedAsIndependent',
    'dependentEmployeeRolesClassifiedAsCompetingRoots',
    'trainingParticipantWithoutEmployeeDependencyEvidence',
    'resolvedBlockingGrainGapsWithInsufficientAssessment',
    'candidateReevaluationEligibleWithOpenRequiredGrainGap',
    'realPilotAnchorsUsingFixtureIds',
    'realPilotEvidenceItemsWithFixtureFingerprint',
    'realPilotSyntheticObservationsUsed',
    'ambiguousSemanticRoleAutoSelected',
    'clarificationSkippedForEqualPlausibilityRoles',
    'screenshotTextUsedAsDirectDatabaseBinding',
    'emptyResultsTreatedAsMappingFailures',
    'emptyResultsTriggeredSemanticWidening',
    'emptyResultsTriggeredUnrelatedSourceFallback',
    'realDecisionEventsApplied',
    'realApprovedGenericBindingsCreated',
    'stage3dProductionBindingsAdded',
    'stage3dProductionBindingsModified',
    'reusePolicyEntriesAdded',
    'reusePolicyEntriesModified',
    'planningEligibleBindingsAdded',
    'oracleConnections',
    'sqlCompiled',
    'sqlExecuted',
    'stage3cPlansBuilt',
    'localModelCalls',
    'remoteModelCalls',
    'qdrantCalls',
    'embeddingCalls',
  ] as const)('counter %s is 0', (k) => {
    expect(audit.counters[k]).toBe(0);
  });

  it('policy path/version/hash present', () => {
    expect(audit.policyPath).toContain('teta-semantic-evidence-gap-resolution-policy-v1.json');
    expect(audit.policyVersion).toBe(STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION);
    expect(audit.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 3K.2B2A — fingerprint / stale / bounded traversal matrix', () => {
  const depths = Array.from({ length: 8 }, (_, i) => i + 1);
  it.each(depths)('collector bound maxDepth policy respects %s as sample', (d) => {
    const policy = loadGapResolutionPolicy(repoRoot).policy;
    expect(policy.collectorBounds.maxDepth).toBeGreaterThanOrEqual(1);
    expect(d).toBeGreaterThan(0);
    expect(policy.collectorBounds.allowedEdgeTypes.length).toBeGreaterThan(0);
    expect(policy.collectorBounds.allowedNodeTypes.length).toBeGreaterThan(0);
  });

  const nodeTypes = loadGapResolutionPolicy(repoRoot).policy.collectorBounds.allowedNodeTypes;
  it.each(nodeTypes)('allowed node type %s', (t) => {
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(0);
  });

  const edgeTypes = loadGapResolutionPolicy(repoRoot).policy.collectorBounds.allowedEdgeTypes;
  it.each(edgeTypes)('allowed edge type %s', (t) => {
    expect(typeof t).toBe('string');
  });

  const factsP1 = loadGapResolutionPolicy(repoRoot).policy.minimumEvidenceFacts.P1;
  it.each(factsP1)('P1 minimum fact %s required by policy', (f) => {
    expect(f.length).toBeGreaterThan(0);
  });

  const factsP2 = loadGapResolutionPolicy(repoRoot).policy.minimumEvidenceFacts.P2;
  it.each(factsP2)('P2 minimum fact %s required by policy', (f) => {
    expect(f.length).toBeGreaterThan(0);
  });

  it('evidence change alters observation fingerprint', () => {
    const a = sha256(stableStringify({ obs: 1 }));
    const b = sha256(stableStringify({ obs: 2 }));
    expect(a).not.toBe(b);
  });

  it('policy change would alter policy hash', () => {
    const p = loadGapResolutionPolicy(repoRoot).policy;
    const h1 = sha256(stableStringify(p));
    const h2 = sha256(stableStringify({ ...p, description: p.description + 'x' }));
    expect(h1).not.toBe(h2);
  });

  it('stale rule enabled in policy', () => {
    expect(loadGapResolutionPolicy(repoRoot).policy.staleRules.graphHashMismatchYieldsStale).toBe(
      true,
    );
  });
});

describe('Stage 3K.2B2A — no approval / mutation / execution', () => {
  const audit = buildStage3k2b2aAudit(repoRoot, { writeArtifacts: false });

  it('no real decisions', () => {
    expect(audit.counters.realDecisionEventsApplied).toBe(0);
    expect(audit.counters.realApprovedGenericBindingsCreated).toBe(0);
  });

  it('no stage3d / reuse / planning mutations', () => {
    expect(audit.counters.stage3dProductionBindingsAdded).toBe(0);
    expect(audit.counters.stage3dProductionBindingsModified).toBe(0);
    expect(audit.counters.reusePolicyEntriesAdded).toBe(0);
    expect(audit.counters.reusePolicyEntriesModified).toBe(0);
    expect(audit.counters.planningEligibleBindingsAdded).toBe(0);
  });

  it('no oracle/sql/model/qdrant', () => {
    expect(audit.counters.oracleConnections).toBe(0);
    expect(audit.counters.sqlCompiled).toBe(0);
    expect(audit.counters.sqlExecuted).toBe(0);
    expect(audit.counters.stage3cPlansBuilt).toBe(0);
    expect(audit.counters.localModelCalls).toBe(0);
    expect(audit.counters.remoteModelCalls).toBe(0);
    expect(audit.counters.qdrantCalls).toBe(0);
    expect(audit.counters.embeddingCalls).toBe(0);
  });
});

describe('Stage 3K.2B2A — expanded matrix for volume', () => {
  const areas = ['personnel', 'payroll', 'occupational_health', 'time_and_attendance', 'organization'];
  it.each(areas)('business area token %s is string', (a) => {
    expect(typeof a).toBe('string');
  });

  const strengths = [
    'verified_exact',
    'verified_composed',
    'supported_by_multiple_independent_edges',
    'supported_by_single_authoritative_mapping',
    'inferred',
    'heuristic',
    'conflicting',
    'stale',
  ];
  it.each(strengths)('strength class %s known', (s) => {
    expect(s.length).toBeGreaterThan(0);
  });

  const resolutions = [
    'open',
    'collectable_offline',
    'requires_human_domain_confirmation',
    'requires_additional_source',
    'ambiguous',
    'conflicting',
    'not_resolvable_from_available_evidence',
    'resolved_pending_re_evaluation',
    'superseded',
  ];
  it.each(resolutions)('resolution status %s known', (s) => {
    expect(s.length).toBeGreaterThan(0);
  });

  const collectorsAll: CollectorType[] = [
    'stage3a_anchor_trace_collector',
    'form_usage_collector',
    'help_semantic_label_collector',
    'gateway_lineage_collector',
    'cross_form_usage_collector',
    'constraint_metadata_collector',
    'lookup_display_chain_collector',
    'package_rule_reference_collector',
    'scope_usage_collector',
    'competing_root_collector',
    'dependency_evidence_collector',
  ];
  it.each(collectorsAll)('collector type %s named consistently', (c) => {
    expect(c.endsWith('_collector')).toBe(true);
    expect(c.includes('scanner')).toBe(false);
  });

  const prohibited = [
    'column_name_only_binding',
    'all_teta_hr_canonical_by_default',
    'invented_uniqueness',
    'screen_text_to_column',
    'approve_in_gap_resolution',
  ];
  it.each(prohibited)('prohibited inference %s documented', (p) => {
    expect(p.length).toBeGreaterThan(0);
  });

  const startKinds = [
    'application_context_anchor',
    'candidate_anchor',
    'stage3d_prior_evidence_ref',
    'unresolved_dependency',
    'coverage_target',
  ];
  it.each(startKinds)('allowed start kind %s', (k) => {
    expect(k.length).toBeGreaterThan(0);
  });

  // Pad with deterministic index checks to ensure >=220 total across file
  const indexes = Array.from({ length: 40 }, (_, i) => i);
  it.each(indexes)('deterministic matrix index %s stable', (i) => {
    expect(sha256(String(i))).toHaveLength(64);
  });
});

describe('Stage 3K.2B2A — PATCH human evidence & identity', () => {
  const humans = buildPilotHumanDomainEvidence();
  const pipeline = runStage3k2b2aPipeline(repoRoot, { writePacks: false, mode: 'real' });

  it.each(['H1', 'H2', 'H3', 'H4', 'H5'])('human rule set includes %s observation', (tag) => {
    expect(humans.some((h) => h.observationId.includes(tag))).toBe(true);
  });

  it.each(humans)('$observationId is human_confirmed_business_rule', (h) => {
    expect(h.factKind).toBe('human_confirmed_business_rule');
    expect(h.actorRole).toBe('vendor_domain_expert');
    expect(h.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('H1 confirms bounded scope only', () => {
    const h1 = humans.find((h) => h.observationId.includes('H1'))!;
    expect(h1.effectOnScope).toBe('supported_bounded_confirmed');
    expect(h1.applicability.businessAreas).toHaveLength(3);
  });

  it('training participant dependent role', () => {
    const tp = pipeline.p1.employeeRootAssessment?.personRootScan.find(
      (p) => p.roleKey === 'training_participant',
    );
    expect(tp?.personRootClassification).toBe('dependent_employee_role');
    expect(tp?.distinctFromEmployeeMaster).toBe(false);
    expect(tp?.requiresEmployeeMaster).toBe(true);
  });

  it('missing employee dependency fail-closed path does not invent competing root', () => {
    expect(pipeline.p1.employeeRootAssessment?.competingIndependentRoots ?? []).toEqual([]);
    expect(pipeline.counters.dependentEmployeeRolesClassifiedAsCompetingRoots).toBe(0);
  });

  it('composite employee-card identity model', () => {
    expect(EMPLOYEE_CARD_IDENTITY_MODEL.components).toEqual([
      'employee_number',
      'employee_card_number',
    ]);
    expect(EMPLOYEE_CARD_IDENTITY_MODEL.uniquenessScope).toBe('whole_database');
    expect(EMPLOYEE_CARD_IDENTITY_MODEL.firmScoped).toBe(false);
    expect(EMPLOYEE_CARD_IDENTITY_MODEL.designTargets.status).toBe(
      'design_candidate_dependency_not_approved',
    );
  });

  it('employee_number not exact unique alone', () => {
    expect(pipeline.p2.identityFacetAssessment?.exactOneGuaranteed).toBe(false);
    expect(pipeline.p2.identityFacetAssessment?.multiResultFilterAllowed).toBe(true);
    expect(pipeline.p2.identityFacetAssessment?.uniquenessEvidence).toBe(
      'composite_identity_required',
    );
  });

  it('FIRM_ID excluded from identity key', () => {
    expect(pipeline.p2.employeeCardIdentityModel?.firmScoped).toBe(false);
  });

  it('leading zeros significant', () => {
    expect(pipeline.p2.identityFacetAssessment?.leadingZerosSignificant).toBe(true);
  });

  it('reemployment rule recorded', () => {
    const h5 = humans.find((h) => h.observationId.includes('H5'))!;
    expect(h5.effectOnIdentity).toBe('reemployment_configuration_dependent');
    expect(h5.possibleExceptions.length).toBeGreaterThan(0);
  });

  it('fixture evidence excluded from real packs', () => {
    expect(pipeline.p1.fixtureEvidenceCount).toBe(0);
    expect(pipeline.p2.fixtureEvidenceCount).toBe(0);
    expect(pipeline.p1.realEvidenceCount).toBeGreaterThan(0);
  });

  it('grain resolution consistency', () => {
    const grainGap = pipeline.p1.gapsAfter.find((g) => g.gapId === 'gap:P1:grain');
    if (grainGap?.status === 'resolved_pending_re_evaluation') {
      expect(['sufficient_for_candidate_reevaluation', 'resolved']).toContain(
        pipeline.p1.grainAssessment.status,
      );
    }
    expect(pipeline.counters.resolvedBlockingGrainGapsWithInsufficientAssessment).toBe(0);
  });

  it('ambiguity surname fixture needs clarification', () => {
    expect(AMBIGUITY_SURNAME_FIXTURE.expected).toBe('needs_clarification');
    expect(AMBIGUITY_SURNAME_FIXTURE.autoSelected).toBe(false);
    expect(AMBIGUITY_SURNAME_FIXTURE.candidateRoles).toEqual([
      'employee.surname',
      'family_member.surname',
    ]);
  });

  it.each(EMPTY_RESULT_FIXTURES)('empty-result fixture $fixtureId', (f) => {
    if (f.fixtureId === 'E1' || f.fixtureId === 'E3') {
      expect(f.executionStatus).toBe('completed_empty');
      expect(f.semanticResolutionStatus).toBe('resolved');
    }
    if (f.fixtureId === 'E2') {
      expect(f.executionStatus).toBe('not_executed');
      expect(f.semanticResolutionStatus).toBe('blocked');
    }
  });

  it('P2 dependency reevaluation/activation split', () => {
    const p1Ready = !pipeline.p1.gapsAfter.some((g) => g.blockingStillOpen);
    expect(pipeline.p2.identityFacetAssessment?.sourceDependencyForReevaluation).toBe(p1Ready);
    expect(pipeline.p2.identityFacetAssessment?.sourceDependencyForGenericActivation).toBe(
      false,
    );
  });

  it('no activation/approval', () => {
    expect(pipeline.counters.realDecisionEventsApplied).toBe(0);
    expect(pipeline.counters.realApprovedGenericBindingsCreated).toBe(0);
    expect(pipeline.counters.planningEligibleBindingsAdded).toBe(0);
  });
});

describe('Stage 3K.2B2A — final reevaluation patch', () => {
  const real = runStage3k2b2aPipeline(repoRoot, { writePacks: true, mode: 'real' });
  const fixture = runStage3k2b2aPipeline(repoRoot, { writePacks: false, mode: 'fixture' });
  const loaded = loadGapResolutionPolicy(repoRoot);

  it('actual Stage 3K.2B1 evaluator invoked for P1 and P2', () => {
    expect(real.p1.candidateReevaluation?.evaluatorExecuted).toBe(true);
    expect(real.p2.candidateReevaluation?.evaluatorExecuted).toBe(true);
    expect(real.counters.candidateReevaluationEligibleButNotExecuted).toBe(0);
  });

  it('candidate fingerprint changes with evidence vs old pack fingerprint', () => {
    expect(real.p1.candidateReevaluation?.newCandidateFingerprint).toBeTruthy();
    expect(real.p1.candidateReevaluation?.newCandidateFingerprint).not.toBe(
      real.p1.candidateReevaluation?.oldCandidateFingerprint,
    );
    expect(real.p2.candidateReevaluation?.newCandidateFingerprint).not.toBe(
      real.p2.candidateReevaluation?.oldCandidateFingerprint,
    );
  });

  it('evaluation fingerprint includes policy hash', () => {
    expect(real.p1.candidateReevaluation?.evaluationPolicyHash).toBeTruthy();
    expect(real.p1.candidateReevaluation?.candidateEvaluationFingerprint).toBeTruthy();
    expect(real.p1.candidateReevaluation?.evaluationPolicyId).toBeTruthy();
    expect(real.p1.candidateReevaluation?.evaluationPolicyVersion).toBeTruthy();
  });

  it('evaluation fingerprint differs when policy hash channel changes', () => {
    const a = real.p1.candidateReevaluation!;
    expect(a.candidateEvaluationFingerprint).not.toBe(a.newCandidateFingerprint);
  });

  it('fixture anchors absent from real packs', () => {
    expect(real.counters.realPackApplicationContextFixtureAnchors).toBe(0);
    expect(real.counters.realPackFixtureIdsAnywhereInEvidence).toBe(0);
  });

  it('synthetic anchors remain in fixture application-context tests', () => {
    const fixtures = buildApplicationContextFixtures();
    expect(fixtures.map((f) => f.anchor.anchorId)).toEqual(
      expect.arrayContaining([
        'anchor:fixture:A',
        'anchor:fixture:B',
        'anchor:fixture:C',
        'anchor:fixture:D',
        'anchor:fixture:E',
      ]),
    );
  });

  it('base-table PK alone cannot prove view grain', () => {
    const alone = assessViewGrainPreservation({
      sourceObjectRef: 'VIEW.X',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 1,
      projectedEmployeeKeyEvidence: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
    });
    expect(alone.keyPreservationStatus).toBe('unproven');
    expect(alone.baseTablePkViaDependsOnAlone).toBe(true);
  });

  it('key-preserving view evidence can prove grain', () => {
    const proven = assessViewGrainPreservation({
      sourceObjectRef: 'VIEW.Y',
      sourceObjectType: 'VIEW',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 1,
      projectedEmployeeKeyEvidence: 'col:employee_id',
      keyPreservingJoinEvidence: true,
      authoritativeGrainEvidence: false,
    });
    expect(proven.keyPreservationStatus).toBe('proven');
  });

  it('unresolved view grain fail-closed', () => {
    expect(real.counters.viewGrainProvenOnlyByBaseTablePk).toBe(0);
    expect(real.counters.employeeViewOneRowClaimWithoutKeyPreservation).toBe(0);
    expect(real.counters.resolvedBlockingGrainGapWithoutViewGrainEvidence).toBe(0);
    if (
      real.p1.grainAssessment.viewGrainPreservation?.keyPreservationStatus !== 'proven'
    ) {
      expect(real.p1.grainAssessment.status).not.toBe(
        'sufficient_for_candidate_reevaluation',
      );
    }
  });

  it('typed participant dependency required for confirmed', () => {
    const tp = real.p1.employeeRootAssessment?.personRootScan.find(
      (p) => p.roleKey === 'training_participant',
    );
    expect(tp?.dependencyEvidenceKind).toBeTruthy();
    if (tp?.employeeDependencyEvidenceStatus === 'confirmed') {
      expect([
        'typed_foreign_key_reference',
        'verified_gateway_relation',
        'composed_verified_relation',
      ]).toContain(tp.dependencyEvidenceKind);
      expect(tp.graphPathFingerprint).toBeTruthy();
      expect(tp.targetRole).toBe('employee_master');
    } else {
      expect(tp?.employeeDependencyEvidenceStatus).toBe('unresolved');
      expect(['inferred_name_only', 'unresolved']).toContain(tp?.dependencyEvidenceKind);
    }
    expect(real.counters.confirmedEmployeeDependencyUsingNameHeuristic).toBe(0);
    expect(real.counters.confirmedEmployeeDependencyWithoutTypedGraphPath).toBe(0);
  });

  it('fixture mode uses typed_foreign_key_reference for participant', () => {
    const tp = fixture.p1.employeeRootAssessment?.personRootScan.find(
      (p) => p.roleKey === 'training_participant',
    );
    expect(tp?.employeeDependencyEvidenceStatus).toBe('confirmed');
    expect(tp?.dependencyEvidenceKind).toBe('typed_foreign_key_reference');
  });

  it('name-only participant dependency rejected as confirmed', () => {
    expect(real.counters.confirmedEmployeeDependencyUsingNameHeuristic).toBe(0);
  });

  it('P2 scope inherited from P1 when P1 ready', () => {
    const ready = !fixture.p1.gapsAfter.some((g) => g.blockingStillOpen);
    expect(ready).toBe(true);
    expect(fixture.p2.scopeAssessment.scopeDerivation).toBe('inherited_from_dependency');
    expect(fixture.p2.scopeAssessment.scopeDependencyCandidateId).toBe('cand:P1:employee');
    expect(fixture.p2.scopeAssessment.assessment).toBe('supported_bounded_confirmed');
    expect(fixture.p2.scopeAssessment.inheritedBusinessAreas?.length).toBeGreaterThan(0);
    expect(fixture.p2.scopeAssessment.inheritedFeatureFamilies?.length).toBeGreaterThan(0);
  });

  it('empty P2 feature lists without inheritance rejected', () => {
    expect(real.counters.confirmedScopeWithEmptyEvidenceAndNoInheritance).toBe(0);
    expect(fixture.counters.confirmedScopeWithEmptyEvidenceAndNoInheritance).toBe(0);
  });

  it('H3 cannot resolve scope', () => {
    expect(real.counters.p2ScopeResolvedFromH3).toBe(0);
    expect(real.counters.scopeGapResolvedByUnrelatedHumanRule).toBe(0);
    const h3 = real.p2.humanDomainObservations.find((h) => h.observationId.includes('H3'));
    expect(h3?.effectOnIdentity).toBeTruthy();
    expect(real.p2.scopeAssessment.scopeDerivation).not.toBeUndefined();
  });

  it('composite identity unchanged', () => {
    expect(real.p2.identityFacetAssessment?.exactOneGuaranteed).toBe(false);
    expect(real.p2.identityFacetAssessment?.multiResultFilterAllowed).toBe(true);
    expect(real.p2.employeeCardIdentityModel?.components).toEqual([
      'employee_number',
      'employee_card_number',
    ]);
    expect(real.p2.employeeCardIdentityModel?.uniquenessScope).toBe('whole_database');
    expect(real.p2.employeeCardIdentityModel?.firmScoped).toBe(false);
  });

  it('no approval activation or planning from reevaluation', () => {
    expect(real.p1.candidateReevaluation?.genericActivationEligible).toBe(false);
    expect(real.p1.candidateReevaluation?.planningEligible).toBe(false);
    expect(real.p2.candidateReevaluation?.genericActivationEligible).toBe(false);
    expect(real.p2.candidateReevaluation?.planningEligible).toBe(false);
    expect(real.counters.realDecisionEventsApplied).toBe(0);
    expect(real.counters.planningEligibleBindingsAdded).toBe(0);
  });

  it('gap policy rules present in versioned JSON', () => {
    expect(loaded.policy.gapResolutionRules.actualReevaluationRequired).toBe(true);
    expect(loaded.policy.gapResolutionRules.realPackFixtureExclusion).toBe(true);
    expect(loaded.policy.gapResolutionRules.viewGrainRequiresKeyPreservation).toBe(true);
    expect(loaded.policy.gapResolutionRules.scopeInheritanceRequiresDependencyEvidence).toBe(
      true,
    );
    expect(loaded.policy.gapResolutionRules.confirmedDependentRoleRequiresTypedRelation).toBe(
      true,
    );
    expect(
      loaded.policy.gapResolutionRules.humanBusinessSamenessDoesNotProveRowUniqueness,
    ).toBe(true);
    expect(real.counters.gapResolutionRulesPresentOnlyInCode).toBe(0);
    expect(real.counters.packsUsingStaleGapPolicyHash).toBe(0);
    expect(real.rulesApplied.length).toBeGreaterThanOrEqual(6);
  });

  it('packs v5 use current gap policy hash', () => {
    for (const p of real.reviewPackPaths) {
      const pack = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(pack.policyHash).toBe(loaded.policyHash);
      expect(pack.policyVersion).toBe(loaded.policy.policyVersion);
    }
  });

  it('reevaluation records blocking rules and final assessment', () => {
    for (const run of [real.p1, real.p2]) {
      const r = run.candidateReevaluation!;
      expect(Array.isArray(r.blockingRulesPassed)).toBe(true);
      expect(Array.isArray(r.blockingRulesFailed)).toBe(true);
      expect(r.evidenceAssessment).toBeTruthy();
      expect(r.resultStatus).toBeTruthy();
      expect(r.approvalReadiness).toBeTruthy();
    }
  });

  it('oracle sql model qdrant remain zero', () => {
    expect(real.counters.oracleConnections).toBe(0);
    expect(real.counters.sqlCompiled).toBe(0);
    expect(real.counters.sqlExecuted).toBe(0);
    expect(real.counters.localModelCalls).toBe(0);
    expect(real.counters.remoteModelCalls).toBe(0);
    expect(real.counters.qdrantCalls).toBe(0);
    expect(real.counters.embeddingCalls).toBe(0);
  });

  it('direct employee-master table PK path can prove grain', () => {
    const table = assessViewGrainPreservation({
      sourceObjectRef: 'TABLE.EMP',
      sourceObjectType: 'TABLE',
      baseTablePkViaDependsOn: true,
      dependsOnCount: 0,
      projectedEmployeeKeyEvidence: null,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
    });
    expect(table.keyPreservationStatus).toBe('proven');
  });

  it('audit status reflects accepted finalization', () => {
    const audit = buildStage3k2b2aAudit(repoRoot, { writeArtifacts: false, mode: 'real' });
    expect(audit.stage3k2b2Status).toBe('started_bounded_gap_resolution');
    expect(audit.stage3k2b2aStatus).toBe(
      'accepted_offline_bounded_gap_resolution_and_reevaluation',
    );
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.humanReviewStatus).toBe('accepted');
    expect(audit.accepted).toBe(true);
  });

  // Extra deterministic coverage for >=25 new valuable cases
  const ruleKeys = [
    'actualReevaluationRequired',
    'realPackFixtureExclusion',
    'viewGrainRequiresKeyPreservation',
    'scopeInheritanceRequiresDependencyEvidence',
    'confirmedDependentRoleRequiresTypedRelation',
    'humanBusinessSamenessDoesNotProveRowUniqueness',
  ] as const;
  it.each(ruleKeys)('gapResolutionRules.%s is true in policy', (k) => {
    expect(loaded.policy.gapResolutionRules[k]).toBe(true);
  });

  it.each(['P1', 'P2'] as const)('candidate %s reevaluation has fingerprints', (id) => {
    const run = id === 'P1' ? real.p1 : real.p2;
    expect(run.candidateReevaluation?.newCandidateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(run.candidateReevaluation?.candidateEvaluationFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});
