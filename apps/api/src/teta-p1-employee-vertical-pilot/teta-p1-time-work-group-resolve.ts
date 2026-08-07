import { loadAcceptedP1DeclaredColumns } from './teta-p1-vertical-pilot-field-resolve';
import {
  fingerprint,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
} from './teta-p1-vertical-pilot.types';
import {
  discoverTimeWorkGroupEvidence,
  type TimeWorkGroupDiscoveryBundle,
} from './teta-p1-time-work-group-discover';
import {
  type TimeWorkGroupCandidate,
  type TimeWorkGroupCurrentnessMode,
  type TimeWorkGroupResolutionStatus,
  type TimeWorkGroupSafetyCounters,
} from './teta-p1-time-work-group.types';
import {
  buildTimeWorkGroupEvidenceFromArtifacts,
  resolveSchemaRoles,
  type LogicalRoleId,
  type SchemaRoleResolutionResult,
  type SchemaRoleResolutionStatus,
} from '../teta-schema-role-resolution';

export type TimeWorkGroupFieldBinding = {
  logicalRole: string;
  physicalObject: string | null;
  physicalColumn: string | null;
  resolutionStatus: TimeWorkGroupResolutionStatus;
  evidenceRefs: string[];
  resolutionFingerprint: string;
};

const REQUIRED_ROLES: LogicalRoleId[] = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
];

function field(
  logicalRole: string,
  physicalObject: string | null,
  physicalColumn: string | null,
  resolutionStatus: TimeWorkGroupResolutionStatus,
  evidenceRefs: string[],
): TimeWorkGroupFieldBinding {
  return {
    logicalRole,
    physicalObject,
    physicalColumn,
    resolutionStatus,
    evidenceRefs,
    resolutionFingerprint: fingerprint({
      logicalRole,
      physicalObject,
      physicalColumn,
      resolutionStatus,
    }),
  };
}

function mapStatus(s: SchemaRoleResolutionStatus): TimeWorkGroupResolutionStatus {
  if (s === 'proven_exact' || s === 'strong_inference_readonly') return 'resolved_exact';
  if (s === 'ambiguous') return 'ambiguous';
  if (s === 'conflicting') return 'conflicting';
  if (s === 'stale') return 'stale';
  if (s === 'insufficient') return 'missing';
  return 'technically_unproven';
}

export type TimeWorkGroupResolutionResult = {
  employeeSourceAvailable: boolean;
  employeeBindings: TimeWorkGroupFieldBinding[];
  candidates: TimeWorkGroupCandidate[];
  selectedCandidateRef: string | null;
  fieldBindings: TimeWorkGroupFieldBinding[];
  currentnessMode: TimeWorkGroupCurrentnessMode;
  currentnessEvidenceRefs: string[];
  grainAssessment: string;
  cardinalityAssessment: string;
  semanticAttributionStatus: 'confirmed_for_time_work_group' | 'unconfirmed';
  allGatesResolvedExact: boolean;
  /** True when generic resolver allows bounded readonly pilot SELECT. */
  executionEligible: boolean;
  schemaRoleResolution: SchemaRoleResolutionResult;
  blockingGaps: string[];
  discovery: TimeWorkGroupDiscoveryBundle;
};

/**
 * Resolve TWG via generic schema role resolver.
 * Scenario supplies logical question/roles only — no Oracle assignment/join seeds.
 */
export async function resolveTimeWorkGroupBindings(input: {
  repoRoot: string;
  counters: TimeWorkGroupSafetyCounters;
  declaredEmployeeColumns?: string[];
}): Promise<TimeWorkGroupResolutionResult> {
  const discovery = await discoverTimeWorkGroupEvidence(input.repoRoot, input.counters);
  const loaded = loadAcceptedP1DeclaredColumns(input.repoRoot);
  const declared =
    input.declaredEmployeeColumns ?? loaded.columns ?? [];
  const declaredUpper = new Set(declared.map((c) => c.toUpperCase()));
  const employeeSourceAvailable =
    declaredUpper.size > 0 || Boolean(loaded.available);

  const empCol = (name: string) => (declaredUpper.has(name) ? name : null);
  const empStatus = (name: string): TimeWorkGroupResolutionStatus =>
    declaredUpper.has(name) ? 'resolved_exact' : 'missing';

  const employeeBindings: TimeWorkGroupFieldBinding[] = [
    field(
      'employee_first_name',
      `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      empCol('IMIE'),
      empStatus('IMIE'),
      ['pilot:accepted_employee_foundation', 'physical:IMIE'],
    ),
    field(
      'employee_last_name',
      `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      empCol('NAZWISKO'),
      empStatus('NAZWISKO'),
      ['pilot:accepted_employee_foundation', 'physical:NAZWISKO'],
    ),
    field(
      'employee_number',
      `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      empCol('NR_EWIDENCYJNY'),
      empStatus('NR_EWIDENCYJNY'),
      ['pilot:accepted_employee_foundation', 'physical:NR_EWIDENCYJNY'],
    ),
    field(
      'employee_identity',
      `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      empCol('ID'),
      empStatus('ID'),
      ['pilot:accepted_employee_foundation', 'physical:ID'],
    ),
  ];

  const evidenceGraph = await buildTimeWorkGroupEvidenceFromArtifacts(input.repoRoot);
  const schemaRoleResolution = resolveSchemaRoles({
    question: 'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.',
    subjectRole: 'employee',
    targetConcept: 'current_time_work_group',
    requiredRoles: REQUIRED_ROLES,
    confirmedSubjectSource: {
      owner: P1_VERTICAL_OWNER,
      objectType: 'VIEW',
      objectName: P1_VERTICAL_OBJECT,
      identityColumn: 'ID',
      businessNumberColumn: 'NR_EWIDENCYJNY',
      firstNameColumn: 'IMIE',
      lastNameColumn: 'NAZWISKO',
    },
    applicationAnchors: discovery.applicationAnchors.map((a) => ({
      formRef: a.formRef,
      controlName: a.controlName,
      datasetName: a.datasetName ?? undefined,
      evidenceRefs: a.evidenceRefs,
    })),
    temporalIntent: 'current_on_oracle_sysdate',
    evidenceGraph,
  });

  // Audit invariants — scenario must not seed physical mapping
  if (schemaRoleResolution.audit.humanProvidedOracleObjectSeeds > 0) {
    input.counters.guessedTimeWorkGroupSource += 1;
  }
  if (schemaRoleResolution.audit.ambiguousCandidateAutoSelected > 0) {
    input.counters.ambiguousCandidateAutoSelected += 1;
  }

  const candidates: TimeWorkGroupCandidate[] = schemaRoleResolution.candidateRanking.map((c) => {
    const assessment = schemaRoleResolution.candidateObjects.find(
      (x) => x.objectRef === c.objectRef,
    );
    const roles = schemaRoleResolution.roleAssignmentsByRole;
    const isChosen =
      c.objectRef === roles.assignment_source?.objectRef &&
      (schemaRoleResolution.overallStatus === 'proven_exact' ||
        schemaRoleResolution.overallStatus === 'strong_inference_readonly');
    return {
      candidateRef: c.objectRef,
      applicationAnchorRefs: discovery.applicationAnchors.map(
        (a) => `${a.formRef}#${a.controlName}`,
      ),
      assignmentObject: c.objectRef,
      employeeRelationPath: (schemaRoleResolution.chosenRelationPath ?? []).map((step) => ({
        sourceObject: step.fromObject,
        sourceColumn: step.fromColumn,
        targetObject: step.toObject,
        targetColumn: step.toColumn,
        relationType: step.relationType,
        evidenceRefs: step.evidenceRefs,
        resolutionStatus: mapStatus(step.status),
      })),
      groupReferenceColumn: isChosen ? roles.dictionary_reference?.column ?? null : null,
      dictionaryObject: isChosen ? roles.dictionary_identity?.objectRef ?? null : null,
      dictionaryIdColumn: isChosen ? roles.dictionary_identity?.column ?? null : null,
      dictionaryNameColumn: isChosen ? roles.dictionary_display_name?.column ?? null : null,
      temporalColumns:
        isChosen && roles.valid_from?.column && roles.valid_to?.column
          ? [roles.valid_from.column, roles.valid_to.column]
          : [],
      grainAssessment: 'inferred_by_schema_role_resolver',
      cardinalityAssessment: 'deferred_to_execution_cardinality_audit',
      semanticEvidenceRefs: assessment?.supportingEvidenceRefs.filter((r) =>
        /semantic|form|ui|dataset|docs/i.test(r),
      ) ?? [],
      technicalEvidenceRefs: assessment?.supportingEvidenceRefs.filter((r) =>
        /stage2|oracle|fk|gateway|relation/i.test(r),
      ) ?? [],
      resolutionStatus: mapStatus(c.status),
      blockingGaps:
        c.status === 'proven_exact' || c.status === 'strong_inference_readonly'
          ? []
          : [`schema_role_status:${c.status}`, assessment?.resolutionExplanation ?? ''],
      notes: [assessment?.resolutionExplanation ?? ''],
    };
  });

  // Also surface evidence-only gaps when no assignment candidates exist
  if (candidates.length === 0) {
    candidates.push({
      candidateRef: 'no_assignment_candidate_from_evidence',
      applicationAnchorRefs: discovery.applicationAnchors.map(
        (a) => `${a.formRef}#${a.controlName}`,
      ),
      assignmentObject: null,
      employeeRelationPath: [],
      groupReferenceColumn: null,
      dictionaryObject:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_identity?.objectRef ?? null,
      dictionaryIdColumn:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_identity?.column ?? null,
      dictionaryNameColumn:
        schemaRoleResolution.roleAssignmentsByRole.dictionary_display_name?.column ?? null,
      temporalColumns: [],
      grainAssessment: 'unproven',
      cardinalityAssessment: 'unproven',
      semanticEvidenceRefs: schemaRoleResolution.evidenceByFamily.application_semantic.flatMap(
        (c) => c.provenance,
      ),
      technicalEvidenceRefs: [
        ...schemaRoleResolution.evidenceByFamily.application_technical.flatMap((c) => c.provenance),
        ...schemaRoleResolution.evidenceByFamily.oracle_structural.flatMap((c) => c.provenance),
      ],
      resolutionStatus: 'technically_unproven',
      blockingGaps: [
        'assignment_source_not_discovered_from_evidence_graph',
        schemaRoleResolution.resolutionExplanation,
      ],
      notes: [
        'Generic resolver exhausted available evidence families without a complete subject→assignment→dictionary path',
      ],
    });
  }

  const executionEligible =
    schemaRoleResolution.executionEligibility === 'eligible_for_bounded_readonly' ||
    schemaRoleResolution.executionEligibility === 'eligible_for_bounded_readonly_pilot';

  const roles = schemaRoleResolution.roleAssignmentsByRole;
  const selectedCandidateRef = executionEligible
    ? roles.assignment_source?.objectRef ?? null
    : null;

  if (!executionEligible) {
    // Do not guess — leave selected null
    input.counters.candidateSelectedByNameSimilarity += 0;
    input.counters.fallbackOracleObjectSelected += 0;
  }

  // Dictionary evidence may be known before a complete assignment path exists.
  const dictEvidenceObj = evidenceGraph.objects.find((o) =>
    o.tags?.includes('dictionary_candidate'),
  );
  const dictEvidenceClaims = evidenceGraph.claims.filter(
    (c) => c.object === dictEvidenceObj?.objectRef,
  );
  const dictEvidenceExact =
    Boolean(dictEvidenceObj) &&
    dictEvidenceClaims.some((c) => c.family === 'application_technical');

  const fieldBindings: TimeWorkGroupFieldBinding[] = [
    ...employeeBindings,
    field(
      'assignmentSourceRef',
      roles.assignment_source?.objectRef ?? null,
      null,
      roles.assignment_source
        ? mapStatus(roles.assignment_source.status)
        : 'missing',
      roles.assignment_source?.supportingEvidenceRefs ?? [
        'blocking:assignment_source_not_resolved_by_schema_role_resolver',
      ],
    ),
    field(
      'groupReferenceColumn',
      roles.dictionary_reference?.objectRef ?? null,
      roles.dictionary_reference?.column ?? null,
      roles.dictionary_reference
        ? mapStatus(roles.dictionary_reference.status)
        : 'missing',
      roles.dictionary_reference?.supportingEvidenceRefs ?? [],
    ),
    field(
      'dictionarySourceRef',
      roles.dictionary_identity?.objectRef ??
        dictEvidenceObj?.objectRef ??
        null,
      null,
      roles.dictionary_identity
        ? mapStatus(roles.dictionary_identity.status)
        : dictEvidenceExact
          ? 'resolved_exact'
          : 'missing',
      roles.dictionary_identity?.supportingEvidenceRefs ??
        dictEvidenceClaims.flatMap((c) => c.provenance),
    ),
    field(
      'dictionaryIdColumn',
      roles.dictionary_identity?.objectRef ?? dictEvidenceObj?.objectRef ?? null,
      roles.dictionary_identity?.column ??
        dictEvidenceObj?.columns?.find((c) => c.isPk)?.name ??
        null,
      roles.dictionary_identity
        ? mapStatus(roles.dictionary_identity.status)
        : dictEvidenceExact
          ? 'resolved_exact'
          : 'missing',
      roles.dictionary_identity?.supportingEvidenceRefs ?? [],
    ),
    field(
      'dictionaryNameColumn',
      roles.dictionary_display_name?.objectRef ??
        dictEvidenceObj?.objectRef ??
        null,
      roles.dictionary_display_name?.column ??
        dictEvidenceObj?.columns?.find((c) => /NAZWA|DESCRIPTION|NAME/i.test(c.name))
          ?.name ??
        null,
      roles.dictionary_display_name
        ? mapStatus(roles.dictionary_display_name.status)
        : dictEvidenceExact
          ? 'resolved_exact'
          : 'missing',
      roles.dictionary_display_name?.supportingEvidenceRefs ?? [],
    ),
    field(
      'employeeToAssignmentPath',
      null,
      schemaRoleResolution.chosenRelationPath?.[0]
        ? `${schemaRoleResolution.chosenRelationPath[0].fromColumn}=${schemaRoleResolution.chosenRelationPath[0].toColumn}`
        : null,
      schemaRoleResolution.chosenRelationPath
        ? mapStatus(schemaRoleResolution.chosenRelationPath[0]!.status)
        : 'technically_unproven',
      schemaRoleResolution.chosenRelationPath?.[0]?.evidenceRefs ?? [],
    ),
    field(
      'currentnessRule',
      roles.valid_from?.objectRef ?? null,
      roles.valid_from?.column && roles.valid_to?.column
        ? `${roles.valid_from.column}..${roles.valid_to.column}`
        : null,
      schemaRoleResolution.temporalResolution.mode === 'unresolved'
        ? 'missing'
        : mapStatus(schemaRoleResolution.overallStatus),
      schemaRoleResolution.temporalResolution.supportingEvidenceRefs,
    ),
    field(
      'assignmentGrain',
      roles.assignment_source?.objectRef ?? null,
      null,
      executionEligible ? 'resolved_exact' : 'missing',
      ['schema_role_resolver:grain_deferred_to_cardinality_audit'],
    ),
  ];

  const semanticOk =
    schemaRoleResolution.evidenceByFamily.application_semantic.length > 0 ||
    discovery.applicationAnchors.length > 0;

  const blockingGaps = executionEligible
    ? []
    : [
        `overallStatus:${schemaRoleResolution.overallStatus}`,
        `executionEligibility:${schemaRoleResolution.executionEligibility}`,
        schemaRoleResolution.resolutionExplanation,
        ...schemaRoleResolution.candidateRanking
          .slice(0, 5)
          .map((c) => `candidate:${c.objectRef}:${c.status}:score=${c.score}`),
      ];

  const temporalMode = schemaRoleResolution.temporalResolution.mode;
  const currentnessMode: TimeWorkGroupCurrentnessMode =
    temporalMode === 'effective_date_range' ||
    temporalMode === 'current_snapshot_source' ||
    temporalMode === 'exact_current_flag'
      ? temporalMode
      : 'unresolved';

  return {
    employeeSourceAvailable: employeeSourceAvailable || declaredUpper.size > 0,
    employeeBindings,
    candidates,
    selectedCandidateRef,
    fieldBindings,
    currentnessMode,
    currentnessEvidenceRefs: schemaRoleResolution.temporalResolution.supportingEvidenceRefs,
    grainAssessment: executionEligible
      ? 'schema_role_resolver_path_complete'
      : 'unproven_oracle_assignment_grain',
    cardinalityAssessment: executionEligible
      ? 'to_be_audited_at_execution'
      : 'unproven_current_multiplicity',
    semanticAttributionStatus: semanticOk
      ? 'confirmed_for_time_work_group'
      : 'unconfirmed',
    allGatesResolvedExact: executionEligible,
    executionEligible,
    schemaRoleResolution,
    blockingGaps,
    discovery,
  };
}
