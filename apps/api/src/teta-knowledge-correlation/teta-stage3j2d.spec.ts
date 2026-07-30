import {
  RELATION_KINDS,
  STAGE3J2D_CORRELATOR_VERSION,
  STAGE_BOUNDARY_ZERO_FIELDS,
  allFixturePacks,
  assertLeadingZeroPreserved,
  buildApplicabilityPartitionKey,
  buildBlockingIndex,
  buildFixtureManifest,
  buildStage3j2dAudit,
  combinedFixtureManifest,
  emptyBlockingStats,
  fixturePackA_ExactDuplicate,
  fixturePackB_SemanticDuplicate,
  fixturePackC_Enrichment,
  fixturePackD_ProductVariant,
  fixturePackE_ProductSurfaceVariant,
  fixturePackF_VersionVariant,
  fixturePackG_TemporalVariant,
  fixturePackH_ConfigurationVariant,
  fixturePackI_ProcessVariant,
  fixturePackJ_ClientVariant,
  fixturePackK_Conflict,
  fixturePackL_UnknownApplicability,
  fixturePackM_SharedSignature,
  fixturePackN_Regulatory,
  fixturePackO_PayrollLeadingZero,
  fixturePackP_HelpExact,
  fixturePackQ_HelpAmbiguous,
  fixturePackR_GoldenSupported,
  fixturePackS_GoldenPartial,
  fixturePackT_GoldenUnsupported,
  fixturePackU_GoldenConflict,
  fixturePackV_TetaMe,
  isFolderOnlyShared,
  loadApplicabilitySeparationPolicy,
  loadCorrelationPolicy,
  loadExistingKnowledgeAnchors,
  loadGoldenQuestions,
  makeOccurrence,
  normalizeCandidate,
  normalizeForExactCompare,
  normalizePreserveCodes,
  normalizeText,
  collectStrictErrors,
  runStage3j2dCorrelation,
  shareNonFolderBlock,
  tokenizeLabel,
  validateConfig,
} from './index';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';

function kindsOf(result: ReturnType<typeof runStage3j2dCorrelation>) {
  return result.manifest.relationDecisions.map((d) => d.relationKind);
}

describe('Stage 3J.2D config', () => {
  test('validate-config passes', () => {
    expect(validateConfig().ok).toBe(true);
  });
  test('correlator version', () => {
    expect(STAGE3J2D_CORRELATOR_VERSION).toBe('stage3j2d-v1');
  });
  test('relation taxonomy has 15 kinds', () => {
    expect(RELATION_KINDS.length).toBe(15);
  });
  test('golden questions are 21', () => {
    expect(loadGoldenQuestions().questions.length).toBe(21);
  });
  test('policy forbids local model', () => {
    expect(loadCorrelationPolicy().allowLocalModel).toBe(false);
  });
  test('policy forbids embeddings', () => {
    expect(loadCorrelationPolicy().allowEmbeddings).toBe(false);
  });
  test('policy forbids conflict auto-resolve', () => {
    expect(loadCorrelationPolicy().allowConflictAutoResolve).toBe(false);
  });
  test('policy forbids approved record creation', () => {
    expect(loadCorrelationPolicy().allowApprovedRecordCreation).toBe(false);
  });
  test('applicability policy separates HR vs Edu', () => {
    expect(loadApplicabilitySeparationPolicy().neverAutoMerge.tetaHrVsTetaEdu).toBe(true);
  });
  test('Teta ME is not business domain in policy', () => {
    expect(loadApplicabilitySeparationPolicy().productSurfaceRules.teta_me.isBusinessDomain).toBe(false);
  });
  test('anchors config loads', () => {
    expect(loadExistingKnowledgeAnchors().policyVersion).toContain('anchors');
  });
  test('stage boundary zero fields present', () => {
    expect(STAGE_BOUNDARY_ZERO_FIELDS.length).toBeGreaterThan(15);
  });
});

describe('Stage 3J.2D normalizer', () => {
  test('normalizeText lowercases', () => {
    expect(normalizeText('Ala Ma Kota')).toBe('ala ma kota');
  });
  test('normalizeText strips punctuation', () => {
    expect(normalizeText('A, B!')).toBe('a b');
  });
  test('normalizePreserveCodes keeps leading zeros', () => {
    expect(normalizePreserveCodes('Kod 0010')).toContain('0010');
  });
  test('tokenizeLabel returns tokens', () => {
    expect(tokenizeLabel('Składnik Okresowy').length).toBeGreaterThan(0);
  });
  test('normalizeCandidate produces partition key', () => {
    const n = normalizeCandidate(
      makeOccurrence({ id: 'n1', kind: 'status', label: 'X', predicate: 'is', statement: 'X is open' }),
    );
    expect(n.applicabilityPartitionKey.length).toBe(64);
  });
  test('normalizeCandidate blocking keys include kind', () => {
    const n = normalizeCandidate(
      makeOccurrence({ id: 'n2', kind: 'parameter', label: 'Param', predicate: 'has', statement: 'Param has value' }),
    );
    expect(n.blockingKeys.some((k) => k.startsWith('kind:'))).toBe(true);
  });
  test('exact compare ignores punctuation', () => {
    expect(normalizeForExactCompare('A.')).toBe(normalizeForExactCompare('A!'));
  });
  test('leading zero assert helper', () => {
    expect(assertLeadingZeroPreserved('0010')).toBe(true);
  });
});

describe('Stage 3J.2D applicability', () => {
  test('different families different partition', () => {
    const a = buildApplicabilityPartitionKey({
      platformId: 'teta_platform',
      productFamilyIds: ['teta_hr'],
      productSurfaceIds: [],
      domainIds: ['kadry'],
      businessAreaIds: [],
      productVersionHints: [],
      documentDateHints: [],
      scopeStatus: 'global_candidate',
      currentnessStatus: 'not_verified',
      clientSpecificRisk: 'low',
    });
    const b = buildApplicabilityPartitionKey({
      platformId: 'teta_platform',
      productFamilyIds: ['teta_edu'],
      productSurfaceIds: [],
      domainIds: ['kadry'],
      businessAreaIds: [],
      productVersionHints: [],
      documentDateHints: [],
      scopeStatus: 'global_candidate',
      currentnessStatus: 'not_verified',
      clientSpecificRisk: 'low',
    });
    expect(a).not.toBe(b);
  });
  test('version changes partition', () => {
    const a = buildApplicabilityPartitionKey({
      platformId: 'teta_platform',
      productFamilyIds: ['teta_hr'],
      productSurfaceIds: [],
      domainIds: ['place'],
      businessAreaIds: [],
      productVersionHints: ['30.5'],
      documentDateHints: [],
      scopeStatus: 'global_candidate',
      currentnessStatus: 'not_verified',
      clientSpecificRisk: 'low',
    });
    const b = buildApplicabilityPartitionKey({
      platformId: 'teta_platform',
      productFamilyIds: ['teta_hr'],
      productSurfaceIds: [],
      domainIds: ['place'],
      businessAreaIds: [],
      productVersionHints: ['33.5'],
      documentDateHints: [],
      scopeStatus: 'global_candidate',
      currentnessStatus: 'not_verified',
      clientSpecificRisk: 'low',
    });
    expect(a).not.toBe(b);
  });
});

describe('Stage 3J.2D blocking', () => {
  test('emptyBlockingStats for n=2', () => {
    expect(emptyBlockingStats(2).candidatePairsPossible).toBe(1);
  });
  test('folder-only shared helper', () => {
    const a = normalizeCandidate(
      makeOccurrence({
        id: 'f1',
        kind: 'status',
        label: 'Aaa',
        predicate: 'p',
        statement: 's',
        payload: { folderHint: 'folderX' },
        applicability: { productFamilyIds: ['teta_hr'], domainIds: ['x'] },
      }),
    );
    const b = normalizeCandidate(
      makeOccurrence({
        id: 'f2',
        kind: 'action',
        label: 'Zzz',
        predicate: 'q',
        statement: 't',
        payload: { folderHint: 'folderX' },
        applicability: { productFamilyIds: ['teta_edu'], domainIds: ['y'] },
      }),
    );
    expect(isFolderOnlyShared(a, b) || !shareNonFolderBlock(a, b)).toBe(true);
  });
  test('buildBlockingIndex indexes keys', () => {
    const n = normalizeCandidate(
      makeOccurrence({ id: 'b1', kind: 'status', label: 'Status', predicate: 'is', statement: 'Status is open' }),
    );
    expect(buildBlockingIndex([n]).size).toBeGreaterThan(0);
  });
});

describe('Stage 3J.2D fixture packs', () => {
  test('A exact_duplicate', () => {
    const r = runStage3j2dCorrelation(fixturePackA_ExactDuplicate());
    expect(kindsOf(r)).toContain('exact_duplicate');
    expect(r.stats.candidateOccurrencesPreserved).toBe(2);
    expect(r.stats.proposedRecordsCreated).toBe(1);
  });
  test('B semantic_duplicate', () => {
    const r = runStage3j2dCorrelation(fixturePackB_SemanticDuplicate());
    expect(kindsOf(r)).toContain('semantic_duplicate');
    expect(r.stats.candidateOccurrencesLost).toBe(0);
  });
  test('C enrich_existing', () => {
    const r = runStage3j2dCorrelation(fixturePackC_Enrichment());
    expect(kindsOf(r)).toContain('enrich_existing');
    expect(r.manifest.proposedRecords.some((x) => x.enrichmentNotes.length > 0)).toBe(true);
  });
  test('D product_variant no HR/Edu merge', () => {
    const r = runStage3j2dCorrelation(fixturePackD_ProductVariant());
    expect(kindsOf(r)).toContain('product_variant');
    expect(r.stats.tetaEduMergedIntoTetaHr).toBe(0);
    expect(r.stats.proposedRecordsCreated).toBe(2);
  });
  test('E product_surface_variant ME not domain', () => {
    const r = runStage3j2dCorrelation(fixturePackE_ProductSurfaceVariant());
    expect(kindsOf(r)).toContain('product_surface_variant');
    expect(r.manifest.proposedRecords.every((rec) => !rec.applicability.domainIds.includes('teta_me'))).toBe(true);
  });
  test('F version_variant', () => {
    expect(kindsOf(runStage3j2dCorrelation(fixturePackF_VersionVariant()))).toContain('version_variant');
  });
  test('G temporal_variant', () => {
    expect(kindsOf(runStage3j2dCorrelation(fixturePackG_TemporalVariant()))).toContain('temporal_variant');
  });
  test('H configuration_variant', () => {
    expect(kindsOf(runStage3j2dCorrelation(fixturePackH_ConfigurationVariant()))).toContain('configuration_variant');
  });
  test('I process_variant', () => {
    expect(kindsOf(runStage3j2dCorrelation(fixturePackI_ProcessVariant()))).toContain('process_variant');
  });
  test('J client_variant', () => {
    expect(kindsOf(runStage3j2dCorrelation(fixturePackJ_ClientVariant()))).toContain('client_variant');
  });
  test('K conflict no auto-resolve', () => {
    const r = runStage3j2dCorrelation(fixturePackK_Conflict());
    expect(kindsOf(r)).toContain('conflict');
    expect(r.stats.conflictsAutoResolved).toBe(0);
    expect(r.manifest.conflicts.every((c) => c.resolutionStatus === 'requires_review')).toBe(true);
  });
  test('L unknown applicability requires_review', () => {
    const r = runStage3j2dCorrelation(fixturePackL_UnknownApplicability());
    expect(kindsOf(r)).toContain('requires_review');
    expect(kindsOf(r)).not.toContain('semantic_duplicate');
    expect(r.stats.unknownApplicabilityAutoMerged).toBe(0);
  });
  test('M shared signature preserves occurrences', () => {
    const r = runStage3j2dCorrelation(fixturePackM_SharedSignature());
    expect(r.stats.candidateOccurrencesPreserved).toBe(2);
    expect(r.stats.occurrencesLostBecauseOfSharedSignature).toBe(0);
  });
  test('N regulatory currentness not_verified', () => {
    const r = runStage3j2dCorrelation(fixturePackN_Regulatory());
    expect(r.manifest.proposedRecords[0].applicability.currentnessStatus).toBe('not_verified');
    expect(r.stats.regulatoryClaimsMarkedCurrent).toBe(0);
  });
  test('O payroll leading zero preserved', () => {
    const r = runStage3j2dCorrelation(fixturePackO_PayrollLeadingZero());
    expect(r.stats.leadingZeroIdentifiersLost).toBe(0);
    expect(r.stats.payrollCodesCorrelated).toBeGreaterThanOrEqual(1);
    expect(r.manifest.proposedRecords[0].structuredPayload.componentCode).toBe('0010');
  });
  test('P help exact has node and path', () => {
    const r = runStage3j2dCorrelation(fixturePackP_HelpExact());
    const exact = r.manifest.correlations.filter((c) => c.status === 'exact');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.every((c) => c.targetNodeIds.length && c.evidencePath.length)).toBe(true);
  });
  test('Q help ambiguous not auto-resolved', () => {
    const r = runStage3j2dCorrelation(fixturePackQ_HelpAmbiguous());
    expect(r.manifest.correlations.some((c) => c.status === 'ambiguous')).toBe(true);
    expect(r.stats.ambiguousCorrelationsAutoResolved).toBe(0);
  });
  test('R golden supported has evidence', () => {
    const r = runStage3j2dCorrelation(fixturePackR_GoldenSupported());
    const q01 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q01');
    expect(q01?.coverageStatus).toBe('supported');
    expect(q01?.evidenceCount).toBeGreaterThan(0);
  });
  test('S golden partial', () => {
    const r = runStage3j2dCorrelation(fixturePackS_GoldenPartial());
    const q02 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q02');
    expect(q02?.coverageStatus).toBe('partially_supported');
  });
  test('T golden unsupported no hallucination', () => {
    const r = runStage3j2dCorrelation(fixturePackT_GoldenUnsupported());
    const q01 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q01');
    expect(q01?.coverageStatus).toBe('unsupported');
  });
  test('U golden conflicting', () => {
    const r = runStage3j2dCorrelation(fixturePackU_GoldenConflict());
    const q01 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q01');
    expect(q01?.coverageStatus).toBe('conflicting');
    expect(r.stats.supportedQuestionsWithUnresolvedConflict).toBe(0);
  });
  test('V Teta ME product surface', () => {
    const r = runStage3j2dCorrelation(fixturePackV_TetaMe());
    expect(r.manifest.questionCoverage.find((q) => q.questionId === 'Q21')).toBeTruthy();
    expect(r.stats.tetaMeTreatedAsStandaloneDomain).toBe(0);
    expect(
      r.manifest.proposedRecords.every((rec) => !rec.applicability.domainIds.map((d) => d.toLowerCase()).includes('teta_me')),
    ).toBe(true);
  });
});

describe('Stage 3J.2D combined fixtures', () => {
  test('all packs run without occurrence loss', () => {
    const packs = allFixturePacks();
    expect(packs.length).toBe(22);
    for (const p of packs) {
      const r = runStage3j2dCorrelation(p.manifest);
      expect(r.stats.candidateOccurrencesLost).toBe(0);
      expect(r.stats.evidenceOccurrencesLost).toBe(0);
      expect(r.stats.rawSourcesReadByStage3j2d).toBe(0);
      expect(r.stats.localModelCalls).toBe(0);
      expect(r.stats.approvedRecordsCreated).toBe(0);
    }
  });
  test('combined fixture determinism', () => {
    const m = combinedFixtureManifest();
    const a = runStage3j2dCorrelation(m);
    const b = runStage3j2dCorrelation(m);
    expect(a.manifest.fingerprintSha256).toBe(b.manifest.fingerprintSha256);
    expect(a.manifest.run.correlationRunId).toBe(b.manifest.run.correlationRunId);
  });
  test('combined fixture evaluates 21 questions', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.goldenQuestionsEvaluated).toBe(21);
    expect(r.manifest.questionCoverage).toHaveLength(21);
  });
  test('approval always not_reviewed', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.manifest.proposedRecords.every((x) => x.approval.status === 'not_reviewed')).toBe(true);
  });
  test('no oracle connections', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.oracleConnectionsOpened).toBe(0);
    expect(r.stats.graphCorrelationOracleConnections).toBe(0);
  });
});

describe('Stage 3J.2D strict boundaries', () => {
  test('stage boundary counters are zero on fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    for (const f of STAGE_BOUNDARY_ZERO_FIELDS) {
      expect(r.stats[f]).toBe(0);
    }
  });
  test('strict errors empty on fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest(), { strict: true });
    expect(r.strictErrors).toEqual([]);
  });
});

describe('Stage 3J.2D relation decision identity', () => {
  test('relationDecisionId stable across runs', () => {
    const m = fixturePackA_ExactDuplicate();
    const a = runStage3j2dCorrelation(m);
    const b = runStage3j2dCorrelation(m);
    expect(a.manifest.relationDecisions.map((d) => d.relationDecisionId)).toEqual(
      b.manifest.relationDecisions.map((d) => d.relationDecisionId),
    );
  });
  test('proposedRecordLogicalId prefix', () => {
    const a = runStage3j2dCorrelation(fixturePackA_ExactDuplicate());
    expect(a.manifest.proposedRecords[0].proposedRecordLogicalId.startsWith('proposed-logical:')).toBe(true);
  });
  test('changed candidate creates new run id', () => {
    const base = fixturePackA_ExactDuplicate();
    const changed = buildFixtureManifest([
      ...base.batches[0].candidateOccurrences,
      makeOccurrence({ id: 'occ:extra', kind: 'status', label: 'Extra', predicate: 'is', statement: 'Extra status' }),
    ]);
    const a = runStage3j2dCorrelation(base);
    const b = runStage3j2dCorrelation(changed);
    expect(a.manifest.run.correlationRunId).not.toBe(b.manifest.run.correlationRunId);
  });
});

describe('Stage 3J.2D lexical false positive', () => {
  test('similar words alone are not semantic_duplicate', () => {
    const m = buildFixtureManifest([
      makeOccurrence({
        id: 'lex1',
        kind: 'business_concept',
        label: 'Premia roczna',
        predicate: 'jest',
        statement: 'Premia roczna jest wypłacana raz w roku pracownikom.',
        payload: {},
      }),
      makeOccurrence({
        id: 'lex2',
        kind: 'business_concept',
        label: 'Premia kwartalna',
        predicate: 'jest',
        statement: 'Premia kwartalna jest wypłacana raz na kwartał pracownikom.',
        payload: {},
      }),
    ]);
    const r = runStage3j2dCorrelation(m);
    expect(r.stats.semanticDuplicatesBasedOnlyOnLexicalSimilarity).toBe(0);
    expect(kindsOf(r)).not.toContain('semantic_duplicate');
  });
});

describe('Stage 3J.2D golden question safety', () => {
  test('question Q01 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q01');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q02 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q02');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q03 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q03');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q04 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q04');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q05 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q05');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q06 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q06');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q07 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q07');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q08 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q08');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q09 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q09');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q10 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q10');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q11 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q11');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q12 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q12');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q13 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q13');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q14 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q14');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q15 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q15');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q16 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q16');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q17 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q17');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q18 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q18');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q19 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q19');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q20 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q20');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('question Q21 has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === 'Q21');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });
  test('Q14 never supported-current without verification', () => {
    const r = runStage3j2dCorrelation(fixturePackN_Regulatory());
    const q14 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q14');
    expect(q14?.coverageStatus).not.toBe('supported');
  });
  test('supported questions always have evidence', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    for (const q of r.manifest.questionCoverage.filter((x) => x.coverageStatus === 'supported')) {
      expect(q.evidenceCount).toBeGreaterThan(0);
    }
  });
});

describe('Stage 3J.2D privacy', () => {
  test('repo docs path check helpers', () => {
    expect(typeof sha256('x')).toBe('string');
    expect(stableStringify({ b: 1, a: 2 })).toContain('a');
  });
});

describe('Stage 3J.2D pair generation', () => {
  test('does not compare unrelated kinds', () => {
    const m = buildFixtureManifest([
      makeOccurrence({ id: 'k1', kind: 'status', label: 'S', predicate: 'is', statement: 'S is open' }),
      makeOccurrence({ id: 'k2', kind: 'parameter', label: 'S', predicate: 'is', statement: 'S is open' }),
    ]);
    const r = runStage3j2dCorrelation(m);
    expect(r.stats.unrelatedKindsCompared).toBe(0);
  });
});

describe('Stage 3J.2D invariant matrix', () => {
  test('A_exact keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('A_exact keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('A_exact keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('A_exact keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('A_exact keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('A_exact keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('A_exact keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('A_exact keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('A_exact keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('A_exact keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('A_exact keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('A_exact keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('A_exact keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('A_exact keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('A_exact keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('A_exact keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('A_exact keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('A_exact keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('A_exact keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('A_exact keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('A_exact keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('A_exact keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('A_exact keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('A_exact keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('A_exact keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('A_exact keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('A_exact keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('A_exact keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'A_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('B_semantic keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('B_semantic keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('B_semantic keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('B_semantic keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('B_semantic keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('B_semantic keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('B_semantic keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('B_semantic keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('B_semantic keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('B_semantic keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('B_semantic keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('B_semantic keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('B_semantic keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('B_semantic keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('B_semantic keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('B_semantic keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('B_semantic keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('B_semantic keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('B_semantic keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('B_semantic keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('B_semantic keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('B_semantic keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('B_semantic keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('B_semantic keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('B_semantic keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('B_semantic keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('B_semantic keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('B_semantic keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'B_semantic')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('C_enrich keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('C_enrich keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('C_enrich keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('C_enrich keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('C_enrich keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('C_enrich keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('C_enrich keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('C_enrich keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('C_enrich keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('C_enrich keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('C_enrich keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('C_enrich keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('C_enrich keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('C_enrich keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('C_enrich keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('C_enrich keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('C_enrich keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('C_enrich keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('C_enrich keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('C_enrich keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('C_enrich keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('C_enrich keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('C_enrich keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('C_enrich keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('C_enrich keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('C_enrich keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('C_enrich keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('C_enrich keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'C_enrich')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('D_product keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('D_product keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('D_product keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('D_product keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('D_product keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('D_product keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('D_product keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('D_product keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('D_product keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('D_product keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('D_product keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('D_product keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('D_product keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('D_product keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('D_product keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('D_product keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('D_product keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('D_product keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('D_product keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('D_product keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('D_product keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('D_product keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('D_product keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('D_product keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('D_product keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('D_product keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('D_product keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('D_product keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'D_product')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('E_surface keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('E_surface keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('E_surface keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('E_surface keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('E_surface keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('E_surface keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('E_surface keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('E_surface keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('E_surface keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('E_surface keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('E_surface keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('E_surface keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('E_surface keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('E_surface keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('E_surface keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('E_surface keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('E_surface keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('E_surface keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('E_surface keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('E_surface keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('E_surface keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('E_surface keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('E_surface keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('E_surface keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('E_surface keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('E_surface keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('E_surface keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('E_surface keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'E_surface')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('F_version keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('F_version keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('F_version keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('F_version keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('F_version keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('F_version keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('F_version keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('F_version keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('F_version keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('F_version keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('F_version keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('F_version keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('F_version keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('F_version keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('F_version keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('F_version keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('F_version keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('F_version keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('F_version keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('F_version keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('F_version keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('F_version keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('F_version keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('F_version keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('F_version keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('F_version keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('F_version keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('F_version keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'F_version')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('G_temporal keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('G_temporal keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('G_temporal keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('G_temporal keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('G_temporal keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('G_temporal keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('G_temporal keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('G_temporal keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('G_temporal keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('G_temporal keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('G_temporal keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('G_temporal keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('G_temporal keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('G_temporal keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('G_temporal keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('G_temporal keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('G_temporal keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('G_temporal keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('G_temporal keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('G_temporal keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('G_temporal keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('G_temporal keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('G_temporal keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('G_temporal keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('G_temporal keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('G_temporal keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('G_temporal keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('G_temporal keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'G_temporal')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('H_config keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('H_config keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('H_config keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('H_config keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('H_config keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('H_config keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('H_config keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('H_config keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('H_config keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('H_config keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('H_config keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('H_config keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('H_config keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('H_config keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('H_config keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('H_config keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('H_config keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('H_config keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('H_config keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('H_config keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('H_config keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('H_config keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('H_config keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('H_config keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('H_config keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('H_config keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('H_config keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('H_config keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'H_config')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('I_process keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('I_process keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('I_process keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('I_process keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('I_process keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('I_process keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('I_process keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('I_process keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('I_process keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('I_process keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('I_process keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('I_process keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('I_process keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('I_process keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('I_process keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('I_process keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('I_process keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('I_process keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('I_process keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('I_process keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('I_process keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('I_process keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('I_process keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('I_process keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('I_process keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('I_process keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('I_process keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('I_process keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'I_process')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('J_client keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('J_client keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('J_client keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('J_client keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('J_client keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('J_client keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('J_client keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('J_client keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('J_client keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('J_client keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('J_client keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('J_client keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('J_client keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('J_client keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('J_client keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('J_client keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('J_client keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('J_client keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('J_client keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('J_client keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('J_client keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('J_client keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('J_client keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('J_client keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('J_client keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('J_client keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('J_client keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('J_client keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'J_client')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('K_conflict keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('K_conflict keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('K_conflict keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('K_conflict keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('K_conflict keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('K_conflict keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('K_conflict keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('K_conflict keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('K_conflict keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('K_conflict keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('K_conflict keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('K_conflict keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('K_conflict keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('K_conflict keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('K_conflict keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('K_conflict keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('K_conflict keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('K_conflict keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('K_conflict keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('K_conflict keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('K_conflict keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('K_conflict keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('K_conflict keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('K_conflict keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('K_conflict keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('K_conflict keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('K_conflict keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('K_conflict keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'K_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('L_unknown keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('L_unknown keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('L_unknown keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('L_unknown keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('L_unknown keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('L_unknown keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('L_unknown keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('L_unknown keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('L_unknown keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('L_unknown keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('L_unknown keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('L_unknown keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('L_unknown keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('L_unknown keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('L_unknown keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('L_unknown keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('L_unknown keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('L_unknown keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('L_unknown keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('L_unknown keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('L_unknown keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('L_unknown keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('L_unknown keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('L_unknown keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('L_unknown keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('L_unknown keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('L_unknown keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('L_unknown keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'L_unknown')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('M_shared_sig keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('M_shared_sig keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('M_shared_sig keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('M_shared_sig keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('M_shared_sig keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('M_shared_sig keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('M_shared_sig keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('M_shared_sig keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('M_shared_sig keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('M_shared_sig keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('M_shared_sig keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('M_shared_sig keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('M_shared_sig keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('M_shared_sig keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('M_shared_sig keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('M_shared_sig keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('M_shared_sig keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('M_shared_sig keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('M_shared_sig keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('M_shared_sig keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('M_shared_sig keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('M_shared_sig keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('M_shared_sig keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('M_shared_sig keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('M_shared_sig keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('M_shared_sig keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('M_shared_sig keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('M_shared_sig keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'M_shared_sig')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('N_regulatory keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('N_regulatory keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('N_regulatory keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('N_regulatory keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('N_regulatory keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('N_regulatory keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('N_regulatory keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('N_regulatory keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('N_regulatory keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('N_regulatory keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('N_regulatory keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('N_regulatory keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('N_regulatory keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('N_regulatory keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('N_regulatory keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('N_regulatory keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('N_regulatory keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('N_regulatory keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('N_regulatory keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('N_regulatory keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('N_regulatory keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('N_regulatory keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('N_regulatory keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('N_regulatory keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('N_regulatory keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('N_regulatory keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('N_regulatory keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('N_regulatory keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'N_regulatory')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('O_payroll keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('O_payroll keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('O_payroll keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('O_payroll keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('O_payroll keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('O_payroll keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('O_payroll keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('O_payroll keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('O_payroll keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('O_payroll keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('O_payroll keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('O_payroll keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('O_payroll keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('O_payroll keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('O_payroll keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('O_payroll keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('O_payroll keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('O_payroll keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('O_payroll keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('O_payroll keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('O_payroll keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('O_payroll keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('O_payroll keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('O_payroll keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('O_payroll keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('O_payroll keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('O_payroll keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('O_payroll keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'O_payroll')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('P_help_exact keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('P_help_exact keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('P_help_exact keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('P_help_exact keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('P_help_exact keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('P_help_exact keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('P_help_exact keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('P_help_exact keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('P_help_exact keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('P_help_exact keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('P_help_exact keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('P_help_exact keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('P_help_exact keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('P_help_exact keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('P_help_exact keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('P_help_exact keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('P_help_exact keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('P_help_exact keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('P_help_exact keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('P_help_exact keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('P_help_exact keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('P_help_exact keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('P_help_exact keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('P_help_exact keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('P_help_exact keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('P_help_exact keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('P_help_exact keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('P_help_exact keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'P_help_exact')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('Q_help_ambiguous keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('Q_help_ambiguous keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('Q_help_ambiguous keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('Q_help_ambiguous keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('Q_help_ambiguous keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('Q_help_ambiguous keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('Q_help_ambiguous keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('Q_help_ambiguous keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('Q_help_ambiguous keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('Q_help_ambiguous keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('Q_help_ambiguous keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('Q_help_ambiguous keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('Q_help_ambiguous keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('Q_help_ambiguous keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('Q_help_ambiguous keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('Q_help_ambiguous keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('Q_help_ambiguous keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('Q_help_ambiguous keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('Q_help_ambiguous keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('Q_help_ambiguous keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('Q_help_ambiguous keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('Q_help_ambiguous keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('Q_help_ambiguous keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('Q_help_ambiguous keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('Q_help_ambiguous keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('Q_help_ambiguous keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('Q_help_ambiguous keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('Q_help_ambiguous keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'Q_help_ambiguous')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('R_golden_supported keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('R_golden_supported keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('R_golden_supported keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('R_golden_supported keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('R_golden_supported keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('R_golden_supported keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('R_golden_supported keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('R_golden_supported keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('R_golden_supported keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('R_golden_supported keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('R_golden_supported keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('R_golden_supported keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('R_golden_supported keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('R_golden_supported keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('R_golden_supported keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('R_golden_supported keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('R_golden_supported keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('R_golden_supported keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('R_golden_supported keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('R_golden_supported keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('R_golden_supported keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('R_golden_supported keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('R_golden_supported keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('R_golden_supported keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('R_golden_supported keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('R_golden_supported keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('R_golden_supported keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('R_golden_supported keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'R_golden_supported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('S_golden_partial keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('S_golden_partial keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('S_golden_partial keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('S_golden_partial keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('S_golden_partial keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('S_golden_partial keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('S_golden_partial keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('S_golden_partial keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('S_golden_partial keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('S_golden_partial keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('S_golden_partial keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('S_golden_partial keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('S_golden_partial keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('S_golden_partial keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('S_golden_partial keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('S_golden_partial keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('S_golden_partial keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('S_golden_partial keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('S_golden_partial keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('S_golden_partial keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('S_golden_partial keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('S_golden_partial keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('S_golden_partial keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('S_golden_partial keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('S_golden_partial keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('S_golden_partial keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('S_golden_partial keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('S_golden_partial keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'S_golden_partial')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('T_golden_unsupported keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('T_golden_unsupported keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('T_golden_unsupported keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('T_golden_unsupported keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('T_golden_unsupported keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('T_golden_unsupported keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('T_golden_unsupported keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('T_golden_unsupported keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('T_golden_unsupported keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('T_golden_unsupported keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('T_golden_unsupported keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('T_golden_unsupported keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('T_golden_unsupported keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('T_golden_unsupported keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('T_golden_unsupported keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('T_golden_unsupported keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('T_golden_unsupported keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('T_golden_unsupported keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('T_golden_unsupported keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('T_golden_unsupported keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('T_golden_unsupported keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('T_golden_unsupported keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('T_golden_unsupported keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('T_golden_unsupported keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('T_golden_unsupported keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('T_golden_unsupported keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('T_golden_unsupported keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('T_golden_unsupported keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'T_golden_unsupported')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('U_golden_conflict keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('U_golden_conflict keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('U_golden_conflict keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('U_golden_conflict keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('U_golden_conflict keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('U_golden_conflict keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('U_golden_conflict keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('U_golden_conflict keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('U_golden_conflict keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('U_golden_conflict keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('U_golden_conflict keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('U_golden_conflict keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('U_golden_conflict keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('U_golden_conflict keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('U_golden_conflict keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('U_golden_conflict keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('U_golden_conflict keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('U_golden_conflict keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('U_golden_conflict keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('U_golden_conflict keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('U_golden_conflict keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('U_golden_conflict keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('U_golden_conflict keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('U_golden_conflict keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('U_golden_conflict keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('U_golden_conflict keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('U_golden_conflict keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('U_golden_conflict keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'U_golden_conflict')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
  test('V_teta_me keeps candidateOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateOccurrencesLost']).toBe(0);
  });
  test('V_teta_me keeps evidenceOccurrencesLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['evidenceOccurrencesLost']).toBe(0);
  });
  test('V_teta_me keeps rawSourcesReadByStage3j2d=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['rawSourcesReadByStage3j2d']).toBe(0);
  });
  test('V_teta_me keeps folderOnlyPairingsGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['folderOnlyPairingsGenerated']).toBe(0);
  });
  test('V_teta_me keeps unrelatedKindsCompared=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unrelatedKindsCompared']).toBe(0);
  });
  test('V_teta_me keeps conflictsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictsAutoResolved']).toBe(0);
  });
  test('V_teta_me keeps conflictingEvidenceDiscarded=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['conflictingEvidenceDiscarded']).toBe(0);
  });
  test('V_teta_me keeps approvedRecordsCreated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['approvedRecordsCreated']).toBe(0);
  });
  test('V_teta_me keeps existingApprovedRecordsModified=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['existingApprovedRecordsModified']).toBe(0);
  });
  test('V_teta_me keeps candidateRecordsAutoApprovedFromLexicon=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['candidateRecordsAutoApprovedFromLexicon']).toBe(0);
  });
  test('V_teta_me keeps ambiguousCorrelationsAutoResolved=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ambiguousCorrelationsAutoResolved']).toBe(0);
  });
  test('V_teta_me keeps graphCorrelationOracleConnections=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['graphCorrelationOracleConnections']).toBe(0);
  });
  test('V_teta_me keeps leadingZeroIdentifiersLost=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['leadingZeroIdentifiersLost']).toBe(0);
  });
  test('V_teta_me keeps customerExampleClaimsPromotedToGlobal=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['customerExampleClaimsPromotedToGlobal']).toBe(0);
  });
  test('V_teta_me keeps localModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['localModelCalls']).toBe(0);
  });
  test('V_teta_me keeps remoteModelCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['remoteModelCalls']).toBe(0);
  });
  test('V_teta_me keeps ragChunksGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ragChunksGenerated']).toBe(0);
  });
  test('V_teta_me keeps qdrantCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['qdrantCalls']).toBe(0);
  });
  test('V_teta_me keeps embeddingCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['embeddingCalls']).toBe(0);
  });
  test('V_teta_me keeps ocrCalls=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['ocrCalls']).toBe(0);
  });
  test('V_teta_me keeps oracleConnectionsOpened=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['oracleConnectionsOpened']).toBe(0);
  });
  test('V_teta_me keeps sqlExecuted=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['sqlExecuted']).toBe(0);
  });
  test('V_teta_me keeps finalChatAnswersGenerated=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['finalChatAnswersGenerated']).toBe(0);
  });
  test('V_teta_me keeps tetaEduMergedIntoTetaHr=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['tetaEduMergedIntoTetaHr']).toBe(0);
  });
  test('V_teta_me keeps unknownApplicabilityAutoMerged=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['unknownApplicabilityAutoMerged']).toBe(0);
  });
  test('V_teta_me keeps goldenQuestionsIncorrectlyMarkedSupported=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['goldenQuestionsIncorrectlyMarkedSupported']).toBe(0);
  });
  test('V_teta_me keeps supportedQuestionsWithoutEvidence=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithoutEvidence']).toBe(0);
  });
  test('V_teta_me keeps supportedQuestionsWithUnresolvedConflict=0', () => {
    const pack = allFixturePacks().find((p) => p.name === 'V_teta_me')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['supportedQuestionsWithUnresolvedConflict']).toBe(0);
  });
});

describe('Stage 3J.2D audit smoke', () => {
  test('buildStage3j2dAudit returns readiness', () => {
    const audit = buildStage3j2dAudit(undefined, { useFixture: true, strict: true });
    expect(audit.readiness.stage3j2eReadiness.status).toMatch(/ready/);
    expect(audit.strictErrors).toEqual([]);
  });
});

describe('Stage 3J.2D utility patch counters', () => {
  const keys = [
    'requiresReviewDecisionsWithConcreteReason',
    'requiresReviewDecisionsWithoutConcreteReason',
    'candidateCorrelationClustersCreated',
    'multiOccurrenceClustersCreated',
    'singleOccurrenceClustersCreated',
    'occurrencesAssignedToClusters',
    'occurrencesAssignedMultipleTimes',
    'occurrencesNotAssignedToAnyCluster',
    'clustersIncorrectlyTreatedAsApprovedMerge',
    'relationReviewDecisionsWithoutReviewTask',
    'reviewTasksWithoutActionableReason',
    'reviewTasksCreated',
    'duplicateReviewTasksCollapsed',
    'proposedRecordsWithOneOccurrence',
    'proposedRecordsWithMultipleOccurrences',
    'maximumOccurrencesPerProposedRecord',
    'proposedRecordsIncorrectlyMergedAcrossApplicability',
    'correlationQueriesAttempted',
    'correlationHintsSourceUnavailable',
    'correlationHintsUnresolvedAfterQuery',
    'correlationsReportedUnresolvedWithoutQuery',
    'correlationSourceAvailabilityMisreported',
    'productRegistryAnchorsResolved',
    'productSurfaceRegistryAnchorsResolved',
    'businessDomainRegistryAnchorsResolved',
    'registryAnchorsIncorrectlyTreatedAsApprovedKnowledge',
    'goldenQuestionsWithoutEvaluationReason',
    'goldenQuestionsUnsupportedDespiteMatchingEvidence',
    'goldenQuestionsSupportedWithoutRequiredKinds',
    'goldenQuestionsIgnoringRegistryAnchors',
    'goldenQuestionsIgnoringCurrentnessFlags',
    'q21IncorrectlyUnsupported',
    'q14CurrentnessStatusIncorrect',
    'periodicComponentQuestionsWithMatchingEvidence',
    'periodicComponentQuestionsStillUnsupportedDespiteEvidence',
  ] as const;
  for (const key of keys) {
    test(`combined fixture has ${key} numeric`, () => {
      const r = runStage3j2dCorrelation(combinedFixtureManifest());
      expect(typeof r.stats[key]).toBe('number');
      expect(Number(r.stats[key])).toBeGreaterThanOrEqual(0);
    });
  }
  const strictZeroKeys = [
    'requiresReviewDecisionsWithoutConcreteReason',
    'occurrencesAssignedMultipleTimes',
    'occurrencesNotAssignedToAnyCluster',
    'clustersIncorrectlyTreatedAsApprovedMerge',
    'relationReviewDecisionsWithoutReviewTask',
    'reviewTasksWithoutActionableReason',
    'correlationsReportedUnresolvedWithoutQuery',
    'correlationSourceAvailabilityMisreported',
    'registryAnchorsIncorrectlyTreatedAsApprovedKnowledge',
    'q21IncorrectlyUnsupported',
    'q14CurrentnessStatusIncorrect',
    'periodicComponentQuestionsStillUnsupportedDespiteEvidence',
  ] as const;
  for (const key of strictZeroKeys) {
    test(`combined fixture keeps ${key}=0`, () => {
      const r = runStage3j2dCorrelation(combinedFixtureManifest());
      expect(r.stats[key]).toBe(0);
    });
  }
  test('real correlation status is demonstrated on combined fixture', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(String(r.stats.stage3j2dRealCorrelationStatus)).toMatch(/demonstrated/);
  });
  test('Q21 is not unsupported on fixture V', () => {
    const r = runStage3j2dCorrelation(fixturePackV_TetaMe());
    const q21 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q21');
    expect(q21).toBeTruthy();
    expect(q21?.coverageStatus).not.toBe('unsupported');
  });
  test('Q14 currentness status uses verification when evidence exists', () => {
    const r = runStage3j2dCorrelation(fixturePackN_Regulatory());
    const q14 = r.manifest.questionCoverage.find((q) => q.questionId === 'Q14');
    expect(q14?.coverageStatus).toBe('requires_currentness_verification');
  });
});

describe('Stage 3J.2D final completeness patch', () => {
  const numericKeys = [
    'candidateOccurrencesAvailable',
    'candidateOccurrencesLoaded',
    'candidateOccurrencesValidated',
    'candidateOccurrencesAvailableToQuestionEvaluator',
    'candidateOccurrencesEligibleForPairing',
    'candidateOccurrencesExcludedFromPairingByPolicy',
    'candidateOccurrencesExcludedByDebugLimit',
    'pairsEnteringBlocking',
    'pairsPassingPairEligibility',
    'pairsSkippedByPairEligibility',
    'pairsWithStrongTopicSignal',
    'pairsWithoutStrongTopicSignal',
    'requiresReviewDecisionsWithStrongTopicSignal',
    'requiresReviewDecisionsWithoutStrongTopicSignal',
    'weakPairsIncorrectlyConvertedToReviewDecision',
    'genericRequiresReviewReasons',
    'requiresReviewWithoutSharedTopicEvidence',
    'multiOccurrenceProposedRecords',
    'multiOccurrenceProposedRecordsWithMergeSupportingRelation',
    'multiOccurrenceProposedRecordsWithoutMergeSupportingRelation',
    'requiresReviewClustersIncorrectlyMaterializedAsMergedRecord',
    'occurrencesImplicitlyMergedByClusterMembership',
    'pairLevelReviewTasksCreated',
    'clusterLevelReviewTasksCreated',
    'subjectLevelReviewTasksCreated',
    'questionLevelReviewTasksCreated',
    'duplicateReviewTaskKeysDetected',
    'redundantReviewTasksCollapsed',
    'relationReviewDecisionsCoveredByReviewTasks',
    'relationReviewDecisionsCoveredMultipleTimes',
    'reviewTasksCoveringMultipleRelations',
    'reviewTasksWithNoHumanDecision',
    'reviewTasksWithNoEvidence',
    'periodicComponentMatchingOccurrences',
    'periodicComponentEvidenceExcludedByPreviousLimit',
    'periodicComponentQuestionsWithEvidence',
    'ksefMatchingOccurrences',
    'ksefCurrentnessUnknownOccurrences',
    'q14EvidenceExcludedByPreviousLimit',
    'technicalQuestionMatchingOccurrences',
    'technicalQuestionsWithEvidence',
    'technicalQuestionsUnsupportedDespiteEvidence',
    'productVariantEligiblePairs',
    'eligibleVariantPairsClassifiedAsVariant',
    'eligibleVariantPairsClassifiedRequiresReview',
    'eligibleVariantPairsMissed',
    'matchingEvidenceExcludedByCandidateLimit',
    'goldenQuestionsEvaluatedOnPartialInput',
    'readinessCalculatedFromPartialInput',
  ] as const;
  for (const key of numericKeys) {
    test(`combined fixture exposes ${key}`, () => {
      const r = runStage3j2dCorrelation(combinedFixtureManifest());
      expect(typeof r.stats[key]).toBe('number');
      expect(Number(r.stats[key])).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('Stage 3J.2D pre-commit cleanup metrics', () => {
  test('candidate occurrence count can differ from evidence entries', () => {
    const m = combinedFixtureManifest();
    const first = m.batches[0]?.candidateOccurrences?.[0];
    if (first && first.evidence?.length) {
      first.evidence.push({ ...first.evidence[0], sectionId: `${first.evidence[0].sectionId}:dup` });
    }
    const r = runStage3j2dCorrelation(m);
    expect(Number(r.stats.candidateOccurrencesRead)).not.toBe(Number(r.stats.evidenceEntriesRead));
  });
  test('evidence entries preserved equals read', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.evidenceEntriesPreserved).toBe(r.stats.evidenceEntriesRead);
  });
  test('strict fails when evidence entry missing occurrence linkage', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const strict = collectStrictErrors(
      { ...r.stats, evidenceEntriesWithMissingCandidateOccurrence: 1 },
      { status: 'ready_with_review', reasons: [] },
    );
    expect(strict).toContain('evidenceEntriesWithMissingCandidateOccurrence');
  });
  test('strict fails when occurrence has no evidence entries', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const strict = collectStrictErrors(
      { ...r.stats, occurrencesWithoutEvidenceEntries: 1 },
      { status: 'ready_with_review', reasons: [] },
    );
    expect(strict).toContain('occurrencesWithoutEvidenceEntries');
  });
  test('multi-occurrence mergeStatus accounting reconciles', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const total = Number(r.stats.proposedRecordsWithMultipleOccurrences);
    const sum =
      Number(r.stats.multiOccurrenceRecordsExactCollapsed ?? 0) +
      Number(r.stats.multiOccurrenceRecordsSemanticallyGrouped ?? 0) +
      Number(r.stats.multiOccurrenceRecordsEnriched ?? 0) +
      Number(r.stats.multiOccurrenceRecordsVariantPartitioned ?? 0) +
      Number(r.stats.multiOccurrenceRecordsConflictPartitioned ?? 0) +
      Number(r.stats.multiOccurrenceRecordsRequiresReviewBeforeMerge ?? 0);
    expect(total).toBe(sum);
  });
  test('merge-support accounting separates review groups from invalid merged records', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const total = Number(r.stats.proposedRecordsWithMultipleOccurrences);
    const withSupport = Number(r.stats.multiOccurrenceRecordsWithMergeSupportingRelation ?? 0);
    const reviewOnly = Number(r.stats.multiOccurrenceReviewGroupProposalsWithoutMergeSupportingRelation ?? 0);
    const invalidMerged = Number(r.stats.invalidMergedRecordsWithoutMergeSupportingRelation ?? 0);
    expect(total).toBe(withSupport + reviewOnly);
    expect(invalidMerged).toBe(0);
    expect(reviewOnly).toBeGreaterThanOrEqual(0);
  });
  test('requires_review_before_merge records are not reported as merged', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.reviewGroupProposalsIncorrectlyReportedAsMerged ?? 0).toBe(0);
  });
  test('cluster membership does not imply implicit merge', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.occurrencesMergedOnlyBecauseOfClusterMembership ?? 0).toBe(0);
  });
  test('review primary grouping is reconciled', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.reviewTasksWithoutPrimaryGrouping).toBe(0);
    expect(r.stats.reviewTasksWithMultiplePrimaryGroupings).toBe(0);
    expect(r.stats.reviewTaskCountReconciliationOk).toBe(true);
  });
  test('grouping membership does not break task totals', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const counts = JSON.parse(String(r.stats.reviewTaskPrimaryGroupingCounts ?? '{}')) as Record<string, number>;
    const total = Object.values(counts).reduce((sum, v) => sum + Number(v || 0), 0);
    expect(total).toBe(Number(r.stats.reviewTasksCreated));
  });
  test('repo summary can be based on acceptance run', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    expect(r.stats.acceptanceRunInputComplete).toBe(true);
  });
  test('unsupported without evidence remains valid', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const unsupported = r.manifest.questionCoverage.filter((q) => q.coverageStatus === 'unsupported');
    expect(unsupported.every((q) => q.evidenceCount === 0)).toBe(true);
  });
  test('debug run flags partial input readiness', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest(), { maxCandidates: 10 });
    expect(r.stats.debugRunInputPartial).toBe(true);
    expect(r.stats.readinessCalculatedFromPartialInput).toBe(1);
  });
});
