import path from 'path';
import { readFileSync } from 'fs';
import {
  PILOT_COVERAGE_TARGETS,
  getPilotTarget,
  listPilotTargetIds,
  validateCoverageTarget,
  validateCandidate,
  assertNoProductionMutation,
  familyFromGraphNodeId,
  familyFromEvidenceType,
  isIndependentEvidenceFamily,
  INDEPENDENT_EVIDENCE_FAMILIES,
  RISK_CLASSES,
  VALUE_KINDS,
  sha256,
  stableStringify,
  expandEvidenceObservations,
  deriveOverallStrength,
  evaluateEvidenceThreshold,
  assessmentNeverApproved,
  buildCandidateFingerprintPayload,
  computeCandidateFingerprint,
  computeCandidateEvaluationFingerprint,
  computeDecisionFingerprint,
  discoverCandidates,
  buildHumanReviewPack,
  createEmptyDecisionLedger,
  appendSyntheticDecision,
  applyHumanDecision,
  validateDecisionSchema,
  buildStage3k2b1Audit,
  resolveRepoRootFromModule,
  STAGE3K2B1_CONTRACT_VERSION,
  STAGE3K2B1_COVERAGE_TARGET_VERSION,
  STAGE3K2B1_DECISION_CONTRACT_VERSION,
  STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION,
  SYNTHETIC_FIXTURE_DEFS,
  type TetaGenericSemanticBindingCandidate,
  type RawEvidenceObservation,
} from './index';

const repoRoot = resolveRepoRootFromModule();

describe('Stage 3K.2B1 — contracts', () => {
  it('exports contract versions', () => {
    expect(STAGE3K2B1_CONTRACT_VERSION).toBe('teta-aia-generic-semantic-candidate-v1');
    expect(STAGE3K2B1_COVERAGE_TARGET_VERSION).toBe('teta-aia-semantic-coverage-target-v1');
    expect(STAGE3K2B1_DECISION_CONTRACT_VERSION).toBe(
      'teta-aia-generic-semantic-binding-decision-v1',
    );
    expect(STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION).toContain('evaluation-policy');
  });

  it.each(INDEPENDENT_EVIDENCE_FAMILIES)('family %s is independent', (f) => {
    expect(isIndependentEvidenceFamily(f)).toBe(true);
  });

  it('approved_stage3d_role is NOT an independent family', () => {
    expect(isIndependentEvidenceFamily('approved_stage3d_role')).toBe(false);
  });

  it.each(RISK_CLASSES)('risk class %s listed', (r) => {
    expect(typeof r).toBe('string');
  });

  it.each(VALUE_KINDS)('value kind %s listed', (v) => {
    expect(typeof v).toBe('string');
  });

  it('sha256 and stableStringify are deterministic', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe('Stage 3K.2B1 — coverage targets', () => {
  it('lists exactly P1–P4', () => {
    expect(listPilotTargetIds()).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('excludes active_employment from pilot', () => {
    expect(PILOT_COVERAGE_TARGETS.some((t) => t.roleKey.includes('active_employment'))).toBe(
      false,
    );
  });

  it.each(PILOT_COVERAGE_TARGETS)('target $targetId validates', (t) => {
    expect(validateCoverageTarget(t)).toEqual([]);
  });

  it.each(PILOT_COVERAGE_TARGETS)('target $targetId has no oracle names', (t) => {
    const blob = JSON.stringify(t);
    expect(blob).not.toMatch(/\bNT_[A-Z0-9_]+\b/);
    expect(blob).not.toMatch(/oracle-/);
  });

  it('getPilotTarget returns P3', () => {
    expect(getPilotTarget('P3')?.roleKey).toBe('current_position');
  });

  it('rejects target with oracle name', () => {
    const bad = {
      ...PILOT_COVERAGE_TARGETS[0],
      semanticMeaning: 'uses NT_KP_PRC_PRACOWNICY',
    };
    expect(validateCoverageTarget(bad)).toContain(
      'coverage_target_must_not_contain_oracle_or_graph_ids',
    );
  });

  it.each(['targetId', 'conceptKey', 'roleKey', 'semanticMeaning'] as const)(
    'missing %s fails validation',
    (field) => {
      const bad = { ...PILOT_COVERAGE_TARGETS[0], [field]: '' };
      expect(validateCoverageTarget(bad).some((e) => e.includes(field))).toBe(true);
    },
  );

  it('P2 is identity_sensitive', () => {
    expect(getPilotTarget('P2')?.riskClass).toBe('identity_sensitive');
  });

  it('P3 is temporal_sensitive', () => {
    expect(getPilotTarget('P3')?.riskClass).toBe('temporal_sensitive');
  });

  it('P4 expects display_business_value', () => {
    expect(getPilotTarget('P4')?.expectedValueKind).toBe('display_business_value');
  });

  it('targets are requests for discovery not bindings', () => {
    for (const t of PILOT_COVERAGE_TARGETS) {
      expect((t as { status?: string }).status).toBeUndefined();
      expect((t as { approved?: boolean }).approved).toBeUndefined();
    }
  });
});

describe('Stage 3K.2B1 — evidence lineage', () => {
  const hash = 'abc';

  it('maps oracle-object to oracle_metadata_ddl', () => {
    expect(familyFromGraphNodeId('oracle-object:X:VIEW:Y')).toBe('oracle_metadata_ddl');
  });

  it('maps oracle-column to oracle_metadata_ddl', () => {
    expect(familyFromGraphNodeId('oracle-column:X:T:C')).toBe('oracle_metadata_ddl');
  });

  it('maps form to application_form_control', () => {
    expect(familyFromGraphNodeId('form:uuid:Name')).toBe('application_form_control');
  });

  it('maps BO join to dataset_gateway_join', () => {
    expect(familyFromGraphNodeId('join:Teta.Sumo.Personel.bosX.BO.Y:A:B:h')).toBe(
      'dataset_gateway_join',
    );
  });

  it('maps reconstructed evidence type', () => {
    expect(familyFromEvidenceType('reconstructed_sql_join')).toBe('sqljoin_reconstruction');
  });

  it('maps vendor_confirmed_relation', () => {
    expect(familyFromEvidenceType('vendor_confirmed_relation')).toBe('dataset_gateway_join');
  });

  it('dedupes same originObservationId', () => {
    const r = expandEvidenceObservations(
      [
        {
          nodeId: 'oracle-object:A',
          supports: ['concept'],
          sourceStage: 't',
          graphSourceHash: hash,
          originObservationId: 'same',
        },
        {
          nodeId: 'oracle-object:A',
          supports: ['value'],
          sourceStage: 't',
          graphSourceHash: hash,
          originObservationId: 'same',
        },
      ],
      [],
    );
    expect(r.underlyingEvidenceRefs).toHaveLength(1);
    expect(r.duplicateEvidenceObservationsDeduplicated).toBe(1);
    expect(r.independentEvidenceFamilies).toEqual(['oracle_metadata_ddl']);
    expect(r.duplicateObservationFamiliesCountedAsIndependent).toBe(0);
  });

  it('prior approvals never counted independent', () => {
    const r = expandEvidenceObservations(
      [
        {
          nodeId: 'oracle-object:A',
          supports: ['concept'],
          sourceStage: 't',
          graphSourceHash: hash,
        },
      ],
      [
        {
          type: 'approved_stage3d_role',
          subject: 'occupational_health_examinations',
          roleKey: 'employee',
          bindingKind: 'source',
          status: 'approved',
          homeSubjectScope: 'occupational_health_examinations',
        },
      ],
    );
    expect(r.priorApprovalReferencesSeen).toBe(1);
    expect(r.priorApprovalReferencesCountedAsIndependentEvidence).toBe(0);
    expect(r.independentEvidenceFamilies).not.toContain('approved_stage3d_role' as never);
  });

  it.each([
    ['stale', { stale: true }, 'stale'],
    ['conflicting', { conflicting: true }, 'conflicting'],
    ['inferred', { inferredOnly: true }, 'inferred'],
    ['heuristic', { heuristicOnly: true }, 'heuristic'],
  ] as const)('deriveOverallStrength %s', (_n, opts, expected) => {
    expect(deriveOverallStrength([], opts)).toBe(expected);
  });

  it('multi family → supported_by_multiple_independent_edges', () => {
    const items = [
      {
        evidenceId: '1',
        family: 'oracle_metadata_ddl' as const,
        originObservationId: 'a',
        lineageKey: 'a',
        strength: 'verified_exact' as const,
        supports: ['concept' as const],
        sourceStage: 't',
        graphSourceHash: hash,
      },
      {
        evidenceId: '2',
        family: 'application_form_control' as const,
        originObservationId: 'b',
        lineageKey: 'b',
        strength: 'verified_exact' as const,
        supports: ['concept' as const],
        sourceStage: 't',
        graphSourceHash: hash,
      },
    ];
    expect(deriveOverallStrength(items)).toBe('supported_by_multiple_independent_edges');
  });
});

describe('Stage 3K.2B1 — evidence threshold', () => {
  const base = {
    riskClass: 'normal_reference' as const,
    evidenceStrength: 'verified_exact' as const,
    independentFamilyCount: 2,
    conflicts: [] as string[],
    ambiguities: [] as string[],
    knownGaps: [] as string[],
    graphHashMismatch: false,
  };

  it('sufficient_for_review when strong', () => {
    const r = evaluateEvidenceThreshold(base);
    expect(r.assessment).toBe('sufficient_for_review');
    expect(r.readyForHumanReview).toBe(true);
  });

  it('stale on hash mismatch', () => {
    expect(evaluateEvidenceThreshold({ ...base, graphHashMismatch: true }).assessment).toBe(
      'stale',
    );
  });

  it('conflicting', () => {
    expect(
      evaluateEvidenceThreshold({ ...base, conflicts: ['x'] }).assessment,
    ).toBe('conflicting');
  });

  it('inferred only', () => {
    expect(evaluateEvidenceThreshold({ ...base, inferredOnly: true }).assessment).toBe(
      'needs_more_evidence',
    );
  });

  it('heuristic only', () => {
    expect(evaluateEvidenceThreshold({ ...base, heuristicOnly: true }).assessment).toBe(
      'needs_more_evidence',
    );
  });

  it('cardinality unresolved', () => {
    expect(
      evaluateEvidenceThreshold({ ...base, cardinalityUnresolved: true }).assessment,
    ).toBe('needs_more_evidence');
  });

  it('ambiguous', () => {
    expect(
      evaluateEvidenceThreshold({ ...base, ambiguities: ['a'] }).assessment,
    ).toBe('ambiguous');
  });

  it('identity facet required', () => {
    expect(
      evaluateEvidenceThreshold({
        ...base,
        riskClass: 'identity_sensitive',
        identityFacetSeparated: false,
      }).assessment,
    ).toBe('needs_more_evidence');
  });

  it('never returns approved', () => {
    const r = evaluateEvidenceThreshold(base);
    expect(assessmentNeverApproved({ candidateEvidenceAssessment: r.assessment })).toBe(true);
    expect(r.assessment).not.toBe('approved' as never);
  });

  it('ready means reviewable not approved', () => {
    const r = evaluateEvidenceThreshold(base);
    expect(r.readyForHumanReview).toBe(true);
    expect(r.candidateStatus).toBe('needs_review');
  });
});

describe('Stage 3K.2B1 — fingerprints', () => {
  function minimalCandidate(
    overrides: Partial<TetaGenericSemanticBindingCandidate> = {},
  ): TetaGenericSemanticBindingCandidate {
    const base = {
      contractVersion: STAGE3K2B1_CONTRACT_VERSION,
      candidateId: 'cand:test',
      coverageTargetId: 'P1',
      conceptKey: 'employee',
      roleKey: 'employee',
      semanticMeaning: 'm',
      relationMeaning: null,
      valueKind: 'business_value' as const,
      resultGrain: 'one_row_per_employee' as const,
      applicability: {
        productFamily: 'teta_hr',
        productSurface: 'g',
        businessArea: 'w',
        clientScope: 'bounded_teta_hr',
        versionScope: 'v1',
        currentHomeSubject: 'occupational_health_examinations',
        proposedGenericScope: 'bounded_teta_hr',
      },
      temporalPolicy: null,
      riskClass: 'normal_reference' as const,
      requiredDataDomain: 'hr',
      priorApprovalRefs: [],
      underlyingEvidenceRefs: [],
      independentEvidenceFamilies: [],
      evidenceStrength: 'verified_exact' as const,
      graphSourceHash: 'h',
      dependencyVector: {
        graphSourceHash: 'h',
        semanticBindingsVersion: 'v',
        ontologyVersion: 'o',
        stage3k2b1ContractVersion: STAGE3K2B1_CONTRACT_VERSION,
      },
      ambiguities: [],
      conflicts: [],
      knownGaps: [],
      warnings: [],
      candidateEvidenceAssessment: 'sufficient_for_review' as const,
      candidateStatus: 'needs_review' as const,
      readyForHumanReview: true,
      scopeExpansionRisk: [],
      whyMayBeGeneric: [],
      candidateEvaluationPolicyVersion: STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION,
      ...overrides,
    };
    const fp = computeCandidateFingerprint(buildCandidateFingerprintPayload(base));
    const efp = computeCandidateEvaluationFingerprint(fp);
    return { ...base, candidateFingerprint: fp, candidateEvaluationFingerprint: efp };
  }

  it('candidateFingerprint != candidateEvaluationFingerprint', () => {
    const c = minimalCandidate();
    expect(c.candidateFingerprint).not.toBe(c.candidateEvaluationFingerprint);
  });

  it('policy-only change keeps candidateFingerprint', () => {
    const c = minimalCandidate();
    const e1 = c.candidateEvaluationFingerprint;
    const e2 = computeCandidateEvaluationFingerprint(c.candidateFingerprint, 'alt-policy');
    expect(e1).not.toBe(e2);
  });

  it('evidence change changes candidateFingerprint', () => {
    const a = minimalCandidate();
    const b = minimalCandidate({
      underlyingEvidenceRefs: [
        {
          evidenceId: 'ev1',
          family: 'oracle_metadata_ddl',
          originObservationId: 'x',
          lineageKey: 'x',
          strength: 'verified_exact',
          supports: ['concept'],
          sourceStage: 't',
          graphSourceHash: 'h',
        },
      ],
    });
    expect(a.candidateFingerprint).not.toBe(b.candidateFingerprint);
  });

  it('scope change changes candidateFingerprint', () => {
    const a = minimalCandidate();
    const b = minimalCandidate({
      applicability: {
        ...a.applicability,
        proposedGenericScope: 'other',
      },
    });
    expect(a.candidateFingerprint).not.toBe(b.candidateFingerprint);
  });

  it('evidence order shuffle stable', () => {
    const refs = [
      {
        evidenceId: 'ev2',
        family: 'application_form_control' as const,
        originObservationId: 'b',
        lineageKey: 'b',
        strength: 'verified_exact' as const,
        supports: ['concept' as const],
        sourceStage: 't',
        graphSourceHash: 'h',
      },
      {
        evidenceId: 'ev1',
        family: 'oracle_metadata_ddl' as const,
        originObservationId: 'a',
        lineageKey: 'a',
        strength: 'verified_exact' as const,
        supports: ['concept' as const],
        sourceStage: 't',
        graphSourceHash: 'h',
      },
    ];
    const a = minimalCandidate({ underlyingEvidenceRefs: refs });
    const b = minimalCandidate({ underlyingEvidenceRefs: [...refs].reverse() });
    expect(a.candidateFingerprint).toBe(b.candidateFingerprint);
  });

  it('decision fingerprint includes actor', () => {
    const c = minimalCandidate();
    const d1 = computeDecisionFingerprint({
      candidateFingerprint: c.candidateFingerprint,
      candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
      actor: 'alice',
      decision: 'defer',
      reason: 'r',
      policyVersion: 'p',
      dependencyVector: c.dependencyVector,
    });
    const d2 = computeDecisionFingerprint({
      candidateFingerprint: c.candidateFingerprint,
      candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
      actor: 'bob',
      decision: 'defer',
      reason: 'r',
      policyVersion: 'p',
      dependencyVector: c.dependencyVector,
    });
    expect(d1).not.toBe(d2);
  });

  it('no timestamps in fingerprint payload keys that affect identity', () => {
    const c = minimalCandidate();
    const payload = buildCandidateFingerprintPayload(c);
    expect(JSON.stringify(payload)).not.toMatch(/timestamp|Date\.|C:\\\\|file:\/\//i);
  });
});

describe('Stage 3K.2B1 — pilot discovery P1–P4', () => {
  const result = discoverCandidates({ repoRoot, targetIds: ['P1', 'P2', 'P3', 'P4'] });

  it('generates 4 candidates', () => {
    expect(result.candidates).toHaveLength(4);
  });

  it.each(['P1', 'P2', 'P3', 'P4'])('includes %s', (id) => {
    expect(result.candidates.some((c) => c.coverageTargetId === id)).toBe(true);
  });

  it('P1 exposes BHP home subject and proposed generic scope', () => {
    const p1 = result.candidates.find((c) => c.coverageTargetId === 'P1')!;
    expect(p1.applicability.currentHomeSubject).toBe('occupational_health_examinations');
    expect(p1.applicability.proposedGenericScope).toBe('bounded_teta_hr');
    expect(p1.priorApprovalRefs.length).toBeGreaterThan(0);
    expect(p1.whyMayBeGeneric.length).toBeGreaterThan(0);
    expect(p1.scopeExpansionRisk.length).toBeGreaterThan(0);
    expect(p1.independentEvidenceFamilies.length).toBeGreaterThan(0);
  });

  it('P1 prior approval is not independent family', () => {
    const p1 = result.candidates.find((c) => c.coverageTargetId === 'P1')!;
    expect(p1.priorApprovalRefs.every((r) => r.type === 'approved_stage3d_role')).toBe(true);
    expect(p1.independentEvidenceFamilies as string[]).not.toContain('approved_stage3d_role');
  });

  it('P2 preserves leading zeros and identity facet', () => {
    const p2 = result.candidates.find((c) => c.coverageTargetId === 'P2')!;
    expect(p2.identitySemantics?.examplePreservedValue).toBe('00122');
    expect(p2.identitySemantics?.leadingZeroPreserved).toBe(true);
    expect(p2.identitySemantics?.stringPreserving).toBe(true);
    expect(p2.identitySemantics?.notInternalId).toBe(true);
    expect(p2.identitySemantics?.notSurname).toBe(true);
    expect(p2.riskClass).toBe('identity_sensitive');
    expect(p2.valueKind).toBe('identity_string');
  });

  it('P3 is needs_more_evidence due to cardinality', () => {
    const p3 = result.candidates.find((c) => c.coverageTargetId === 'P3')!;
    expect(p3.evidenceAssessment).toBe('needs_more_evidence');
    expect(p3.approvalReadiness).toBe('blocked_more_evidence');
    expect(p3.reviewPackStatus).toBe('generated');
    expect(p3.knownGaps).toEqual(
      expect.arrayContaining([
        'cardinality_unresolved',
        'multi_current_row_behavior_unresolved',
        'tie_ambiguity_policy_unresolved',
      ]),
    );
    expect(p3.temporalPolicy?.cardinalityPolicyResolved).toBe(false);
    expect(p3.temporalPolicy?.openEndedEndAllowed).toBe(true);
    expect(p3.warnings.some((w) => w.includes('FETCH FIRST'))).toBe(true);
  });

  it('P4 is display_business_value with lookup', () => {
    const p4 = result.candidates.find((c) => c.coverageTargetId === 'P4')!;
    expect(p4.valueKind).toBe('display_business_value');
    expect(p4.displaySemantics?.valueKind).toBe('display_business_value');
    expect(p4.displaySemantics?.endsOnForeignKeyIdentity).toBe(false);
    expect(p4.displaySemantics?.lookupProven).toBe(true);
    expect(p4.independentEvidenceFamilies).toContain('lookup_display_path');
  });

  it('validates all candidates', () => {
    for (const c of result.candidates) {
      expect(validateCandidate(c)).toEqual([]);
    }
  });

  it('determinism across 3 runs', () => {
    const a = discoverCandidates({ repoRoot });
    const b = discoverCandidates({ repoRoot });
    const c = discoverCandidates({ repoRoot });
    for (let i = 0; i < 4; i++) {
      expect(a.candidates[i].candidateFingerprint).toBe(b.candidates[i].candidateFingerprint);
      expect(b.candidates[i].candidateFingerprint).toBe(c.candidates[i].candidateFingerprint);
      expect(a.candidates[i].candidateEvaluationFingerprint).toBe(
        b.candidates[i].candidateEvaluationFingerprint,
      );
    }
  });

  it('does not discover OU/payroll/history/location/negative', () => {
    const roles = result.candidates.map((c) => c.roleKey);
    expect(roles.some((r) => /organizational_unit|payroll|history|location|without_current/i.test(r))).toBe(
      false,
    );
  });

  it('freeGraphDiscoveryAttempts is 0', () => {
    expect(result.counters.freeGraphDiscoveryAttempts).toBe(0);
  });

  it('production mutation counters are zero', () => {
    expect(
      assertNoProductionMutation({
        stage3dProductionBindingsAdded: result.counters.stage3dProductionBindingsAdded,
        stage3dProductionBindingsModified: result.counters.stage3dProductionBindingsModified,
        reusePolicyEntriesAdded: result.counters.reusePolicyEntriesAdded,
        reusePolicyEntriesModified: result.counters.reusePolicyEntriesModified,
        realDecisionEventsApplied: result.counters.realDecisionEventsApplied,
        realApprovedGenericBindingsCreated: result.counters.realApprovedGenericBindingsCreated,
        planningEligibleBindingsAdded: result.counters.planningEligibleBindingsAdded,
      }),
    ).toEqual([]);
  });
});

describe('Stage 3K.2B1 — review packs', () => {
  const result = discoverCandidates({ repoRoot });
  const packs = result.candidates.map(buildHumanReviewPack);

  it('one pack per pilot', () => {
    expect(packs).toHaveLength(4);
  });

  it.each(packs)('pack $packId is PENDING', (p) => {
    expect(p.decisionStatus).toBe('PENDING_HUMAN_DECISION');
    expect(p.automaticApproveRecommendation).toBe(false);
  });

  it('P3 recommends more_evidence_required', () => {
    const p = packs.find((x) => x.packId === 'pack:P3')!;
    expect(p.recommendedDecision).toBe('more_evidence_required');
    expect(p.knownGaps.length).toBeGreaterThan(0);
  });

  it('available decisions include request_more_evidence', () => {
    for (const p of packs) {
      expect(p.availableHumanDecisions).toContain('request_more_evidence');
      expect(p.availableHumanDecisions).not.toContain('auto_approve' as never);
    }
  });

  it('packs include evidence summary fields', () => {
    for (const p of packs) {
      expect(p.evidenceSummary.independentFamilies).toBeDefined();
      expect(p.evidenceSummary.priorApprovalRefs).toBeDefined();
    }
  });
});

describe('Stage 3K.2B1 — decision ledger', () => {
  it('empty ledger has zero real applies', () => {
    expect(createEmptyDecisionLedger().realDecisionEventsApplied).toBe(0);
    expect(createEmptyDecisionLedger().events).toEqual([]);
  });

  it('synthetic append does not increment realDecisionEventsApplied', () => {
    const c = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const ledger = appendSyntheticDecision(createEmptyDecisionLedger(), {
      decisionId: 'd1',
      candidateId: c.candidateId,
      decision: 'defer',
      actor: 'test',
      timestamp: '2026-01-01T00:00:00Z',
      reason: 'synthetic',
      policyVersion: 'p',
      candidateFingerprint: c.candidateFingerprint,
      candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
      dependencyVector: c.dependencyVector,
    });
    expect(ledger.events).toHaveLength(1);
    expect(ledger.realDecisionEventsApplied).toBe(0);
    expect(validateDecisionSchema(ledger.events[0])).toEqual([]);
  });

  it('apply without confirm fails', () => {
    const c = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const r = applyHumanDecision(
      createEmptyDecisionLedger(),
      {
        decisionId: 'd1',
        candidateId: c.candidateId,
        decision: 'defer',
        actor: 'test',
        timestamp: '2026-01-01T00:00:00Z',
        reason: 'x',
        policyVersion: 'p',
        candidateFingerprint: c.candidateFingerprint,
        candidateEvaluationFingerprint: c.candidateEvaluationFingerprint,
        dependencyVector: c.dependencyVector,
      },
      { confirmHumanDecision: false, isRealPilot: true },
    );
    expect(r.ok).toBe(false);
  });
});

describe('Stage 3K.2B1 — synthetic fixtures S1–S15', () => {
  it('S1 ready_for_human_review', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S1.options });
    expect(r.candidates[0].evidenceAssessment).toBe('sufficient_for_decision');
    expect(r.candidates[0].reviewPackStatus).toBe('generated');
  });

  it('S2 inferred needs_more_evidence', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S2.options });
    expect(r.candidates[0].evidenceAssessment).toBe('needs_more_evidence');
  });

  it('S3 heuristic needs_more_evidence', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S3.options });
    expect(r.candidates[0].evidenceAssessment).toBe('needs_more_evidence');
  });

  it('S4 conflicting', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S4.options });
    expect(r.candidates[0].evidenceAssessment).toBe('conflicting');
  });

  it('S5 duplicate same-origin counts as 1', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S5.options });
    expect(r.candidates[0].independentEvidenceFamilies).toHaveLength(1);
    expect(r.counters.duplicateEvidenceObservationsDeduplicated).toBeGreaterThanOrEqual(1);
  });

  it('S6 prior approval no double count', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S6.options });
    expect(r.counters.priorApprovalReferencesCountedAsIndependentEvidence).toBe(0);
    expect(r.candidates[0].priorApprovalRefs.length).toBeGreaterThan(0);
  });

  it('S7 stale', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S7.options });
    expect(r.candidates[0].evidenceAssessment).toBe('stale');
  });

  it('S8 policy-only fingerprint split', () => {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] });
    const alt = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S8.options });
    expect(base.candidates[0].candidateFingerprint).toBe(alt.candidates[0].candidateFingerprint);
    expect(base.candidates[0].candidateEvaluationFingerprint).not.toBe(
      alt.candidates[0].candidateEvaluationFingerprint,
    );
  });

  it('S9 evidence change fingerprint', () => {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] });
    const changed = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S9.options });
    expect(base.candidates[0].candidateFingerprint).not.toBe(
      changed.candidates[0].candidateFingerprint,
    );
  });

  it('S10 scope change fingerprint', () => {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const mutated = {
      ...base,
      applicability: { ...base.applicability, proposedGenericScope: 'x' },
    };
    expect(computeCandidateFingerprint(buildCandidateFingerprintPayload(base))).not.toBe(
      computeCandidateFingerprint(buildCandidateFingerprintPayload(mutated)),
    );
  });

  it('S11 leading zero', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S11.options });
    expect(r.candidates[0].identitySemantics?.examplePreservedValue).toBe('00122');
  });

  it('S12 ambiguous', () => {
    const r = discoverCandidates({ repoRoot, ...SYNTHETIC_FIXTURE_DEFS.S12.options });
    expect(r.candidates[0].evidenceAssessment).toBe('ambiguous');
  });

  it('S13 no automatic approval in packs', () => {
    const packs = discoverCandidates({ repoRoot }).candidates.map(buildHumanReviewPack);
    expect(packs.every((p) => p.automaticApproveRecommendation === false)).toBe(true);
  });

  it('S14 reuse policy unchanged', () => {
    const policy = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'apps/api/config/teta-generic-semantic-reuse-policy-v1.json'),
        'utf8',
      ),
    );
    expect(policy.defaultReuse).toBe('deny');
    expect(policy.reusableRoles).toEqual([]);
  });

  it('S15 execution counters zero', () => {
    const r = discoverCandidates({ repoRoot });
    expect(r.counters.oracleConnections).toBe(0);
    expect(r.counters.sqlCompiled).toBe(0);
    expect(r.counters.sqlExecuted).toBe(0);
    expect(r.counters.localModelCalls).toBe(0);
    expect(r.counters.remoteModelCalls).toBe(0);
    expect(r.counters.qdrantCalls).toBe(0);
    expect(r.counters.embeddingCalls).toBe(0);
  });
});

describe('Stage 3K.2B1 — audit', () => {
  const audit = buildStage3k2b1Audit(repoRoot, { writeArtifacts: true });

  it('status fields', () => {
    expect(audit.stage3k2bStatus).toBe('started_candidate_discovery');
    expect(audit.stage3k2b1Status).toBe(
      'accepted_offline_candidate_discovery_and_review_pack',
    );
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.humanReviewStatus).toBe('accepted');
  });

  it('strictErrors empty', () => {
    expect(audit.strictErrors).toEqual([]);
  });

  it('strict zeros', () => {
    expect(audit.priorApprovalReferencesCountedAsIndependentEvidence).toBe(0);
    expect(audit.duplicateObservationFamiliesCountedAsIndependent).toBe(0);
    expect(audit.realDecisionEventsApplied).toBe(0);
    expect(audit.realApprovedGenericBindingsCreated).toBe(0);
    expect(audit.stage3dProductionBindingsAdded).toBe(0);
    expect(audit.stage3dProductionBindingsModified).toBe(0);
    expect(audit.reusePolicyEntriesAdded).toBe(0);
    expect(audit.reusePolicyEntriesModified).toBe(0);
    expect(audit.planningEligibleBindingsAdded).toBe(0);
    expect(audit.oracleConnections).toBe(0);
    expect(audit.sqlCompiled).toBe(0);
    expect(audit.sqlExecuted).toBe(0);
    expect(audit.stage3cPlansBuilt).toBe(0);
    expect(audit.localModelCalls).toBe(0);
    expect(audit.remoteModelCalls).toBe(0);
    expect(audit.qdrantCalls).toBe(0);
    expect(audit.embeddingCalls).toBe(0);
  });

  it('all synthetic fixtures ok', () => {
    expect(audit.syntheticFixtureResults.every((s) => s.ok)).toBe(true);
  });

  it('writes review pack paths', () => {
    expect(audit.reviewPackPaths.length).toBe(4);
    expect(audit.reviewPackPaths.every((p) => p.includes('review-packs-v2'))).toBe(true);
  });

  it('reusePolicyUnchanged', () => {
    expect(audit.reusePolicyUnchanged).toBe(true);
  });
});

describe('Stage 3K.2B1 — parametric coverage bulk', () => {
  const nodePrefixes: Array<[string, string]> = [
    ['oracle-object:A', 'oracle_metadata_ddl'],
    ['oracle-column:A:B:C', 'oracle_metadata_ddl'],
    ['form:x', 'application_form_control'],
    ['control:x', 'application_form_control'],
    ['join:Foo.bosBar.BO.Baz:1', 'dataset_gateway_join'],
    ['join:reconstructed:x', 'sqljoin_reconstruction'],
    ['oracle-package:P', 'package_dependency'],
    ['help:doc', 'help_semantic_mapping'],
    ['lookup:x', 'lookup_display_path'],
    ['value-path:x', 'lookup_display_path'],
  ];

  it.each(nodePrefixes)('familyFromGraphNodeId(%s)=%s', (node, fam) => {
    expect(familyFromGraphNodeId(node)).toBe(fam);
  });

  const supportsList = [
    'concept',
    'relation',
    'value',
    'grain',
    'temporal',
    'display',
    'identity',
  ] as const;

  it.each(supportsList)('expand accepts supports=%s', (sup) => {
    const r = expandEvidenceObservations(
      [
        {
          nodeId: `oracle-object:${sup}`,
          supports: [sup],
          sourceStage: 't',
          graphSourceHash: 'h',
        },
      ],
      [],
    );
    expect(r.underlyingEvidenceRefs[0].supports).toContain(sup);
  });

  it.each(PILOT_COVERAGE_TARGETS.map((t) => t.targetId))(
    'discover single target %s',
    (id) => {
      const r = discoverCandidates({ repoRoot, targetIds: [id] });
      expect(r.candidates).toHaveLength(1);
      expect(r.candidates[0].coverageTargetId).toBe(id);
      expect(r.candidates[0].candidateFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(r.candidates[0].candidateEvaluationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it.each(INDEPENDENT_EVIDENCE_FAMILIES)(
    'synthetic observation family %s expands',
    (family) => {
      const obs: RawEvidenceObservation = {
        nodeId: `n:${family}`,
        familyOverride: family,
        supports: ['concept'],
        sourceStage: 'synthetic',
        graphSourceHash: 'h',
        originObservationId: `orig:${family}`,
      };
      const r = expandEvidenceObservations([obs], []);
      expect(r.independentEvidenceFamilies).toContain(family);
    },
  );

  const thresholdCases: Array<[string, Parameters<typeof evaluateEvidenceThreshold>[0], string]> =
    [
      [
        'ok-normal',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 1,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
        },
        'sufficient_for_review',
      ],
      [
        'ok-multi',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'supported_by_multiple_independent_edges',
          independentFamilyCount: 2,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
        },
        'sufficient_for_review',
      ],
      [
        'stale',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 1,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: true,
        },
        'stale',
      ],
      [
        'conflict',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'conflicting',
          independentFamilyCount: 1,
          conflicts: ['c'],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
        },
        'conflicting',
      ],
      [
        'inferred',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'inferred',
          independentFamilyCount: 0,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
          inferredOnly: true,
        },
        'needs_more_evidence',
      ],
      [
        'heuristic',
        {
          riskClass: 'normal_reference',
          evidenceStrength: 'heuristic',
          independentFamilyCount: 0,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
          heuristicOnly: true,
        },
        'needs_more_evidence',
      ],
      [
        'card',
        {
          riskClass: 'temporal_sensitive',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 2,
          conflicts: [],
          ambiguities: [],
          knownGaps: ['cardinality_unresolved'],
          graphHashMismatch: false,
          cardinalityUnresolved: true,
        },
        'needs_more_evidence',
      ],
      [
        'amb',
        {
          riskClass: 'configuration_sensitive',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 2,
          conflicts: [],
          ambiguities: ['which'],
          knownGaps: [],
          graphHashMismatch: false,
        },
        'ambiguous',
      ],
      [
        'id-fail',
        {
          riskClass: 'identity_sensitive',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 1,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
          identityFacetSeparated: false,
        },
        'needs_more_evidence',
      ],
      [
        'id-ok',
        {
          riskClass: 'identity_sensitive',
          evidenceStrength: 'verified_exact',
          independentFamilyCount: 1,
          conflicts: [],
          ambiguities: [],
          knownGaps: [],
          graphHashMismatch: false,
          identityFacetSeparated: true,
        },
        'sufficient_for_review',
      ],
    ];

  it.each(thresholdCases)('threshold %s → %s', (_name, input, expected) => {
    expect(evaluateEvidenceThreshold(input).assessment).toBe(expected);
  });

  // Bulk fingerprint stability matrix
  const meanings = Array.from({ length: 20 }, (_, i) => `meaning-${i}`);
  it.each(meanings)('fingerprint changes with meaning %s', (m) => {
    const a = {
      conceptKey: 'c',
      roleKey: 'r',
      semanticMeaning: 'base',
      relationMeaning: null,
      valueKind: 'business_value',
      resultGrain: 'one_row_per_employee',
      applicability: {
        productFamily: 'teta_hr',
        productSurface: 'g',
        businessArea: 'w',
        clientScope: 'b',
        versionScope: 'v1',
        currentHomeSubject: 'occupational_health_examinations',
        proposedGenericScope: 'bounded_teta_hr',
      },
      temporalPolicy: null,
      evidenceBundle: [],
      graphSourceHash: 'h',
      dependencyVector: {
        graphSourceHash: 'h',
        semanticBindingsVersion: 'v',
        ontologyVersion: 'o',
        stage3k2b1ContractVersion: STAGE3K2B1_CONTRACT_VERSION,
      },
      knownGaps: [],
      ambiguities: [],
      conflicts: [],
    };
    const b = { ...a, semanticMeaning: m };
    expect(computeCandidateFingerprint(a)).not.toBe(computeCandidateFingerprint(b));
  });

  const policyVersions = Array.from({ length: 15 }, (_, i) => `policy-v-${i}`);
  it.each(policyVersions)('evaluation fingerprint changes with policy %s', (p) => {
    const fp = computeCandidateFingerprint({
      conceptKey: 'c',
      roleKey: 'r',
      semanticMeaning: 'm',
      relationMeaning: null,
      valueKind: 'business_value',
      resultGrain: 'one_row_per_employee',
      applicability: {
        productFamily: 'teta_hr',
        productSurface: 'g',
        businessArea: 'w',
        clientScope: 'b',
        versionScope: 'v1',
        currentHomeSubject: 's',
        proposedGenericScope: 'g',
      },
      temporalPolicy: null,
      evidenceBundle: [],
      graphSourceHash: 'h',
      dependencyVector: {
        graphSourceHash: 'h',
        semanticBindingsVersion: 'v',
        ontologyVersion: 'o',
        stage3k2b1ContractVersion: STAGE3K2B1_CONTRACT_VERSION,
      },
      knownGaps: [],
      ambiguities: [],
      conflicts: [],
    });
    expect(computeCandidateEvaluationFingerprint(fp, p)).not.toBe(
      computeCandidateEvaluationFingerprint(fp, STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION),
    );
  });

  it.each(['P1', 'P2', 'P3', 'P4'] as const)(
    'review pack for %s has no auto approve',
    (id) => {
      const c = discoverCandidates({ repoRoot, targetIds: [id] }).candidates[0];
      const pack = buildHumanReviewPack(c);
      expect(pack.automaticApproveRecommendation).toBe(false);
      expect(pack.decisionStatus).toBe('PENDING_HUMAN_DECISION');
      expect(pack.candidateFingerprint).toBe(c.candidateFingerprint);
    },
  );

  it.each([
    'approve_generic_reuse',
    'approve_with_scope',
    'request_more_evidence',
    'reject',
    'defer',
  ] as const)('decision kind %s available on packs', (d) => {
    const pack = buildHumanReviewPack(
      discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0],
    );
    expect(pack.availableHumanDecisions).toContain(d);
  });
});
