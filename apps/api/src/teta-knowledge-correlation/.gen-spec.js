/* eslint-disable */
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'teta-stage3j2d.spec.ts');

const header = `import {
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
`;

const questionTests = Array.from({ length: 21 }, (_, i) => {
  const id = `Q${String(i + 1).padStart(2, '0')}`;
  return `  test('question ${id} has coverage assessment on combined fixtures', () => {
    const r = runStage3j2dCorrelation(combinedFixtureManifest());
    const q = r.manifest.questionCoverage.find((x) => x.questionId === '${id}');
    expect(q).toBeTruthy();
    expect(q!.coverageStatus).toBeTruthy();
  });`;
}).join('\n');

const mid = `
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
`;

const invariants = [
  'candidateOccurrencesLost',
  'evidenceOccurrencesLost',
  'rawSourcesReadByStage3j2d',
  'folderOnlyPairingsGenerated',
  'unrelatedKindsCompared',
  'conflictsAutoResolved',
  'conflictingEvidenceDiscarded',
  'approvedRecordsCreated',
  'existingApprovedRecordsModified',
  'candidateRecordsAutoApprovedFromLexicon',
  'ambiguousCorrelationsAutoResolved',
  'graphCorrelationOracleConnections',
  'leadingZeroIdentifiersLost',
  'customerExampleClaimsPromotedToGlobal',
  'localModelCalls',
  'remoteModelCalls',
  'ragChunksGenerated',
  'qdrantCalls',
  'embeddingCalls',
  'ocrCalls',
  'oracleConnectionsOpened',
  'sqlExecuted',
  'finalChatAnswersGenerated',
  'tetaEduMergedIntoTetaHr',
  'unknownApplicabilityAutoMerged',
  'goldenQuestionsIncorrectlyMarkedSupported',
  'supportedQuestionsWithoutEvidence',
  'supportedQuestionsWithUnresolvedConflict',
];

const packNames = [
  'A_exact',
  'B_semantic',
  'C_enrich',
  'D_product',
  'E_surface',
  'F_version',
  'G_temporal',
  'H_config',
  'I_process',
  'J_client',
  'K_conflict',
  'L_unknown',
  'M_shared_sig',
  'N_regulatory',
  'O_payroll',
  'P_help_exact',
  'Q_help_ambiguous',
  'R_golden_supported',
  'S_golden_partial',
  'T_golden_unsupported',
  'U_golden_conflict',
  'V_teta_me',
];

let matrix = '';
for (const pack of packNames) {
  for (const inv of invariants) {
    matrix += `  test('${pack} keeps ${inv}=0', () => {
    const pack = allFixturePacks().find((p) => p.name === '${pack}')!;
    const r = runStage3j2dCorrelation(pack.manifest);
    expect(r.stats['${inv}']).toBe(0);
  });
`;
  }
}

const footer = `});

describe('Stage 3J.2D audit smoke', () => {
  test('buildStage3j2dAudit returns readiness', () => {
    const audit = buildStage3j2dAudit(undefined, { useFixture: true, strict: true });
    expect(audit.readiness.stage3j2eReadiness.status).toMatch(/ready/);
    expect(audit.strictErrors).toEqual([]);
  });
});
`;

fs.writeFileSync(out, header + questionTests + mid + matrix + footer);
console.log('tests approx', (header + questionTests + mid + matrix + footer).split('test(').length - 1);
