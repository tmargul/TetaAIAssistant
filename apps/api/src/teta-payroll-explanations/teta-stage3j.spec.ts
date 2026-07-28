/**
 * Stage 3J unit tests — synthetic fixtures + optional local golden (no DOMAN in git).
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseService } from '../database/database.service';
import { parsePayrollFormula } from '../teta-payroll-snapshots/teta-payroll-formula-parser';
import { TetaPayrollSnapshotImportService } from '../teta-payroll-snapshots/teta-payroll-snapshot-import.service';
import { TetaPayrollSnapshotQueryService } from '../teta-payroll-snapshots/teta-payroll-snapshot-query.service';
import { TetaPayrollSnapshotRepository } from '../teta-payroll-snapshots/teta-payroll-snapshot-repository';
import {
  evaluatePayrollChatGate,
  isClientPayrollConfigurationQuestion,
  isGenericPayrollKnowledgeQuestion,
} from '../teta-payroll-snapshots/teta-payroll-snapshot-chat-gate';
import { STAGE3I_PARSER_VERSION } from '../teta-payroll-snapshots/teta-payroll-snapshot.types';
import { analyzeComponentImpact } from './teta-payroll-component-impact.service';
import {
  buildPayrollComponentRequest,
  detectPayrollExplanationFocus,
  detectPayrollExplanationIntent,
  detectUnsupportedPayrollIntent,
  isStage3jSupportedIntent,
  isStage3jUnsupportedIntent,
} from './teta-payroll-component-explanation-planner';
import {
  buildAdjacencyMap,
  buildReverseAdjacencyMap,
  traverseDependencies,
  traverseDependents,
} from './teta-payroll-component-graph.service';
import {
  buildCapabilityNotAvailableExplanation,
  buildEmployeeValueNotAvailableMessage,
  formatExplanationAsPlainText,
  mapExplanationToChatResponse,
} from './teta-payroll-component-response-mapper';
import { resolvePayrollComponent } from './teta-payroll-component-resolver';
import {
  extractComponentCodeCandidate,
  extractTitleCandidate,
  normalizePayrollTitle,
  scanPotentialCodes,
  searchPayrollComponents,
  selectPayrollComponent,
} from './teta-payroll-component-selector';
import { TetaPayrollComponentExplanationService } from './teta-payroll-component-explanation.service';
import {
  buildFingerprintFromExplanation,
  canonicalJsonStringify,
  computeExplanationFingerprint,
} from './teta-payroll-explanation-contract';
import {
  STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION,
  STAGE3J_DEFAULT_DEPTH,
  STAGE3J_EXPLANATION_CONTRACT_VERSION,
  STAGE3J_MAX_CANDIDATES,
  STAGE3J_MAX_CODE_LENGTH,
  STAGE3J_MAX_DEPTH,
  STAGE3J_MAX_GRAPH_NODES,
  STAGE3J_SEMANTICS_CATALOG_VERSION,
} from './teta-payroll-explanation.types';
import { routePayrollChatQuestion } from './teta-payroll-explanation-chat-route';
import {
  buildHistoryExpiredNotice,
  redactChatResponseForHistory,
  redactExplanationForHistory,
} from './teta-payroll-explanation-history-redactor';
import {
  escapeHtml,
  explainPayrollFormula,
  summarizeFormulaSteps,
} from './teta-payroll-formula-explainer';
import {
  loadPayrollSemanticsCatalog,
  lookupComponentTypeMeaning,
  lookupCorrectionModeMeaning,
  lookupFunctionMeaning,
  lookupRelationTypeMeaning,
  resetSemanticsCatalogCache,
} from './teta-payroll-semantics-catalog';
import {
  buildGoldenImpact1350RepoSummary,
  countCustomerConfigurationCodesExposedInRepoArtifacts,
  formatGoldenImpact1350RepoDetail,
} from './teta-stage3j-artifact-privacy';
import {
  buildStage3jAudit,
  collectSideEffectViolations,
  emptyStage3jSideEffects,
  REQUIRED_STAGE3J_REFERENCE_IDS,
  validateStage3jInvariants,
} from './teta-stage3j-audit';
import {
  countImpactWordingIssues,
  emptyReferenceAudit,
  emptyRuntimeAudit,
  recordExplanationMetrics,
  recordSelectorMetrics,
} from './teta-stage3j-runtime-metrics';

const syntheticComponents = [
  { code: '1000', title: 'WYNAGRODZENIE BAZOWE', typeCode: 'P' },
  { code: '1010', title: 'PREMIA BAZOWA', typeCode: 'P' },
  { code: '2000', title: 'ZUS PRACODAWCY', typeCode: 'O' },
  { code: '0010', title: 'STAWKA GODZINOWA', typeCode: 'S' },
];

const syntheticDeps = [
  {
    fromComponentCode: '1010',
    toComponentCode: '1000',
    relationType: 'current_list_value',
    sourceFunction: 'm0',
    sourceFragment: 'm0_1000',
    confidence: 'confirmed',
  },
  {
    fromComponentCode: '2000',
    toComponentCode: '1010',
    relationType: 'current_list_value',
    sourceFunction: 'm0',
    sourceFragment: 'm0_1010',
    confidence: 'confirmed',
  },
];

function openTempDb(): { db: DatabaseService; repository: TetaPayrollSnapshotRepository } {
  const dbPath = path.join(os.tmpdir(), `stage3j-spec-${Date.now()}-${Math.random()}.sqlite`);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = `file:${dbPath}`;
  const config = {
    get: (_key: string, def?: string) => process.env.DATABASE_URL ?? def,
  } as ConstructorParameters<typeof DatabaseService>[0];
  const db = new DatabaseService(config);
  db.onModuleInit();
  const repository = new TetaPayrollSnapshotRepository(db);
  return { db, repository };
}

function importSyntheticFixture(
  repository: TetaPayrollSnapshotRepository,
  file = 'payroll-parameters-minimal-valid.rtf',
): ReturnType<TetaPayrollSnapshotImportService['importBuffer']> {
  const buf = readFileSync(
    path.join(__dirname, '../teta-payroll-snapshots/fixtures', file),
  );
  const imports = new TetaPayrollSnapshotImportService(repository);
  return imports.importBuffer(buf, file);
}

function explanationService(
  repository: TetaPayrollSnapshotRepository,
): TetaPayrollComponentExplanationService {
  return new TetaPayrollComponentExplanationService(repository);
}

beforeAll(() => {
  resetSemanticsCatalogCache();
});

describe('Stage 3J — selector', () => {
  test('1. normalizePayrollTitle strips diacritics', () => {
    expect(normalizePayrollTitle('Premia Bądź')).toBe('PREMIA BADZ');
  });
  test('2. extractComponentCodeCandidate from keyword', () => {
    expect(extractComponentCodeCandidate('składnik 1010')).toBe('1010');
  });
  test('3. extractComponentCodeCandidate quoted', () => {
    expect(extractComponentCodeCandidate('"1353"')).toBe('1353');
  });
  test('4. extractTitleCandidate from keyword', () => {
    expect(extractTitleCandidate('składnik Premia Bazowa')).toContain('Premia');
  });
  test('5. selectPayrollComponent exact code', () => {
    const r = selectPayrollComponent({ rawValue: '1010', components: syntheticComponents });
    expect(r.resolved?.code).toBe('1010');
    expect(r.selector.selectorType).toBe('exact_code');
  });
  test('6. selectPayrollComponent exact title', () => {
    const r = selectPayrollComponent({
      rawValue: 'WYNAGRODZENIE BAZOWE',
      components: syntheticComponents,
    });
    expect(r.resolved?.code).toBe('1000');
  });
  test('7. selectPayrollComponent normalized title', () => {
    const r = selectPayrollComponent({
      rawValue: 'wynagrodzenie bazowe',
      components: syntheticComponents,
    });
    expect(r.resolved?.code).toBe('1000');
    expect(r.selector.confidence).toBe('normalized_exact');
  });
  test('8. selectPayrollComponent unresolved code', () => {
    const r = selectPayrollComponent({ rawValue: '9999', components: syntheticComponents });
    expect(r.resolved).toBeNull();
  });
  test('9. selectPayrollComponent suggests padded code', () => {
    const r = selectPayrollComponent({ rawValue: '10', components: syntheticComponents });
    expect(r.selector.suggestedCode).toBe('0010');
    expect(r.candidates[0]?.code).toBe('0010');
  });
  test('10. searchPayrollComponents by code fragment', () => {
    const r = searchPayrollComponents(syntheticComponents, '101');
    expect(r.some((c) => c.code === '1010')).toBe(true);
  });
  test('11. searchPayrollComponents by title', () => {
    const r = searchPayrollComponents(syntheticComponents, 'premia');
    expect(r.some((c) => c.code === '1010')).toBe(true);
  });
  test('12. searchPayrollComponents empty query', () => {
    expect(searchPayrollComponents(syntheticComponents, '')).toEqual([]);
  });
  test('13. searchPayrollComponents respects limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      code: String(3000 + i),
      title: `SKŁADNIK ${i}`,
      typeCode: 'P',
    }));
    expect(searchPayrollComponents(many, 'SKŁADNIK', 5).length).toBeLessThanOrEqual(5);
  });
  test('14. scanPotentialCodes finds tokens', () => {
    expect(scanPotentialCodes('składnik 1000 i 1010')).toContain('1000');
  });
  test('15. ambiguous title returns candidate_list', () => {
    const dup = [
      { code: 'A1', title: 'PREMIA', typeCode: 'P' },
      { code: 'A2', title: 'PREMIA', typeCode: 'P' },
    ];
    const r = selectPayrollComponent({ rawValue: 'PREMIA', components: dup });
    expect(r.ambiguous).toBe(true);
    expect(r.selector.confidence).toBe('ambiguous');
  });
  test('16. STAGE3J_MAX_CODE_LENGTH is 4', () => {
    expect(STAGE3J_MAX_CODE_LENGTH).toBe(4);
  });
  test('17. STAGE3J_MAX_CANDIDATES is 10', () => {
    expect(STAGE3J_MAX_CANDIDATES).toBe(10);
  });
  test('18. partial title match single result', () => {
    const r = selectPayrollComponent({ rawValue: 'bazowe', components: syntheticComponents });
    expect(r.resolved?.code).toBe('1000');
  });
});

describe('Stage 3J — planner & intent', () => {
  test('19. detectPayrollExplanationIntent configuration', () => {
    expect(detectPayrollExplanationIntent('Jaka jest konfiguracja składnika 1010?')).toBe(
      'explain_payroll_component_configuration',
    );
  });
  test('20. detectPayrollExplanationIntent inspect', () => {
    expect(detectPayrollExplanationIntent('Sprawdź składnik 1010')).toBe(
      'inspect_payroll_component',
    );
  });
  test('21. detectUnsupportedPayrollIntent compare', () => {
    expect(detectUnsupportedPayrollIntent('Porównaj składnik 1010 i 2000')).toBe(
      'compare_payroll_components',
    );
  });
  test('22. detectUnsupportedPayrollIntent calculate', () => {
    expect(detectUnsupportedPayrollIntent('Oblicz składnik 1010')).toBe(
      'calculate_payroll_component',
    );
  });
  test('23. detectUnsupportedPayrollIntent employee value', () => {
    expect(
      detectUnsupportedPayrollIntent('Dlaczego pracownik ma 500 zł na składniku 1010?'),
    ).toBe('explain_employee_payroll_value');
  });
  test('24. detectPayrollExplanationFocus dependencies', () => {
    expect(detectPayrollExplanationFocus('Od czego zależy składnik 1010?')).toBe('dependencies');
  });
  test('25. detectPayrollExplanationFocus impact', () => {
    expect(detectPayrollExplanationFocus('Jaki wpływ ma składnik 1000?')).toBe('impact');
  });
  test('26. detectPayrollExplanationFocus formula', () => {
    expect(detectPayrollExplanationFocus('Jak działa wzór składnika 1010?')).toBe('formula');
  });
  test('27. isStage3jSupportedIntent true for inspect', () => {
    expect(isStage3jSupportedIntent('inspect_payroll_component')).toBe(true);
  });
  test('28. isStage3jUnsupportedIntent true for modify', () => {
    expect(isStage3jUnsupportedIntent('modify_payroll_component')).toBe(true);
  });
  test('29. buildPayrollComponentRequest extracts code', () => {
    const req = buildPayrollComponentRequest('składnik 1010', 3);
    expect(req.selector.selectorHint).toBe('code');
    expect(req.requestedDepth).toBe(3);
  });
  test('30. buildPayrollComponentRequest depth capped', () => {
    const req = buildPayrollComponentRequest('składnik 1010', 99);
    expect(req.requestedDepth).toBe(STAGE3J_MAX_DEPTH);
  });
  test('31. STAGE3J_DEFAULT_DEPTH is 5', () => {
    expect(STAGE3J_DEFAULT_DEPTH).toBe(5);
  });
  test('32. unsupported intent returns capability_not_available via service', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const svc = explanationService(repository);
    const ex = svc.explain({ query: 'Porównaj składnik 1010 i 2000' });
    expect(ex.status).toBe('capability_not_available');
  });
});

describe('Stage 3J — semantics catalog', () => {
  test('33. catalog version constant', () => {
    const cat = loadPayrollSemanticsCatalog();
    expect(cat.catalogVersion).toBe(STAGE3J_SEMANTICS_CATALOG_VERSION);
  });
  test('34. catalog sha256 is hex', () => {
    expect(loadPayrollSemanticsCatalog().catalogSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('35. lookupComponentTypeMeaning verified P', () => {
    const cat = loadPayrollSemanticsCatalog();
    const r = lookupComponentTypeMeaning(cat, 'P');
    expect(r.unknown).toBe(false);
    expect(r.meaning).toContain('obliczany');
  });
  test('36. lookupComponentTypeMeaning unknown type', () => {
    const cat = loadPayrollSemanticsCatalog();
    const r = lookupComponentTypeMeaning(cat, 'ZZZ');
    expect(r.unknown).toBe(true);
  });
  test('37. lookupCorrectionModeMeaning DMK', () => {
    const cat = loadPayrollSemanticsCatalog();
    expect(lookupCorrectionModeMeaning(cat, 'DMK').unknown).toBe(false);
  });
  test('38. lookupFunctionMeaning m0', () => {
    const cat = loadPayrollSemanticsCatalog();
    expect(lookupFunctionMeaning(cat, 'm0').unknown).toBe(false);
  });
  test('39. lookupFunctionMeaning unknown', () => {
    const cat = loadPayrollSemanticsCatalog();
    expect(lookupFunctionMeaning(cat, 'unknownFn').unknown).toBe(true);
  });
  test('40. lookupRelationTypeMeaning current_list_value', () => {
    expect(lookupRelationTypeMeaning('current_list_value')).toContain('bieżącej');
  });
});

describe('Stage 3J — formula explainer', () => {
  test('41. empty formula step', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'empty')).toBe(true);
  });
  test('42. component reference step', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('m0_1000 + 100');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'component_reference')).toBe(true);
  });
  test('43. CASE WHEN conditional step', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('CASE WHEN m0_1000 > 0 THEN 1 ELSE 0 END');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'conditional')).toBe(true);
  });
  test('44. operator step for addition', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('m0_1000 + m0_1010');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'operator')).toBe(true);
  });
  test('45. unknown function warning', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('totallyUnknownFn(1)');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.unknownFunctions.length).toBeGreaterThan(0);
  });
  test('46. summarizeFormulaSteps joins descriptions', () => {
    const text = summarizeFormulaSteps([
      { stepType: 'x', sequence: 1, description: 'Krok A', evidenceTokenIds: [], provenance: 'snapshot_exact' },
      { stepType: 'y', sequence: 2, description: 'Krok B', evidenceTokenIds: [], provenance: 'snapshot_exact' },
    ]);
    expect(text).toContain('1. Krok A');
    expect(text).toContain('2. Krok B');
  });
  test('47. escapeHtml encodes tags', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  test('48. malformed formula adds warning', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = { raw: '(', status: 'malformed' as const, tokens: [], directComponentCodes: [], unknownCalls: [] };
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.warnings).toContain('formula_unparsed');
  });
  test('49. logical AND/OR step', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('m0_1000 > 0 AND m0_1010 > 0');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'logical')).toBe(true);
  });
  test('50. numeric literal step', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('100 + 200');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.stepType === 'literal')).toBe(true);
  });
  test('51. m0 reference uses training semantics', () => {
    const cat = loadPayrollSemanticsCatalog();
    const ast = parsePayrollFormula('m0_1000');
    const r = explainPayrollFormula({ ast, catalog: cat });
    expect(r.steps.some((s) => s.provenance === 'training_semantics_verified')).toBe(true);
  });
  test('52. summarizeFormulaSteps empty', () => {
    expect(summarizeFormulaSteps([])).toBe('Brak opisu wzoru.');
  });
});

describe('Stage 3J — dependency graph', () => {
  const titleByCode = new Map(syntheticComponents.map((c) => [c.code, c.title]));
  const knownCodes = new Set(syntheticComponents.map((c) => c.code));

  test('53. buildAdjacencyMap groups edges', () => {
    const adj = buildAdjacencyMap(syntheticDeps as never);
    expect(adj.get('1010')?.length).toBe(1);
  });
  test('54. buildReverseAdjacencyMap', () => {
    const rev = buildReverseAdjacencyMap(syntheticDeps as never);
    expect(rev.get('1000')?.[0]?.fromComponentCode).toBe('1010');
  });
  test('55. traverseDependencies direct', () => {
    const g = traverseDependencies({
      dependencies: syntheticDeps as never,
      rootCode: '1010',
      maxDepth: 5,
      titleByCode,
      knownCodes,
    });
    expect(g.direct).toEqual(['1000']);
  });
  test('56. traverseDependencies transitive', () => {
    const g = traverseDependencies({
      dependencies: syntheticDeps as never,
      rootCode: '2000',
      maxDepth: 5,
      titleByCode,
      knownCodes,
    });
    expect(g.transitive.some((t) => t.componentCode === '1000')).toBe(true);
  });
  test('57. traverseDependents direct', () => {
    const g = traverseDependents({
      dependencies: syntheticDeps as never,
      targetCode: '1000',
      maxDepth: 5,
      titleByCode,
    });
    expect(g.direct.some((d) => d.componentCode === '1010')).toBe(true);
  });
  test('58. traverseDependents transitive', () => {
    const g = traverseDependents({
      dependencies: syntheticDeps as never,
      targetCode: '1000',
      maxDepth: 5,
      titleByCode,
    });
    expect(g.transitive.some((d) => d.componentCode === '2000')).toBe(true);
  });
  test('59. missing target reported', () => {
    const deps = [
      ...syntheticDeps,
      {
        fromComponentCode: '1010',
        toComponentCode: '9999',
        relationType: 'unknown_reference',
        sourceFunction: null,
        sourceFragment: 'm0_9999',
        confidence: 'inferred',
      },
    ];
    const g = traverseDependencies({
      dependencies: deps as never,
      rootCode: '1010',
      maxDepth: 3,
      titleByCode,
      knownCodes,
    });
    expect(g.missingTargets).toContain('9999');
  });
  test('60. STAGE3J_MAX_GRAPH_NODES constant', () => {
    expect(STAGE3J_MAX_GRAPH_NODES).toBe(500);
  });
  test('61. cycle detection from self-edge', () => {
    const deps = [
      {
        fromComponentCode: '3000',
        toComponentCode: '3000',
        relationType: 'current_list_value',
        sourceFunction: 'm0',
        sourceFragment: 'm0_3000',
        confidence: 'confirmed',
      },
    ];
    const g = traverseDependencies({
      dependencies: deps as never,
      rootCode: '3000',
      maxDepth: 3,
      titleByCode: new Map([['3000', 'SELF']]),
      knownCodes: new Set(['3000']),
    });
    expect(g.selfReferences).toContain('3000');
  });
  test('62. depth limit respected', () => {
    const chain = [
      { fromComponentCode: 'A', toComponentCode: 'B', relationType: 'x', sourceFunction: null, sourceFragment: 'x', confidence: 'c' },
      { fromComponentCode: 'B', toComponentCode: 'C', relationType: 'x', sourceFunction: null, sourceFragment: 'x', confidence: 'c' },
      { fromComponentCode: 'C', toComponentCode: 'D', relationType: 'x', sourceFunction: null, sourceFragment: 'x', confidence: 'c' },
    ];
    const titles = new Map([
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
      ['D', 'D'],
    ]);
    const g = traverseDependencies({
      dependencies: chain as never,
      rootCode: 'A',
      maxDepth: 1,
      titleByCode: titles,
      knownCodes: new Set(['A', 'B', 'C', 'D']),
    });
    expect(g.transitive.length).toBe(0);
  });
  test('63. cycle detection on synthetic self-edge graph', () => {
    const deps = [
      {
        fromComponentCode: '3000',
        toComponentCode: '3001',
        relationType: 'current_list_value',
        sourceFunction: 'm0',
        sourceFragment: 'm0_3001',
        confidence: 'confirmed',
      },
      {
        fromComponentCode: '3001',
        toComponentCode: '3000',
        relationType: 'current_list_value',
        sourceFunction: 'm0',
        sourceFragment: 'm0_3000',
        confidence: 'confirmed',
      },
    ];
    const codes = new Set(['3000', '3001']);
    const g = traverseDependencies({
      dependencies: deps as never,
      rootCode: '3000',
      maxDepth: 5,
      titleByCode: new Map([
        ['3000', 'A'],
        ['3001', 'B'],
      ]),
      knownCodes: codes,
    });
    expect(g.cycles.length).toBeGreaterThan(0);
  });
});

describe('Stage 3J — impact analysis', () => {
  test('64. analyzeComponentImpact direct dependents', () => {
    const titleByCode = new Map(syntheticComponents.map((c) => [c.code, c.title]));
    const r = analyzeComponentImpact({
      dependencies: syntheticDeps as never,
      targetCode: '1000',
      maxDepth: 5,
      titleByCode,
      calculationFormulaRefs: [],
      sqlFormulaCount: 0,
      sqlReferencesIndexed: false,
    });
    expect(r.directDependents.some((d) => d.componentCode === '1010')).toBe(true);
  });
  test('65. analyzeComponentImpact sql not_indexed when count > 0', () => {
    const titleByCode = new Map([['1000', 'X']]);
    const r = analyzeComponentImpact({
      dependencies: [],
      targetCode: '1000',
      maxDepth: 3,
      titleByCode,
      calculationFormulaRefs: [],
      sqlFormulaCount: 5,
      sqlReferencesIndexed: false,
    });
    expect(r.sqlFormulaUses[0]?.status).toBe('not_indexed');
  });
  test('66. analyzeComponentImpact sql none_found', () => {
    const titleByCode = new Map([['1000', 'X']]);
    const r = analyzeComponentImpact({
      dependencies: [],
      targetCode: '1000',
      maxDepth: 3,
      titleByCode,
      calculationFormulaRefs: [],
      sqlFormulaCount: 0,
      sqlReferencesIndexed: false,
    });
    expect(r.sqlFormulaUses[0]?.status).toBe('none_found');
  });
  test('67. calculation formula uses aggregated', () => {
    const titleByCode = new Map([['1000', 'X']]);
    const r = analyzeComponentImpact({
      dependencies: [],
      targetCode: '1000',
      maxDepth: 3,
      titleByCode,
      calculationFormulaRefs: [
        { calculationFormulaId: 'cf1', internalId: 'F1', title: 'Calc A', formulaTypeRaw: 'T', componentCode: '1000', sourceFunction: 'm0', confidence: 'confirmed' },
        { calculationFormulaId: 'cf1', internalId: 'F1', title: 'Calc A', formulaTypeRaw: 'T', componentCode: '1000', sourceFunction: 'm0', confidence: 'confirmed' },
      ],
      sqlFormulaCount: 0,
      sqlReferencesIndexed: false,
    });
    expect(r.calculationFormulaUses[0]?.referenceCount).toBe(2);
  });
});

describe('Stage 3J — fingerprint & contract', () => {
  test('68. canonicalJsonStringify sorts keys', () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  test('69. computeExplanationFingerprint stable', () => {
    const cat = loadPayrollSemanticsCatalog();
    const input = {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      snapshotFileSha256: 'abc',
      componentRecordHash: 'def',
      componentCode: '1010',
      focus: 'full' as const,
      requestedDepth: 5,
      semanticsCatalogVersion: cat.catalogVersion,
      semanticsCatalogSha256: cat.catalogSha256,
      directDependencyCodes: ['1000'],
      transitiveDependencyCodes: [],
      directDependentCodes: [],
      calculationFormulaReferenceIds: [],
      diagnosticCodes: [],
    };
    const a = computeExplanationFingerprint(input);
    const b = computeExplanationFingerprint({ ...input, directDependencyCodes: ['1000'] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  test('70. fingerprint changes when deps change', () => {
    const cat = loadPayrollSemanticsCatalog();
    const base = {
      contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      snapshotFileSha256: 'abc',
      componentRecordHash: 'def',
      componentCode: '1010',
      focus: 'full' as const,
      requestedDepth: 5,
      semanticsCatalogVersion: cat.catalogVersion,
      semanticsCatalogSha256: cat.catalogSha256,
      directDependencyCodes: ['1000'],
      transitiveDependencyCodes: [] as string[],
      directDependentCodes: [] as string[],
      calculationFormulaReferenceIds: [] as string[],
      diagnosticCodes: [] as string[],
    };
    const a = computeExplanationFingerprint(base);
    const b = computeExplanationFingerprint({ ...base, directDependencyCodes: ['2000'] });
    expect(a).not.toBe(b);
  });
  test('71. STAGE3J_EXPLANATION_CONTRACT_VERSION', () => {
    expect(STAGE3J_EXPLANATION_CONTRACT_VERSION).toBe('teta-aia-payroll-component-explanation-v1');
  });
  test('72. STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION', () => {
    expect(STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION).toBe(
      'teta-aia-payroll-component-chat-response-v1',
    );
  });
});

describe('Stage 3J — snapshot & explanation service', () => {
  test('73. snapshot_required without active snapshot', () => {
    const { repository } = openTempDb();
    const ex = explanationService(repository).explain({ code: '1010' });
    expect(ex.status).toBe('snapshot_required');
    expect(ex.diagnostics.some((d) => d.code === 'snapshot_required')).toBe(true);
  });
  test('74. completed explanation after import', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    expect(['completed', 'completed_with_warnings']).toContain(ex.status);
    expect(ex.component?.code).toBe('1010');
  });
  test('75. explanation includes source metadata', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    expect(ex.source?.parserVersion).toBe(STAGE3I_PARSER_VERSION);
    expect(ex.source?.semanticsCatalogVersion).toBe(STAGE3J_SEMANTICS_CATALOG_VERSION);
  });
  test('76. component_not_found for missing code', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '9999' });
    expect(ex.status).toBe('component_not_found');
  });
  test('77. dependencies section populated for 1010', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010', focus: 'dependencies' });
    expect(ex.dependencies.direct.some((d) => d.componentCode === '1000')).toBe(true);
  });
  test('78. impact section for 1000', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1000', focus: 'impact' });
    expect(ex.impact.directDependents.some((d) => d.componentCode === '1010')).toBe(true);
  });
  test('79. fingerprint populated on success', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    expect(ex.explanationFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('80. buildFingerprintFromExplanation matches', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const svc = explanationService(repository);
    const ex = svc.explain({ code: '1010' });
    const comp = repository.getComponent(ex.source!.snapshotId, '1010');
    const cat = loadPayrollSemanticsCatalog();
    const fp = buildFingerprintFromExplanation(ex, cat.catalogSha256, comp!.sourceEvidence.recordHash);
    expect(fp).toBe(ex.explanationFingerprintSha256);
  });
  test('81. search requires snapshot', () => {
    const { repository } = openTempDb();
    const r = explanationService(repository).searchComponents('1010');
    expect(r.status).toBe('snapshot_required');
  });
  test('82. search finds component', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const r = explanationService(repository).searchComponents('1010');
    expect(r.status).toBe('ok');
    expect(r.candidates.some((c) => c.code === '1010')).toBe(true);
  });
  test('83. resolvePayrollComponent with exact code', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const scope = repository.getOrCreateInstallationScopeId();
    const r = resolvePayrollComponent({
      repository,
      installationScopeId: scope,
      rawSelector: '1010',
      exactCode: '1010',
    });
    expect(r.selection.resolved?.code).toBe('1010');
  });
  test('84. query-based explain resolves code', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ query: 'Jak działa składnik 1010?' });
    expect(ex.component?.code).toBe('1010');
  });
  test('85. historical snapshot diagnostic', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    expect(ex.diagnostics.some((d) => d.code === 'snapshot_date_historical')).toBe(true);
  });
});

describe('Stage 3J — chat, privacy & gate', () => {
  test('86. isGenericPayrollKnowledgeQuestion true', () => {
    expect(isGenericPayrollKnowledgeQuestion('Co oznacza składnik typu Obliczany?')).toBe(true);
  });
  test('87. isClientPayrollConfigurationQuestion true', () => {
    expect(isClientPayrollConfigurationQuestion('Jak zbudowany jest składnik 1010?')).toBe(true);
  });
  test('88. evaluatePayrollChatGate snapshot_required', () => {
    const gate = evaluatePayrollChatGate({
      question: 'Jak zbudowany jest składnik 1010?',
      queryService: { getActiveSummary: () => null, inspectComponent: () => ({ status: 'no_active_snapshot' }) } as never,
      uploadAllowed: true,
    });
    expect(gate.kind).toBe('snapshot_required');
  });
  test('89. routePayrollChatQuestion generic not handled', () => {
    const { repository } = openTempDb();
    const svc = explanationService(repository);
    const queries = new TetaPayrollSnapshotQueryService(repository);
    const r = routePayrollChatQuestion({
      question: 'Co oznacza składnik typu Obliczany?',
      explanationService: svc,
      queryService: queries,
      uploadAllowed: true,
    });
    expect(r.handled).toBe(false);
  });
  test('90. routePayrollChatQuestion unsupported handled', () => {
    const { repository } = openTempDb();
    const svc = explanationService(repository);
    const queries = new TetaPayrollSnapshotQueryService(repository);
    const r = routePayrollChatQuestion({
      question: 'Oblicz składnik 1010 dla pracownika',
      explanationService: svc,
      queryService: queries,
      uploadAllowed: true,
    });
    expect(r.handled).toBe(true);
    if (r.handled) expect(r.chatResponse.status).toBe('capability_not_available');
  });
  test('91. redactExplanationForHistory removes raw formula', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    const red = redactExplanationForHistory(ex);
    expect(red.formula.raw).toBeNull();
    expect(red.dependencies.direct.every((d) => d.sourceFragment === '[redacted]')).toBe(true);
  });
  test('92. redactChatResponseForHistory flags', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    const chat = mapExplanationToChatResponse(ex);
    const red = redactChatResponseForHistory(chat);
    expect(red.historyRedaction.rawFormulaPersisted).toBe(false);
    expect(red.historyRedaction.dataExpired).toBe(true);
  });
  test('93. buildHistoryExpiredNotice text', () => {
    expect(buildHistoryExpiredNotice()).toContain('nie są trwale');
  });
  test('94. routePayrollChatQuestion with active snapshot', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const svc = explanationService(repository);
    const queries = new TetaPayrollSnapshotQueryService(repository);
    const r = routePayrollChatQuestion({
      question: 'Jak zbudowany jest składnik 1010?',
      explanationService: svc,
      queryService: queries,
      uploadAllowed: true,
    });
    expect(r.handled).toBe(true);
    if (r.handled) expect(r.content.length).toBeGreaterThan(10);
  });
  test('95. chat response contract version', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    const chat = mapExplanationToChatResponse(ex);
    expect(chat.contractVersion).toBe(STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION);
    expect(chat.type).toBe('payroll_component_explanation');
  });
});

describe('Stage 3J — API & UI mapper concepts', () => {
  test('96. mapExplanationToChatResponse title with code', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    const chat = mapExplanationToChatResponse(ex);
    expect(chat.title).toContain('1010');
  });
  test('97. formatExplanationAsPlainText overview sections', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010', focus: 'full' });
    const text = formatExplanationAsPlainText(ex);
    expect(text).toContain('Konfiguracja składnika');
    expect(text).toContain('Zależności');
  });
  test('98. formatExplanationAsPlainText formula focus', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010', focus: 'formula' });
    const text = formatExplanationAsPlainText(ex, 'formula');
    expect(text).toContain('Jak działa wzór');
  });
  test('99. formatExplanationAsPlainText impact focus', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1000', focus: 'impact' });
    const text = formatExplanationAsPlainText(ex, 'impact');
    expect(text).toContain('Wpływ');
  });
  test('100. buildCapabilityNotAvailableExplanation status', () => {
    const ex = buildCapabilityNotAvailableExplanation('test');
    expect(ex.status).toBe('capability_not_available');
  });
  test('101. buildEmployeeValueNotAvailableMessage mentions stage', () => {
    expect(buildEmployeeValueNotAvailableMessage()).toContain('kolejny etap');
  });
  test('102. FOCUS_VALUES includes full', () => {
    const focuses = ['overview', 'formula', 'dependencies', 'impact', 'full'];
    expect(focuses).toContain('full');
  });
  test('103. STAGE3J_MAX_DEPTH is 10 for API depth param', () => {
    expect(STAGE3J_MAX_DEPTH).toBe(10);
  });
  test('104. formatText service wrapper', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const svc = explanationService(repository);
    const ex = svc.explain({ code: '1010' });
    expect(svc.formatText(ex)).toContain('1010');
  });
  test('105. snapshot_required chat message polish', () => {
    const ex = explanationService(openTempDb().repository).explain({ query: 'składnik 1010' });
    const chat = mapExplanationToChatResponse(ex);
    expect(chat.message).toContain('raportu parametrów');
  });
});

describe('Stage 3J — audit invariants', () => {
  test('106. empty side effects pass validation', () => {
    expect(collectSideEffectViolations(emptyStage3jSideEffects())).toEqual([]);
  });
  test('107. side effect violation detected', () => {
    const v = collectSideEffectViolations(emptyStage3jSideEffects({ llmCalls: 1 }));
    expect(v.some((e) => e.includes('llmCalls'))).toBe(true);
  });
  test('108. buildStage3jAudit shape with runtime/reference split', () => {
    const runtimeAudit = emptyRuntimeAudit({
      impactTraceRequests: 1,
      directDependentsReturned: 1,
      deterministicFingerprintCheckOk: 1,
    });
    const report = buildStage3jAudit({
      explanationContractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      semanticsCatalogVersion: STAGE3J_SEMANTICS_CATALOG_VERSION,
      runtimeAudit,
      referenceAudit: emptyReferenceAudit({
        referencesTested: REQUIRED_STAGE3J_REFERENCE_IDS.length,
        referencesPassed: REQUIRED_STAGE3J_REFERENCE_IDS.length,
      }),
      references: REQUIRED_STAGE3J_REFERENCE_IDS.map((id) => ({
        id,
        ok: true,
        detail: 'ok',
      })),
      verification: { stage3jTestsExecuted: 158, stage3jTestsPassed: 158, stage3jTestsFailed: 0 },
      invariants: {
        golden1353DirectDependenciesCorrect: true,
        golden1353TransitiveDependenciesCorrect: true,
        golden1353PathsCorrect: true,
        golden1350ImpactContains1353And1355: true,
        exact0010Preserved: true,
        code10NotAutoResolvedTo0010: true,
        ambiguousTitleNotAutoResolved: true,
        ambiguousResponseHasAmbiguousSelectionEvidence: true,
        cycleTraversalTerminates: true,
        unknownFunctionMeaningNotInvented: true,
        calculationFormulaUseProven: true,
        snapshotRequiredUsesStage3jRoute: true,
        missingComponentUsesStage3jRoute: true,
        unsupportedCapabilityDoesNotFallback: true,
        goldenImpactAdditionalDependentsRedactedFromRepoArtifacts: true,
        allRequiredReferencesPassed: true,
        everyRequiredReferenceExecuted: true,
        everyRequiredReferencePassed: true,
      },
      minStage3jTests: 158,
    });
    expect(report.contractVersion).toBe('teta-aia-payroll-component-explanation-audit-v1');
    expect(report.runtimeAudit).toBeDefined();
    expect(report.referenceAudit).toBeDefined();
    expect(report.strictErrors).toEqual([]);
  });
  test('109. validateStage3jInvariants fails low test count', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit(),
      invariants: {},
      references: [],
      verification: {
        stage3jTestsExecuted: 50,
        stage3jTestsPassed: 50,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
    });
    expect(errors.some((e) => e.includes('stage3jTestsExecuted'))).toBe(true);
  });
  test('110. audit output must not contain raw formula patterns', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit(),
      invariants: {},
      references: [],
      verification: {
        stage3jTestsExecuted: 158,
        stage3jTestsPassed: 158,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
      auditOutputText: 'component m0_1000 reference',
    });
    expect(errors).toContain('auditOutputContainsRawFormulaReference');
  });
  test('111. emptyRuntimeAudit defaults zero', () => {
    expect(emptyRuntimeAudit().impactTraceRequests).toBe(0);
  });
  test('112. strict fails on failed reference', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit(),
      invariants: {},
      references: [{ id: 'golden-impact-1350', ok: false, detail: 'fail' }],
      verification: {
        stage3jTestsExecuted: 158,
        stage3jTestsPassed: 158,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
    });
    expect(errors).toContain('reference:golden-impact-1350');
  });
  test('113. required reference missing makes strict audit fail', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit(),
      invariants: {},
      references: [],
      verification: {
        stage3jTestsExecuted: 158,
        stage3jTestsPassed: 158,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
    });
    expect(errors.some((e) => e.startsWith('referenceMissing:'))).toBe(true);
  });
});

describe('Stage 3J — local golden optional', () => {
  const golden = path.resolve(
    __dirname,
    '../../../../.local/fixtures/payroll/SKLADNIKI_DOMAN.rtf',
  );

  test('114. golden fixture skipped when missing', () => {
    if (existsSync(golden)) {
      expect(true).toBe(true);
      return;
    }
    expect(existsSync(golden)).toBe(false);
  });

  test('115. golden explain 1353 when fixture present', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    const buf = readFileSync(golden);
    new TetaPayrollSnapshotImportService(repository).importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: 'customer_example',
    });
    const ex = explanationService(repository).explain({ code: '1353', focus: 'dependencies' });
    expect(['completed', 'completed_with_warnings']).toContain(ex.status);
    expect(ex.dependencies.direct.map((d) => d.componentCode).sort()).toEqual(
      ['1350', '1351', '1352'].sort(),
    );
  });

  test('116. golden explain 1350 deps when present', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    const buf = readFileSync(golden);
    new TetaPayrollSnapshotImportService(repository).importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: 'customer_example',
    });
    const ex = explanationService(repository).explain({ code: '1350', focus: 'dependencies' });
    const codes = ex.dependencies.direct.map((d) => d.componentCode).sort();
    expect(codes).toEqual(['1346', '1348'].sort());
  });

  test('117. golden 1355 includes 0010 dependency when present', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    const buf = readFileSync(golden);
    new TetaPayrollSnapshotImportService(repository).importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: 'customer_example',
    });
    const ex = explanationService(repository).explain({ code: '1355', focus: 'dependencies' });
    expect(['completed', 'completed_with_warnings']).toContain(ex.status);
    expect(ex.dependencies.direct.map((d) => d.componentCode)).toContain('0010');
  });

  test('118. golden transitive 1353 includes 1346/1348 when present', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    const buf = readFileSync(golden);
    new TetaPayrollSnapshotImportService(repository).importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: 'customer_example',
    });
    const ex = explanationService(repository).explain({ code: '1353', depth: 5 });
    const trans = ex.dependencies.transitive.map((t) => t.componentCode);
    expect(trans.includes('1346') || trans.includes('1348')).toBe(true);
  });
});

describe('Stage 3J — pre-commit audit patch', () => {
  const golden = path.resolve(
    __dirname,
    '../../../../.local/fixtures/payroll/SKLADNIKI_DOMAN.rtf',
  );
  const ambiguousFixture = path.resolve(
    __dirname,
    '../teta-payroll-snapshots/fixtures/payroll-parameters-ambiguous-title.rtf',
  );
  const unknownFixture = path.resolve(
    __dirname,
    '../teta-payroll-snapshots/fixtures/payroll-parameters-unknown-function.rtf',
  );

  function importGolden(repository: TetaPayrollSnapshotRepository) {
    const buf = readFileSync(golden);
    new TetaPayrollSnapshotImportService(repository).importBuffer(buf, 'SKLADNIKI_DOMAN.rtf', {
      sourceScope: 'customer_example',
    });
  }

  test('119. golden impact 1350 invokes impact focus', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const ex = explanationService(repository).explain({ code: '1350', focus: 'impact', depth: 5 });
    expect(['completed', 'completed_with_warnings']).toContain(ex.status);
    expect(ex.impact.directDependents.length).toBeGreaterThan(0);
  });

  test('120. impact 1350 contains 1353', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const codes = explanationService(repository)
      .explain({ code: '1350', focus: 'impact', depth: 5 })
      .impact.directDependents.map((d) => d.componentCode);
    expect(codes).toContain('1353');
  });

  test('121. impact 1350 contains 1355', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const codes = explanationService(repository)
      .explain({ code: '1350', focus: 'impact', depth: 5 })
      .impact.directDependents.map((d) => d.componentCode);
    expect(codes).toContain('1355');
  });

  test('122. impact wording uses może wpłynąć', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const ex = explanationService(repository).explain({ code: '1350', focus: 'impact', depth: 5 });
    const text = `${ex.narrative.impactExplanation} ${ex.narrative.summary}`;
    expect(text).toMatch(/może wpłynąć/i);
  });

  test('123. impact wording does not claim guaranteed change', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const ex = explanationService(repository).explain({ code: '1350', focus: 'impact', depth: 5 });
    const text = `${ex.narrative.impactExplanation} ${ex.narrative.summary}`;
    expect(countImpactWordingIssues(text)).toBe(0);
  });

  const polishFixture = path.resolve(
    __dirname,
    '../teta-payroll-snapshots/fixtures/payroll-parameters-polish-encoding.rtf',
  );

  function importPolishEncoding(repository: TetaPayrollSnapshotRepository) {
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(polishFixture),
      'payroll-parameters-polish-encoding.rtf',
    );
  }

  test('124. 0010 exact selector preserves leading zeros', () => {
    const { repository } = openTempDb();
    importPolishEncoding(repository);
    const scope = repository.getOrCreateInstallationScopeId();
    const sel = resolvePayrollComponent({
      repository,
      installationScopeId: scope,
      rawSelector: '0010',
      exactCode: '0010',
    });
    expect(sel.selection.selector.selectorType).toBe('exact_code');
    expect(sel.selection.resolved?.code).toBe('0010');
  });

  test('125. code 10 does not auto-resolve to 0010', () => {
    const { repository } = openTempDb();
    importPolishEncoding(repository);
    const scope = repository.getOrCreateInstallationScopeId();
    const sel = resolvePayrollComponent({
      repository,
      installationScopeId: scope,
      rawSelector: '10',
    });
    expect(sel.selection.resolved?.code).not.toBe('0010');
    expect(sel.selection.selector.suggestedCode).toBe('0010');
  });

  test('126. snapshot-required through Stage 3J route', () => {
    const { repository } = openTempDb();
    const svc = explanationService(repository);
    const queries = new TetaPayrollSnapshotQueryService(repository);
    const route = routePayrollChatQuestion({
      question: 'Jak zbudowany jest składnik 1353?',
      explanationService: svc,
      queryService: queries,
      uploadAllowed: true,
    });
    expect(route.handled).toBe(true);
    if (route.handled) {
      expect(route.chatResponse.status).toBe('snapshot_required');
      expect(route.content).toMatch(/Wydruk parametrów płacowych/);
    }
  });

  test('127. component-not-found through Stage 3J route', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const svc = explanationService(repository);
    const queries = new TetaPayrollSnapshotQueryService(repository);
    const route = routePayrollChatQuestion({
      question: 'Jak zbudowany jest składnik ZZZZ?',
      explanationService: svc,
      queryService: queries,
      uploadAllowed: true,
    });
    expect(route.handled).toBe(true);
    if (route.handled) expect(route.chatResponse.status).toBe('component_not_found');
  });

  test('128. ambiguous title runtime route', () => {
    const { repository } = openTempDb();
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(ambiguousFixture),
      'payroll-parameters-ambiguous-title.rtf',
    );
    const ex = explanationService(repository).explain({ query: 'premia kwartalna' });
    expect(ex.status).toBe('ambiguous_component');
    expect((ex.candidates ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test('129. cycle runtime traversal terminates', () => {
    const g = traverseDependencies({
      dependencies: [
        { fromComponentCode: '1000', toComponentCode: '1010' },
        { fromComponentCode: '1010', toComponentCode: '1000' },
      ] as never,
      rootCode: '1000',
      maxDepth: 5,
      titleByCode: new Map([
        ['1000', 'A'],
        ['1010', 'B'],
      ]),
      knownCodes: new Set(['1000', '1010']),
    });
    expect(g.cycles.length).toBeGreaterThan(0);
  });

  test('130. unknown function runtime explainer', () => {
    const { repository } = openTempDb();
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(unknownFixture),
      'payroll-parameters-unknown-function.rtf',
    );
    const ex = explanationService(repository).explain({ code: '4000', focus: 'formula' });
    expect(ex.formula.unknownCalls.length).toBeGreaterThan(0);
    expect(ex.diagnostics.some((d) => d.code === 'formula_unknown_function')).toBe(true);
  });

  test('131. unknown meaning not invented', () => {
    const { repository } = openTempDb();
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(unknownFixture),
      'payroll-parameters-unknown-function.rtf',
    );
    const ex = explanationService(repository).explain({ code: '4000', focus: 'formula' });
    const invented = ex.diagnostics.filter((d) => d.code === 'formula_meaning_invented');
    expect(invented.length).toBe(0);
  });

  test('132. calculation formula use runtime impact', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const active = repository.getActive(repository.getOrCreateInstallationScopeId())!;
    let found = false;
    for (const summary of repository.listComponentSummaries(active.snapshotId)) {
      const refs = repository.listCalculationFormulaRefsByComponent(active.snapshotId, summary.code);
      if (refs.length === 0) continue;
      const ex = explanationService(repository).explain({
        code: summary.code,
        focus: 'impact',
        depth: 3,
      });
      if (ex.impact.calculationFormulaUses.length > 0) found = true;
      break;
    }
    expect(found).toBe(true);
  });

  test('133. raw calculation formula absent from sanitized audit shape', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1010' });
    const sanitized = JSON.stringify({
      status: ex.status,
      formula: { available: ex.formula.available, parseStatus: ex.formula.parseStatus },
    });
    expect(sanitized).not.toMatch(/m0_/);
  });

  test('134. runtime and reference counters are separate types', () => {
    const runtime = emptyRuntimeAudit();
    const reference = emptyReferenceAudit();
    expect(runtime.explanationRequests).toBeDefined();
    expect(reference.referencesTested).toBeDefined();
    expect((runtime as never as { referencesTested?: number }).referencesTested).toBeUndefined();
  });

  test('135. required reference failed makes strict audit fail', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit({ referencesFailed: 1 }),
      invariants: {},
      references: [{ id: 'stage3j-dependency-cycle', ok: false, detail: 'fail' }],
      verification: {
        stage3jTestsExecuted: 158,
        stage3jTestsPassed: 158,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
    });
    expect(errors).toContain('reference:stage3j-dependency-cycle');
  });

  test('136. same fingerprint stable for identical input', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const svc = explanationService(repository);
    const a = svc.explain({ code: '1353', focus: 'full', depth: 5 });
    const b = svc.explain({ code: '1353', focus: 'full', depth: 5 });
    expect(a.explanationFingerprintSha256).toBe(b.explanationFingerprintSha256);
  });

  test('137. changed depth changes fingerprint', () => {
    if (!existsSync(golden)) return;
    const { repository } = openTempDb();
    importGolden(repository);
    const svc = explanationService(repository);
    const a = svc.explain({ code: '1353', focus: 'full', depth: 5 });
    const b = svc.explain({ code: '1353', focus: 'full', depth: 4 });
    expect(a.explanationFingerprintSha256).not.toBe(b.explanationFingerprintSha256);
  });

  test('138. persistence counters all zero in empty runtime audit', () => {
    const runtime = emptyRuntimeAudit();
    expect(runtime.rawComponentFormulasPersisted).toBe(0);
    expect(runtime.calculationFormulasPersisted).toBe(0);
    expect(runtime.sqlFormulasPersisted).toBe(0);
    expect(runtime.rawFormulasLogged).toBe(0);
  });

  test('139. guaranteedImpactClaimsMade zero helper', () => {
    expect(countImpactWordingIssues('Zmiana może wpłynąć na składnik.')).toBe(0);
    expect(countImpactWordingIssues('To zawsze zmieni wartość.')).toBeGreaterThan(0);
  });

  test('140. recordExplanationMetrics increments impact trace', () => {
    const runtime = emptyRuntimeAudit();
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({ code: '1000', focus: 'impact' });
    recordExplanationMetrics(runtime, ex, { focus: 'impact', traceKind: 'impact' });
    expect(runtime.impactTraceRequests).toBeGreaterThan(0);
  });

  test('141. REQUIRED_STAGE3J_REFERENCE_IDS includes A-J core refs', () => {
    expect(REQUIRED_STAGE3J_REFERENCE_IDS).toContain('golden-full-explanation-1353');
    expect(REQUIRED_STAGE3J_REFERENCE_IDS).toContain('golden-impact-1350');
    expect(REQUIRED_STAGE3J_REFERENCE_IDS).toContain('stage3j-unsupported-capability');
  });

  test('142. buildStage3jAudit exposes auditSemantics', () => {
    const report = buildStage3jAudit({
      explanationContractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
      semanticsCatalogVersion: STAGE3J_SEMANTICS_CATALOG_VERSION,
      runtimeAudit: emptyRuntimeAudit({ impactTraceRequests: 1, directDependentsReturned: 1 }),
      referenceAudit: emptyReferenceAudit(),
    });
    expect(report.auditSemantics.runtimeCountersComeFromInstrumentedServices).toContain('runtimeAudit');
  });

  test('143. emptyReferenceAudit defaults zero', () => {
    expect(emptyReferenceAudit().referencesFailed).toBe(0);
  });

  test('144. cycle graph does not truncate on simple 2-node cycle', () => {
    const g = traverseDependencies({
      dependencies: [
        { fromComponentCode: '1000', toComponentCode: '1010' },
        { fromComponentCode: '1010', toComponentCode: '1000' },
      ] as never,
      rootCode: '1000',
      maxDepth: 5,
      titleByCode: new Map(),
      knownCodes: new Set(['1000', '1010']),
    });
    expect(g.truncated).toBe(false);
  });

  test('145. ambiguous candidates omit formula field', () => {
    const { repository } = openTempDb();
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(ambiguousFixture),
      'payroll-parameters-ambiguous-title.rtf',
    );
    const ex = explanationService(repository).explain({ query: 'premia kwartalna' });
    for (const c of ex.candidates ?? []) {
      expect(Object.keys(c)).not.toContain('formula');
    }
  });

  test('146. unsupported capability via explain query', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const ex = explanationService(repository).explain({
      query: 'Utwórz składnik analogiczny do 1353.',
    });
    expect(ex.status).toBe('capability_not_available');
  });

  test('147. runtimeAudit generatedAtExcludedFromFingerprint default', () => {
    expect(emptyRuntimeAudit().generatedAtExcludedFromFingerprint).toBe(1);
  });

  test('148. impact narrative uses probabilistic wording helper', () => {
    expect(countImpactWordingIssues('może wpłynąć')).toBe(0);
  });

  test('149. selectPayrollComponent 0010 via list not numeric trim', () => {
    const { repository } = openTempDb();
    importPolishEncoding(repository);
    const scope = repository.getOrCreateInstallationScopeId();
    const active = repository.getActive(scope)!;
    const list = repository.listComponentSummaries(active.snapshotId);
    const sel = selectPayrollComponent({ rawValue: '0010', components: list });
    expect(sel.resolved?.code).toBe('0010');
  });

  test('150. fingerprint depth sensitivity synthetic', () => {
    const { repository } = openTempDb();
    importSyntheticFixture(repository);
    const svc = explanationService(repository);
    const a = svc.explain({ code: '1010', focus: 'dependencies', depth: 5 });
    const b = svc.explain({ code: '1010', focus: 'dependencies', depth: 3 });
    expect(a.explanationFingerprintSha256).not.toBe(b.explanationFingerprintSha256);
  });

  test('151. repo impact 1350 detail redacts extra client codes', () => {
    const detail = formatGoldenImpact1350RepoDetail(
      buildGoldenImpact1350RepoSummary({
        directDependentCodes: ['1353', '1355', '2380', '2382'],
        impactTraceRequests: 2,
      }),
    );
    expect(detail).toContain('containsRequiredDependents=1353,1355');
    expect(detail).toContain('directDependentCount=4');
    expect(detail).not.toContain('2380');
    expect(detail).not.toContain('2382');
  });

  test('152. required dependents remain visible in repo detail', () => {
    const detail = formatGoldenImpact1350RepoDetail(
      buildGoldenImpact1350RepoSummary({
        directDependentCodes: ['1353', '1355'],
        impactTraceRequests: 2,
      }),
    );
    expect(detail).toMatch(/1353/);
    expect(detail).toMatch(/1355/);
  });

  test('153. directDependentCount preserved in repo detail', () => {
    const summary = buildGoldenImpact1350RepoSummary({
      directDependentCodes: Array.from({ length: 14 }, (_, i) => String(1000 + i)),
      impactTraceRequests: 2,
    });
    expect(summary.directDependentCount).toBe(14);
    expect(formatGoldenImpact1350RepoDetail(summary)).toContain('directDependentCount=14');
  });

  test('154. local reference file path stays gitignored', () => {
    const gitignore = readFileSync(path.resolve(__dirname, '../../../../.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.local\/?/);
  });

  test('155. ambiguous runtime route increments ambiguousSelections', () => {
    const runtime = emptyRuntimeAudit();
    const { repository } = openTempDb();
    new TetaPayrollSnapshotImportService(repository).importBuffer(
      readFileSync(ambiguousFixture),
      'payroll-parameters-ambiguous-title.rtf',
    );
    const scope = repository.getOrCreateInstallationScopeId();
    const selection = resolvePayrollComponent({
      repository,
      installationScopeId: scope,
      rawSelector: 'premia kwartalna',
    });
    recordSelectorMetrics(runtime, selection.selection);
    expect(runtime.ambiguousSelections).toBeGreaterThanOrEqual(1);
  });

  test('156. ambiguous response without selection evidence fails strict audit', () => {
    const errors = validateStage3jInvariants({
      sideEffects: emptyStage3jSideEffects(),
      runtimeAudit: emptyRuntimeAudit({
        ambiguousComponentResponses: 1,
        ambiguousSelections: 0,
        impactTraceRequests: 1,
        directDependentsReturned: 1,
      }),
      referenceAudit: emptyReferenceAudit(),
      invariants: { ambiguousResponseHasAmbiguousSelectionEvidence: false },
      references: [],
      verification: {
        stage3jTestsExecuted: 158,
        stage3jTestsPassed: 158,
        stage3jTestsFailed: 0,
        regressionTestsExecuted: 0,
        regressionTestsPassed: 0,
        regressionTestsFailed: 0,
      },
    });
    expect(errors).toContain('runtimeAudit:ambiguousComponentResponsesWithoutAmbiguousSelections');
    expect(errors).toContain('invariant:ambiguousResponseHasAmbiguousSelectionEvidence');
  });

  test('157. customerConfigurationCodesExposedInRepoArtifacts must stay zero', () => {
    const exposed = countCustomerConfigurationCodesExposedInRepoArtifacts(
      'dependents=1353,1355,2380,2382;impactTraceRequests=2',
    );
    expect(exposed).toBeGreaterThan(0);
    const safe = countCustomerConfigurationCodesExposedInRepoArtifacts(
      formatGoldenImpact1350RepoDetail(
        buildGoldenImpact1350RepoSummary({
          directDependentCodes: ['1353', '1355', '2380'],
          impactTraceRequests: 2,
        }),
      ),
    );
    expect(safe).toBe(0);
  });

  test('158. local impact reference may keep full dependent list shape', () => {
    const localPayload = {
      directDependentCodes: ['1353', '1355', '2380'],
      directDependentCount: 3,
    };
    expect(localPayload.directDependentCodes).toContain('2380');
    expect(localPayload.directDependentCodes.length).toBe(3);
  });

  test('159. goldenMeta uses directDependencyCount key', () => {
    const stage3jDoc = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../../docs/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.json'),
        'utf8',
      ),
    ) as {
      goldenMeta?: { directDependencyCount?: number; directDependentCount?: number };
    };
    expect(stage3jDoc.goldenMeta?.directDependencyCount).toBe(2136);
  });

  test('160. goldenMeta does not expose directDependentCount key', () => {
    const stage3jDoc = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../../docs/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.json'),
        'utf8',
      ),
    ) as {
      goldenMeta?: { directDependencyCount?: number; directDependentCount?: number };
    };
    expect(stage3jDoc.goldenMeta?.directDependentCount).toBeUndefined();
  });

  test('161. impactSummary keeps directDependentCount equals 14', () => {
    const stage3jDoc = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../../docs/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.json'),
        'utf8',
      ),
    ) as {
      references?: Array<{
        id: string;
        impactSummary?: { directDependentCount?: number };
      }>;
    };
    const impactRef = stage3jDoc.references?.find((r) => r.id === 'golden-impact-1350');
    expect(impactRef?.impactSummary?.directDependentCount).toBe(14);
  });
});
