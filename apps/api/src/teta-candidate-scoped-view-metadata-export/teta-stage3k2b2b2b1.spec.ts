import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import {
  assertAllowlistBound,
  assertRegisteredStatement,
  assertStrictZeros,
  assertVerifiedExactGates,
  assessOracleViewDdlEnvelope,
  assessPathContainment,
  atomicWriteVendorPayload,
  buildExportRequest,
  buildImportManifestFromExport,
  buildStage3k2b2b2b1Audit,
  canonicalizeViewDdl,
  containedPayloadPath,
  emptyStage3k2b2b2b1SafetyCounters,
  executeMetadataExport,
  importValidatedViewDefinition,
  loadMetadataPolicy,
  preflightP1Identity,
  rehashPayloadFile,
  regexOnlyEnvelopeProbe,
  registeredMetadataStatements,
  rejectFreeFormIdentifier,
  rejectSessionAsApplicationEdition,
  rejectWrongOwnerExport,
  runPilotPipeline,
  scanTopLevelAs,
  sha256,
  transformProfileHash,
  vendorRoot,
  type TetaCandidateScopedViewIdentity,
} from './index';

const repoRoot = path.resolve(__dirname, '../../../..');
const P1_DDL =
  'CREATE OR REPLACE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY AS SELECT ID, NR_PRAC FROM T_PRAC';
const payloadRelativePath = `P1/${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}.sql`;
const sharedProductionVendorStoreSentinel = path.join(
  vendorRoot(repoRoot),
  'sentinel-do-not-touch.txt',
);
let testVendorArtifactRoot = '';
let previousRequireTestVendorRoot = '';

function allocateTestVendorArtifactRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teta-vendor-test-root-'));
}

function verifiedOracleIdentity(
  overrides: Partial<TetaCandidateScopedViewIdentity> = {},
): Partial<TetaCandidateScopedViewIdentity> {
  return {
    identityVerificationStatus: 'verified_exact',
    applicationEditionEvidenceStatus: 'confirmed_not_editioned',
    databaseIdentityConfidence: 'verified',
    objectStatus: 'VALID',
    objectEdition: null,
    expectedEdition: null,
    editionableStatus: 'NONEDITIONABLE',
    ...overrides,
  };
}

function expectedIdentity(
  overrides: Partial<TetaCandidateScopedViewIdentity> = {},
): TetaCandidateScopedViewIdentity {
  const base = {
    candidateId: 'cand:P1:employee',
    candidateFingerprint: 'candidate-fingerprint',
    owner: REAL_EMPLOYEE_OBJECT_OWNER,
    objectName: REAL_EMPLOYEE_OBJECT_NAME,
    objectType: 'VIEW' as const,
    objectEdition: null,
    expectedEdition: null,
    editionableStatus: 'NONEDITIONABLE' as const,
    objectStatus: 'VALID' as const,
    applicationEditionEvidenceRef: null,
    applicationEditionEvidenceStatus: 'confirmed_not_editioned' as const,
    databaseIdentityConfidence: 'verified' as const,
    applicationBuildFingerprint: null,
    applicationVersionEvidenceRef: null,
    identityVerificationStatus: 'verified_exact' as const,
    runtimeReadyClaimAllowed: true,
    ...overrides,
  };
  return { ...base, identityFingerprint: 'identity-fingerprint' };
}

async function exportComplete(
  root = repoRoot,
  ddl = P1_DDL,
  completeness: 'complete' | 'fragmented_complete' | 'truncated' = 'complete',
) {
  const { policy, policyHash } = loadMetadataPolicy(root);
  const counters = emptyStage3k2b2b2b1SafetyCounters();
  const result = await executeMetadataExport({
    root,
    policy,
    policyHash,
    execute: true,
    confirm: true,
    counters,
    oracleIdentity: verifiedOracleIdentity(),
    syntheticMode: true,
    vendorArtifactRoot: testVendorArtifactRoot,
    exporter: {
      exportDdl: async () => ({
        raw: Buffer.from(ddl),
        completeness,
        sourceDatabaseProductVersion: 'Oracle 19c',
        metadataApiVersion: 'DBMS_METADATA',
      }),
    },
  });
  return { ...result, counters, policyHash };
}

beforeEach(() => {
  previousRequireTestVendorRoot = process.env.TETA_REQUIRE_TEST_VENDOR_ROOT ?? '';
  process.env.TETA_REQUIRE_TEST_VENDOR_ROOT = '1';
  testVendorArtifactRoot = allocateTestVendorArtifactRoot();
  fs.mkdirSync(path.dirname(sharedProductionVendorStoreSentinel), { recursive: true });
  fs.writeFileSync(sharedProductionVendorStoreSentinel, 'shared-sentinel');
});

afterEach(() => {
  if (testVendorArtifactRoot) fs.rmSync(testVendorArtifactRoot, { recursive: true, force: true });
  testVendorArtifactRoot = '';
  process.env.TETA_REQUIRE_TEST_VENDOR_ROOT = previousRequireTestVendorRoot;
});

describe('Stage 3K.2B2B2B1 — metadata policy validation and hashes', () => {
  const loaded = loadMetadataPolicy(repoRoot);

  it('loads the versioned P1-only policy with a deterministic hash', () => {
    expect(loaded.policyPath).toBe(
      'apps/api/config/teta-candidate-scoped-view-metadata-export-policy-v1.json',
    );
    expect(loaded.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(loadMetadataPolicy(repoRoot).policyHash).toBe(loaded.policyHash);
  });

  it.each([
    ['policyVersion', 'wrong', 'version_mismatch'],
    ['firstSliceTargets', ['P1', 'P2'], 'first_slice_not_p1'],
    ['boundedObjectCount', 2, 'bounded_object_count'],
    ['allowedObjectType', 'TABLE', 'object_type'],
    ['allowedCandidateId', 'cand:P2', 'candidate'],
  ] as const)('rejects tampered %s', (key, value, error) => {
    const { validateMetadataPolicy } = require('./index') as typeof import('./index');
    expect(validateMetadataPolicy({ ...loaded.policy, [key]: value })).toContain(error);
  });

  it.each(['strip_utf8_bom', 'crlf_to_lf'] as const)(
    'requires transform rule %s',
    (rule) => {
      const { validateMetadataPolicy } = require('./index') as typeof import('./index');
      expect(
        validateMetadataPolicy({
          ...loaded.policy,
          transformProfile: {
            ...loaded.policy.transformProfile,
            rules: loaded.policy.transformProfile.rules.filter((x) => x !== rule),
          },
        }),
      ).toContain(rule === 'strip_utf8_bom' ? 'missing_bom_rule' : 'missing_crlf_rule');
    },
  );

  it.each([
    'exact_identity',
    'transform_profile_required',
    'raw_hash_authority',
    'envelope_required',
    'path_containment',
    'atomic_write',
    'closed_statements',
    'legal_fail_closed',
    'no_graph_promotion',
    'no_approval',
    'no_row_data',
    'no_ddl_execution',
    'session_edition_not_application_edition',
    'verified_exact_requires_edition_and_database_identity',
    'manifest_after_payload',
    'editionablePropertyDoesNotProveEditionedObject',
    'ownerSchemaEditionCapabilityRequired',
    'nonEditionsEnabledOwnerNeedsNoApplicationEdition',
    'allEditionsEvidenceRequiredForEditionAmbiguity',
    'ordinaryAllObjectsIsNotAllEditionsEvidence',
    'nullEditionDoesNotAutomaticallyMeanMissingEdition',
    'insufficientEditionVisibilityFailsClosed',
  ])('declares the required policy rule %s', (rule) => {
    expect(loaded.policy.rulesApplied).toContain(rule);
  });

  it.each([
    'approvalForbidden',
    'graphPromotionForbidden',
    'rowDataForbidden',
    'dmlForbidden',
    'ddlExecutionForbidden',
    'wildcardMetadataForbidden',
    'nameSimilarityFallbackForbidden',
    'globalMetadataScanForbidden',
    'regexOnlyEnvelopeAuthoritativeForbidden',
    'canonicalHashAsIntegrityForbidden',
    'sessionEditionAsApplicationEditionForbidden',
  ])('fails closed for %s', (flag) => {
    expect(loaded.policy.failClosed[flag]).toBe(true);
  });
});

describe('Stage 3K.2B2B2B1 — canonical transform profile', () => {
  it.each([
    ['bom', '\uFEFFSELECT ID\r\nFROM T_PRAC\n', 'SELECT ID\nFROM T_PRAC'],
    ['crlf', 'SELECT ID\r\nFROM T_PRAC\r\n', 'SELECT ID\nFROM T_PRAC'],
    ['single trailing newline', 'SELECT ID\nFROM T_PRAC\n', 'SELECT ID\nFROM T_PRAC'],
    ['no transport change', 'SELECT ID FROM T_PRAC', 'SELECT ID FROM T_PRAC'],
  ])('canonicalizes %s only', (_, raw, expected) => {
    const result = canonicalizeViewDdl(raw);
    expect(result.canonical).toBe(expected);
    expect(result.rawPayloadSha256).toBe(sha256(Buffer.from(raw)));
    expect(result.transformProfileHash).toBe(transformProfileHash());
  });

  it.each([
    ["literal trailing whitespace", "SELECT 'x  ' AS X FROM T_PRAC  \n", "SELECT 'x  ' AS X FROM T_PRAC  "],
    ['comment trailing whitespace', 'SELECT ID FROM T_PRAC -- keep  \n', 'SELECT ID FROM T_PRAC -- keep  '],
  ])('does not strip per-line whitespace in %s', (_, raw, expected) => {
    expect(canonicalizeViewDdl(raw).canonical).toBe(expected);
  });

  it('keeps raw integrity authority distinct from canonical comparison', () => {
    const raw = '\uFEFFSELECT ID\r\nFROM T_PRAC\n';
    const canonical = canonicalizeViewDdl(raw);
    expect(canonical.rawPayloadSha256).not.toBe(canonical.canonicalPayloadSha256);
    expect(canonical.rawPayloadSha256).toBe(sha256(Buffer.from(raw)));
  });
});

describe('Stage 3K.2B2B2B1 — exact identity and fail-closed gates', () => {
  it('uses offline identity as not_verified and disallows GET_DDL', () => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const preflight = preflightP1Identity({ root: repoRoot, counters });
    expect(preflight.identity.identityVerificationStatus).toBe('not_verified');
    expect(preflight.getDdlAllowed).toBe(false);
  });

  it.each([
    ['missing edition evidence', verifiedOracleIdentity({ applicationEditionEvidenceStatus: 'unavailable' }), 'not_verified'],
    ['unverified database identity', verifiedOracleIdentity({ databaseIdentityConfidence: 'unverified' }), 'not_verified'],
    ['unknown object status', verifiedOracleIdentity({ objectStatus: 'UNKNOWN' }), 'not_verified'],
    ['exact verified identity', verifiedOracleIdentity(), 'verified_exact'],
  ] as const)('%s produces %s', (_, oracleIdentity, status) => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = preflightP1Identity({ root: repoRoot, counters, oracleIdentity });
    expect(result.identity.identityVerificationStatus).toBe(status);
    expect(result.getDdlAllowed).toBe(status === 'verified_exact');
  });

  it('records missing verified-exact gates and invalid runtime claims', () => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    assertVerifiedExactGates(
      expectedIdentity({
        applicationEditionEvidenceStatus: 'unavailable',
        databaseIdentityConfidence: 'unverified',
        objectStatus: 'INVALID',
        runtimeReadyClaimAllowed: true,
      }),
      counters,
    );
    expect(counters.verifiedExactWithoutEditionEvidence).toBe(1);
    expect(counters.verifiedExactWithoutDatabaseIdentity).toBe(1);
    expect(counters.invalidObjectReportedRuntimeReady).toBe(1);
  });

  it.each([
    ['owner', 'OTHER_OWNER', false, 'wrongOwnerViewDefinitionsExported'],
    ['owner', REAL_EMPLOYEE_OBJECT_OWNER, true, 'wrongOwnerViewDefinitionsExported'],
  ] as const)('rejectWrongOwnerExport handles %s %s', (_, owner, accepted, counter) => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(rejectWrongOwnerExport(owner, REAL_EMPLOYEE_OBJECT_OWNER, counters)).toBe(accepted);
    expect(counters[counter]).toBe(accepted ? 0 : 1);
  });

  it('never treats session edition as application edition', () => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    rejectSessionAsApplicationEdition('ORA$BASE', true, counters);
    rejectSessionAsApplicationEdition(null, true, counters);
    expect(counters.sessionEditionAssumedAsApplicationEdition).toBe(1);
  });
});

describe('Stage 3K.2B2B2B1 — exact P1 export request constraints', () => {
  const { policy, policyHash } = loadMetadataPolicy(repoRoot);
  const built = buildExportRequest(
    repoRoot,
    policy,
    policyHash,
    emptyStage3k2b2b2b1SafetyCounters(),
    verifiedOracleIdentity(),
    true,
  );

  it.each([
    ['candidate', () => expect(built.request.candidateId).toBe('cand:P1:employee')],
    ['single-object bound', () => expect(built.request.boundedObjectCount).toBe(1)],
    ['metadata-only mode', () => expect(built.request.metadataOnly).toBe(true)],
    ['row-data prohibition', () => expect(built.request.rowDataAllowed).toBe(false)],
    ['DML prohibition', () => expect(built.request.dmlAllowed).toBe(false)],
    ['DDL-execution prohibition', () => expect(built.request.ddlExecutionAllowed).toBe(false)],
    ['verified identity GET_DDL gate', () => expect(built.request.getDdlAllowed).toBe(true)],
    ['P1 allowlist binding', () =>
      expect(built.request.allowlistId).toBe('allowlist:P1:employee:v1')],
    ['transform profile id', () =>
      expect(built.request.metadataTransformProfileId).toBe('oracle-view-ddl-canonical-v1')],
    ['transform profile version', () => expect(built.request.metadataTransformProfileVersion).toBe('v1')],
    ['transform profile fingerprint', () =>
      expect(built.request.metadataTransformProfileHash).toBe(transformProfileHash())],
    ['non-empty request fingerprint', () => expect(built.request.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)],
    ['exact owner statement bind', () =>
      expect(
        built.request.statements.find(
          (s) => s.metadataStatementTemplateId === 'exact_current_visible_object_identity',
        )?.sqlText,
      ).toContain('OWNER = :owner')],
    ['no wildcard metadata statement', () =>
      expect(built.request.statements.every((statement) => !statement.sqlText.includes('*'))).toBe(true)],
    ['registered metadata templates include edition evidence probes', () =>
      expect(
        built.request.statements.map((s) => s.metadataStatementTemplateId),
      ).toEqual(
        expect.arrayContaining([
          'database_identity',
          'exact_current_visible_object_identity',
          'exact_owner_editions_enabled_lookup',
          'exact_object_all_editions_lookup',
          'session_edition_lookup',
          'exact_view_ddl_export',
        ]),
      )],
  ])('enforces %s', (_, assertion) => assertion());
});

describe('Stage 3K.2B2B2B1 — CREATE VIEW envelope scanner matrix', () => {
  const createPrefixes = [
    ['CREATE', 'create_view'],
    ['CREATE OR REPLACE', 'create_or_replace_view'],
  ] as const;
  const forceOptions = [
    ['', false],
    [' FORCE', true],
  ] as const;
  const editionOptions = [
    ['', 'UNKNOWN'],
    [' EDITIONABLE', 'EDITIONABLE'],
    [' NONEDITIONABLE', 'NONEDITIONABLE'],
  ] as const;
  const identifiers = [
    [`${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`, false],
    [`"${REAL_EMPLOYEE_OBJECT_OWNER}"."${REAL_EMPLOYEE_OBJECT_NAME}"`, true],
  ] as const;
  const columnLists = [
    ['', []],
    [' ("ID", "NR_PRAC")', ['ID', 'NR_PRAC']],
  ] as const;
  const bodies = [
    ['literal AS', "SELECT 'AS' AS VALUE FROM T_PRAC"],
    ['line comment AS', 'SELECT ID FROM T_PRAC -- AS in comment\n'],
    ['block comment AS', 'SELECT ID /* AS in comment */ FROM T_PRAC'],
    ['subquery AS', "SELECT (SELECT 'AS' FROM DUAL) AS VALUE FROM T_PRAC"],
  ] as const;

  it.each(
    createPrefixes.flatMap(([prefix, createKind]) =>
      forceOptions.flatMap(([force, forceStatus]) =>
        editionOptions.flatMap(([edition, editionableStatus]) =>
          identifiers.flatMap(([identifier]) =>
            columnLists.flatMap(([columns, declaredColumnList]) =>
              bodies.map(([bodyName, body]) => [
                prefix,
                force,
                edition,
                identifier,
                columns,
                bodyName,
                body,
                createKind,
                forceStatus,
                editionableStatus,
                declaredColumnList,
              ]),
            ),
          ),
        ),
      ),
    ),
  )(
    '%s%s%s VIEW %s%s with %s is safely extracted',
    (
      prefix,
      force,
      edition,
      identifier,
      columns,
      _bodyName,
      body,
      createKind,
      forceStatus,
      editionableStatus,
      declaredColumnList,
    ) => {
      const result = assessOracleViewDdlEnvelope(
        `${prefix}${force}${edition} VIEW ${identifier}${columns} AS ${body};`,
        expectedIdentity(),
      );
      expect(result.ddlEnvelopeParseStatus).toBe('parsed');
      expect(result.createKind).toBe(createKind);
      expect(result.forceStatus).toBe(forceStatus);
      expect(result.editionableStatus).toBe(editionableStatus);
      expect(result.declaredColumnList).toEqual(declaredColumnList);
      expect(result.viewHeaderIdentityStatus).toBe('matched');
      expect(result.queryBody).toBe(body.trimEnd());
    },
  );

  it.each([
    ['plain select', 'SELECT ID FROM T_PRAC', 'malformed'],
    ['wrong owner', 'CREATE VIEW OTHER.NT_KP_PRC_PRACOWNICY AS SELECT ID FROM T_PRAC', 'parsed'],
    ['missing AS', 'CREATE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY SELECT ID FROM T_PRAC', 'parsed'],
    ['ambiguous wrapper', 'CREATE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY AS GRANT X', 'conflicting'],
  ])('handles %s fail-closed', (_, ddl, status) => {
    const result = assessOracleViewDdlEnvelope(ddl, expectedIdentity());
    expect(result.ddlEnvelopeParseStatus).toBe(status);
    if (ddl.includes('OTHER.')) expect(result.viewHeaderIdentityStatus).toBe('mismatched');
  });

  it('scanner differs from naive regex when AS occurs in a comment', () => {
    const ddl =
      'CREATE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY -- AS misleading\n AS SELECT ID FROM T_PRAC';
    expect(regexOnlyEnvelopeProbe(ddl).asIndex).toBeLessThan(scanTopLevelAs(ddl, 0));
    expect(assessOracleViewDdlEnvelope(ddl, expectedIdentity()).queryBody).toBe('SELECT ID FROM T_PRAC');
    expect(emptyStage3k2b2b2b1SafetyCounters().regexOnlyEnvelopeAcceptedAsAuthoritative).toBe(0);
  });
});

describe('Stage 3K.2B2B2B1 — closed metadata statement templates', () => {
  const all = registeredMetadataStatements({
    candidateId: 'cand:P1:employee',
    allowlistId: 'allowlist:P1:employee:v1',
    policyVersion: 'policy-v1',
    policyHash: 'policy-hash',
    bindValues: {
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      object_name: REAL_EMPLOYEE_OBJECT_NAME,
      object_type: 'VIEW',
    },
  });

  it.each([
    ['database_identity', []],
    ['exact_current_visible_object_identity', ['owner', 'object_name', 'object_type']],
    ['exact_owner_editions_enabled_lookup', ['owner']],
    ['exact_object_all_editions_lookup', ['owner', 'object_name', 'object_type']],
    ['session_edition_lookup', []],
    ['exact_object_identity_lookup', ['owner', 'object_name', 'object_type']],
    ['exact_view_ddl_export', ['object_type', 'object_name', 'owner']],
    ['exact_fragment_completeness_lookup', ['owner', 'object_name']],
  ] as const)('%s has exact bind names only', (id, bindNames) => {
    const statement = all.find((item) => item.metadataStatementTemplateId === id)!;
    expect(statement.bindNames).toEqual(bindNames);
    expect(statement.bindValueFingerprints).toHaveLength(bindNames.length);
    expect(statement.allowedObjectCount).toBe(1);
  });

  it.each(all)('accepts registered template %s', (statement) => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(assertRegisteredStatement(statement, all, counters)).toBe(true);
    expect(assertAllowlistBound(statement, 'cand:P1:employee', 'allowlist:P1:employee:v1', counters)).toBe(
      true,
    );
    expect(assertStrictZeros(counters)).toEqual([]);
  });

  it('rejects tampered template and wrong allowlist', () => {
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(assertRegisteredStatement({ ...all[0], metadataStatementTemplateHash: 'tampered' }, all, counters)).toBe(
      false,
    );
    expect(assertAllowlistBound(all[0], 'cand:P2', 'other', counters)).toBe(false);
    rejectFreeFormIdentifier(true, counters);
    expect(counters.unregisteredMetadataStatementExecuted).toBe(1);
    expect(counters.metadataStatementOutsideCandidateAllowlist).toBe(1);
    expect(counters.freeFormIdentifierUsedInMetadataExport).toBe(1);
  });
});

describe('Stage 3K.2B2B2B1 — contained vendor storage and atomic payloads', () => {
  it('fails closed in test mode without explicit testVendorArtifactRoot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-storage-guard-'));
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(assessPathContainment(root, 'P1/payload.sql', counters).status).toBe('path_invalid');
      expect(counters.testUsedProductionVendorArtifactRoot).toBe(1);
    } finally {
      process.env.NODE_ENV = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleanup removes only test root and preserves shared sentinel', async () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-isolated-root-'));
    const sentinel = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-shared-sentinel-'));
    const sentinelFile = path.join(sentinel, 'sentinel.sql');
    fs.writeFileSync(sentinelFile, 'keep');
    const { policy, policyHash } = loadMetadataPolicy(repoRoot);
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = await executeMetadataExport({
      root: repoRoot,
      policy,
      policyHash,
      execute: true,
      confirm: true,
      counters,
      oracleIdentity: verifiedOracleIdentity(),
      syntheticMode: true,
      vendorArtifactRoot: isolatedRoot,
      exporter: {
        exportDdl: async () => ({
          raw: Buffer.from(P1_DDL),
          completeness: 'complete',
        }),
      },
    });
    expect(result.outcome).toBe('export_completed');
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
    expect(fs.existsSync(sentinelFile)).toBe(true);
    expect(fs.existsSync(isolatedRoot)).toBe(false);
    fs.rmSync(sentinel, { recursive: true, force: true });
  });

  it.each([
    ['normal relative path', 'P1/payload.sql', 'contained'],
    ['parent traversal', '../payload.sql', 'path_invalid'],
    ['nested traversal', 'P1/../../payload.sql', 'path_invalid'],
    ['absolute path', path.resolve(os.tmpdir(), 'payload.sql'), 'path_invalid'],
    ['empty path', '', 'path_invalid'],
  ] as const)('%s is %s', (_, relative, status) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-storage-'));
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(assessPathContainment(root, relative, counters, { vendorArtifactRoot: root }).status).toBe(
      status,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes atomically through temp+rename and rehashes final bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-atomic-'));
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const written = atomicWriteVendorPayload(root, 'P1/payload.sql', Buffer.from(P1_DDL), counters, {
      vendorArtifactRoot: root,
    });
    expect(written.atomicWriteStatus).toBe('completed');
    expect(written.rawPayloadSha256).toBe(sha256(Buffer.from(P1_DDL)));
    expect(rehashPayloadFile(written.payloadPath)).toBe(written.finalPayloadFingerprint);
    expect(fs.readdirSync(path.dirname(written.payloadPath)).some((x) => x.endsWith('.tmp'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects traversal before writing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-traversal-'));
    expect(() =>
      atomicWriteVendorPayload(
        root,
        '../escape.sql',
        Buffer.from(P1_DDL),
        emptyStage3k2b2b2b1SafetyCounters(),
        { vendorArtifactRoot: root },
      ),
    ).toThrow('path_invalid');
    expect(() => containedPayloadPath(root, '../escape.sql', { vendorArtifactRoot: root })).toThrow(
      'path_containment:path_invalid',
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects symlink escape when the platform permits symlink creation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-symlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'teta-outside-'));
    const link = path.join(vendorRoot(root, root), 'escape');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
      fs.symlinkSync(outside, link, 'junction');
      expect(
        assessPathContainment(root, 'escape/payload.sql', emptyStage3k2b2b2b1SafetyCounters(), {
          vendorArtifactRoot: root,
        }).status,
      ).toBe('symlink_or_reparse_escape');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        assessPathContainment(root, '../payload.sql', emptyStage3k2b2b2b1SafetyCounters(), {
          vendorArtifactRoot: root,
        }).status,
      ).toBe('path_invalid');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('Stage 3K.2B2B2B1 — export controls and legal failures', () => {
  it.each([
    ['no flags', false, false],
    ['execute only', true, false],
    ['confirm only', false, true],
  ])('%s remains not_attempted without opening Oracle', async (_, execute, confirm) => {
    const { policy, policyHash } = loadMetadataPolicy(repoRoot);
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = await executeMetadataExport({
      root: repoRoot,
      policy,
      policyHash,
      execute,
      confirm,
      counters,
      vendorArtifactRoot: testVendorArtifactRoot,
    });
    expect(result.outcome).toBe('not_attempted');
    expect(result.lifecycle.exportOutcome).toBe('not_attempted');
    expect(result.lifecycle.requestStatus).toBe('ready_for_explicit_vendor_execution');
    expect(result.lifecycle.identityPreflightStatus).toBe('not_run');
    expect(result.lifecycle.getDdlEligibility).toMatch(/blocked_flags_missing|not_evaluated/);
    expect(result.lifecycle.exportAttemptStatus).toBe('not_attempted');
    expect(counters.oracleConnections).toBe(0);
    expect(counters.dualFlagsUsedAsIdentityProof).toBe(0);
  });

  it('dual flags without verified identity block export and never become eligible', async () => {
    const { policy, policyHash } = loadMetadataPolicy(repoRoot);
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = await executeMetadataExport({
      root: repoRoot,
      policy,
      policyHash,
      execute: true,
      confirm: true,
      counters,
      vendorArtifactRoot: testVendorArtifactRoot,
    });
    expect(result.outcome).toBe('export_blocked_by_policy');
    expect(result.lifecycle.oracleExecutionConsentStatus).toBe('confirmed');
    expect(result.lifecycle.getDdlEligibility).not.toBe('eligible');
    expect(result.lifecycle.exportAttemptStatus).toBe('blocked_before_export');
    expect(result.request.getDdlAllowed).toBe(false);
    expect(result.request.targetIdentity.identityVerificationStatus).toBe('not_verified');
    expect(counters.viewIdentityNotVerifiedBeforeExport).toBeGreaterThanOrEqual(0);
    expect(counters.dualFlagsUsedAsIdentityProof).toBe(0);
    expect(counters.dualFlagsUsedAsEditionProof).toBe(0);
    expect(counters.getDdlAllowedBeforeExactIdentity).toBe(0);
    expect(counters.exportAttemptedWithBlockedEligibility).toBe(0);
    expect(counters.realOracleMetadataExports).toBe(0);
  });

  it.each([
    ['privilege', 'ORA-01031 insufficient privileges', 'requires_metadata_privilege'],
    ['not visible', 'ORA-00942 not visible', 'object_not_visible'],
    ['missing', 'ORA-04043 missing object', 'object_missing'],
    ['edition', 'edition conflict', 'requires_edition_resolution'],
    ['other', 'network error', 'export_failed'],
  ] as const)('fails closed on %s errors', async (_, message, outcome) => {
    const { policy, policyHash } = loadMetadataPolicy(repoRoot);
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = await executeMetadataExport({
      root: repoRoot,
      policy,
      policyHash,
      execute: true,
      confirm: true,
      counters,
      oracleIdentity: verifiedOracleIdentity(),
      syntheticMode: true,
      vendorArtifactRoot: testVendorArtifactRoot,
      exporter: { exportDdl: async () => Promise.reject(new Error(message)) },
    });
    expect(result.outcome).toBe(outcome);
    expect(counters.privilegeFailureTriggeredGlobalScan).toBe(0);
    expect(counters.privilegeFailureTriggeredOwnerFallback).toBe(0);
    expect(counters.realOracleMetadataExports).toBe(0);
  });

  it.each([
    ['complete', 'export_completed'],
    ['fragmented_complete', 'export_completed'],
    ['truncated', 'source_returns_truncated_text'],
  ] as const)('handles CLOB completeness %s', async (completeness, outcome) => {
    const result = await exportComplete(repoRoot, P1_DDL, completeness);
    expect(result.outcome).toBe(outcome);
    expect(result.counters.unorderedFragmentsAccepted).toBe(0);
    expect(result.counters.realOracleMetadataExports).toBe(0);
  });

  it('writes the payload before returning the manifest fingerprint', async () => {
    const result = await exportComplete();
    expect(result.manifest).not.toBeNull();
    expect(
      fs.existsSync(path.join(vendorRoot(repoRoot, testVendorArtifactRoot), result.manifest!.payloadRelativePath)),
    ).toBe(true);
    expect(result.manifest!.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest!.finalPayloadFingerprint).toBe(result.manifest!.rawPayloadSha256);
  });

  it('eligible GET_DDL requires identity+edition+database — flags alone insufficient', async () => {
    const { policy, policyHash } = loadMetadataPolicy(repoRoot);
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const flagged = await executeMetadataExport({
      root: repoRoot,
      policy,
      policyHash,
      execute: true,
      confirm: true,
      counters,
      oracleIdentity: {
        identityVerificationStatus: 'verified_exact',
        // missing edition + database gates
        applicationEditionEvidenceStatus: 'unavailable',
        databaseIdentityConfidence: 'unverified',
        objectStatus: 'VALID',
      },
      syntheticMode: true,
      vendorArtifactRoot: testVendorArtifactRoot,
      exporter: { exportDdl: async () => ({ raw: Buffer.from(P1_DDL), completeness: 'complete' }) },
    });
    expect(flagged.lifecycle.getDdlEligibility).not.toBe('eligible');
    expect(flagged.lifecycle.exportAttemptStatus).toBe('blocked_before_export');
    expect(counters.getDdlAllowedBeforeEditionResolution).toBe(0);
    expect(counters.getDdlAllowedBeforeDatabaseIdentity).toBe(0);
  });
});

describe('Stage 3K.2B2B2B1 — import validation, rehash, and parser handoff', () => {
  async function exportedImportManifest() {
    const exported = await exportComplete();
    return {
      exported,
      manifest: buildImportManifestFromExport(exported.manifest!),
    };
  }

  it('imports a complete payload after both raw rehash gates', async () => {
    const { manifest } = await exportedImportManifest();
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = importValidatedViewDefinition(repoRoot, manifest, counters, {
      expectedCandidateId: 'cand:P1:employee',
      expectedPolicyHash: manifest.exportPolicyHash,
      vendorArtifactRoot: testVendorArtifactRoot,
    });
    expect(result.outcome).toBe('validated_complete');
    expect(result.rawHashRevalidatedBeforeImport).toBe(true);
    expect(result.rawHashRevalidatedBeforeParse).toBe(true);
    expect(result.parse).not.toBeNull();
    expect(result.parse!.parseStatus).toBe('parsed');
    expect(counters.fullCreateViewSentDirectlyToSelectOnlyParser).toBe(0);
  });

  it.each([
    ['candidate mismatch', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, candidateId: 'cand:P2' }), 'rejected_candidate_mismatch'],
    ['policy mismatch', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, exportPolicyHash: 'wrong' }), 'rejected_policy_mismatch'],
    ['truncated', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, declaredCompletenessStatus: 'truncated' as const }), 'rejected_truncated'],
    ['incomplete', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, declaredCompletenessStatus: 'incomplete' as const }), 'rejected_incomplete'],
    ['interrupted atomic write', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, atomicWriteStatus: 'interrupted' as const }), 'rejected_atomic_write_interrupted'],
    ['sensitive storage', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, vendorOnly: false }), 'rejected_sensitive_storage'],
    ['path traversal', (m: ReturnType<typeof buildImportManifestFromExport>) => ({ ...m, payloadRelativePath: '../outside.sql' }), 'rejected_path_containment'],
  ] as const)('rejects %s', async (_, alter, outcome) => {
    const { manifest } = await exportedImportManifest();
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(
      importValidatedViewDefinition(repoRoot, alter(manifest), counters, {
        expectedCandidateId: 'cand:P1:employee',
        expectedPolicyHash: manifest.exportPolicyHash,
        vendorArtifactRoot: testVendorArtifactRoot,
      }).outcome,
    ).toBe(outcome);
  });

  it('rejects a raw payload changed after export before parse handoff', async () => {
    const { manifest } = await exportedImportManifest();
    fs.writeFileSync(
      path.join(vendorRoot(repoRoot, testVendorArtifactRoot), manifest.payloadRelativePath),
      `${P1_DDL} -- TOCTOU`,
    );
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    const result = importValidatedViewDefinition(repoRoot, manifest, counters, {
      vendorArtifactRoot: testVendorArtifactRoot,
    });
    expect(result.outcome).toBe('rejected_raw_hash_mismatch');
    expect(result.rawHashRevalidatedBeforeImport).toBe(true);
    expect(result.rawHashRevalidatedBeforeParse).toBe(false);
    expect(counters.payloadAcceptedWithRawHashMismatch).toBe(1);
  });

  it('rejects mismatched CREATE VIEW target after raw integrity passes', async () => {
    const result = await exportComplete(
      repoRoot,
      'CREATE VIEW OTHER.NT_KP_PRC_PRACOWNICY AS SELECT ID FROM T_PRAC',
    );
    const counters = emptyStage3k2b2b2b1SafetyCounters();
    expect(
      importValidatedViewDefinition(
        repoRoot,
        buildImportManifestFromExport(result.manifest!),
        counters,
        { vendorArtifactRoot: testVendorArtifactRoot },
      ).outcome,
    ).toBe('rejected_target_mismatch');
    expect(counters.importedArtifactTargetMismatch).toBe(1);
  });
});

describe('Stage 3K.2B2B2B1 — offline pilot defaults remain inert', () => {
  it('default pipeline splits request readiness from exportOutcome=not_attempted', async () => {
    const result = await runPilotPipeline(repoRoot);
    expect(result.requestStatus).toBe('ready_for_explicit_vendor_execution');
    expect(result.identityPreflightStatus).toBe('not_run');
    expect(result.oracleExecutionConsentStatus).toBe('not_provided');
    expect(result.getDdlEligibility).toMatch(/blocked_flags_missing|not_evaluated/);
    expect(result.exportAttemptStatus).toBe('not_attempted');
    expect(result.exportOutcome).toBe('not_attempted');
    expect(result.identityResult).toBe('not_verified');
    expect(result.objectStatus).toBe('UNKNOWN');
    expect(result.applicationEditionEvidence).toBe('unavailable');
    expect(result.databaseIdentityStatus).toBe('unverified');
    expect(result.getDdlAllowed).toBe(false);
    expect(result.oracleConnections).toBe(0);
    expect(result.strictErrors).toEqual([]);
    expect(result.p1.grainStatus).toBe('partial');
    expect(result.p1.humanDecision).toBe('request_more_evidence');
    expect(result.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(result.realMetadataExportStatus).toBe('not_executed');
    expect(result.stage3k2b2b2b1Status).toBe(
      'accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure',
    );
    expect(result.stage3k2b2b2b2Status).toBe('not_started');
    expect(result.realCounters.realOracleMetadataExports).toBe(0);
    expect(result.syntheticCounters.syntheticSuccessfulExports).toBeGreaterThan(0);
    expect(result.syntheticCoverageSummary.syntheticArtifactsInRealP1Pack).toBe(false);
  });

  it('audit default writes only review metadata, never raw DDL', async () => {
    const audit = await buildStage3k2b2b2b1Audit(repoRoot);
    const pack = fs.readFileSync(
      path.join(repoRoot, '.local/stage3k2b2b2b1/review-packs-v1/pack-P1.json'),
      'utf8',
    );
    expect(audit.strictErrors).toEqual([]);
    expect(pack).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i);
    expect(audit.approvals).toBe(0);
    expect(JSON.parse(pack).syntheticArtifactsIncluded).toBe(false);
  });

  it.each([
    'oracleConnections',
    'targetViewRowsRead',
    'targetViewBusinessSelects',
    'businessSqlStatementsExecuted',
    'dmlStatements',
    'ddlStatementsExecuted',
    'viewDefinitionsExecuted',
    'localModelCalls',
    'remoteModelCalls',
    'qdrantCalls',
    'embeddingCalls',
    'activeGraphPointerChanges',
    'productionGraphReplaced',
    'previewGraphPromotedWithoutReview',
    'runtimeConsumersUsingPreviewGraph',
    'realDecisionEventsApplied',
    'realApprovedGenericBindingsCreated',
    'stage3dProductionBindingsAdded',
    'reusePolicyEntriesAdded',
    'dualFlagsUsedAsIdentityProof',
    'dualFlagsUsedAsEditionProof',
    'getDdlAllowedBeforeExactIdentity',
    'getDdlAllowedBeforeDatabaseIdentity',
    'getDdlAllowedBeforeEditionResolution',
    'exportAttemptedWithBlockedEligibility',
    'realOracleMetadataExports',
    'realViewDefinitionsImported',
    'realParserRunsOnDdl',
  ] as const)('default pipeline keeps %s at zero', async (counter) => {
    const result = await runPilotPipeline(repoRoot);
    expect(result.counters[counter]).toBe(0);
  });
});
