import { loadAcceptedP1DeclaredColumns } from './teta-p1-vertical-pilot-field-resolve';
import {
  fingerprint,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  type CurrentPositionResolvedBinding,
  type CurrentPositionSafetyCounters,
  type FieldResolutionStatus,
} from './teta-p1-current-position.types';
import {
  buildCurrentPositionEvidenceFromStage3d,
  resolveSchemaRoles,
  type LogicalRoleId,
  type SchemaRoleResolutionResult,
  type SchemaRoleResolutionStatus,
} from '../teta-schema-role-resolution';
import {
  buildBlindCurrentPositionEvidenceFromApplicationGraph,
  compareCurrentPositionGroundTruth,
  type BlindEvidenceInputClassification,
} from '../teta-schema-role-resolution/teta-schema-role-evidence-blind-current-position';

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

/** Accepted physical mapping — validation only, never passed into the resolver. */
export const CURRENT_POSITION_EXPECTED_AFTER_RESOLUTION = {
  assignment: `${P1_VERTICAL_OWNER}.NT_KP_KDR_STANOWISKA`,
  dictionary: `${P1_VERTICAL_OWNER}.NT_KP_SLO_STANOWISKA`,
  subjectReference: 'PRAC_ID',
  dictionaryReference: 'SSTN_ID',
  dictionaryIdentity: 'ID',
  dictionaryDisplayName: 'NAZWA',
  validFrom: 'DATA_OD',
  validTo: 'DATA_DO',
} as const;

function mapStatus(s: SchemaRoleResolutionStatus | undefined): FieldResolutionStatus {
  if (!s) return 'missing';
  if (s === 'proven_exact' || s === 'strong_inference_readonly') return 'resolved_exact';
  if (s === 'ambiguous') return 'ambiguous';
  if (s === 'conflicting') return 'conflicting';
  if (s === 'stale') return 'stale';
  return 'missing';
}

function binding(
  logicalRole: CurrentPositionResolvedBinding['logicalRole'],
  physicalObject: string | null,
  physicalColumn: string | null,
  resolutionStatus: FieldResolutionStatus,
  evidenceRefs: string[],
): CurrentPositionResolvedBinding {
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

function applyForce(
  role: CurrentPositionResolvedBinding['logicalRole'],
  base: CurrentPositionResolvedBinding,
  forceStatus?: Partial<Record<CurrentPositionResolvedBinding['logicalRole'], FieldResolutionStatus>>,
): CurrentPositionResolvedBinding {
  const forced = forceStatus?.[role];
  if (!forced || forced === 'resolved_exact') return base;
  return binding(role, null, null, forced, [...base.evidenceRefs, `forced_${forced}`]);
}

/**
 * Resolve current-position physical roles via the generic schema role resolver.
 *
 * Default discoveryMode=approved_binding_reuse loads Stage 3D approved bindings
 * (production fast path). For independent rediscovery acceptance use
 * discoveryMode=blind_physical_rediscovery (no Stage 3D physical seeds).
 */
export function resolveCurrentPositionBindings(input: {
  repoRoot: string;
  counters: CurrentPositionSafetyCounters;
  forceStatus?: Partial<Record<CurrentPositionResolvedBinding['logicalRole'], FieldResolutionStatus>>;
  declaredEmployeeColumns?: string[];
  discoveryMode?: 'approved_binding_reuse' | 'blind_physical_rediscovery';
}): {
  bindings: CurrentPositionResolvedBinding[];
  allResolvedExact: boolean;
  employeeSourceAvailable: boolean;
  stage3dAvailable: boolean;
  schemaRoleResolution: SchemaRoleResolutionResult | null;
} {
  const discoveryMode = input.discoveryMode ?? 'approved_binding_reuse';
  const loadedEmployees = loadAcceptedP1DeclaredColumns(input.repoRoot);
  const declared = new Set(
    (input.declaredEmployeeColumns ?? loadedEmployees.columns).map((c) => c.toUpperCase()),
  );
  const employeeSourceAvailable =
    declared.size > 0 || Boolean(input.declaredEmployeeColumns?.length);

  // Production reuse only — never used in blind mode.
  const graph =
    discoveryMode === 'approved_binding_reuse'
      ? buildCurrentPositionEvidenceFromStage3d(input.repoRoot)
      : null;
  const stage3dAvailable = Boolean(graph);

  const resolveEmployeeCol = (
    role: CurrentPositionResolvedBinding['logicalRole'],
    candidates: string[],
  ): CurrentPositionResolvedBinding => {
    if (input.forceStatus?.[role] && input.forceStatus[role] !== 'resolved_exact') {
      return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, input.forceStatus[role]!, [
        'pilot:accepted_employee_foundation',
        `forced_${input.forceStatus[role]}`,
      ]);
    }
    const present = candidates.filter((c) => declared.has(c.toUpperCase()));
    if (present.length === 1) {
      return binding(
        role,
        `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
        present[0]!,
        'resolved_exact',
        [
          ...loadedEmployees.evidenceRefs,
          `declaredColumn:${present[0]}`,
          'confirmed_subject_source',
        ],
      );
    }
    if (present.length > 1) {
      return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, 'ambiguous', [
        `ambiguousCandidates:${present.join(',')}`,
      ]);
    }
    return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, 'missing', [
      `candidatesNotInView:${candidates.join(',')}`,
    ]);
  };

  const employeeBindings = [
    resolveEmployeeCol('employee_first_name', ['IMIE']),
    resolveEmployeeCol('employee_last_name', ['NAZWISKO']),
    resolveEmployeeCol('employee_number', ['NR_EWIDENCYJNY']),
    resolveEmployeeCol('employeePrimaryIdentityColumn', ['ID']),
  ];

  if (!graph) {
    input.counters.guessedCurrentPositionSource += 0;
    if (discoveryMode === 'blind_physical_rediscovery') {
      // Blind path is handled by resolveCurrentPositionBlind — this adapter stays production-only.
      return {
        bindings: [
          ...employeeBindings,
          binding('currentPositionSourceRef', null, null, 'missing', [
            'blind_mode_requires_resolveCurrentPositionBlind',
          ]),
        ],
        allResolvedExact: false,
        employeeSourceAvailable,
        stage3dAvailable: false,
        schemaRoleResolution: null,
      };
    }
    const bindings = [
      ...employeeBindings,
      binding('currentPositionSourceRef', null, null, 'missing', ['stage3d_evidence_unavailable']),
    ];
    return {
      bindings,
      allResolvedExact: false,
      employeeSourceAvailable,
      stage3dAvailable: false,
      schemaRoleResolution: null,
    };
  }

  const schemaRoleResolution = resolveSchemaRoles({
    question:
      'Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracownika o numerze ewidencyjnym 00122.',
    subjectRole: 'employee',
    targetConcept: 'current_position',
    requiredRoles: REQUIRED_ROLES,
    discoveryMode: 'approved_binding_reuse',
    confirmedSubjectSource: {
      owner: P1_VERTICAL_OWNER,
      objectType: 'VIEW',
      objectName: P1_VERTICAL_OBJECT,
      identityColumn: 'ID',
      businessNumberColumn: 'NR_EWIDENCYJNY',
      firstNameColumn: 'IMIE',
      lastNameColumn: 'NAZWISKO',
    },
    temporalIntent: 'current_on_oracle_sysdate',
    evidenceGraph: graph,
  });

  const roles = schemaRoleResolution.roleAssignmentsByRole;
  const toPilot = (
    logicalRole: CurrentPositionResolvedBinding['logicalRole'],
    roleId: LogicalRoleId,
  ): CurrentPositionResolvedBinding => {
    const a = roles[roleId];
    return applyForce(
      logicalRole,
      binding(
        logicalRole,
        a?.objectRef ?? null,
        a?.column ?? null,
        mapStatus(a?.status),
        a?.supportingEvidenceRefs ?? ['schema_role_resolver'],
      ),
      input.forceStatus,
    );
  };

  const assignment = toPilot('currentPositionSourceRef', 'assignment_source');
  const subjectRef = toPilot('positionEmployeeReferenceColumn', 'subject_reference');
  const dictRef = toPilot('positionIdColumn', 'dictionary_reference');
  const dictId = toPilot('dictionaryIdColumn', 'dictionary_identity');
  const dictObj = applyForce(
    'dictionarySourceRef',
    binding(
      'dictionarySourceRef',
      roles.dictionary_identity?.objectRef ?? null,
      null,
      mapStatus(roles.dictionary_identity?.status),
      roles.dictionary_identity?.supportingEvidenceRefs ?? [],
    ),
    input.forceStatus,
  );
  const dictName = toPilot('positionNameColumn', 'dictionary_display_name');
  const validFrom = toPilot('positionValidFromColumn', 'valid_from');
  const validTo = toPilot('positionValidToColumn', 'valid_to');

  const pathOk =
    schemaRoleResolution.chosenRelationPath &&
    schemaRoleResolution.chosenRelationPath.length >= 2 &&
    (schemaRoleResolution.overallStatus === 'proven_exact' ||
      schemaRoleResolution.overallStatus === 'strong_inference_readonly');

  const employeeToPositionJoin = applyForce(
    'employeeToPositionJoin',
    binding(
      'employeeToPositionJoin',
      assignment.physicalObject,
      pathOk
        ? `${roles.subject_identity?.column ?? 'ID'}=${subjectRef.physicalColumn}`
        : null,
      pathOk ? 'resolved_exact' : mapStatus(schemaRoleResolution.overallStatus),
      schemaRoleResolution.chosenRelationPath?.[0]?.evidenceRefs ?? [],
    ),
    input.forceStatus,
  );

  const positionToDictionaryJoin = applyForce(
    'positionToDictionaryJoin',
    binding(
      'positionToDictionaryJoin',
      dictObj.physicalObject,
      pathOk ? `${dictRef.physicalColumn}=${dictId.physicalColumn}` : null,
      pathOk ? 'resolved_exact' : mapStatus(schemaRoleResolution.overallStatus),
      schemaRoleResolution.chosenRelationPath?.[1]?.evidenceRefs ?? [],
    ),
    input.forceStatus,
  );

  const current_position_name = applyForce(
    'current_position_name',
    binding(
      'current_position_name',
      dictName.physicalObject,
      dictName.physicalColumn,
      dictName.resolutionStatus,
      [...dictName.evidenceRefs, 'projection:current_position_name'],
    ),
    input.forceStatus,
  );

  const bindings: CurrentPositionResolvedBinding[] = [
    ...employeeBindings,
    assignment,
    subjectRef,
    dictRef,
    validFrom,
    validTo,
    dictObj,
    dictId,
    dictName,
    employeeToPositionJoin,
    positionToDictionaryJoin,
    current_position_name,
  ];

  return {
    bindings,
    allResolvedExact: bindings.every((b) => b.resolutionStatus === 'resolved_exact'),
    employeeSourceAvailable,
    stage3dAvailable,
    schemaRoleResolution,
  };
}

export function byRole(
  bindings: CurrentPositionResolvedBinding[],
  role: CurrentPositionResolvedBinding['logicalRole'],
): CurrentPositionResolvedBinding | undefined {
  return bindings.find((b) => b.logicalRole === role);
}

/** Post-resolution validation against previously accepted mapping (not resolver input). */
export function validateCurrentPositionAgainstAccepted(
  resolution: SchemaRoleResolutionResult,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const exp = CURRENT_POSITION_EXPECTED_AFTER_RESOLUTION;
  if (resolution.roleAssignmentsByRole.assignment_source?.objectRef !== exp.assignment) {
    mismatches.push(`assignment:${resolution.roleAssignmentsByRole.assignment_source?.objectRef}`);
  }
  if (resolution.roleAssignmentsByRole.dictionary_identity?.objectRef !== exp.dictionary) {
    mismatches.push(`dictionary:${resolution.roleAssignmentsByRole.dictionary_identity?.objectRef}`);
  }
  if (resolution.roleAssignmentsByRole.subject_reference?.column !== exp.subjectReference) {
    mismatches.push(`subjectRef:${resolution.roleAssignmentsByRole.subject_reference?.column}`);
  }
  if (resolution.roleAssignmentsByRole.dictionary_reference?.column !== exp.dictionaryReference) {
    mismatches.push(`dictRef:${resolution.roleAssignmentsByRole.dictionary_reference?.column}`);
  }
  if (resolution.roleAssignmentsByRole.dictionary_display_name?.column !== exp.dictionaryDisplayName) {
    mismatches.push(`dictName:${resolution.roleAssignmentsByRole.dictionary_display_name?.column}`);
  }
  if (resolution.roleAssignmentsByRole.valid_from?.column !== exp.validFrom) {
    mismatches.push(`validFrom:${resolution.roleAssignmentsByRole.valid_from?.column}`);
  }
  if (resolution.roleAssignmentsByRole.valid_to?.column !== exp.validTo) {
    mismatches.push(`validTo:${resolution.roleAssignmentsByRole.valid_to?.column}`);
  }
  if (resolution.audit.expectedMappingUsedAsResolverInput !== 0) {
    mismatches.push('expectedMappingUsedAsResolverInput');
  }
  return { ok: mismatches.length === 0, mismatches };
}

const BLIND_REQUIRED: LogicalRoleId[] = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
];

/**
 * Acceptance-only blind rediscovery — no Stage 3D / prior-pilot physical seeds.
 * Ground truth compared only AFTER resolution.
 */
export async function resolveCurrentPositionBlind(input: {
  repoRoot: string;
  question?: string;
}): Promise<{
  schemaRoleResolution: SchemaRoleResolutionResult;
  inputClassifications: BlindEvidenceInputClassification[];
  stage3dBindingsFileLoaded: boolean;
  previousPilotPhysicalBindingsLoaded: boolean;
  blindRediscoveryStatus: 'passed' | 'not_yet_supported' | 'ambiguous';
  postResolutionGroundTruth: ReturnType<typeof compareCurrentPositionGroundTruth>;
  missingCapabilities: string[];
}> {
  const question =
    input.question ??
    'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.';

  const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(input.repoRoot);

  // Ground truth intentionally NOT loaded into resolver input.
  const schemaRoleResolution = resolveSchemaRoles({
    question,
    subjectRole: 'employee',
    targetConcept: 'current_position',
    requiredRoles: BLIND_REQUIRED,
    discoveryMode: 'blind_physical_rediscovery',
    confirmedSubjectSource: {
      owner: P1_VERTICAL_OWNER,
      objectType: 'VIEW',
      objectName: P1_VERTICAL_OBJECT,
      identityColumn: 'ID',
      businessNumberColumn: 'NR_EWIDENCYJNY',
      firstNameColumn: 'IMIE',
      lastNameColumn: 'NAZWISKO',
    },
    temporalIntent: 'current_on_oracle_sysdate',
    evidenceGraph: blind.graph,
  });

  const roles = schemaRoleResolution.roleAssignmentsByRole;
  const postResolutionGroundTruth = compareCurrentPositionGroundTruth({
    assignment: roles.assignment_source?.objectRef,
    subjectReference: roles.subject_reference?.column,
    dictionaryReference: roles.dictionary_reference?.column,
    dictionary: roles.dictionary_identity?.objectRef,
    dictionaryDisplayName: roles.dictionary_display_name?.column,
    validFrom: roles.valid_from?.column,
    validTo: roles.valid_to?.column,
  });

  const missingCapabilities: string[] = [];
  if (!roles.assignment_source?.objectRef) {
    missingCapabilities.push('assignment_source_from_application_graph');
  }
  if (!roles.subject_reference?.column) {
    missingCapabilities.push('employee_assignment_join_predicates');
  }
  if (!roles.dictionary_reference?.column) {
    missingCapabilities.push('assignment_to_dictionary_join_predicates');
  }
  if (
    schemaRoleResolution.temporalResolution.mode === 'unresolved' ||
    !roles.valid_from?.column ||
    !roles.valid_to?.column
  ) {
    missingCapabilities.push('temporal_role_evidence_on_assignment_source');
  }
  if (schemaRoleResolution.chosenRelationPath == null) {
    missingCapabilities.push('complete_subject_to_dictionary_relation_path');
  }

  let blindRediscoveryStatus: 'passed' | 'not_yet_supported' | 'ambiguous' =
    'not_yet_supported';
  if (schemaRoleResolution.overallStatus === 'ambiguous') {
    blindRediscoveryStatus = 'ambiguous';
  } else if (
    postResolutionGroundTruth.matched &&
    (schemaRoleResolution.overallStatus === 'proven_exact' ||
      schemaRoleResolution.overallStatus === 'strong_inference_readonly')
  ) {
    blindRediscoveryStatus = 'passed';
  }

  return {
    schemaRoleResolution,
    inputClassifications: blind.inputClassifications,
    stage3dBindingsFileLoaded: blind.stage3dBindingsFileLoaded,
    previousPilotPhysicalBindingsLoaded: blind.previousPilotPhysicalBindingsLoaded,
    blindRediscoveryStatus,
    postResolutionGroundTruth,
    missingCapabilities,
  };
}

