/**
 * Stage 3C — shared BHP fixture graph for unit tests / audit refs E–F.
 */
import type { GraphEdgeView, GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import type { FixtureGraph } from './teta-query-graph-client';

function n(
  partial: Partial<GraphNodeView> & { id: string; type: string; name: string },
): GraphNodeView {
  return {
    domain: partial.domain ?? 'oracle',
    canonicalName: partial.canonicalName ?? partial.name,
    owner: partial.owner ?? null,
    objectType: partial.objectType ?? null,
    confidence: partial.confidence ?? 'confirmed',
    sourceStages: partial.sourceStages ?? ['fixture'],
    attributes: partial.attributes ?? {},
    evidence: partial.evidence ?? [],
    semanticNormalization: partial.semanticNormalization ?? null,
    ...partial,
  };
}

function e(
  type: string,
  from: string,
  to: string,
  attrs: Record<string, unknown> = {},
): GraphEdgeView {
  return {
    id: `edge:${type}:${from}:${to}`,
    type,
    from,
    to,
    confidence: 'confirmed',
    sourceStages: ['fixture'],
    attributes: attrs,
    evidence: [],
  };
}

export function buildBhpFixtureGraph(opts?: {
  includeHrmUnknown?: boolean;
  omitJoins?: boolean;
  equalEmployeeCandidates?: boolean;
}): FixtureGraph {
  const formId =
    'form:19a5dac6-733f-4801-8a66-f9ee707bb404:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok';

  const empView = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY';
  const empTable = 'oracle-object:TETA_ADMIN:TABLE:T_PRAC_BASE';
  const examView = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_BHP_BADANIA';
  const examType = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_SLO_RODZAJE_BADAN';
  const posView = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_STANOWISKA';
  const orgView = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_ORG_JEDNOSTKI';
  const empAccess = 'oracle-object:TETA_ADMIN_P:SYNONYM:NT_KP_PRC_PRACOWNICY';
  const hrm = 'oracle-object:HRM:TABLE:T_PRAC';
  const unknown = 'oracle-object:UNKNOWN:VIEW:PRACOWNICY';
  const empAlt = 'oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY_ALT';

  const nodes: GraphNodeView[] = [
    n({
      id: formId,
      type: 'application_form',
      domain: 'application',
      name: 'KartotekaBadanBHPWidok',
      canonicalName:
        'Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok',
      owner: null,
      objectType: null,
    }),
    n({
      id: empView,
      type: 'oracle_object',
      name: 'NT_KP_PRC_PRACOWNICY',
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      attributes: {
        semanticTags: ['employee_master'],
        searchTerms: ['pracownicy', 'pracownik'],
        oracleValidationStatus: 'confirmed',
      },
    }),
    n({
      id: empTable,
      type: 'oracle_object',
      name: 'T_PRAC_BASE',
      owner: 'TETA_ADMIN',
      objectType: 'TABLE',
      attributes: { semanticTags: ['employee_master'], searchTerms: ['pracownicy'] },
    }),
    ...(opts?.equalEmployeeCandidates
      ? []
      : [
          n({
            id: empAccess,
            type: 'oracle_object',
            name: 'NT_KP_PRC_PRACOWNICY',
            owner: 'TETA_ADMIN_P',
            objectType: 'SYNONYM',
            attributes: { semanticTags: ['employee_master'], searchTerms: ['pracownicy'] },
          }),
        ]),
    n({
      id: examView,
      type: 'oracle_object',
      name: 'NT_KP_BHP_BADANIA',
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      attributes: {
        semanticTags: ['health_examination', 'occupational_health'],
        searchTerms: ['badania BHP', 'badania', 'termin badania', 'ważność badania'],
      },
    }),
    n({
      id: examType,
      type: 'oracle_object',
      name: 'NT_KP_SLO_RODZAJE_BADAN',
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      attributes: {
        semanticTags: ['examination_type_dictionary'],
        searchTerms: ['rodzaje badań BHP', 'rodzaj badania'],
      },
    }),
    n({
      id: posView,
      type: 'oracle_object',
      name: 'NT_KP_KDR_STANOWISKA',
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      attributes: { semanticTags: ['current_position'], searchTerms: ['stanowisko', 'stanowiska'] },
    }),
    n({
      id: orgView,
      type: 'oracle_object',
      name: 'NT_KP_ORG_JEDNOSTKI',
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      attributes: {
        semanticTags: ['organizational_unit'],
        searchTerms: ['jednostka organizacyjna', 'struktura organizacyjna'],
      },
    }),
  ];

  if (opts?.includeHrmUnknown) {
    nodes.push(
      n({
        id: hrm,
        type: 'oracle_object',
        name: 'T_PRAC',
        owner: 'HRM',
        objectType: 'TABLE',
        attributes: { semanticTags: ['employee_master'], searchTerms: ['pracownicy'] },
      }),
      n({
        id: unknown,
        type: 'oracle_object',
        name: 'PRACOWNICY',
        owner: 'UNKNOWN',
        objectType: 'VIEW',
        attributes: { semanticTags: ['employee_master'], searchTerms: ['pracownicy'] },
      }),
    );
  }

  // Equal-candidate mode: two TETA_ADMIN views on form path, no synonym access winner.
  const includeSynonymAccess = !opts?.equalEmployeeCandidates;

  if (opts?.equalEmployeeCandidates) {
    nodes.push(
      n({
        id: empAlt,
        type: 'oracle_object',
        name: 'NT_KP_PRC_PRACOWNICY_ALT',
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        attributes: {
          semanticTags: ['employee_master'],
          searchTerms: ['pracownicy', 'pracownik'],
        },
      }),
    );
  }

  const col = (
    objectId: string,
    columnName: string,
    businessRole: string,
    extra: Record<string, unknown> = {},
  ) => {
    const objectName = objectId.split(':').pop()!;
    const id = `oracle-column:TETA_ADMIN:${objectName}:${columnName}`;
    nodes.push(
      n({
        id,
        type: 'oracle_column',
        name: columnName,
        owner: 'TETA_ADMIN',
        objectType: null,
        attributes: {
          owner: 'TETA_ADMIN',
          objectName,
          columnName,
          businessRole,
          labelHints: extra.labelHints ?? [businessRole.replace(/_/g, ' ')],
          ...extra,
        },
      }),
    );
    return id;
  };

  const empId = col(empView, 'ID', 'employee_id', { labelHints: ['id'] });
  const empNr = col(empView, 'NR_EWD', 'employee_number', {
    labelHints: ['numer ewidencyjny', 'nr ewidencyjny'],
  });
  const empImie = col(empView, 'IMIE', 'employee_first_name', { labelHints: ['imię', 'imie'] });
  const empNazw = col(empView, 'NAZWISKO', 'employee_last_name', { labelHints: ['nazwisko'] });
  const empOd = col(empView, 'DATA_OD', 'employment_valid_from', {
    labelHints: ['data od', 'zatrudnienie'],
    semanticTags: ['active_employment'],
    activeEmploymentSemantics: 'confirmed',
  });
  const empDo = col(empView, 'DATA_DO', 'employment_valid_to', {
    labelHints: ['data do', 'zatrudnienie'],
    semanticTags: ['active_employment'],
  });

  const examPrac = col(examView, 'PRAC_ID', 'examination_employee_fk', { labelHints: ['prac id'] });
  const examTypeFk = col(examView, 'RODZ_ID', 'examination_type_fk', { labelHints: ['rodz id'] });
  const examOd = col(examView, 'DATA_OD', 'examination_valid_from', {
    labelHints: ['data od', 'ważne od', 'termin od'],
  });
  const examDo = col(examView, 'DATA_DO', 'examination_valid_to', {
    labelHints: ['data do', 'ważne do', 'termin do', 'ważność'],
  });

  const typeId = col(examType, 'ID', 'examination_type_id', { labelHints: ['id'] });
  const typeName = col(examType, 'NAZWA', 'examination_type_name', {
    labelHints: ['rodzaj badania', 'nazwa'],
    preferDisplayText: true,
    displayMember: true,
  });

  const posEmp = col(posView, 'PRAC_ID', 'position_employee_fk', { labelHints: ['prac id'] });
  const posName = col(posView, 'NAZWA', 'position_name', {
    labelHints: ['stanowisko', 'nazwa stanowiska'],
    preferDisplayText: true,
  });

  const orgEmp = col(orgView, 'PRAC_ID', 'org_employee_fk', { labelHints: ['prac id'] });
  const orgName = col(orgView, 'NAZWA', 'organizational_unit_name', {
    labelHints: ['jednostka organizacyjna', 'nazwa jednostki', 'jednostka'],
    preferDisplayText: true,
  });

  void empNr;
  void empImie;
  void empNazw;
  void empOd;
  void empDo;
  void examOd;
  void examDo;
  void typeName;
  void posName;
  void orgName;

  const edges: GraphEdgeView[] = [
    e('USES_DATASOURCE', formId, examView),
    e('MAPS_TO_ORACLE_OBJECT', formId, examView),
    e('MAPS_TO_ORACLE_OBJECT', formId, empView),
    e('MAPS_TO_ORACLE_OBJECT', formId, examType),
    e('HAS_COLUMN', empView, empId),
    e('HAS_COLUMN', empView, empNr),
    e('HAS_COLUMN', empView, empImie),
    e('HAS_COLUMN', empView, empNazw),
    e('HAS_COLUMN', empView, empOd),
    e('HAS_COLUMN', empView, empDo),
    e('HAS_COLUMN', examView, examPrac),
    e('HAS_COLUMN', examView, examTypeFk),
    e('HAS_COLUMN', examView, examOd),
    e('HAS_COLUMN', examView, examDo),
    e('HAS_COLUMN', examType, typeId),
    e('HAS_COLUMN', examType, typeName),
    e('HAS_COLUMN', posView, posEmp),
    e('HAS_COLUMN', posView, posName),
    e('HAS_COLUMN', orgView, orgEmp),
    e('HAS_COLUMN', orgView, orgName),
  ];

  if (includeSynonymAccess) {
    edges.push(e('RESOLVES_SYNONYM_TO', empAccess, empView));
  }

  if (!opts?.omitJoins) {
    edges.push(
      e('FOREIGN_KEY_TO', examPrac, empId),
      e('FOREIGN_KEY_TO', examTypeFk, typeId),
      e('FOREIGN_KEY_TO', posEmp, empId),
      e('FOREIGN_KEY_TO', orgEmp, empId),
    );
  }

  if (opts?.equalEmployeeCandidates) {
    edges.push(e('MAPS_TO_ORACLE_OBJECT', formId, empAlt));
  }

  return { nodes, edges };
}

export function minimalReadyEvidencePlan(graphSourceHash: string): import('../teta-planner/teta-stage3b.types').TetaEvidencePlan {
  return {
    contractVersion: 'teta-aia-evidence-plan-v1',
    planningStatus: 'ready',
    intent: { type: 'build_employee_report', confidence: 'exact', matchedSignals: ['raport'] },
    question: {
      raw: 'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.',
      language: 'pl',
    },
    entities: [
      {
        type: 'reportSubject',
        rawValue: 'badania BHP',
        normalizedValue: 'occupational_health_examinations',
        source: 'question',
        sourceStart: 0,
        sourceEnd: 11,
        confidence: 'exact',
        validationStatus: 'valid',
      },
      {
        type: 'relativeDateRange',
        rawValue: 'w tym miesiącu',
        normalizedValue: 'current_month',
        source: 'question',
        sourceStart: 0,
        sourceEnd: 14,
        confidence: 'exact',
        validationStatus: 'valid',
      },
    ],
    missingEntities: [],
    ambiguities: [],
    evidenceRequirements: [],
    resolvedGraphEvidence: { nodes: [], edges: [], paths: [], conflicts: [], warnings: [] },
    clarificationQuestions: [],
    selectionRequiredBeforeExecution: false,
    executionPolicy: {
      sqlGenerationAllowed: false,
      sqlExecutionAllowed: false,
      fileReadAllowed: false,
      oracleWriteAllowed: false,
      reason: 'stage3b',
    },
    audit: {
      deterministic: true,
      graphSourceHash,
      plannerConfigVersion: 'teta-aia-planner-config-v1',
      plannerDurationMs: 1,
      graphQueriesExecuted: 0,
      scopedFieldQueries: 0,
      unscopedFieldQueries: 0,
      resolvedForms: 0,
      resolvedFormScopedFields: 0,
      irrelevantGlobalAmbiguities: 0,
      clarificationQuestionsForAmbiguities: 0,
      evidenceNotApplicable: 0,
      queryTimingMs: { resolveFormMs: 0, resolveFieldMs: 0, resolveNodeMs: 0, otherMs: 0 },
      guessedEntities: 0,
      autoResolvedAmbiguities: 0,
      sqlGenerated: 0,
      sqlExecuted: 0,
      filesRead: 0,
      oracleWrites: 0,
    },
  };
}
