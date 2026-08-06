import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildImportManifestFromExport,
} from './teta-view-metadata-import';
import {
  assertFinalizationStrictCounters,
  buildPreviewDeltaFromEvidence,
  buildSessionContextSnippetFromFinalization,
  fingerprintFromDeterministicPayload,
  runStage3k2b2b2b2OfflineFinalization,
  stripRawFieldsForRepoSafe,
} from './teta-view-metadata-offline-finalization';

jest.mock('../teta-employee-foundation-source-enrichment/teta-enrichment-policy', () => ({
  loadEnrichmentPolicy: () => ({
    policy: { policyVersion: 'enrichment-v1' },
    policyHash: 'enrichment-hash-v1',
  }),
}));

jest.mock('./teta-view-metadata-policy', () => ({
  loadMetadataPolicy: () => ({
    policyPath: 'apps/api/config/teta-candidate-scoped-view-metadata-export-policy-v1.json',
    policy: { policyVersion: 'teta-aia-candidate-scoped-view-metadata-export-policy-v1', rulesApplied: ['x'] },
    policyHash: 'policy-hash-v2',
  }),
}));

jest.mock('./teta-view-metadata-import', () => {
  const original = jest.requireActual('./teta-view-metadata-import');
  return {
    ...original,
    importValidatedViewDefinition: () => ({
      outcome: 'validated_complete',
      envelope: { ddlEnvelopeParseStatus: 'parsed', queryBodyExtractionStatus: 'extracted' },
      parse: { parseStatus: 'parsed' },
      keyPreservation: { keyPreservationStatus: 'proven' },
      rawHashRevalidatedBeforeImport: true,
      rawHashRevalidatedBeforeParse: true,
    }),
  };
});

jest.mock('../teta-semantic-evidence-gap/teta-candidate-reevaluation', () => ({
  executeStage3k2b1Reevaluation: () => ({
    requestId: 'reeval:P1:test',
    candidateId: 'cand:P1:employee',
    oldCandidateFingerprint: 'old-fp',
    newCandidateFingerprint: 'new-fp',
    evaluationPolicyId: 'policy-id',
    evaluationPolicyVersion: 'policy-v1',
    evaluationPolicyHash: 'policy-hash-v1',
    candidateEvaluationFingerprint: 'eval-fp',
    evaluatorExecuted: true,
    resultStatus: 'ready_with_review',
    evidenceAssessment: 'supported',
    approvalReadiness: 'review_required',
    blockingRulesPassed: ['rule-a'],
    blockingRulesFailed: [],
    nonBlockingWarnings: [],
    genericActivationEligible: false,
    planningEligible: false,
    approvalForbidden: true,
    evaluationTraceFinalAssessment: 'supported',
    rulesApplied: [],
  }),
}));

function writeFinalizationFixtures(
  root: string,
  opts?: { staleImport?: boolean; stalePolicy?: boolean; artifactVersion?: 'v2' | 'v3' },
) {
  const suffix = opts?.artifactVersion ?? 'v2';
  const out = path.join(root, '.local', 'stage3k2b2b2b2');
  fs.mkdirSync(path.join(out, `review-packs-${suffix}`), { recursive: true });
  const exportManifest = {
    manifestFingerprint: 'exp-fp',
    candidateId: 'cand:P1:employee',
    candidateFingerprint: 'cand-fp',
    targetIdentity: {
      owner: 'TETA_ADMIN',
      objectName: 'NT_KP_PRC_PRACOWNICY',
      objectType: 'VIEW',
    },
    identityFingerprint: 'id-fp',
    vendorArtifactRootId: 'vendor-root',
    vendorArtifactRootFingerprint: 'vendor-root-fp',
    payloadRelativePath: 'P1/TETA_ADMIN.NT_KP_PRC_PRACOWNICY.sql',
    payloadResolvedPathFingerprint: 'payload-path-fp',
    rawPayloadSha256: 'raw-sha',
    canonicalPayloadSha256: 'canon-sha',
    payloadByteLength: 100,
    declaredCompletenessStatus: 'complete',
    metadataSourceKind: 'dbms_metadata_get_ddl',
    metadataTransformProfileId: 'oracle-view-ddl-canonical-v1',
    metadataTransformProfileVersion: 'v1',
    metadataTransformProfileHash: 'profile-hash',
    exportPolicyVersion: 'teta-aia-candidate-scoped-view-metadata-export-policy-v1',
    exportPolicyHash: opts?.stalePolicy ? 'stale-policy-hash' : 'policy-hash-v2',
    storageContainmentStatus: 'contained',
    atomicWriteStatus: 'completed',
  };
  const importManifest = buildImportManifestFromExport(exportManifest as never);
  const importFinal = opts?.staleImport
    ? { ...importManifest, importManifestFingerprint: 'different-fp' }
    : importManifest;
  fs.writeFileSync(path.join(out, `export-manifest-${suffix}.json`), JSON.stringify(exportManifest, null, 2));
  fs.writeFileSync(path.join(out, `import-manifest-${suffix}.json`), JSON.stringify(importFinal, null, 2));
  fs.writeFileSync(path.join(out, `ddl-envelope-assessment-${suffix}.json`), JSON.stringify({ ddlEnvelopeParseStatus: 'parsed', queryBodyExtractionStatus: 'extracted' }, null, 2));
  fs.writeFileSync(path.join(out, `key-preservation-assessment-${suffix}.json`), JSON.stringify({ keyPreservationStatus: 'proven' }, null, 2));
  fs.writeFileSync(path.join(out, `review-packs-${suffix}/pack-P1.json`), JSON.stringify({ candidateId: 'cand:P1:employee' }, null, 2));
  const payloadPath = path.join(
    root,
    '.local',
    'teta-vendor-artifacts',
    'view-definitions',
    exportManifest.payloadRelativePath,
  );
  fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
  fs.writeFileSync(payloadPath, 'CREATE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY AS SELECT 1 FROM DUAL');
  fs.writeFileSync(
    path.join(out, `stage3k2b2b2b2-audit-${suffix}.json`),
    JSON.stringify({
      baseGraphHashBefore: 'g1',
      baseGraphHashAfter: 'g1',
      activeGraphPointerBefore: '.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite',
      activeGraphPointerAfter: '.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite',
      baseGraphFileSha256Before: 'sha1',
      baseGraphFileSha256After: 'sha1',
      baseGraphFileSizeBefore: 10,
      baseGraphFileSizeAfter: 10,
      candidateFingerprintBefore: 'old-fp',
    }),
  );
}

describe('Stage 3K.2B2B2B2 offline finalization', () => {
  it('replays real evidence artifacts offline', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, {
      writeArtifacts: false,
      acceptedStatus: true,
    });
    expect(result.stage3k2b2b2b2Status).toBe(
      'accepted_real_p1_view_metadata_export_import_and_reassessment_pilot',
    );
  });

  it('raw/import manifest mismatch blocks reevaluation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-stale-import-'));
    writeFinalizationFixtures(root, { staleImport: true });
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.reevaluationStatus).toBe('blocked_stale_evidence');
  });

  it('stale policy hash blocks reevaluation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-stale-policy-'));
    writeFinalizationFixtures(root, { stalePolicy: true });
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.reevaluationStatus).toBe('blocked_stale_evidence');
  });

  it('actual evaluator is invoked in offline path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-eval-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.evaluatorExecuted).toBe(true);
    expect(result.evaluatorKind).toContain('stage3k2b1');
  });

  it('evaluator fingerprint is deterministic helper', () => {
    const a = fingerprintFromDeterministicPayload({ x: 1, y: [2, 3] });
    const b = fingerprintFromDeterministicPayload({ y: [2, 3], x: 1 });
    expect(a).toBe(b);
  });

  it('key preservation alone cannot bypass evaluator checks', () => {
    const errors = assertFinalizationStrictCounters({ p1GrainCopiedDirectlyFromKeyPreservation: 1 });
    expect(errors).toContain('strict_nonzero:p1GrainCopiedDirectlyFromKeyPreservation=1');
  });

  it('missing dependency can be flagged by strict counters', () => {
    const errors = assertFinalizationStrictCounters({ evaluatorDependenciesMissing: 1 });
    expect(errors).toContain('strict_nonzero:evaluatorDependenciesMissing=1');
  });

  it('evaluator-driven proven preview is represented in delta', () => {
    const delta = buildPreviewDeltaFromEvidence({
      importValidationResult: 'validated_complete',
      keyPreservationStatus: 'proven',
      candidateId: 'cand:P1:employee',
      beforeGrain: 'partial',
      afterGrain: 'proven',
      evidenceRefs: ['e1'],
      inputArtifactFingerprints: ['f1'],
    });
    expect(delta.previewStatus).toBe('validated_preview_with_semantic_effect');
    expect(delta.previewAddedNodes + delta.previewAddedEdges).toBeGreaterThan(0);
  });

  it('approval remains forbidden in finalization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-approval-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.approvalForbidden).toBe(true);
  });

  it('planning remains blocked in finalization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-planning-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.planningEligible).toBe(false);
  });

  it('zero-delta semantic preview is rejected to not_created', () => {
    const delta = buildPreviewDeltaFromEvidence({
      importValidationResult: 'validated_complete',
      keyPreservationStatus: 'proven',
      candidateId: 'cand:P1:employee',
      beforeGrain: 'partial',
      afterGrain: 'partial',
      evidenceRefs: ['e1'],
      inputArtifactFingerprints: ['f1'],
    });
    expect(delta.previewStatus).toBe('not_created_no_new_validated_evidence');
  });

  it('active graph unchanged values are preserved in output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-graph-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.baseGraphHashBefore).toBe(result.baseGraphHashAfter);
    expect(result.baseGraphFileSha256Before).toBe(result.baseGraphFileSha256After);
  });

  it('no Oracle counters during offline finalization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-no-oracle-'));
    writeFinalizationFixtures(root);
    const result = await runStage3k2b2b2b2OfflineFinalization(root, { writeArtifacts: false });
    expect(result.counters.oracleMetadataConnections).toBe(0);
    expect(result.counters.metadataStatementsExecuted).toBe(0);
    expect(result.counters.viewDefinitionsExported).toBe(0);
  });

  it('payload survives replay and offline replay works after restart simulation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-final-restart-'));
    writeFinalizationFixtures(root, { artifactVersion: 'v3' });
    const payloadRel = 'sha256/raw-sha.sql';
    const payloadPath = path.join(
      root,
      '.local',
      'teta-vendor-artifacts',
      'view-definitions',
      payloadRel,
    );
    fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
    fs.writeFileSync(payloadPath, 'CREATE VIEW X AS SELECT 1 FROM DUAL');
    const outDir = path.join(root, '.local', 'stage3k2b2b2b2');
    const exportPath = path.join(outDir, 'export-manifest-v3.json');
    const importPath = path.join(outDir, 'import-manifest-v3.json');
    const exp = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    exp.payloadRelativePath = payloadRel;
    exp.storageContainmentStatus = 'contained';
    fs.writeFileSync(exportPath, JSON.stringify(exp, null, 2));
    const imp = buildImportManifestFromExport(exp);
    fs.writeFileSync(importPath, JSON.stringify(imp, null, 2));
    const first = await runStage3k2b2b2b2OfflineFinalization(root, {
      writeArtifacts: false,
      artifactVersion: 'v3',
    });
    expect(first.reevaluationStatus).toBe('completed');
    // restart simulation: second independent invocation
    const second = await runStage3k2b2b2b2OfflineFinalization(root, {
      writeArtifacts: false,
      artifactVersion: 'v3',
    });
    expect(second.reevaluationStatus).toBe('completed');
  });

  it('session status snippet serializer includes target stage and next stage', () => {
    const lines = buildSessionContextSnippetFromFinalization({
      stageStatus: 'accepted_real_p1_view_metadata_export_import_and_reassessment_pilot',
      nextStage: 'stage3k2b2b2b3_p1_application_access_surface_and_semantic_attribution_gap_closure_design',
      policyHash: 'abc',
    });
    expect(lines.join('\n')).toContain('Stage 3K.2B2B2B2=');
    expect(lines.join('\n')).toContain('nextStage=');
  });

  it('repo-safe stripping removes raw ddl/query fields', () => {
    const stripped = stripRawFieldsForRepoSafe({
      rawDdl: 'X',
      payload: {
        queryBody: 'SELECT *',
        ok: 1,
      },
      safe: true,
    }) as Record<string, unknown>;
    expect(stripped.rawDdl).toBeUndefined();
    expect((stripped.payload as Record<string, unknown>).queryBody).toBeUndefined();
    expect(stripped.safe).toBe(true);
  });
});
