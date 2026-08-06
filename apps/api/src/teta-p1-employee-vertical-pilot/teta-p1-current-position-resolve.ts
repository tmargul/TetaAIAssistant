import fs from 'fs';
import path from 'path';
import { loadAcceptedP1DeclaredColumns } from './teta-p1-vertical-pilot-field-resolve';
import {
  fingerprint,
  P1_CURRENT_POSITION_DICTIONARY,
  P1_CURRENT_POSITION_SOURCE,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  type CurrentPositionResolvedBinding,
  type CurrentPositionSafetyCounters,
} from './teta-p1-current-position.types';
import type { FieldResolutionStatus } from './teta-p1-vertical-pilot.types';

type Stage3dBindingFile = {
  version?: string;
  subjects?: Array<{
    subject?: string;
    sources?: Array<{
      role?: string;
      status?: string;
      logicalObjectNodeId?: string;
      accessObjectNodeId?: string;
    }>;
    joins?: Array<{
      role?: string;
      status?: string;
      joinType?: string;
      leftSourceRole?: string;
      rightSourceRole?: string;
      predicates?: Array<{
        leftOracleColumnNodeId?: string;
        rightOracleColumnNodeId?: string;
        operator?: string;
      }>;
      joinNodeId?: string | null;
    }>;
    relations?: Array<{
      role?: string;
      status?: string;
      joinType?: string;
      leftSourceRole?: string;
      rightSourceRole?: string;
      predicates?: Array<{
        leftOracleColumnNodeId?: string;
        rightOracleColumnNodeId?: string;
        operator?: string;
      }>;
      joinNodeId?: string | null;
    }>;
    valuePaths?: Array<{
      role?: string;
      status?: string;
      displayColumnNodeId?: string;
      displaySourceRole?: string;
      steps?: Array<{
        sourceRole?: string;
        columnNodeId?: string;
        displayColumnNodeId?: string;
      }>;
    }>;
    temporals?: Array<{
      role?: string;
      status?: string;
      sourceRole?: string;
      validFromColumnNodeId?: string;
      validToColumnNodeId?: string;
      openEndedEndAllowed?: boolean;
      startInclusive?: boolean;
      endInclusive?: boolean;
      clock?: string;
    }>;
  }>;
};

function parseOracleColumnNode(nodeId: string | undefined): {
  owner: string;
  objectName: string;
  columnName: string;
} | null {
  if (!nodeId) return null;
  const m = /^oracle-column:([^:]+):([^:]+):(.+)$/.exec(nodeId);
  if (!m) return null;
  return { owner: m[1]!, objectName: m[2]!, columnName: m[3]! };
}

function parseOracleObjectNode(nodeId: string | undefined): {
  owner: string;
  objectType: string;
  objectName: string;
} | null {
  if (!nodeId) return null;
  const m = /^oracle-object:([^:]+):([^:]+):(.+)$/.exec(nodeId);
  if (!m) return null;
  return { owner: m[1]!, objectType: m[2]!, objectName: m[3]! };
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

export function resolveCurrentPositionBindings(input: {
  repoRoot: string;
  counters: CurrentPositionSafetyCounters;
  /** Test override: force a role to ambiguous/missing. */
  forceStatus?: Partial<Record<CurrentPositionResolvedBinding['logicalRole'], FieldResolutionStatus>>;
  declaredEmployeeColumns?: string[];
}): {
  bindings: CurrentPositionResolvedBinding[];
  allResolvedExact: boolean;
  employeeSourceAvailable: boolean;
  stage3dAvailable: boolean;
} {
  const bindingsPath = path.join(
    input.repoRoot,
    'apps',
    'api',
    'config',
    'teta-business-semantic-bindings-v1.json',
  );
  const loadedEmployees = loadAcceptedP1DeclaredColumns(input.repoRoot);
  const declared = new Set(
    (input.declaredEmployeeColumns ?? loadedEmployees.columns).map((c) => c.toUpperCase()),
  );
  const employeeSourceAvailable = declared.size > 0 || Boolean(input.declaredEmployeeColumns?.length);
  const stage3dAvailable = fs.existsSync(bindingsPath);

  const employeeEvidence = [
    ...loadedEmployees.evidenceRefs,
    'stage3d:teta-business-semantic-bindings-v1',
  ];

  const resolveEmployeeCol = (
    role: CurrentPositionResolvedBinding['logicalRole'],
    candidates: string[],
  ): CurrentPositionResolvedBinding => {
    if (input.forceStatus?.[role] === 'ambiguous') {
      input.counters.ambiguousPositionBindingAutoSelected += 0;
      return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, 'ambiguous', [
        ...employeeEvidence,
        'forced_ambiguous',
      ]);
    }
    if (input.forceStatus?.[role] === 'missing' || input.forceStatus?.[role] === 'stale') {
      return binding(
        role,
        `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
        null,
        input.forceStatus[role]!,
        [...employeeEvidence, `forced_${input.forceStatus[role]}`],
      );
    }
    const present = candidates.filter((c) => declared.has(c.toUpperCase()));
    if (present.length === 1) {
      return binding(
        role,
        `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
        present[0]!,
        'resolved_exact',
        [...employeeEvidence, `declaredColumn:${present[0]}`],
      );
    }
    if (present.length > 1) {
      return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, 'ambiguous', [
        ...employeeEvidence,
        `ambiguousCandidates:${present.join(',')}`,
      ]);
    }
    return binding(role, `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`, null, 'missing', [
      ...employeeEvidence,
      `candidatesNotInView:${candidates.join(',')}`,
    ]);
  };

  const employeeBindings = [
    resolveEmployeeCol('employee_first_name', ['IMIE']),
    resolveEmployeeCol('employee_last_name', ['NAZWISKO']),
    resolveEmployeeCol('employee_number', ['NR_EWIDENCYJNY']),
    resolveEmployeeCol('employeePrimaryIdentityColumn', ['ID']),
  ];

  if (!stage3dAvailable) {
    input.counters.guessedCurrentPositionSource += 1;
    const missingPos = binding(
      'currentPositionSourceRef',
      null,
      null,
      'missing',
      ['stage3d_bindings_unavailable'],
    );
    const bindings = [...employeeBindings, missingPos];
    return {
      bindings,
      allResolvedExact: false,
      employeeSourceAvailable,
      stage3dAvailable: false,
    };
  }

  const file = JSON.parse(fs.readFileSync(bindingsPath, 'utf8')) as Stage3dBindingFile;
  // Technical evidence only — BHP subject carries the approved physical map for current_position.
  const subject =
    file.subjects?.find((s) => s.subject === 'occupational_health_examinations') ??
    file.subjects?.[0];
  const evidenceBase = [
    'stage3d:teta-business-semantic-bindings-v1',
    'stage3d_subject:occupational_health_examinations:technical_evidence_only',
    `bindings_version:${file.version ?? 'unknown'}`,
  ];

  const positionSource = subject?.sources?.find((s) => s.role === 'current_position');
  const dictionarySource = subject?.sources?.find((s) => s.role === 'position_dictionary');
  const empToPos = (subject?.relations ?? subject?.joins)?.find(
    (j) => j.role === 'employee_to_current_position',
  );
  const posToDict = (subject?.relations ?? subject?.joins)?.find(
    (j) => j.role === 'current_position_to_position_dictionary',
  );
  const positionNamePath = subject?.valuePaths?.find((v) => v.role === 'position_name');
  const temporal = subject?.temporals?.find((t) => t.role === 'current_position_on_oracle_sysdate');

  const resolveObjectRole = (
    role: CurrentPositionResolvedBinding['logicalRole'],
    source: { status?: string; logicalObjectNodeId?: string; accessObjectNodeId?: string } | undefined,
    expectedObject: string,
    guessCounter: keyof CurrentPositionSafetyCounters,
  ): CurrentPositionResolvedBinding => {
    if (input.forceStatus?.[role] === 'ambiguous') {
      return binding(role, null, null, 'ambiguous', [...evidenceBase, 'forced_ambiguous']);
    }
    if (input.forceStatus?.[role] === 'missing' || input.forceStatus?.[role] === 'stale') {
      return binding(role, null, null, input.forceStatus[role]!, [
        ...evidenceBase,
        `forced_${input.forceStatus[role]}`,
      ]);
    }
    if (input.forceStatus?.[role] === 'conflicting') {
      return binding(role, null, null, 'conflicting', [...evidenceBase, 'forced_conflicting']);
    }
    const parsed = parseOracleObjectNode(source?.logicalObjectNodeId ?? source?.accessObjectNodeId);
    if (!source || source.status !== 'approved' || !parsed) {
      input.counters[guessCounter] += 0; // do not guess
      return binding(role, null, null, 'missing', [...evidenceBase, `${role}_not_approved`]);
    }
    if (parsed.owner !== P1_VERTICAL_OWNER || parsed.objectName !== expectedObject) {
      // Do not auto-select alternate dictionary (e.g. SL_STAN)
      return binding(role, `${parsed.owner}.${parsed.objectName}`, null, 'conflicting', [
        ...evidenceBase,
        `expected:${expectedObject}`,
        `found:${parsed.objectName}`,
      ]);
    }
    return binding(
      role,
      `${parsed.owner}.${parsed.objectName}`,
      null,
      'resolved_exact',
      [...evidenceBase, source.logicalObjectNodeId ?? source.accessObjectNodeId!],
    );
  };

  const currentPositionSourceRef = resolveObjectRole(
    'currentPositionSourceRef',
    positionSource,
    P1_CURRENT_POSITION_SOURCE,
    'guessedCurrentPositionSource',
  );
  const dictionarySourceRef = resolveObjectRole(
    'dictionarySourceRef',
    dictionarySource,
    P1_CURRENT_POSITION_DICTIONARY,
    'guessedPositionDictionary',
  );

  const resolveJoinColumn = (
    role: CurrentPositionResolvedBinding['logicalRole'],
    nodeId: string | undefined,
    expectedObject: string,
    expectedColumn: string,
    joinRole: string,
  ): CurrentPositionResolvedBinding => {
    if (input.forceStatus?.[role] === 'ambiguous') {
      return binding(role, null, null, 'ambiguous', [...evidenceBase, 'forced_ambiguous']);
    }
    if (input.forceStatus?.[role] && input.forceStatus[role] !== 'resolved_exact') {
      return binding(role, null, null, input.forceStatus[role]!, [
        ...evidenceBase,
        `forced_${input.forceStatus[role]}`,
      ]);
    }
    const parsed = parseOracleColumnNode(nodeId);
    if (!parsed) {
      return binding(role, null, null, 'missing', [...evidenceBase, `${joinRole}_column_missing`]);
    }
    if (parsed.objectName !== expectedObject || parsed.columnName !== expectedColumn) {
      return binding(
        role,
        `${parsed.owner}.${parsed.objectName}`,
        parsed.columnName,
        'conflicting',
        [...evidenceBase, nodeId!, `expected:${expectedObject}.${expectedColumn}`],
      );
    }
    return binding(
      role,
      `${parsed.owner}.${parsed.objectName}`,
      parsed.columnName,
      'resolved_exact',
      [...evidenceBase, nodeId!, `join_role:${joinRole}`],
    );
  };

  const empJoinLeft = empToPos?.predicates?.[0]?.leftOracleColumnNodeId;
  const empJoinRight = empToPos?.predicates?.[0]?.rightOracleColumnNodeId;
  // Re-check employee primary identity against join evidence
  const joinIdentity = resolveJoinColumn(
    'employeePrimaryIdentityColumn',
    empJoinLeft,
    P1_VERTICAL_OBJECT,
    'ID',
    'employee_to_current_position',
  );
  // Prefer declared+join agreement
  const employeePrimary =
    employeeBindings.find((b) => b.logicalRole === 'employeePrimaryIdentityColumn')!;
  const employeePrimaryMerged: CurrentPositionResolvedBinding =
    employeePrimary.resolutionStatus === 'resolved_exact' &&
    joinIdentity.resolutionStatus === 'resolved_exact' &&
    employeePrimary.physicalColumn === joinIdentity.physicalColumn
      ? binding(
          'employeePrimaryIdentityColumn',
          employeePrimary.physicalObject,
          employeePrimary.physicalColumn,
          'resolved_exact',
          [
            ...employeePrimary.evidenceRefs,
            ...joinIdentity.evidenceRefs,
            'declared_and_stage3d_join_agree',
          ],
        )
      : employeePrimary.resolutionStatus !== 'resolved_exact'
        ? employeePrimary
        : joinIdentity.resolutionStatus !== 'resolved_exact'
          ? joinIdentity
          : binding(
              'employeePrimaryIdentityColumn',
              null,
              null,
              'conflicting',
              [...employeePrimary.evidenceRefs, ...joinIdentity.evidenceRefs],
            );

  const positionEmployeeReferenceColumn = resolveJoinColumn(
    'positionEmployeeReferenceColumn',
    empJoinRight,
    P1_CURRENT_POSITION_SOURCE,
    'PRAC_ID',
    'employee_to_current_position',
  );

  const employeeToPositionJoin: CurrentPositionResolvedBinding = (() => {
    if (input.forceStatus?.employeeToPositionJoin) {
      return binding(
        'employeeToPositionJoin',
        null,
        null,
        input.forceStatus.employeeToPositionJoin,
        [...evidenceBase, `forced_${input.forceStatus.employeeToPositionJoin}`],
      );
    }
    if (
      empToPos?.status === 'approved' &&
      empToPos.joinType === 'left' &&
      employeePrimaryMerged.resolutionStatus === 'resolved_exact' &&
      positionEmployeeReferenceColumn.resolutionStatus === 'resolved_exact'
    ) {
      return binding(
        'employeeToPositionJoin',
        `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_SOURCE}`,
        `${employeePrimaryMerged.physicalColumn}=${positionEmployeeReferenceColumn.physicalColumn}`,
        'resolved_exact',
        [
          ...evidenceBase,
          'join_role:employee_to_current_position',
          empJoinLeft!,
          empJoinRight!,
        ],
      );
    }
    input.counters.guessedEmployeePositionJoin += 0;
    return binding('employeeToPositionJoin', null, null, 'missing', [
      ...evidenceBase,
      'employee_to_current_position_incomplete',
    ]);
  })();

  const posDictLeft = posToDict?.predicates?.[0]?.leftOracleColumnNodeId;
  const posDictRight = posToDict?.predicates?.[0]?.rightOracleColumnNodeId;
  const positionIdColumn = resolveJoinColumn(
    'positionIdColumn',
    posDictLeft,
    P1_CURRENT_POSITION_SOURCE,
    'SSTN_ID',
    'current_position_to_position_dictionary',
  );
  const dictionaryIdColumn = resolveJoinColumn(
    'dictionaryIdColumn',
    posDictRight,
    P1_CURRENT_POSITION_DICTIONARY,
    'ID',
    'current_position_to_position_dictionary',
  );

  const positionToDictionaryJoin: CurrentPositionResolvedBinding = (() => {
    if (input.forceStatus?.positionToDictionaryJoin) {
      return binding(
        'positionToDictionaryJoin',
        null,
        null,
        input.forceStatus.positionToDictionaryJoin,
        [...evidenceBase, `forced_${input.forceStatus.positionToDictionaryJoin}`],
      );
    }
    if (
      posToDict?.status === 'approved' &&
      positionIdColumn.resolutionStatus === 'resolved_exact' &&
      dictionaryIdColumn.resolutionStatus === 'resolved_exact'
    ) {
      return binding(
        'positionToDictionaryJoin',
        `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_DICTIONARY}`,
        `${positionIdColumn.physicalColumn}=${dictionaryIdColumn.physicalColumn}`,
        'resolved_exact',
        [
          ...evidenceBase,
          'join_role:current_position_to_position_dictionary',
          posDictLeft!,
          posDictRight!,
          posToDict.joinNodeId ? `joinNodeId:${posToDict.joinNodeId}` : 'joinNodeId:null',
        ],
      );
    }
    return binding('positionToDictionaryJoin', null, null, 'missing', [
      ...evidenceBase,
      'position_to_dictionary_incomplete',
    ]);
  })();

  const positionNameColumn: CurrentPositionResolvedBinding = (() => {
    if (input.forceStatus?.positionNameColumn) {
      return binding(
        'positionNameColumn',
        null,
        null,
        input.forceStatus.positionNameColumn,
        [...evidenceBase, `forced_${input.forceStatus.positionNameColumn}`],
      );
    }
    const display = parseOracleColumnNode(positionNamePath?.displayColumnNodeId);
    if (
      positionNamePath?.status === 'approved' &&
      display &&
      display.objectName === P1_CURRENT_POSITION_DICTIONARY &&
      display.columnName === 'NAZWA'
    ) {
      return binding(
        'positionNameColumn',
        `${display.owner}.${display.objectName}`,
        display.columnName,
        'resolved_exact',
        [...evidenceBase, positionNamePath.displayColumnNodeId!, 'valuePath:position_name'],
      );
    }
    // Stale Stage 3C fixture put NAZWA on KDR — reject that as conflicting if somehow present
    return binding('positionNameColumn', null, null, 'missing', [
      ...evidenceBase,
      'position_name_display_unresolved',
    ]);
  })();

  const current_position_name = binding(
    'current_position_name',
    positionNameColumn.physicalObject,
    positionNameColumn.physicalColumn,
    positionNameColumn.resolutionStatus,
    [...positionNameColumn.evidenceRefs, 'projection:current_position_name'],
  );

  const resolveTemporalCol = (
    role: 'positionValidFromColumn' | 'positionValidToColumn',
    nodeId: string | undefined,
    expected: string,
  ): CurrentPositionResolvedBinding => {
    if (input.forceStatus?.[role]) {
      return binding(role, null, null, input.forceStatus[role]!, [
        ...evidenceBase,
        `forced_${input.forceStatus[role]}`,
      ]);
    }
    const parsed = parseOracleColumnNode(nodeId);
    if (
      temporal?.status === 'approved' &&
      temporal.clock === 'oracle_sysdate' &&
      temporal.openEndedEndAllowed === true &&
      parsed &&
      parsed.objectName === P1_CURRENT_POSITION_SOURCE &&
      parsed.columnName === expected
    ) {
      return binding(
        role,
        `${parsed.owner}.${parsed.objectName}`,
        parsed.columnName,
        'resolved_exact',
        [...evidenceBase, nodeId!, 'temporal:current_position_on_oracle_sysdate'],
      );
    }
    return binding(role, null, null, 'missing', [
      ...evidenceBase,
      `temporal_${expected}_unresolved`,
    ]);
  };

  const positionValidFromColumn = resolveTemporalCol(
    'positionValidFromColumn',
    temporal?.validFromColumnNodeId,
    'DATA_OD',
  );
  const positionValidToColumn = resolveTemporalCol(
    'positionValidToColumn',
    temporal?.validToColumnNodeId,
    'DATA_DO',
  );

  const bindings: CurrentPositionResolvedBinding[] = [
    ...employeeBindings.filter((b) => b.logicalRole !== 'employeePrimaryIdentityColumn'),
    employeePrimaryMerged,
    currentPositionSourceRef,
    positionEmployeeReferenceColumn,
    positionIdColumn,
    positionValidFromColumn,
    positionValidToColumn,
    dictionarySourceRef,
    dictionaryIdColumn,
    positionNameColumn,
    employeeToPositionJoin,
    positionToDictionaryJoin,
    current_position_name,
  ];

  return {
    bindings,
    allResolvedExact: bindings.every((b) => b.resolutionStatus === 'resolved_exact'),
    employeeSourceAvailable,
    stage3dAvailable,
  };
}

export function byRole(
  bindings: CurrentPositionResolvedBinding[],
  role: CurrentPositionResolvedBinding['logicalRole'],
): CurrentPositionResolvedBinding | undefined {
  return bindings.find((b) => b.logicalRole === role);
}
