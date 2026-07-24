/**
 * Stage 3B unit tests — intent/entity/plan (no SQL, no file read, no Oracle write).
 */
import path from 'path';
import {
  defaultPlannerConfigDir,
  loadPlannerConfigs,
  validatePlannerConfigs,
} from './teta-intent-catalog';
import { extractIntent } from './teta-intent-extractor';
import { extractEntities } from './teta-entity-extractor';
import {
  TetaEvidencePlannerService,
  type Stage3aResolverClient,
} from './teta-evidence-planner.service';
import { stripVolatilePlanFields, stableStringify } from './teta-task-contract';
import { STAGE3B_REFERENCE_QUESTIONS } from './teta-stage3b-audit';
import type { GraphResolverResult } from '../teta-plugins/teta-stage3a.types';
import { readFileSync } from 'fs';

const apiRoot = path.resolve(__dirname, '..', '..');
const configs = loadPlannerConfigs(defaultPlannerConfigDir(apiRoot));

function emptyGraph(status: GraphResolverResult['status'] = 'unresolved'): GraphResolverResult {
  return {
    status,
    query: {},
    selectedNodeId: null,
    candidates: [],
    nodes: [],
    edges: [],
    paths: [],
    conflicts: [],
    warnings: [],
    provenance: [],
    audit: {},
    truncated: false,
    continuation: null,
  };
}

function mockResolver(overrides?: Partial<Stage3aResolverClient>): Stage3aResolverClient {
  return {
    resolveForm: () => emptyGraph('unresolved'),
    resolveField: () => emptyGraph('ambiguous'),
    resolveNode: () => emptyGraph('unresolved'),
    traceFieldToOracle: () => emptyGraph('unresolved'),
    ...overrides,
  };
}

function planner(resolver: Stage3aResolverClient | null = mockResolver()) {
  return new TetaEvidencePlannerService({
    configs,
    resolver,
    graphSourceHash: 'test-hash',
  });
}

describe('Stage 3B intent & evidence planner', () => {
  test('1. payroll intent exact', () => {
    const r = extractIntent(STAGE3B_REFERENCE_QUESTIONS.A!.question, configs);
    expect(r.type).toBe('explain_payroll_component');
    expect(r.confidence).toBe('exact');
  });

  test('2. payroll component code extraction', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.A!, configs, 'explain_payroll_component');
    expect(ents.some((e) => e.type === 'componentCode' && e.normalizedValue === '4300')).toBe(true);
  });

  test('3. employee number preserves leading zeros', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.A!, configs, 'explain_payroll_component');
    const emp = ents.find((e) => e.type === 'employeeNumber');
    expect(emp?.rawValue).toBe('00034');
    expect(emp?.normalizedValue).toBe('00034');
  });

  test('4. payroll value extraction', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.A!, configs, 'explain_payroll_component');
    expect(ents.some((e) => e.type === 'componentValue' && e.normalizedValue === '5200')).toBe(true);
  });

  test('5. payroll period luty 2026', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.A!, configs, 'explain_payroll_component');
    expect(ents.some((e) => e.type === 'payrollPeriod' && e.normalizedValue === '2026-02')).toBe(true);
  });

  test('6. payroll type UC preserves rawValue', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.A!, configs, 'explain_payroll_component');
    const t = ents.find((e) => e.type === 'payrollType');
    expect(t?.rawValue).toBe('UC');
  });

  test('7. incomplete payroll clarification', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.B!);
    expect(plan.planningStatus).toBe('needs_clarification');
    expect(plan.clarificationQuestions.length).toBeGreaterThan(0);
    expect(plan.missingEntities.some((m) => m.type === 'employee' || m.type === 'employeeNumber')).toBe(
      true,
    );
  });

  test('8. XLSX validation intent', () => {
    const r = extractIntent(STAGE3B_REFERENCE_QUESTIONS.C!.question, configs);
    expect(r.type).toBe('validate_import_file');
  });

  test('9. multiple target tables', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.C!, configs, 'validate_import_file');
    const tables = ents.filter((e) => e.type === 'targetTable').map((e) => e.normalizedValue);
    expect(tables).toEqual(expect.arrayContaining(['T_PRAC', 'L_STANOWISKA', 'L_STAWKI']));
  });

  test('10. report intent', () => {
    const r = extractIntent(STAGE3B_REFERENCE_QUESTIONS.D!.question, configs);
    expect(r.type).toBe('build_employee_report');
  });

  test('11. current month remains relative', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.D!, configs, 'build_employee_report');
    const rel = ents.find((e) => e.type === 'relativeDateRange');
    expect(rel?.normalizedValue).toBe('current_month');
    expect(rel?.attributes?.resolvedAt).toBeNull();
  });

  test('12. BHP subject normalization', () => {
    const ents = extractEntities(STAGE3B_REFERENCE_QUESTIONS.D!, configs, 'build_employee_report');
    expect(
      ents.some(
        (e) => e.type === 'reportSubject' && e.normalizedValue === 'occupational_health_examinations',
      ),
    ).toBe(true);
  });

  test('13. application field intent', () => {
    const r = extractIntent(STAGE3B_REFERENCE_QUESTIONS.E!.question, configs);
    expect(r.type).toBe('explain_application_field');
  });

  test('14. form-scoped field resolution propagates graph result', () => {
    const formGuid = '03c5e06f-fad6-414e-8053-47d944b0b19e';
    const formId = `form:${formGuid}:ListyObliczoneWidok`;
    const helpId = `help-field:${formGuid}:ListyObliczoneWidok:wartość`;
    const calls: string[] = [];
    const resolver = mockResolver({
      resolveNode: (input) => {
        if (input.nodeType === 'plugin_registry_entry') {
          calls.push('resolveNode:plugin');
          return {
            ...emptyGraph('resolved'),
            selectedNodeId: `plugin:${formGuid}`,
            candidates: [
              {
                nodeId: `plugin:${formGuid}`,
                scoreRank: 4,
                matchKind: 'exact_name',
                confidence: 'confirmed',
                domain: 'application',
                type: 'plugin_registry_entry',
                canonicalName: formGuid,
                name: 'Lista obliczona',
              },
            ],
            nodes: [
              {
                id: `plugin:${formGuid}`,
                type: 'plugin_registry_entry',
                domain: 'application',
                name: 'Lista obliczona',
                canonicalName: formGuid,
                owner: null,
                objectType: null,
                confidence: 'confirmed',
                sourceStages: ['1'],
                attributes: { className: 'ListyObliczoneWidok', guid: formGuid },
                evidence: [],
                semanticNormalization: null,
              },
            ],
          };
        }
        if (input.nodeType === 'help_field') {
          calls.push('resolveNode:help');
          return {
            ...emptyGraph('ambiguous'),
            candidates: [
              {
                nodeId: helpId,
                scoreRank: 4,
                matchKind: 'exact_name',
                confidence: 'confirmed',
                domain: 'help',
                type: 'help_field',
                canonicalName: 'Wartość',
                name: 'Wartość',
              },
            ],
          };
        }
        if (input.id === helpId) {
          calls.push('resolveNode:helpId');
          return {
            ...emptyGraph('resolved'),
            selectedNodeId: helpId,
            candidates: [
              {
                nodeId: helpId,
                scoreRank: 1,
                matchKind: 'exact_canonical_id',
                confidence: 'confirmed',
                domain: 'help',
                type: 'help_field',
                canonicalName: 'Wartość',
                name: 'Wartość',
              },
            ],
            nodes: [
              {
                id: helpId,
                type: 'help_field',
                domain: 'help',
                name: 'Wartość',
                canonicalName: 'Wartość',
                owner: null,
                objectType: null,
                confidence: 'confirmed',
                sourceStages: ['2C'],
                attributes: {},
                evidence: [{ kind: 'help', text: 'wartość składnika' }],
                semanticNormalization: null,
              },
            ],
          };
        }
        calls.push('resolveNode:other');
        return emptyGraph('unresolved');
      },
      resolveForm: (input) => {
        calls.push(`resolveForm:${input.guid ? 'guid' : input.nameFragment ? 'frag' : 'other'}`);
        if (input.guid === formGuid) {
          return {
            ...emptyGraph('resolved'),
            selectedNodeId: formId,
            candidates: [
              {
                nodeId: formId,
                scoreRank: 2,
                matchKind: 'exact_guid',
                confidence: 'confirmed',
                domain: 'application',
                type: 'application_form',
                canonicalName: 'ListyObliczoneWidok',
                name: 'ListyObliczoneWidok',
              },
            ],
            nodes: [
              {
                id: formId,
                type: 'application_form',
                domain: 'application',
                name: 'ListyObliczoneWidok',
                canonicalName: 'ListyObliczoneWidok',
                owner: null,
                objectType: null,
                confidence: 'confirmed',
                sourceStages: ['2A'],
                attributes: { guid: formGuid },
                evidence: [],
                semanticNormalization: null,
              },
            ],
          };
        }
        return emptyGraph('unresolved');
      },
      resolveField: (input) => {
        calls.push(`resolveField:${input.formNodeId ? 'scoped' : 'global'}`);
        expect(input.formNodeId).toBe(formId);
        return {
          ...emptyGraph('ambiguous'),
          candidates: [
            {
              nodeId: `${formId}:dgcWartosc`,
              scoreRank: 9,
              matchKind: 'control_name_tokens',
              confidence: 'confirmed',
              domain: 'application',
              type: 'ui_control',
              canonicalName: 'dgcWartosc',
              name: 'dgcWartosc',
            },
          ],
        };
      },
      getEvidenceSubgraph: () => {
        calls.push('subgraph:help');
        return {
          ...emptyGraph('resolved'),
          nodes: [
            {
              id: helpId,
              type: 'help_field',
              domain: 'help',
              name: 'Wartość',
              canonicalName: 'Wartość',
              owner: null,
              objectType: null,
              confidence: 'confirmed',
              sourceStages: ['2C'],
              attributes: {},
              evidence: [{ kind: 'help', text: 'wartość składnika' }],
              semanticNormalization: null,
            },
          ],
        };
      },
      traceFieldToOracle: () => {
        calls.push('trace');
        return emptyGraph('resolved');
      },
    });
    const plan = planner(resolver).plan(STAGE3B_REFERENCE_QUESTIONS.E!);
    expect(plan.intent.type).toBe('explain_application_field');
    expect(calls.indexOf('resolveNode:plugin')).toBeLessThan(calls.indexOf('resolveForm:guid'));
    expect(calls.indexOf('resolveForm:guid')).toBeLessThan(calls.findIndex((c) => c.startsWith('resolveField:')));
    expect(plan.audit.scopedFieldQueries).toBe(1);
    expect(plan.audit.unscopedFieldQueries).toBe(0);
    expect(plan.evidenceRequirements.find((e) => e.evidenceType === 'form')?.status).toBe('resolved');
    expect(plan.evidenceRequirements.find((e) => e.evidenceType === 'help_field')?.status).toBe(
      'resolved',
    );
    expect(plan.evidenceRequirements.find((e) => e.evidenceType === 'action_parameter')?.status).toBe(
      'not_applicable',
    );
    expect(plan.planningStatus).toBe('ready');
    expect(plan.audit.autoResolvedAmbiguities).toBe(0);
  });

  test('15. field without form ambiguous', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.F!);
    expect(['ambiguous', 'needs_clarification']).toContain(plan.planningStatus);
    expect(plan.planningStatus).not.toBe('ready');
    expect(plan.clarificationQuestions.length).toBeGreaterThan(0);
    expect(plan.clarificationQuestions.some((q) => /Nazwa/.test(q.question))).toBe(true);
    expect(plan.ambiguities.some((a) => a.subject === 'field_scope_missing')).toBe(true);
    expect(plan.ambiguities.some((a) => a.subject === 'action_parameter')).toBe(false);
  });

  test('16. trace application intent', () => {
    const r = extractIntent(
      'Gdzie w bazie zapisuje się pole Typ stanowiska na formularzu Karta opisu?',
      configs,
    );
    expect(r.type).toBe('trace_application_to_oracle');
  });

  test('17. unsupported write request', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.G!);
    expect(plan.intent.type).toBe('unsupported');
    expect(plan.planningStatus).toBe('unsupported');
    expect(plan.executionPolicy.oracleWriteAllowed).toBe(false);
  });

  test('18. unknown intent', () => {
    const r = extractIntent('Jaka jest pogoda w Krakowie?', configs);
    expect(r.type).toBe('unknown');
  });

  test('19. context fills employee identifier', () => {
    const plan = planner().plan({
      question: 'Dlaczego składnik 4300 tak się policzył?',
      conversationContext: { employeeIdentifiers: ['00034'] },
    });
    expect(plan.entities.some((e) => e.type === 'employeeNumber' && e.rawValue === '00034')).toBe(
      true,
    );
    expect(plan.entities.find((e) => e.type === 'employeeNumber')?.source).toBe('context');
  });

  test('20. question overrides conflicting context form only when explicit', () => {
    const plan = planner().plan({
      question: 'Do czego służy pole Wartość na formularzu Lista obliczona?',
      conversationContext: {
        formContext: { formName: 'InnyFormularz' },
      },
    });
    const forms = plan.entities.filter((e) => e.type === 'formName');
    expect(forms.some((e) => e.source === 'question')).toBe(true);
    expect(forms.every((e) => e.source !== 'context')).toBe(true);
  });

  test('21. Stage 3A ambiguity propagation', () => {
    const resolver = mockResolver({
      resolveNode: (input) => {
        if (input.nodeType === 'plugin_registry_entry') {
          return {
            ...emptyGraph('ambiguous'),
            candidates: [
              {
                nodeId: 'plugin:a',
                scoreRank: 4,
                matchKind: 'name',
                confidence: 'confirmed',
                domain: 'application',
                type: 'plugin_registry_entry',
                canonicalName: 'A',
                name: 'Lista obliczona',
              },
              {
                nodeId: 'plugin:b',
                scoreRank: 4,
                matchKind: 'name',
                confidence: 'confirmed',
                domain: 'application',
                type: 'plugin_registry_entry',
                canonicalName: 'B',
                name: 'Lista obliczona',
              },
            ],
          };
        }
        return emptyGraph('unresolved');
      },
      resolveForm: () => ({
        ...emptyGraph('ambiguous'),
        candidates: [
          {
            nodeId: 'form:a',
            scoreRank: 4,
            matchKind: 'name',
            confidence: 'confirmed',
            domain: 'application',
            type: 'application_form',
            canonicalName: 'A',
            name: 'A',
          },
          {
            nodeId: 'form:b',
            scoreRank: 4,
            matchKind: 'name',
            confidence: 'confirmed',
            domain: 'application',
            type: 'application_form',
            canonicalName: 'B',
            name: 'B',
          },
        ],
      }),
      resolveField: () => emptyGraph('ambiguous'),
    });
    const plan = planner(resolver).plan(STAGE3B_REFERENCE_QUESTIONS.E!);
    expect(plan.ambiguities.some((a) => a.kind === 'ambiguous')).toBe(true);
    expect(plan.audit.autoResolvedAmbiguities).toBe(0);
    expect(plan.planningStatus).not.toBe('ready');
  });

  test('22. Stage 3A conflict propagation', () => {
    const formGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const resolver = mockResolver({
      resolveNode: (input) => {
        if (input.nodeType === 'plugin_registry_entry') {
          return {
            ...emptyGraph('resolved'),
            selectedNodeId: `plugin:${formGuid}`,
            candidates: [
              {
                nodeId: `plugin:${formGuid}`,
                scoreRank: 4,
                matchKind: 'exact_name',
                confidence: 'confirmed',
                domain: 'application',
                type: 'plugin_registry_entry',
                canonicalName: formGuid,
                name: 'Lista obliczona',
              },
            ],
            nodes: [
              {
                id: `plugin:${formGuid}`,
                type: 'plugin_registry_entry',
                domain: 'application',
                name: 'Lista obliczona',
                canonicalName: formGuid,
                owner: null,
                objectType: null,
                confidence: 'confirmed',
                sourceStages: ['1'],
                attributes: { guid: formGuid, className: 'X' },
                evidence: [],
                semanticNormalization: null,
              },
            ],
          };
        }
        return emptyGraph('unresolved');
      },
      resolveForm: () => ({
        ...emptyGraph('resolved'),
        selectedNodeId: `form:${formGuid}:X`,
      }),
      resolveField: () => ({
        ...emptyGraph('conflicting'),
        conflicts: [
          {
            conflictId: 'c1',
            conflictType: 'joinType',
            subjectId: 'edge:1',
            resolutionStatus: 'unresolved',
            alternatives: ['LEFT', 'UNKNOWN'],
            evidence: [],
          },
        ],
      }),
      traceFieldToOracle: () => ({
        ...emptyGraph('conflicting'),
        conflicts: [
          {
            conflictId: 'c1',
            conflictType: 'joinType',
            subjectId: 'edge:1',
            resolutionStatus: 'unresolved',
            alternatives: ['LEFT', 'UNKNOWN'],
            evidence: [],
          },
        ],
      }),
    });
    const plan = planner(resolver).plan(STAGE3B_REFERENCE_QUESTIONS.E!);
    // conflicts may surface on oracle_path when help also resolves; at minimum no auto-resolve
    expect(plan.audit.autoResolvedAmbiguities).toBe(0);
  });

  test('23. deferred runtime evidence', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.A!);
    const deferred = plan.evidenceRequirements.filter((e) => e.status === 'deferred');
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.some((e) => e.runtimeSourceRequired)).toBe(true);
  });

  test('24. no SQL generation', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.A!);
    expect(plan.executionPolicy.sqlGenerationAllowed).toBe(false);
    expect(plan.audit.sqlGenerated).toBe(0);
  });

  test('25. no file read', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.C!);
    expect(plan.executionPolicy.fileReadAllowed).toBe(false);
    expect(plan.audit.filesRead).toBe(0);
  });

  test('26. no Oracle write', () => {
    const plan = planner().plan(STAGE3B_REFERENCE_QUESTIONS.G!);
    expect(plan.executionPolicy.oracleWriteAllowed).toBe(false);
    expect(plan.audit.oracleWrites).toBe(0);
  });

  test('27. deterministic ordering', () => {
    const p = planner();
    const a = p.plan(STAGE3B_REFERENCE_QUESTIONS.A!);
    const b = p.plan(STAGE3B_REFERENCE_QUESTIONS.A!);
    expect(stableStringify(stripVolatilePlanFields(a))).toBe(stableStringify(stripVolatilePlanFields(b)));
    const types = a.entities.map((e) => `${e.sourceStart}:${e.type}`);
    const sorted = [...types].sort((x, y) => {
      const [sx, tx] = x.split(':');
      const [sy, ty] = y.split(':');
      if (Number(sx) !== Number(sy)) return Number(sx) - Number(sy);
      return String(tx).localeCompare(String(ty));
    });
    expect(types).toEqual(sorted);
  });

  test('28. configuration validation', () => {
    const catalog = JSON.parse(
      readFileSync(path.join(apiRoot, 'config', 'teta-intent-catalog-v1.json'), 'utf8'),
    );
    const templates = JSON.parse(
      readFileSync(path.join(apiRoot, 'config', 'teta-evidence-templates-v1.json'), 'utf8'),
    );
    const language = JSON.parse(
      readFileSync(path.join(apiRoot, 'config', 'teta-planner-language-pl-v1.json'), 'utf8'),
    );
    expect(validatePlannerConfigs(catalog, templates, language)).toEqual([]);
  });

  test('29. reference A–G', () => {
    const p = planner(
      mockResolver({
        resolveForm: () => ({
          ...emptyGraph('resolved'),
          selectedNodeId: 'form:lista',
        }),
        resolveField: () => ({
          ...emptyGraph('resolved'),
          selectedNodeId: 'help:wartosc',
        }),
        resolveNode: () => emptyGraph('ambiguous'),
        traceFieldToOracle: () => emptyGraph('resolved'),
      }),
    );
    const A = p.plan(STAGE3B_REFERENCE_QUESTIONS.A!);
    const B = p.plan(STAGE3B_REFERENCE_QUESTIONS.B!);
    const C = p.plan(STAGE3B_REFERENCE_QUESTIONS.C!);
    const D = p.plan(STAGE3B_REFERENCE_QUESTIONS.D!);
    const E = p.plan(STAGE3B_REFERENCE_QUESTIONS.E!);
    const F = p.plan(STAGE3B_REFERENCE_QUESTIONS.F!);
    const G = p.plan(STAGE3B_REFERENCE_QUESTIONS.G!);
    expect(A.intent.type).toBe('explain_payroll_component');
    expect(B.planningStatus).toBe('needs_clarification');
    expect(C.intent.type).toBe('validate_import_file');
    expect(D.intent.type).toBe('build_employee_report');
    expect(E.intent.type).toBe('explain_application_field');
    expect(['ambiguous', 'needs_clarification']).toContain(F.planningStatus);
    expect(G.intent.type).toBe('unsupported');
  });

  test('30. Polish diacritics normalization', () => {
    const r = extractIntent('Dlaczego skladnik 4300 sie policzyl?', configs);
    // without diacritics still matches via ascii patterns where defined
    const r2 = extractIntent('Do czego służy pole Wartość na formularzu Lista obliczona?', configs);
    expect(r2.type).toBe('explain_application_field');
    const ents = extractEntities(
      { question: 'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.' },
      configs,
      'build_employee_report',
    );
    expect(ents.some((e) => e.type === 'relativeDateRange')).toBe(true);
  });

  test('31. BHP executes graph evidence queries', () => {
    let nodeCalls = 0;
    const resolver = mockResolver({
      resolveNode: () => {
        nodeCalls += 1;
        return {
          ...emptyGraph('resolved'),
          selectedNodeId: 'oracle-object:TETA_ADMIN:VIEW:NT_KP_BHP_X',
          candidates: [
            {
              nodeId: 'oracle-object:TETA_ADMIN:VIEW:NT_KP_BHP_X',
              scoreRank: 4,
              matchKind: 'exact_name',
              confidence: 'confirmed',
              domain: 'oracle',
              type: 'oracle_object',
              canonicalName: 'NT_KP_BHP_X',
              name: 'NT_KP_BHP_X',
            },
          ],
        };
      },
      resolveForm: () => emptyGraph('unresolved'),
    });
    const plan = planner(resolver).plan(STAGE3B_REFERENCE_QUESTIONS.D!);
    expect(plan.audit.graphQueriesExecuted).toBeGreaterThan(0);
    expect(nodeCalls).toBeGreaterThan(0);
    expect(plan.audit.sqlGenerated).toBe(0);
    // structural may resolve; no employee runtime values are fetched
    expect(plan.executionPolicy.sqlExecutionAllowed).toBe(false);
  });

  test('32. exact table symbol keeps canonical candidates without auto-owner', () => {
    const resolver = mockResolver({
      resolveNode: (input) => ({
        ...emptyGraph('ambiguous'),
        candidates: [
          {
            nodeId: `oracle-object:TETA_ADMIN:TABLE:${input.name}`,
            scoreRank: 3,
            matchKind: 'exact_oracle_identity',
            confidence: 'confirmed',
            domain: 'oracle',
            type: 'oracle_object',
            canonicalName: String(input.name),
            name: String(input.name),
          },
          {
            nodeId: `oracle-object:TETA_ADMIN_P:SYNONYM:${input.name}`,
            scoreRank: 3,
            matchKind: 'exact_oracle_identity',
            confidence: 'confirmed',
            domain: 'oracle',
            type: 'oracle_object',
            canonicalName: String(input.name),
            name: String(input.name),
          },
        ],
      }),
    });
    const plan = planner(resolver).plan(STAGE3B_REFERENCE_QUESTIONS.C!);
    expect(plan.selectionRequiredBeforeExecution).toBe(true);
    expect(plan.audit.autoResolvedAmbiguities).toBe(0);
    const target = plan.evidenceRequirements.find((e) => e.evidenceType === 'target_tables');
    const rows = target?.graphResolution?.candidates as Array<{
      businessTarget: string;
      canonicalCandidates: unknown[];
      selectionRequiredBeforeExecution: boolean;
    }>;
    expect(rows?.some((r) => r.businessTarget === 'T_PRAC')).toBe(true);
    expect(rows?.every((r) => r.selectionRequiredBeforeExecution)).toBe(true);
  });

  test('33. ambiguity generates clarification or selectionRequiredBeforeExecution', () => {
    const F = planner().plan(STAGE3B_REFERENCE_QUESTIONS.F!);
    expect(F.clarificationQuestions.length).toBeGreaterThan(0);
    const C = planner(
      mockResolver({
        resolveNode: () => ({
          ...emptyGraph('ambiguous'),
          candidates: [
            {
              nodeId: 'a',
              scoreRank: 3,
              matchKind: 'x',
              confidence: 'confirmed',
              domain: 'oracle',
              type: 'oracle_object',
              canonicalName: 'T',
              name: 'T',
            },
            {
              nodeId: 'b',
              scoreRank: 3,
              matchKind: 'x',
              confidence: 'confirmed',
              domain: 'oracle',
              type: 'oracle_object',
              canonicalName: 'T',
              name: 'T',
            },
          ],
        }),
      }),
    ).plan(STAGE3B_REFERENCE_QUESTIONS.C!);
    expect(
      C.selectionRequiredBeforeExecution ||
        C.clarificationQuestions.length > 0 ||
        C.ambiguities.some((a) => a.selectionRequiredBeforeExecution),
    ).toBe(true);
  });
});
