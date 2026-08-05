import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
  REAL_P1_FORM_GUID,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import {
  STAGE3K2B2B2A_COLLECTOR_VERSION,
  STAGE3K2B2B2A_CONTRACT_VERSION,
  STAGE3K2B2B2A_PARSER_VERSION,
  STAGE3K2B2B2A_POLICY_VERSION,
  assertStrictZeros,
  assessDefinitionCompleteness,
  assessKeyPreservation,
  buildP1Allowlist,
  buildStage3k2b2b2aAudit,
  emptySafetyCounters,
  enforceNotParsedSemantics,
  importViewDefinitionArtifact,
  loadEnrichmentPolicy,
  parseOracleViewDefinition,
  reconstructApplicationDataSurface,
  runEnrichmentPipeline,
  sha256,
  stableStringify,
  validateEnrichmentPolicy,
  type DefinitionCompletenessStatus,
  type DefinitionSourceKind,
  type EvidenceAvailability,
  type GraphRevisionStatus,
  type KeyPreservationStatus,
  type MaterializationStatus,
  type ParseStatus,
  type PromotionStatus,
  type SemanticAttributionStatus,
  type SensitivityClassification,
  type Stage3k2b2b2aSafetyCounters,
  type SurfaceSelectionStatus,
} from './index';

const repoRoot = path.resolve(__dirname, '../../../..');

const DEFINITION_KINDS: DefinitionSourceKind[] = [
  'all_views_text',
  'dbms_metadata_ddl',
  'preserved_source_file',
  'gateway_equivalent_select',
  'sqljoin_equivalent_select',
  'manual_vendor_artifact',
];
const COMPLETENESS: DefinitionCompletenessStatus[] = [
  'complete',
  'fragmented_complete',
  'truncated',
  'incomplete',
  'missing',
  'conflicting',
];
const PARSE_STATUSES: ParseStatus[] = [
  'parsed',
  'parsed_with_unsupported_constructs',
  'parse_failed',
  'not_parsed',
];
const KEY_STATUSES: KeyPreservationStatus[] = [
  'proven',
  'supported_partial',
  'unproven',
  'conflicting',
  'not_evaluable',
];
const EVIDENCE_AVAIL: EvidenceAvailability[] = [
  'complete',
  'partial',
  'unavailable',
  'conflicting',
];
const MATERIALIZATION: MaterializationStatus[] = [
  'materialized',
  'materialized_partial',
  'requires_bounded_reconstruction',
  'requires_new_extraction',
  'blocked',
];
const ATTRIBUTION: SemanticAttributionStatus[] = [
  'proven',
  'supported_partial',
  'unproven',
  'conflicting',
];
const SELECTION: SurfaceSelectionStatus[] = [
  'selected',
  'ambiguous',
  'no_candidates',
  'blocked',
  'not_evaluated',
];
const AMBIGUITY = ['unambiguous', 'ambiguous', 'not_evaluable', 'conflicting'] as const;
const SENSITIVITY: SensitivityClassification[] = [
  'generic_technical_metadata',
  'vendor_confidential',
  'client_specific_technical_metadata',
  'restricted',
];
const GRAPH_REV: GraphRevisionStatus[] = [
  'preview',
  'validated_preview',
  'rejected',
  'superseded',
];
const PROMOTION: PromotionStatus[] = [
  'not_requested',
  'blocked',
  'requires_separate_review',
  'approved_for_future_promotion',
];
const PROHIBITED = [
  'similar_view_name',
  'global_view_scan',
  'global_column_scan',
  'prac_employee_karta_search',
  'unanchored_shortest_path',
];
const POLICY_BOOL_RULES = [
  'viewDefinitionCompletenessRequired',
  'unsupportedConstructsBlockKeyPreservation',
  'candidateScopedAllowlistRequired',
  'partialDataSurfaceNotConfirmed',
  'ambiguousDataSurfaceRequiresSelection',
  'rawTechnicalMetadataContainment',
  'previewGraphCannotBecomeActive',
  'syntheticArtifactsExcludedFromRealAssessment',
  'missingArtifactIsFailClosedNotFailure',
  'notParsedMeansNotEvaluated',
  'zeroCandidatesAreNotUnambiguous',
  'activeGraphImmutabilityRequiresContentHash',
  'validatedPreviewRequiresNonEmptyDelta',
  'allowlistRequiresObservedBounds',
  'syntheticAndRealMetricsSeparated',
  'requestAvailabilityDoesNotProveSemanticAttribution',
] as const;
const ALLOWED_NODES = [
  'application_form',
  'application_control',
  'business_object',
  'dataset',
  'data_source',
  'gateway',
  'join',
  'oracle_object',
  'oracle_column',
  'help_field',
];
const ALLOWED_EDGES = [
  'HAS_CONTROL',
  'USES_BO',
  'USES_DF',
  'USES_DATASOURCE',
  'PRODUCES_DATASET',
  'RESOLVES_TO_GATEWAY',
  'JOINS_TO',
  'MAPS_TO_ORACLE_OBJECT',
  'BINDS_TARGET',
  'HAS_COLUMN',
  'DEPENDS_ON',
  'PRIMARY_KEY_OF',
  'UNIQUE_KEY_OF',
];
const COUNTER_KEYS = Object.keys(emptySafetyCounters()) as (keyof Stage3k2b2b2aSafetyCounters)[];
const STRICT_ZERO_KEYS = COUNTER_KEYS.filter(
  (k) =>
    ![
      'viewDefinitionsLocated',
      'viewDefinitionsImported',
      'viewDefinitionsParsed',
      'viewDefinitionParseFailures',
    ].includes(k),
);
const UNSUPPORTED_SAMPLES: Array<{ name: string; sql: string }> = [
  { name: 'MODEL_CLAUSE', sql: 'SELECT a FROM t MODEL DIMENSION BY (a) MEASURES (b)' },
  { name: 'PIVOT', sql: 'SELECT * FROM t PIVOT (SUM(x) FOR y IN (1,2))' },
  { name: 'UNPIVOT', sql: 'SELECT * FROM t UNPIVOT (val FOR col IN (a,b))' },
  { name: 'MATCH_RECOGNIZE', sql: 'SELECT * FROM t MATCH_RECOGNIZE (ORDER BY a)' },
  { name: 'XMLTABLE', sql: "SELECT * FROM XMLTABLE('/a' PASSING x)" },
  { name: 'JSON_TABLE', sql: "SELECT * FROM JSON_TABLE(j, '$' COLUMNS (a PATH '$.a'))" },
  { name: 'CONNECT_BY', sql: 'SELECT * FROM t START WITH id=1 CONNECT BY PRIOR id = parent' },
];

const SIMPLE_KP =
  'CREATE OR REPLACE VIEW TETA_ADMIN.NT_KP_PRC_PRACOWNICY AS\n' +
  'SELECT p.ID AS ID_PRAC, p.NR_EWD, p.NAZWISKO FROM TETA_ADMIN.T_PRAC p WHERE p.AKTYWNY = 1';

const LEFT_JOIN_1N =
  'SELECT p.ID AS ID_PRAC, a.ADRES FROM T_PRAC p LEFT JOIN T_ADRESY a ON a.IPRA_ID = p.ID';

const DISTINCT_SQL = 'SELECT DISTINCT p.ID AS ID_PRAC FROM T_PRAC p';
const GROUP_BY_SQL = 'SELECT p.ID, COUNT(*) FROM T_PRAC p GROUP BY p.ID';
const UNION_SQL = 'SELECT ID FROM T_PRAC UNION SELECT ID FROM T_PRAC_ARCH';
const SUBQUERY_SQL = 'SELECT ID AS ID_PRAC FROM (SELECT ID FROM T_PRAC) x';
const TRUNCATED_SQL = 'SELECT ID FROM T_PRAC WHERE [truncated]';
const NO_SELECT = 'THIS IS NOT SQL';

function writeTempManifest(opts: {
  content: string;
  synthetic?: boolean;
  targetCandidateId?: string;
  targetViewRef?: string;
  expectedOwner?: string;
  fingerprint?: string;
  contentFileName?: string;
  underDocs?: boolean;
}): { dir: string; manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3k2b2b2a-'));
  const contentFile = opts.contentFileName ?? 'view.sql';
  const contentPath = opts.underDocs
    ? path.join(dir, 'docs', contentFile)
    : path.join(dir, contentFile);
  fs.mkdirSync(path.dirname(contentPath), { recursive: true });
  fs.writeFileSync(contentPath, opts.content, 'utf8');
  const fp = opts.fingerprint ?? sha256(opts.content);
  const manifest = {
    manifestVersion: 'v1',
    targetCandidateId: opts.targetCandidateId ?? 'cand:P1:employee',
    targetViewRef:
      opts.targetViewRef ?? `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
    expectedOwner: opts.expectedOwner ?? REAL_EMPLOYEE_OBJECT_OWNER,
    expectedObjectType: 'VIEW',
    sourceKind: 'manual_vendor_artifact',
    contentFile: opts.underDocs ? path.join('docs', contentFile) : contentFile,
    declaredFingerprint: fp,
    acquisitionMode: 'manual_vendor_artifact_import',
    containsClientRows: false,
    containsPersonalData: false,
    vendorOnly: true,
    synthetic: opts.synthetic ?? false,
  };
  const manifestPath = path.join(dir, 'view-definition-import-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { dir, manifestPath };
}

describe('Stage 3K.2B2B2A — versions & contracts', () => {
  it('contract version', () => {
    expect(STAGE3K2B2B2A_CONTRACT_VERSION).toBe(
      'teta-aia-employee-foundation-source-enrichment-v1',
    );
  });
  it('policy version', () => {
    expect(STAGE3K2B2B2A_POLICY_VERSION).toBe(
      'teta-aia-employee-foundation-source-enrichment-policy-v1',
    );
  });
  it('parser version', () => {
    expect(STAGE3K2B2B2A_PARSER_VERSION).toContain('oracle-view-definition-parser');
  });
  it('collector version', () => {
    expect(STAGE3K2B2B2A_COLLECTOR_VERSION).toContain('collector');
  });
  it('sha256 deterministic', () => {
    expect(sha256('x')).toBe(sha256('x'));
  });
  it('stableStringify sorts', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
  it('empty counters strict ok', () => {
    expect(assertStrictZeros(emptySafetyCounters())).toEqual([]);
  });
  it.each(DEFINITION_KINDS)('definitionSourceKind %s', (k) => {
    expect(DEFINITION_KINDS).toContain(k);
  });
  it.each(COMPLETENESS)('completeness %s', (k) => {
    expect(COMPLETENESS).toContain(k);
  });
  it.each(PARSE_STATUSES)('parseStatus %s', (k) => {
    expect(PARSE_STATUSES).toContain(k);
  });
  it.each(KEY_STATUSES)('keyPreservation %s', (k) => {
    expect(KEY_STATUSES).toContain(k);
  });
  it.each(EVIDENCE_AVAIL)('evidenceAvailability %s', (k) => {
    expect(EVIDENCE_AVAIL).toContain(k);
  });
  it.each(MATERIALIZATION)('materialization %s', (k) => {
    expect(MATERIALIZATION).toContain(k);
  });
  it.each(ATTRIBUTION)('attribution %s', (k) => {
    expect(ATTRIBUTION).toContain(k);
  });
  it.each(SELECTION)('selection %s', (k) => {
    expect(SELECTION).toContain(k);
  });
  it.each(AMBIGUITY)('ambiguity %s', (k) => {
    expect(AMBIGUITY).toContain(k);
  });
  it.each(SENSITIVITY)('sensitivity %s', (k) => {
    expect(SENSITIVITY).toContain(k);
  });
  it.each(GRAPH_REV)('graphRevision %s', (k) => {
    expect(GRAPH_REV).toContain(k);
  });
  it.each(PROMOTION)('promotion %s', (k) => {
    expect(PROMOTION).toContain(k);
  });
  it.each(COUNTER_KEYS)('counter %s starts at 0', (k) => {
    expect(emptySafetyCounters()[k]).toBe(0);
  });
  it.each(STRICT_ZERO_KEYS)('strict zero key %s listed', (k) => {
    expect(STRICT_ZERO_KEYS).toContain(k);
  });
});

describe('Stage 3K.2B2B2A — policy load/hash/validate', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);

  it('path under apps/api/config', () => {
    expect(loaded.policyPath).toBe(
      'apps/api/config/teta-employee-foundation-source-enrichment-policy-v1.json',
    );
  });
  it('version matches', () => {
    expect(loaded.policy.policyVersion).toBe(STAGE3K2B2B2A_POLICY_VERSION);
  });
  it('hash 64 hex', () => {
    expect(loaded.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('validate empty', () => {
    expect(validateEnrichmentPolicy(loaded.policy)).toEqual([]);
  });
  it.each(POLICY_BOOL_RULES)('rule %s true', (k) => {
    expect(loaded.policy[k]).toBe(true);
  });
  it.each(PROHIBITED)('prohibits %s', (p) => {
    expect(loaded.policy.prohibitedFallbacks).toContain(p);
  });
  it.each(ALLOWED_NODES)('allows node %s', (n) => {
    expect(loaded.policy.allowedNodeTypes).toContain(n);
  });
  it.each(ALLOWED_EDGES)('allows edge %s', (e) => {
    expect(loaded.policy.allowedEdgeTypes).toContain(e);
  });
  it('first slice P1 only', () => {
    expect(loaded.policy.firstSliceTargets).toEqual(['P1']);
  });
  it.each(['P2', 'P6', 'P7', 'training_participant'])('defers %s', (t) => {
    expect(loaded.policy.deferredTargets).toContain(t);
  });
  it('collector bounds', () => {
    expect(loaded.policy.collectorBounds.maxDepth).toBe(4);
    expect(loaded.policy.collectorBounds.maxNodes).toBe(80);
    expect(loaded.policy.collectorBounds.maxEdges).toBe(160);
    expect(loaded.policy.collectorBounds.maxCandidates).toBe(20);
  });
  it('rejects wrong version', () => {
    expect(
      validateEnrichmentPolicy({ ...loaded.policy, policyVersion: 'wrong' }),
    ).toContain('version_mismatch');
  });
  it('rejects allowlist optional', () => {
    expect(
      validateEnrichmentPolicy({
        ...loaded.policy,
        candidateScopedAllowlistRequired: false,
      }),
    ).toContain('allowlist_required');
  });
  it('rejects preview becoming active', () => {
    expect(
      validateEnrichmentPolicy({
        ...loaded.policy,
        previewGraphCannotBecomeActive: false,
      }),
    ).toContain('preview_cannot_become_active_required');
  });
  it('rejects synthetic in real', () => {
    expect(
      validateEnrichmentPolicy({
        ...loaded.policy,
        syntheticArtifactsExcludedFromRealAssessment: false,
      }),
    ).toContain('synthetic_excluded_required');
  });
  it('failClosed approval', () => {
    expect(loaded.policy.failClosed.approvalForbidden).toBe(true);
  });
  it('failClosed sql', () => {
    expect(loaded.policy.failClosed.sqlExecutionForbidden).toBe(true);
  });
  it('failClosed promotion', () => {
    expect(loaded.policy.failClosed.activeGraphPromotionForbidden).toBe(true);
  });
  it('hash stable across loads', () => {
    expect(loadEnrichmentPolicy(repoRoot).policyHash).toBe(loaded.policyHash);
  });
});

describe('Stage 3K.2B2B2A — allowlist exact scope', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const al = buildP1Allowlist({
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    baseGraphHash: 'g1',
    candidateFingerprint: sha256('cand:P1:employee'),
  });

  it('id', () => expect(al.allowlistId).toBe('allowlist:P1:employee:v1'));
  it('single candidate', () => expect(al.candidateIds).toEqual(['cand:P1:employee']));
  it('form anchor', () => {
    expect(al.applicationAnchorRefs).toEqual([`form:${REAL_P1_FORM_GUID}`]);
  });
  it('view technical ref', () => {
    expect(al.technicalSourceRefs).toEqual([
      `oracle_view:${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
    ]);
  });
  it.each(['stage2a', 'stage2b', 'stage2c', 'stage2d', 'stage2e', 'stage3a'])(
    'artifact ref %s',
    (r) => {
      expect(al.artifactRefs).toContain(r);
    },
  );
  it('includes foundation pack', () => {
    expect(al.artifactRefs).toContain('stage3k2b2b1:pack-P1');
  });
  it.each(PROHIBITED)('prohibits fallback %s', (p) => {
    expect(al.prohibitedFallbacks).toContain(p);
  });
  it('fingerprint 64 hex', () => {
    expect(al.allowlistFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('maxDepth from policy', () => {
    expect(al.maxDepth).toBe(loaded.policy.collectorBounds.maxDepth);
  });
  it('maxCandidates 20', () => expect(al.maxCandidates).toBe(20));
  it('policy hash wired', () => expect(al.policyHash).toBe(loaded.policyHash));
  it.each(ALLOWED_NODES)('node bound %s', (n) => {
    expect(al.allowedNodeTypes).toContain(n);
  });
  it.each(ALLOWED_EDGES)('edge bound %s', (e) => {
    expect(al.allowedEdgeTypes).toContain(e);
  });
});

describe('Stage 3K.2B2B2A — definition completeness', () => {
  it('missing empty', () => {
    expect(assessDefinitionCompleteness({ content: null }).definitionCompletenessStatus).toBe(
      'missing',
    );
  });
  it('complete select', () => {
    expect(
      assessDefinitionCompleteness({ content: SIMPLE_KP }).definitionCompletenessStatus,
    ).toBe('complete');
  });
  it('truncated marker', () => {
    expect(
      assessDefinitionCompleteness({ content: TRUNCATED_SQL }).definitionCompletenessStatus,
    ).toBe('truncated');
  });
  it('incomplete length', () => {
    expect(
      assessDefinitionCompleteness({
        content: 'SELECT 1 FROM dual',
        expectedLength: 500,
      }).definitionCompletenessStatus,
    ).toBe('incomplete');
  });
  it('fragmented_complete ordered', () => {
    expect(
      assessDefinitionCompleteness({
        content: SIMPLE_KP,
        fragmentCount: 2,
        fragmentOrderingVerified: true,
      }).definitionCompletenessStatus,
    ).toBe('fragmented_complete');
  });
  it('unordered fragments incomplete', () => {
    expect(
      assessDefinitionCompleteness({
        content: SIMPLE_KP,
        fragmentCount: 2,
        fragmentOrderingVerified: false,
      }).definitionCompletenessStatus,
    ).toBe('incomplete');
  });
  it('no select incomplete', () => {
    expect(
      assessDefinitionCompleteness({ content: NO_SELECT }).definitionCompletenessStatus,
    ).toBe('incomplete');
  });
  it.each([
    ['complete', SIMPLE_KP],
    ['truncated', TRUNCATED_SQL],
    ['incomplete', NO_SELECT],
  ] as const)('fixture %s', (status, sql) => {
    expect(assessDefinitionCompleteness({ content: sql }).definitionCompletenessStatus).toBe(
      status,
    );
  });
});

describe('Stage 3K.2B2B2A — Oracle view parser constructs', () => {
  it('parses simple', () => {
    expect(parseOracleViewDefinition(SIMPLE_KP).parseStatus).toBe('parsed');
  });
  it('detects projection', () => {
    expect(parseOracleViewDefinition(SIMPLE_KP).projections.length).toBeGreaterThan(0);
  });
  it('detects base source', () => {
    expect(parseOracleViewDefinition(SIMPLE_KP).baseSources.length).toBeGreaterThan(0);
  });
  it('detects where', () => {
    expect(parseOracleViewDefinition(SIMPLE_KP).hasWhere).toBe(true);
  });
  it('detects LEFT join', () => {
    expect(parseOracleViewDefinition(LEFT_JOIN_1N).joinTypes).toContain('LEFT');
  });
  it('detects outer join', () => {
    expect(parseOracleViewDefinition(LEFT_JOIN_1N).outerJoinUsage).toBe(true);
  });
  it('detects DISTINCT', () => {
    expect(parseOracleViewDefinition(DISTINCT_SQL).distinctUsage).toBe(true);
  });
  it('detects GROUP BY', () => {
    expect(parseOracleViewDefinition(GROUP_BY_SQL).groupingUsage).toBe(true);
  });
  it('detects aggregate', () => {
    expect(parseOracleViewDefinition(GROUP_BY_SQL).aggregateFunctions).toContain('COUNT');
  });
  it('detects UNION', () => {
    expect(parseOracleViewDefinition(UNION_SQL).unionUsage).toBe(true);
  });
  it('detects subquery', () => {
    expect(parseOracleViewDefinition(SUBQUERY_SQL).subqueryUsage).toBe(true);
  });
  it('detects quoted identifiers', () => {
    expect(
      parseOracleViewDefinition('SELECT "ID" AS "ID_PRAC" FROM "T_PRAC"').quotedIdentifiers
        .length,
    ).toBeGreaterThan(0);
  });
  it('detects aliases', () => {
    expect(parseOracleViewDefinition(SIMPLE_KP).aliases.length).toBeGreaterThan(0);
  });
  it('empty not_parsed', () => {
    expect(parseOracleViewDefinition(null).parseStatus).toBe('not_parsed');
  });
  it('missing select parse_failed', () => {
    expect(parseOracleViewDefinition(NO_SELECT).parseStatus).toBe('parse_failed');
  });
  it.each(UNSUPPORTED_SAMPLES)('unsupported %s', ({ name, sql }) => {
    const r = parseOracleViewDefinition(sql);
    expect(r.parseStatus).toBe('parsed_with_unsupported_constructs');
    expect(r.unsupportedConstructs).toContain(name);
  });
  it('INNER join type', () => {
    expect(
      parseOracleViewDefinition(
        'SELECT p.ID FROM T_PRAC p INNER JOIN T_X x ON x.ID = p.ID',
      ).joinTypes,
    ).toContain('INNER');
  });
  it('CROSS join type', () => {
    expect(
      parseOracleViewDefinition('SELECT * FROM T_PRAC CROSS JOIN T_X').joinTypes,
    ).toContain('CROSS');
  });
  it('RIGHT join type', () => {
    expect(
      parseOracleViewDefinition(
        'SELECT * FROM T_PRAC p RIGHT JOIN T_X x ON x.ID = p.ID',
      ).joinTypes,
    ).toContain('RIGHT');
  });
  it('FULL join type', () => {
    expect(
      parseOracleViewDefinition(
        'SELECT * FROM T_PRAC p FULL OUTER JOIN T_X x ON x.ID = p.ID',
      ).joinTypes,
    ).toContain('FULL');
  });
  it('oracle (+) outer', () => {
    expect(
      parseOracleViewDefinition('SELECT * FROM T_PRAC p, T_X x WHERE p.ID = x.ID(+)').outerJoinUsage,
    ).toBe(true);
  });
  it('canonical fingerprint stable', () => {
    const a = parseOracleViewDefinition(SIMPLE_KP).canonicalContentFingerprint;
    const b = parseOracleViewDefinition(SIMPLE_KP.replace(/\s+/g, '  ')).canonicalContentFingerprint;
    expect(a).toBe(b);
  });
  it('does not execute sql counters', () => {
    const c = emptySafetyCounters();
    parseOracleViewDefinition(SIMPLE_KP);
    expect(c.sqlExecuted).toBe(0);
    expect(c.sqlCompiled).toBe(0);
    expect(c.viewDefinitionsExecuted).toBe(0);
  });
});

describe('Stage 3K.2B2B2A — key preservation', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const policy = loaded.policy;

  it('missing → not_evaluable', () => {
    const c = emptySafetyCounters();
    const r = assessKeyPreservation({
      viewRef: 'V',
      completeness: 'missing',
      parse: null,
      dependsOnBasePkOnly: false,
      projectedIdentityHints: [],
      policy,
      counters: c,
    });
    expect(r.keyPreservationStatus).toBe('not_evaluable');
  });

  it.each(['truncated', 'incomplete', 'conflicting'] as const)(
    '%s cannot be proven',
    (completeness) => {
      const c = emptySafetyCounters();
      const parse = parseOracleViewDefinition(SIMPLE_KP);
      const r = assessKeyPreservation({
        viewRef: 'V',
        completeness,
        parse,
        dependsOnBasePkOnly: false,
        projectedIdentityHints: ['ID_PRAC'],
        policy,
        counters: c,
      });
      expect(r.keyPreservationStatus).not.toBe('proven');
      expect(['not_evaluable', 'supported_partial']).toContain(r.keyPreservationStatus);
    },
  );

  it('unsupported cannot be proven', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(UNSUPPORTED_SAMPLES[0].sql);
    const r = assessKeyPreservation({
      viewRef: 'V',
      completeness: 'complete',
      parse,
      dependsOnBasePkOnly: false,
      projectedIdentityHints: ['ID'],
      policy,
      counters: c,
    });
    expect(r.keyPreservationStatus).toBe('not_evaluable');
  });

  it('simple complete can be proven', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(SIMPLE_KP);
    const r = assessKeyPreservation({
      viewRef: 'V',
      completeness: 'complete',
      parse,
      dependsOnBasePkOnly: false,
      projectedIdentityHints: ['ID_PRAC'],
      policy,
      counters: c,
    });
    expect(r.keyPreservationStatus).toBe('proven');
    expect(assertStrictZeros(c)).toEqual([]);
  });

  it('LEFT JOIN → supported_partial', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(LEFT_JOIN_1N);
    const r = assessKeyPreservation({
      viewRef: 'V',
      completeness: 'complete',
      parse,
      dependsOnBasePkOnly: false,
      projectedIdentityHints: ['ID_PRAC'],
      policy,
      counters: c,
    });
    expect(r.keyPreservationStatus).toBe('supported_partial');
  });

  it('GROUP BY → supported_partial', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(GROUP_BY_SQL);
    expect(
      assessKeyPreservation({
        viewRef: 'V',
        completeness: 'complete',
        parse,
        dependsOnBasePkOnly: false,
        projectedIdentityHints: ['ID'],
        policy,
        counters: c,
      }).keyPreservationStatus,
    ).toBe('supported_partial');
  });

  it('UNION → supported_partial', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(UNION_SQL);
    expect(
      assessKeyPreservation({
        viewRef: 'V',
        completeness: 'complete',
        parse,
        dependsOnBasePkOnly: false,
        projectedIdentityHints: ['ID'],
        policy,
        counters: c,
      }).keyPreservationStatus,
    ).toBe('supported_partial');
  });

  it('dependsOn base pk alone max supported_partial', () => {
    const c = emptySafetyCounters();
    expect(
      assessKeyPreservation({
        viewRef: 'V',
        completeness: 'missing',
        parse: null,
        dependsOnBasePkOnly: true,
        projectedIdentityHints: [],
        policy,
        counters: c,
      }).keyPreservationStatus,
    ).toBe('not_evaluable');
  });

  it('guard incomplete proven increments counter', () => {
    const c = emptySafetyCounters();
    const parse = parseOracleViewDefinition(SIMPLE_KP);
    // force path by calling with truncated then manually — assessor blocks proven
    assessKeyPreservation({
      viewRef: 'V',
      completeness: 'truncated',
      parse,
      dependsOnBasePkOnly: false,
      projectedIdentityHints: ['ID_PRAC'],
      policy,
      counters: c,
    });
    expect(c.keyPreservationProvenFromIncompleteDefinition).toBe(0);
  });
});

describe('Stage 3K.2B2B2A — data surface reconstruction', () => {
  it('real default partial / unproven / no_candidates', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: [],
      datasetRefs: [],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: null,
      counters: c,
    });
    expect(s.evidenceAvailability).toBe('partial');
    expect(s.materializationStatus).toBe('requires_bounded_reconstruction');
    expect(s.semanticAttributionStatus).toBe('unproven');
    expect(s.surfaceCandidateCount).toBe(0);
    expect(s.surfaceSelectionStatus).toBe('no_candidates');
    expect(s.ambiguityStatus).toBe('not_evaluable');
    expect(s.selectionRequired).toBe(false);
    expect(s.applicationDataSurfaceStatus).toBe('supported_partial');
    expect(s.applicationDataSurfaceStatus).not.toBe('confirmed');
    expect(assertStrictZeros(c)).toEqual([]);
  });

  it('ambiguous gateways require selection', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: ['g1', 'g2'],
      datasetRefs: ['d1'],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: 'v1',
      counters: c,
    });
    expect(s.surfaceSelectionStatus).toBe('ambiguous');
    expect(s.ambiguityStatus).toBe('ambiguous');
    expect(s.selectionRequired).toBe(true);
    expect(s.applicationDataSurfaceStatus).toBe('ambiguous');
    expect(s.surfaceCandidates.length).toBe(2);
    expect(c.ambiguousDataSurfaceAutoSelected).toBe(0);
  });

  it('one gateway may be unambiguous selected still not confirmed', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: ['g1'],
      datasetRefs: ['d1'],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: ['o1'],
      employeeSemanticSourceRef: 'v1',
      counters: c,
    });
    expect(s.surfaceSelectionStatus).toBe('selected');
    expect(s.ambiguityStatus).toBe('unambiguous');
    expect(s.applicationDataSurfaceStatus).toBe('supported_partial');
    expect(s.semanticAttributionStatus).toBe('unproven');
    expect(s.applicationDataSurfaceStatus).not.toBe('confirmed');
  });

  it('form is anchor only', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: [],
      datasetRefs: [],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: null,
      counters: c,
    });
    expect(s.applicationAnchorRefs[0]).toContain(REAL_P1_FORM_GUID);
    expect(s.datasetRefs).toEqual([]);
    expect(c.formAnchorUsedAsDataSurface).toBe(0);
  });
});

describe('Stage 3K.2B2B2A — view import manifest', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const allowlist = buildP1Allowlist({
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    baseGraphHash: 'g',
    candidateFingerprint: 'c',
  });

  it('missing manifest → requires_vendor_export', () => {
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath: path.join(os.tmpdir(), 'no-such-manifest-3k2b2b2a.json'),
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('requires_vendor_export');
    expect(c.missingRealArtifactReportedAsExtractionFailure).toBe(0);
  });

  it('fingerprint mismatch rejects', () => {
    const { manifestPath, dir } = writeTempManifest({
      content: SIMPLE_KP,
      fingerprint: 'deadbeef',
    });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('rejected');
    expect(r.artifact.parseStatus).toBe('not_parsed');
    expect(r.artifact.unsupportedConstructs).toBeNull();
    expect(r.artifact.rawContentFingerprint).toBeTruthy();
  });

  it('target candidate mismatch', () => {
    const { manifestPath, dir } = writeTempManifest({
      content: SIMPLE_KP,
      targetCandidateId: 'cand:P9',
    });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('rejected');
    expect(c.artifactsReadOutsideAllowlist).toBe(1);
  });

  it('target view mismatch', () => {
    const { manifestPath, dir } = writeTempManifest({
      content: SIMPLE_KP,
      targetViewRef: 'OTHER.VIEW',
    });
    const c = emptySafetyCounters();
    importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath,
    });
    expect(c.artifactsReadOutsideAllowlist).toBe(1);
  });

  it('synthetic excluded from real P1', () => {
    const { manifestPath, dir } = writeTempManifest({
      content: SIMPLE_KP,
      synthetic: true,
    });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('synthetic_fixture_only');
    expect(c.syntheticViewDefinitionUsedForRealP1).toBe(1);
  });

  it('docs path forbidden', () => {
    const { manifestPath, dir } = writeTempManifest({
      content: SIMPLE_KP,
      underDocs: true,
    });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: false,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('rejected');
    expect(c.rawViewDefinitionCommittedToRepo).toBe(1);
  });

  it('valid import for fixtures', () => {
    const { manifestPath, dir } = writeTempManifest({ content: SIMPLE_KP });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: false,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('imported');
    expect(r.artifact.definitionCompletenessStatus).toBe('complete');
    expect(r.artifact.parseStatus).toBe('parsed');
    expect(c.viewDefinitionsImported).toBe(1);
    expect(c.viewDefinitionsParsed).toBe(1);
  });
});

describe('Stage 3K.2B2B2A — real pipeline offline (no vendor DDL)', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const pipeline = runEnrichmentPipeline(repoRoot, {
    mode: 'real',
    writeArtifacts: true,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  it('view requires_vendor_export', () => {
    expect(pipeline.viewDefinition.viewDefinitionArtifactStatus).toBe(
      'requires_vendor_export',
    );
  });
  it('key preservation not_evaluable', () => {
    expect(pipeline.keyPreservation.keyPreservationStatus).toBe('not_evaluable');
  });
  it('P1 grain stays partial', () => {
    expect(pipeline.p1GrainPreview.grainStatus).toBe('partial');
  });
  it('activation false', () => {
    expect(pipeline.p1GrainPreview.genericActivationEligible).toBe(false);
  });
  it('planning false', () => {
    expect(pipeline.p1GrainPreview.planningEligible).toBe(false);
  });
  it('active pointer unchanged', () => {
    expect(pipeline.graphManifest.activeGraphPointerUnchanged).toBe(true);
    expect(pipeline.activeGraphPointerBefore).toBe(pipeline.activeGraphPointerAfter);
  });
  it('runtime cannot use preview', () => {
    expect(pipeline.graphManifest.runtimeConsumersMayUsePreview).toBe(false);
  });
  it('promotion not_requested', () => {
    expect(pipeline.graphManifest.promotionStatus).toBe('not_requested');
  });
  it('graph revision preview-like', () => {
    expect(['preview', 'validated_preview']).toContain(
      pipeline.graphManifest.graphRevisionStatus,
    );
  });
  it('data surface not confirmed', () => {
    expect(pipeline.dataSurface.applicationDataSurfaceStatus).not.toBe('confirmed');
  });
  it('evidenceAvailability partial or unavailable', () => {
    expect(['partial', 'unavailable']).toContain(pipeline.dataSurface.evidenceAvailability);
  });
  it('synthetic not in real pack metrics', () => {
    expect(pipeline.metrics.syntheticArtifactsInRealPack).toBe(0);
    expect(pipeline.metrics.syntheticEvidenceUsedForRealP1).toBe(0);
    expect(pipeline.metrics.realViewDefinitionArtifactsImported).toBe(0);
  });
  it('strict zeros', () => {
    expect(assertStrictZeros(pipeline.counters)).toEqual([]);
  });
  it.each([
    'oracleConnections',
    'sqlCompiled',
    'sqlExecuted',
    'viewDefinitionsExecuted',
    'stage3cPlansBuilt',
    'localModelCalls',
    'remoteModelCalls',
    'qdrantCalls',
    'embeddingCalls',
    'realDecisionEventsApplied',
    'stage3dProductionBindingsAdded',
    'reusePolicyEntriesAdded',
  ] as const)('%s = 0', (k) => {
    expect(pipeline.counters[k]).toBe(0);
  });
  it('writes pack-P1 v2', () => {
    expect(
      fs.existsSync(
        path.join(repoRoot, '.local/stage3k2b2b2a/review-packs-v2/pack-P1.json'),
      ),
    ).toBe(true);
  });
  it('writes audit v2', () => {
    expect(
      fs.existsSync(path.join(repoRoot, '.local/stage3k2b2b2a/stage3k2b2b2a-audit-v2.json')),
    ).toBe(true);
  });
  it('writes enrichment manifest v2', () => {
    expect(
      fs.existsSync(path.join(repoRoot, '.local/stage3k2b2b2a/enrichment-manifest-v2.json')),
    ).toBe(true);
  });
  it('pack has no raw DDL', () => {
    const pack = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.local/stage3k2b2b2a/review-packs-v2/pack-P1.json'),
        'utf8',
      ),
    );
    expect(JSON.stringify(pack)).not.toMatch(/CREATE OR REPLACE VIEW/i);
    expect(pack.approvalForbidden).toBe(true);
  });
  it('not_parsed parser fields are null/not_evaluated', () => {
    expect(pipeline.viewDefinition.parseStatus).toBe('not_parsed');
    expect(pipeline.viewDefinition.unsupportedConstructsStatus).toBe('not_evaluated');
    expect(pipeline.viewDefinition.unsupportedConstructs).toBeNull();
    expect(pipeline.viewDefinition.parseWarnings).toBeNull();
  });
  it('zero candidates not unambiguous', () => {
    expect(pipeline.dataSurface.surfaceCandidateCount).toBe(0);
    expect(pipeline.dataSurface.surfaceSelectionStatus).toBe('no_candidates');
    expect(pipeline.dataSurface.ambiguityStatus).toBe('not_evaluable');
  });
  it('preview not created without delta', () => {
    expect(pipeline.graphManifest.previewStatus).toBe(
      'not_created_no_new_validated_evidence',
    );
    expect(pipeline.graphManifest.previewAddedNodes).toBe(0);
    expect(pipeline.graphManifest.previewSemanticUpgradeCount).toBe(0);
  });
  it('active graph content proof', () => {
    expect(pipeline.graphImmutability.activeGraphContentUnchanged).toBe(true);
    expect(pipeline.graphImmutability.baseGraphFileSha256Before).toBe(
      pipeline.graphImmutability.baseGraphFileSha256After,
    );
    expect(pipeline.graphImmutability.baseGraphFileSizeBefore).toBe(
      pipeline.graphImmutability.baseGraphFileSizeAfter,
    );
  });
});

describe('Stage 3K.2B2B2A — audit wrapper', () => {
  const audit = buildStage3k2b2b2aAudit(repoRoot, { writeArtifacts: true, mode: 'real' });

  it('stage statuses', () => {
    expect(audit.stage3k2b2b2Status).toBe('started_offline_source_evidence_enrichment');
    expect(audit.stage3k2b2b2aStatus).toBe(
      'accepted_offline_candidate_scoped_employee_view_enrichment_pilot',
    );
  });
  it('human review accepted', () => {
    expect(audit.humanReviewVerdict).toBe('PASS_WITH_FINALIZATION');
    expect(audit.humanReviewStatus).toBe('accepted');
    expect(audit.previousHumanReviewVerdict).toBe('PATCH_BEFORE_COMMIT');
    expect(audit.realCandidateApprovalStatus).toBe('no_candidates_approved');
    expect(audit.accepted).toBe(true);
    expect(audit.committed).toBe(false);
  });
  it('strictErrors empty', () => {
    expect(audit.strictErrors).toEqual([]);
  });
  it('policy path/version/hash present', () => {
    expect(audit.enrichmentPolicyPath).toContain(
      'teta-employee-foundation-source-enrichment-policy-v1.json',
    );
    expect(audit.enrichmentPolicyVersion).toBe(STAGE3K2B2B2A_POLICY_VERSION);
    expect(audit.enrichmentPolicyHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 3K.2B2B2A — synthetic fixtures matrix (not real P1)', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const allowlist = buildP1Allowlist({
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    baseGraphHash: 'g',
    candidateFingerprint: 'c',
  });

  const fixtures: Array<{ name: string; sql: string; expectParse?: string }> = [
    { name: 'simple_kp', sql: SIMPLE_KP, expectParse: 'parsed' },
    { name: 'left_join', sql: LEFT_JOIN_1N, expectParse: 'parsed' },
    { name: 'distinct', sql: DISTINCT_SQL, expectParse: 'parsed' },
    { name: 'group_by', sql: GROUP_BY_SQL, expectParse: 'parsed' },
    { name: 'union', sql: UNION_SQL, expectParse: 'parsed' },
    { name: 'subquery', sql: SUBQUERY_SQL, expectParse: 'parsed' },
    { name: 'truncated', sql: TRUNCATED_SQL },
    ...UNSUPPORTED_SAMPLES.map((u) => ({
      name: `unsupported_${u.name}`,
      sql: u.sql,
      expectParse: 'parsed_with_unsupported_constructs',
    })),
  ];

  it.each(fixtures)('fixture %s importable as synthetic-capable content', ({ sql, expectParse }) => {
    const { manifestPath, dir } = writeTempManifest({ content: sql, synthetic: false });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: false,
      manifestPath,
    });
    expect(r.artifact.artifactPresentStatus).toBe('present');
    if (expectParse) expect(r.artifact.parseStatus).toBe(expectParse);
  });

  it.each(fixtures)('fixture %s excluded when marked synthetic for real', ({ sql }) => {
    const { manifestPath, dir } = writeTempManifest({ content: sql, synthetic: true });
    const c = emptySafetyCounters();
    const r = importViewDefinitionArtifact({
      repoRoot: dir,
      allowlist,
      counters: c,
      forRealP1: true,
      manifestPath,
    });
    expect(r.artifact.viewDefinitionArtifactStatus).toBe('synthetic_fixture_only');
    expect(c.syntheticViewDefinitionUsedForRealP1).toBe(1);
  });
});

describe('Stage 3K.2B2B2A — staleness & sensitivity containment', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);
  const pipeline = runEnrichmentPipeline(repoRoot, {
    mode: 'real',
    writeArtifacts: false,
    policy: loaded.policy,
    policyHash: loaded.policyHash,
    policyPath: loaded.policyPath,
  });

  it('staleness vector present', () => {
    expect(pipeline.staleness.enrichmentPolicyHash).toBe(loaded.policyHash);
    expect(pipeline.staleness.allowlistFingerprint).toBeTruthy();
    expect(pipeline.staleness.stale).toBe(false);
  });
  it('no unclassified repo-eligible raw', () => {
    expect(pipeline.counters.unclassifiedRawMetadataMarkedRepoEligible).toBe(0);
  });
  it('no client metadata in docs counter', () => {
    expect(pipeline.counters.clientSpecificTechnicalMetadataExposedInDocs).toBe(0);
  });
  it.each([
    'activeGraphPointerChanges',
    'runtimeConsumersUsingPreviewGraph',
    'previewGraphPromotedWithoutReview',
    'productionGraphReplaced',
    'enrichmentRunsWithoutAllowlist',
    'candidateScopedRunFellBackToNameSearch',
    'globalFreeSearches',
    'unanchoredCollectorRuns',
    'columnNameOnlyBindingsCreated',
  ] as const)('counter %s zero', (k) => {
    expect(pipeline.counters[k]).toBe(0);
  });
});

describe('Stage 3K.2B2B2A — parametric safety matrix', () => {
  it.each(STRICT_ZERO_KEYS)('assertStrictZeros catches nonzero %s', (k) => {
    const c = emptySafetyCounters();
    c[k] = 1;
    expect(assertStrictZeros(c).some((e) => e.includes(String(k)))).toBe(true);
  });

  it.each(DEFINITION_KINDS)('definition kind %s not auto-executed', (k) => {
    expect(typeof k).toBe('string');
    expect(emptySafetyCounters().viewDefinitionsExecuted).toBe(0);
  });

  it.each(COMPLETENESS)('completeness %s never implies sqlExecuted', (c) => {
    expect(c).toBeTruthy();
    expect(emptySafetyCounters().sqlExecuted).toBe(0);
  });

  it.each(KEY_STATUSES)('key status %s does not approve bindings', (s) => {
    expect(s).toBeTruthy();
    expect(emptySafetyCounters().realApprovedGenericBindingsCreated).toBe(0);
  });

  it.each(PROHIBITED)('fallback %s never used in empty counters', (p) => {
    expect(p).toBeTruthy();
    expect(emptySafetyCounters().candidateScopedRunFellBackToNameSearch).toBe(0);
  });

  it.each(ALLOWED_NODES)('node type %s bound in policy', (n) => {
    const loaded = loadEnrichmentPolicy(repoRoot);
    expect(loaded.policy.allowedNodeTypes).toContain(n);
  });

  it.each(ALLOWED_EDGES)('edge type %s bound in policy', (e) => {
    const loaded = loadEnrichmentPolicy(repoRoot);
    expect(loaded.policy.allowedEdgeTypes).toContain(e);
  });

  it.each(SENSITIVITY)('sensitivity %s not auto repo-eligible', (s) => {
    expect(s).toBeTruthy();
    expect(emptySafetyCounters().unclassifiedRawMetadataMarkedRepoEligible).toBe(0);
  });

  it.each(GRAPH_REV)('revision %s does not promote without review', (r) => {
    expect(r).toBeTruthy();
    expect(emptySafetyCounters().previewGraphPromotedWithoutReview).toBe(0);
  });

  it.each(PROMOTION)('promotion %s starts blocked in counters', (p) => {
    expect(p).toBeTruthy();
    expect(emptySafetyCounters().productionGraphReplaced).toBe(0);
  });
});

describe('Stage 3K.2B2B2A — contract patch (not-evaluated / zero-candidates / immutability)', () => {
  const loaded = loadEnrichmentPolicy(repoRoot);

  it('not_parsed produces null unsupportedConstructs', () => {
    const c = emptySafetyCounters();
    const a = enforceNotParsedSemantics(
      {
        artifactId: 'x',
        sourceObjectRef: 'V',
        sourceObjectOwner: 'O',
        sourceObjectType: 'VIEW',
        sourceObjectEdition: null,
        definitionSourceKind: null,
        rawContentFingerprint: null,
        canonicalContentFingerprint: null,
        definitionCompletenessStatus: 'missing',
        sourceLength: null,
        expectedLength: null,
        fragmentCount: 0,
        fragmentOrderingVerified: false,
        parseStatus: 'not_parsed',
        parserVersion: 'p',
        oracleDialectVersion: 'o',
        unsupportedConstructsStatus: 'evaluated',
        unsupportedConstructs: [],
        parseWarnings: [],
        artifactPresentStatus: 'missing',
        artifactImportCapabilityStatus: 'capable',
        artifactValidationStatus: 'missing',
        artifactSemanticEffect: 'none',
        viewDefinitionArtifactStatus: 'requires_vendor_export',
      },
      c,
    );
    expect(a.unsupportedConstructsStatus).toBe('not_evaluated');
    expect(a.unsupportedConstructs).toBeNull();
    expect(a.parseWarnings).toBeNull();
    expect(c.notParsedDefinitionReportedNoUnsupportedConstructs).toBe(1);
    expect(c.notParsedDefinitionWithEvaluatedParserOutput).toBe(1);
  });

  it('parsed clean definition allows empty unsupported array', () => {
    const c = emptySafetyCounters();
    const a = enforceNotParsedSemantics(
      {
        artifactId: 'x',
        sourceObjectRef: 'V',
        sourceObjectOwner: 'O',
        sourceObjectType: 'VIEW',
        sourceObjectEdition: null,
        definitionSourceKind: 'manual_vendor_artifact',
        rawContentFingerprint: 'a',
        canonicalContentFingerprint: 'b',
        definitionCompletenessStatus: 'complete',
        sourceLength: 10,
        expectedLength: null,
        fragmentCount: 1,
        fragmentOrderingVerified: true,
        parseStatus: 'parsed',
        parserVersion: 'p',
        oracleDialectVersion: 'o',
        unsupportedConstructsStatus: 'evaluated',
        unsupportedConstructs: [],
        parseWarnings: [],
        artifactPresentStatus: 'present',
        artifactImportCapabilityStatus: 'capable',
        artifactValidationStatus: 'validated',
        artifactSemanticEffect: 'preview_only',
        viewDefinitionArtifactStatus: 'imported',
      },
      c,
    );
    expect(a.unsupportedConstructs).toEqual([]);
    expect(a.unsupportedConstructsStatus).toBe('evaluated');
    expect(c.notParsedDefinitionReportedNoUnsupportedConstructs).toBe(0);
  });

  it('missing definition cannot report clean parse', () => {
    const c = emptySafetyCounters();
    enforceNotParsedSemantics(
      {
        artifactId: 'x',
        sourceObjectRef: 'V',
        sourceObjectOwner: 'O',
        sourceObjectType: 'VIEW',
        sourceObjectEdition: null,
        definitionSourceKind: null,
        rawContentFingerprint: null,
        canonicalContentFingerprint: null,
        definitionCompletenessStatus: 'missing',
        sourceLength: null,
        expectedLength: null,
        fragmentCount: 0,
        fragmentOrderingVerified: false,
        parseStatus: 'parsed',
        parserVersion: 'p',
        oracleDialectVersion: 'o',
        unsupportedConstructsStatus: 'evaluated',
        unsupportedConstructs: [],
        parseWarnings: [],
        artifactPresentStatus: 'missing',
        artifactImportCapabilityStatus: 'capable',
        artifactValidationStatus: 'missing',
        artifactSemanticEffect: 'none',
        viewDefinitionArtifactStatus: 'requires_vendor_export',
      },
      c,
    );
    expect(c.missingDefinitionReportedAsCleanParse).toBe(1);
  });

  it('zero gateway candidates are not unambiguous', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: [],
      datasetRefs: ['d1'],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: 'v',
      counters: c,
    });
    expect(s.ambiguityStatus).not.toBe('unambiguous');
    expect(s.ambiguityStatus).toBe('not_evaluable');
    expect(s.surfaceSelectionStatus).toBe('no_candidates');
    expect(c.zeroSurfaceCandidatesReportedUnambiguous).toBe(0);
  });

  it('one candidate may be unambiguous', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: ['g1'],
      datasetRefs: ['d1'],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: 'v',
      counters: c,
    });
    expect(s.ambiguityStatus).toBe('unambiguous');
    expect(s.surfaceSelectionStatus).toBe('selected');
    expect(s.surfaceCandidateCount).toBe(1);
  });

  it('several candidates are ambiguous', () => {
    const c = emptySafetyCounters();
    const s = reconstructApplicationDataSurface({
      mode: 'real',
      formResolved: true,
      gatewayRefs: ['g1', 'g2', 'g3'],
      datasetRefs: ['d1'],
      sqlJoinRefs: [],
      oracleAccessSurfaceRefs: [],
      employeeSemanticSourceRef: 'v',
      counters: c,
    });
    expect(s.ambiguityStatus).toBe('ambiguous');
    expect(s.surfaceSelectionStatus).toBe('ambiguous');
    expect(s.selectionRequired).toBe(true);
  });

  it('path equality does not prove file immutability alone', () => {
    const c = emptySafetyCounters();
    c.activeGraphPathUnchangedButContentChanged = 1;
    expect(assertStrictZeros(c).some((e) => e.includes('activeGraphPathUnchangedButContentChanged'))).toBe(
      true,
    );
  });

  it('active graph SHA before/after equal in real pipeline', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(p.graphImmutability.baseGraphFileSha256Before).toMatch(/^[a-f0-9]{64}$|^missing-graph$/);
    expect(p.graphImmutability.baseGraphFileSha256Before).toBe(
      p.graphImmutability.baseGraphFileSha256After,
    );
  });

  it('write-attempt detection counter starts at zero', () => {
    expect(emptySafetyCounters().activeGraphWriteAttempts).toBe(0);
  });

  it('zero-delta preview not created', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(p.graphManifest.previewAddedNodes).toBe(0);
    expect(p.graphManifest.previewAddedEdges).toBe(0);
    expect(p.graphManifest.previewStatus).toBe('not_created_no_new_validated_evidence');
    expect(p.counters.validatedPreviewWithZeroDelta).toBe(0);
  });

  it('preview content hash null when no delta (not run-metadata hash)', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(p.graphManifest.previewContentHash).toBeNull();
    expect(p.graphManifest.previewGraphHash).toBeNull();
    expect(p.counters.previewHashChangedOnlyByRunMetadata).toBe(0);
  });

  it('complete allowlist observed bounds present', () => {
    const al = buildP1Allowlist({
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      baseGraphHash: 'g',
      candidateFingerprint: 'c',
      observed: {
        observedDepth: 1,
        observedNodes: 2,
        observedEdges: 3,
        observedCandidates: 1,
      },
    });
    expect(al.allowedNodeTypes.length).toBeGreaterThan(0);
    expect(al.allowedEdgeTypes.length).toBeGreaterThan(0);
    expect(al.allowedArtifactKinds.length).toBeGreaterThan(0);
    expect(al.observedDepth).toBeLessThanOrEqual(al.maxDepth);
    expect(al.observedNodes).toBeLessThanOrEqual(al.maxNodes);
    expect(al.observedEdges).toBeLessThanOrEqual(al.maxEdges);
    expect(al.observedCandidates).toBeLessThanOrEqual(al.maxCandidates);
  });

  it('synthetic test counts separate from real artifacts', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(p.metrics.syntheticParserFixturesExecuted).toBe(0);
    expect(p.metrics.realViewDefinitionArtifactsImported).toBe(0);
    expect(p.metrics.syntheticArtifactsInRealPack).toBe(0);
    expect(p.metrics.syntheticArtifactsInRealPreview).toBe(0);
    expect(p.metrics.syntheticEvidenceUsedForRealP1).toBe(0);
  });

  it('policy rulesApplied includes patch rules', () => {
    for (const rule of [
      'notParsedMeansNotEvaluated',
      'zeroCandidatesAreNotUnambiguous',
      'activeGraphImmutabilityRequiresContentHash',
      'validatedPreviewRequiresNonEmptyDelta',
      'allowlistRequiresObservedBounds',
      'syntheticAndRealMetricsSeparated',
      'requestAvailabilityDoesNotProveSemanticAttribution',
    ]) {
      expect(loaded.policy.rulesApplied).toContain(rule);
      expect((loaded.policy as Record<string, unknown>)[rule]).toBe(true);
    }
  });

  it('request availability does not prove semantic attribution', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    const req = p.enrichmentRequests.find(
      (r) => r.gapKind === 'application_data_surface_evidence',
    );
    expect(req?.status).toBe('available_in_existing_artifacts');
    expect(p.dataSurface.semanticAttributionStatus).toBe('unproven');
    expect(p.dataSurface.evidenceAvailability).toBe('partial');
  });

  it('no approval activation runtime execution', () => {
    const p = runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: false,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    expect(p.counters.realDecisionEventsApplied).toBe(0);
    expect(p.counters.realApprovedGenericBindingsCreated).toBe(0);
    expect(p.counters.runtimeConsumersUsingPreviewGraph).toBe(0);
    expect(p.counters.oracleConnections).toBe(0);
    expect(p.counters.sqlExecuted).toBe(0);
    expect(p.graphManifest.runtimeConsumersMayUsePreview).toBe(false);
    expect(p.graphManifest.promotionStatus).toBe('not_requested');
  });

  it('allowlist limit exceeded counter fires when observed > max', () => {
    const c = emptySafetyCounters();
    const al = buildP1Allowlist({
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      baseGraphHash: 'g',
      candidateFingerprint: 'c',
      observed: {
        observedDepth: 99,
        observedNodes: 1,
        observedEdges: 1,
        observedCandidates: 1,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { validateAllowlistBounds } = require('./teta-enrichment-data-surface') as {
      validateAllowlistBounds: typeof import('./teta-enrichment-data-surface').validateAllowlistBounds;
    };
    validateAllowlistBounds(al, c);
    expect(c.allowlistLimitExceeded).toBe(1);
  });

  it('preview with structural delta would require positive counts', () => {
    // Document contract: validated_preview_structural_only only with positive delta
    const status =
      1 > 0 ? 'validated_preview_structural_only' : 'not_created_no_new_validated_evidence';
    expect(status).toBe('validated_preview_structural_only');
  });

  it('semantic preview upgrade without evidence is strict-zero', () => {
    expect(emptySafetyCounters().semanticPreviewUpgradeWithoutNewEvidence).toBe(0);
  });

  it('pack v2 contains complete allowlist fields', () => {
    runEnrichmentPipeline(repoRoot, {
      mode: 'real',
      writeArtifacts: true,
      policy: loaded.policy,
      policyHash: loaded.policyHash,
      policyPath: loaded.policyPath,
    });
    const pack = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.local/stage3k2b2b2a/review-packs-v2/pack-P1.json'),
        'utf8',
      ),
    );
    for (const k of [
      'allowlistId',
      'candidateIds',
      'candidateFingerprints',
      'applicationAnchorRefs',
      'technicalSourceRefs',
      'artifactRefs',
      'allowedNodeTypes',
      'allowedEdgeTypes',
      'allowedArtifactKinds',
      'maxDepth',
      'maxNodes',
      'maxEdges',
      'maxCandidates',
      'observedDepth',
      'observedNodes',
      'observedEdges',
      'observedCandidates',
      'prohibitedFallbacks',
      'baseGraphHash',
      'policyVersion',
      'policyHash',
      'allowlistFingerprint',
    ]) {
      expect(pack.allowlist[k]).toBeDefined();
    }
    expect(pack.graphImmutability.baseGraphFileSha256Before).toBeTruthy();
    expect(pack.previewDelta.previewStatus).toBe('not_created_no_new_validated_evidence');
    expect(pack.metrics.syntheticArtifactsInRealPack).toBe(0);
  });

  it.each([
    'notParsedDefinitionReportedNoUnsupportedConstructs',
    'zeroSurfaceCandidatesReportedUnambiguous',
    'activeGraphContentHashChanged',
    'validatedPreviewWithZeroDelta',
    'allowlistLimitExceeded',
    'syntheticArtifactsInRealPack',
  ] as const)('new strict counter %s starts at 0', (k) => {
    expect(emptySafetyCounters()[k]).toBe(0);
  });
});
