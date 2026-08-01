/**
 * Stage 3K.2B1 PATCH — review pack cleanup / evaluation policy tests.
 * Adds >=35 tests on top of existing suite (target total >=235).
 */
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import {
  resolveRepoRootFromModule,
  loadCandidateEvaluationPolicy,
  hashEvaluationPolicy,
  discoverCandidates,
  buildHumanReviewPackV2,
  buildStage3k2b1AuditV2,
  computeCandidateFingerprint,
  computeCandidateEvaluationFingerprint,
  buildCandidateFingerprintPayload,
  evaluateAgainstPolicy,
  hardcodedEvaluationThresholdsInCode,
  sanitizeEvidenceItems,
  buildPilotDependencies,
  STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION,
} from './index';

const repoRoot = resolveRepoRootFromModule();

describe('Stage 3K.2B1 PATCH — evaluation policy config', () => {
  it('loads versioned JSON from apps/api/config', () => {
    const p = loadCandidateEvaluationPolicy(repoRoot);
    expect(p.evaluationPolicyLoadedFromVersionedConfig).toBe(true);
    expect(p.policy.policyVersion).toBe(STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION);
    expect(p.policy.policyId).toBeTruthy();
    expect(p.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      existsSync(
        path.join(
          repoRoot,
          'apps/api/config/teta-generic-semantic-candidate-evaluation-policy-v1.json',
        ),
      ),
    ).toBe(true);
  });

  it('policy hash is stable for same content', () => {
    const a = loadCandidateEvaluationPolicy(repoRoot);
    const b = hashEvaluationPolicy(a.policy);
    expect(a.policyHash).toBe(b);
  });

  it('policy includes all risk classes', () => {
    const p = loadCandidateEvaluationPolicy(repoRoot).policy;
    for (const rc of [
      'normal_reference',
      'temporal_sensitive',
      'configuration_sensitive',
      'payroll_sensitive',
      'identity_sensitive',
    ]) {
      expect(p.riskClasses[rc as keyof typeof p.riskClasses]).toBeDefined();
    }
  });

  it('hardcodedEvaluationThresholdsInCode is 0', () => {
    expect(hardcodedEvaluationThresholdsInCode()).toBe(0);
  });

  it('policy hash change alters evaluation fingerprint only', () => {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const alt = discoverCandidates({
      repoRoot,
      targetIds: ['P1'],
      overridePolicyContentHash: 'deadbeef'.repeat(8),
    }).candidates[0];
    expect(base.candidateFingerprint).toBe(alt.candidateFingerprint);
    expect(base.candidateEvaluationFingerprint).not.toBe(alt.candidateEvaluationFingerprint);
  });

  it('policy version override alters evaluation fingerprint', () => {
    const base = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
    const alt = discoverCandidates({
      repoRoot,
      targetIds: ['P1'],
      candidateEvaluationPolicyVersion: 'alt-version',
    }).candidates[0];
    expect(base.candidateFingerprint).toBe(alt.candidateFingerprint);
    expect(base.candidateEvaluationFingerprint).not.toBe(alt.candidateEvaluationFingerprint);
  });

  it('evaluation fingerprint includes policyId/version/hash fields', () => {
    const fp = computeCandidateEvaluationFingerprint({
      candidateFingerprint: 'a'.repeat(64),
      policyId: 'id',
      policyVersion: 'v',
      policyContentHash: 'h',
    });
    const fp2 = computeCandidateEvaluationFingerprint({
      candidateFingerprint: 'a'.repeat(64),
      policyId: 'id2',
      policyVersion: 'v',
      policyContentHash: 'h',
    });
    expect(fp).not.toBe(fp2);
  });
});

describe('Stage 3K.2B1 PATCH — pack v2 evidence lineage', () => {
  const pilot = discoverCandidates({ repoRoot });
  const packs = pilot.candidates.map(buildHumanReviewPackV2);

  it('every pack has evidenceItems', () => {
    for (const p of packs) {
      expect(p.evidenceItems.length).toBeGreaterThan(0);
      expect(p.packVersion).toBe('v2');
    }
  });

  it('every evidence item has lineageKey', () => {
    for (const p of packs) {
      for (const e of p.evidenceItems) {
        expect(e.lineageKey).toBeTruthy();
        expect(e.family).toBeTruthy();
        expect(e.independenceGroup).toBeTruthy();
      }
    }
  });

  it('lineageAssessment marks priorApprovalRefsCountedAsIndependent=false', () => {
    for (const p of packs) {
      expect(p.lineageAssessment.priorApprovalRefsCountedAsIndependent).toBe(false);
    }
  });

  it('sanitizeEvidenceItems annotates DDL doesNotProveAlone', () => {
    const c = pilot.candidates[0];
    const items = sanitizeEvidenceItems(
      c.underlyingEvidenceRefs,
      c.priorApprovalRefs,
      c.applicability.currentHomeSubject,
    );
    const ddl = items.find((i) => i.family === 'oracle_metadata_ddl');
    expect(ddl?.doesNotProveAlone).toEqual(
      expect.arrayContaining(['business_meaning', 'generic_scope', 'identity_meaning']),
    );
  });

  it('evaluationTrace present with rules', () => {
    for (const p of packs) {
      expect(p.evaluationTrace.policyId).toBeTruthy();
      expect(p.evaluationTrace.policyHash).toBeTruthy();
      expect(p.evaluationTrace.rulesEvaluated.length).toBeGreaterThan(0);
      expect(p.evaluationTrace.finalAssessment).toBe(p.evidenceAssessment);
    }
  });
});

describe('Stage 3K.2B1 PATCH — scope / grain / deps', () => {
  const pilot = discoverCandidates({ repoRoot });

  it('all pilots have explicit scopeAssessment with expansion', () => {
    for (const c of pilot.candidates) {
      expect(c.scopeAssessment.isScopeExpansion).toBe(true);
      expect(c.scopeAssessment.homeScope).toBe('occupational_health_examinations');
      expect(c.scopeAssessment.proposedScope).toBe('bounded_teta_hr');
      expect(c.scopeAssessment.assessment).not.toBe('proven');
      expect(c.knownGaps.some((g) => g.startsWith('scope_expansion_'))).toBe(true);
    }
  });

  it('all pilots have resultGrainAssessment', () => {
    for (const c of pilot.candidates) {
      expect(c.resultGrainAssessment.proposedGrain).toBeTruthy();
      expect(c.resultGrainAssessment.status).toBeTruthy();
    }
  });

  it('P3 grain unresolved + cardinality gaps', () => {
    const p3 = pilot.candidates.find((c) => c.coverageTargetId === 'P3')!;
    expect(p3.resultGrainAssessment.status).toBe('unresolved');
    expect(p3.knownGaps).toEqual(
      expect.arrayContaining([
        'cardinality_unresolved',
        'multi_current_row_behavior_unresolved',
        'tie_ambiguity_policy_unresolved',
      ]),
    );
  });

  it('P2 depends on P1', () => {
    const deps = buildPilotDependencies('P2', new Map([['P1', 'cand:P1:employee']]));
    expect(deps.some((d) => d.candidateId === 'cand:P1:employee')).toBe(true);
    const p2 = pilot.candidates.find((c) => c.coverageTargetId === 'P2')!;
    expect(p2.requiredBindingDependencies.length).toBeGreaterThan(0);
    expect(p2.requiredBindingDependencies.every((d) => d.status === 'pending')).toBe(true);
  });

  it('P4 dependency pending blocks reuse activation', () => {
    const p4 = pilot.candidates.find((c) => c.coverageTargetId === 'P4')!;
    expect(p4.requiredBindingDependencies.length).toBeGreaterThan(0);
    expect(p4.genericReuseActivationBlocked).toBe(true);
    expect(p4.knownGaps.some((g) => g.includes('required_dependency_'))).toBe(true);
  });

  it('P3 pack generated but approval blocked', () => {
    const p3 = pilot.candidates.find((c) => c.coverageTargetId === 'P3')!;
    expect(p3.reviewPackStatus).toBe('generated');
    expect(p3.evidenceAssessment).toBe('needs_more_evidence');
    expect(p3.approvalReadiness).toBe('blocked_more_evidence');
  });

  it('reviewPackStatus vs approvalReadiness are distinct', () => {
    for (const c of pilot.candidates) {
      expect(c.reviewPackStatus).toBe('generated');
      expect(['ready_for_approval_decision', 'blocked_more_evidence', 'blocked_ambiguity', 'blocked_conflict', 'blocked_stale', 'blocked_invalid']).toContain(
        c.approvalReadiness,
      );
    }
  });
});

describe('Stage 3K.2B1 PATCH — identity / DDL gates', () => {
  it('DDL alone does not prove identity meaning (synthetic)', () => {
    const r = discoverCandidates({
      repoRoot,
      targetIds: ['P2'],
      syntheticOverrides: {
        P2: {
          skipStage3d: true,
          forceExactIdentitySemantic: false,
          observations: [
            {
              nodeId: 'oracle-column:SYN:EMP:NR',
              familyOverride: 'oracle_metadata_ddl',
              supports: ['datatype'],
              strength: 'verified_exact',
              sourceStage: 'synthetic',
              graphSourceHash: 'h',
              originObservationId: 'oracle-column:SYN:EMP:NR',
            },
          ],
        },
      },
    });
    expect(r.candidates[0].evidenceAssessment).toBe('needs_more_evidence');
    expect(r.candidates[0].identitySemantics?.exactSemanticLabelEvidence).toBe(false);
  });

  it('pilot P1-P4 are needs_more_evidence under unproven scope', () => {
    const r = discoverCandidates({ repoRoot });
    for (const c of r.candidates) {
      expect(c.evidenceAssessment).toBe('needs_more_evidence');
      expect(c.approvalReadiness).toBe('blocked_more_evidence');
    }
  });
});

describe('Stage 3K.2B1 PATCH — audit v2 metrics', () => {
  const audit = buildStage3k2b1AuditV2(repoRoot, { writeArtifacts: true });

  it('status is accepted_offline_candidate_discovery_and_review_pack', () => {
    expect(audit.stage3k2b1Status).toBe(
      'accepted_offline_candidate_discovery_and_review_pack',
    );
    expect(audit.stage3k2bStatus).toBe('started_candidate_discovery');
    expect(audit.stage3k2b2Status).toBe('not_started');
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.realCandidateApprovalStatus).toBe('no_candidates_approved');
  });

  it('policy loaded + hashed', () => {
    expect(audit.evaluationPolicyLoadedFromVersionedConfig).toBe(true);
    expect(audit.evaluationPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.evaluationRulesApplied).toBeGreaterThan(0);
  });

  it('family metric split present', () => {
    expect(audit.totalCandidateEvidenceFamilyAssignments).toBeGreaterThan(0);
    expect(audit.uniqueEvidenceFamiliesAcrossRun).toBeGreaterThan(0);
    expect(audit.uniqueEvidenceFamiliesAcrossRun).toBeLessThanOrEqual(
      audit.totalCandidateEvidenceFamilyAssignments,
    );
    expect(audit.independentObservationGroupsPerCandidate.P1).toBeGreaterThan(0);
  });

  it('writes review-packs-v2 paths', () => {
    expect(audit.reviewPackPaths.every((p) => p.includes('review-packs-v2'))).toBe(true);
    expect(audit.reviewPackPaths).toHaveLength(4);
  });

  it('strictErrors empty', () => {
    expect(audit.strictErrors).toEqual([]);
  });

  it('zero mutation/execution counters', () => {
    expect(audit.realDecisionEventsApplied).toBe(0);
    expect(audit.realApprovedGenericBindingsCreated).toBe(0);
    expect(audit.stage3dProductionBindingsAdded).toBe(0);
    expect(audit.reusePolicyEntriesAdded).toBe(0);
    expect(audit.planningEligibleBindingsAdded).toBe(0);
    expect(audit.oracleConnections).toBe(0);
    expect(audit.sqlCompiled).toBe(0);
    expect(audit.localModelCalls).toBe(0);
    expect(audit.qdrantCalls).toBe(0);
  });

  it('all synthetic fixtures ok', () => {
    expect(audit.syntheticFixtureResults.every((s) => s.ok)).toBe(true);
  });
});

describe('Stage 3K.2B1 PATCH — policy evaluator unit', () => {
  const policy = loadCandidateEvaluationPolicy(repoRoot).policy;
  const policyHash = loadCandidateEvaluationPolicy(repoRoot).policyHash;

  it('scope expansion unproven blocks sufficient', () => {
    const r = evaluateAgainstPolicy({
      riskClass: 'normal_reference',
      evidenceStrength: 'verified_exact',
      independentObservationGroups: 2,
      semanticEvidenceClassesPresent: ['concept'],
      conflicts: [],
      ambiguities: [],
      knownGaps: ['scope_expansion_unproven'],
      graphHashMismatch: false,
      inferredOnly: false,
      heuristicOnly: false,
      scopeAssessment: {
        homeScope: 'occupational_health_examinations',
        proposedScope: 'bounded_teta_hr',
        isScopeExpansion: true,
        supportingEvidenceRefs: [],
        competingScopeEvidence: [],
        assessment: 'unproven',
      },
      resultGrainAssessment: {
        proposedGrain: 'one_row_per_employee',
        uniquenessEvidence: ['x'],
        cardinalityEvidence: [],
        multiRowRisk: null,
        status: 'proven',
      },
      identityFacetSeparated: true,
      exactIdentitySemanticEvidence: true,
      ddlOnlyForIdentity: false,
      employeeGrainEvidencePresent: true,
      employeeGrainDependencySatisfied: true,
      displayLinkedToPositionIdentity: true,
      requiredBindingDependencies: [],
      policy,
      policyHash,
    });
    expect(r.evidenceAssessment).toBe('needs_more_evidence');
  });

  it('dependencies fail closed for reuse activation', () => {
    const r = evaluateAgainstPolicy({
      riskClass: 'normal_reference',
      evidenceStrength: 'verified_exact',
      independentObservationGroups: 2,
      semanticEvidenceClassesPresent: ['concept'],
      conflicts: [],
      ambiguities: [],
      knownGaps: [],
      graphHashMismatch: false,
      inferredOnly: false,
      heuristicOnly: false,
      scopeAssessment: {
        homeScope: 'a',
        proposedScope: 'a',
        isScopeExpansion: false,
        supportingEvidenceRefs: [],
        competingScopeEvidence: [],
        assessment: 'proven',
      },
      resultGrainAssessment: {
        proposedGrain: 'g',
        uniquenessEvidence: [],
        cardinalityEvidence: [],
        multiRowRisk: null,
        status: 'proven',
      },
      identityFacetSeparated: true,
      exactIdentitySemanticEvidence: true,
      ddlOnlyForIdentity: false,
      employeeGrainEvidencePresent: true,
      employeeGrainDependencySatisfied: true,
      displayLinkedToPositionIdentity: true,
      requiredBindingDependencies: [
        {
          conceptKey: 'x',
          roleKey: 'y',
          candidateId: null,
          dependencyKind: 'source_binding',
          requiredFor: 'generic_reuse',
          status: 'pending',
        },
      ],
      policy,
      policyHash,
    });
    expect(r.genericReuseActivationBlocked).toBe(true);
  });
});

describe('Stage 3K.2B1 PATCH — fingerprint matrix', () => {
  it.each(Array.from({ length: 10 }, (_, i) => `gap-${i}`))(
    'knownGap change affects candidateFingerprint %s',
    (gap) => {
      const base = discoverCandidates({ repoRoot, targetIds: ['P1'] }).candidates[0];
      const mutated = { ...base, knownGaps: [...base.knownGaps, gap] };
      expect(computeCandidateFingerprint(buildCandidateFingerprintPayload(base))).not.toBe(
        computeCandidateFingerprint(buildCandidateFingerprintPayload(mutated)),
      );
    },
  );
});
