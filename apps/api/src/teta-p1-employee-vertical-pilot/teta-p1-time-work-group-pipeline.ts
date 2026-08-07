import fs from 'fs';
import path from 'path';
import { buildTimeWorkGroupChatResponse } from './teta-p1-time-work-group-chat';
import { compileTimeWorkGroupSelect } from './teta-p1-time-work-group-compile';
import { resolveTimeWorkGroupBindings } from './teta-p1-time-work-group-resolve';
import {
  assertTimeWorkGroupStrictZeros,
  buildTimeWorkGroupExactQuestion,
  emptyTimeWorkGroupCounters,
  P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
  P1_TIME_WORK_GROUP_QUESTION,
  P1_TIME_WORK_GROUP_SCENARIO_ID,
  P1_VERTICAL_GATE_ENV,
  validateTimeWorkGroupEmployeeNumber,
  type TimeWorkGroupPilotStatus,
} from './teta-p1-time-work-group.types';

export type TimeWorkGroupRunOptions = {
  question?: string;
  phase?: 'a' | 'b' | 'auto';
  writeArtifacts?: boolean;
  outDir?: string;
  employeeNumber?: string;
  declaredEmployeeColumns?: string[];
  skipGateCheck?: boolean;
};

function isGateEnabled(): boolean {
  return process.env[P1_VERTICAL_GATE_ENV] === 'true';
}

function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, ' ').trim();
}

export async function runP1EmployeeTimeWorkGroupPilot(
  repoRoot: string,
  options: TimeWorkGroupRunOptions = {},
): Promise<Record<string, unknown>> {
  const counters = emptyTimeWorkGroupCounters();
  const employeeNumber = validateTimeWorkGroupEmployeeNumber(
    options.employeeNumber ?? P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
  );
  const expectedQuestion = buildTimeWorkGroupExactQuestion(employeeNumber);
  const question = normalizeQuestion(options.question ?? expectedQuestion);
  const phase = options.phase ?? 'auto';
  const gateOn = options.skipGateCheck ? true : isGateEnabled();

  if (!gateOn) {
    return {
      scenarioId: P1_TIME_WORK_GROUP_SCENARIO_ID,
      pilotStatus: 'blocked_gate_disabled' as TimeWorkGroupPilotStatus,
      businessResultValidationStatus: 'not_executed',
      gateEnabled: false,
      employeeNumber,
      safetyCounters: counters,
      strictErrors: assertTimeWorkGroupStrictZeros(counters),
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
      metadataOnlyOracleConnections: 0,
    };
  }

  if (question !== normalizeQuestion(expectedQuestion)) {
    return {
      scenarioId: P1_TIME_WORK_GROUP_SCENARIO_ID,
      pilotStatus: 'blocked_question_mismatch' as TimeWorkGroupPilotStatus,
      businessResultValidationStatus: 'not_executed',
      gateEnabled: true,
      matchedExactQuestion: false,
      employeeNumber,
      safetyCounters: counters,
      strictErrors: assertTimeWorkGroupStrictZeros(counters),
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
    };
  }

  const resolved = await resolveTimeWorkGroupBindings({
    repoRoot,
    counters,
    declaredEmployeeColumns: options.declaredEmployeeColumns,
  });

  const chatBlocked = buildTimeWorkGroupChatResponse({
    kind: 'blocked',
    employeeNumber,
    blockingGaps: resolved.blockingGaps,
    candidateCount: resolved.candidates.length,
    counters,
  });

  const base = {
    scenarioId: P1_TIME_WORK_GROUP_SCENARIO_ID,
    pilotOnly: true,
    pilotSourceKind: 'vendor_local_vertical_pilot_source',
    candidateId: 'cand:P1:employee',
    candidateApprovalStatus: 'not_approved',
    productionBindingCreated: false,
    reusePolicyModified: false,
    planningEligibilityModified: false,
    gateEnabled: true,
    matchedExactQuestion: true,
    exactQuestion: expectedQuestion,
    employeeNumber,
    logicalRequest: {
      contractVersion: 'teta-aia-p1-time-work-group-logical-request-v1',
      scenarioId: P1_TIME_WORK_GROUP_SCENARIO_ID,
      subject: 'employee',
      projections: [
        'employee_first_name',
        'employee_last_name',
        'employee_number',
        'current_time_work_group_name',
      ],
      filter: {
        field: 'employee_number',
        operator: 'equals',
        value: employeeNumber,
      },
      temporalIntent: 'current_on_oracle_sysdate',
      maxRows: 50,
      created: false,
      reason: resolved.executionEligible
        ? 'awaiting_compile'
        : 'blocked_before_logical_request_materialization',
    },
    discovery: {
      applicationAnchors: resolved.discovery.applicationAnchors,
      artifactAvailability: resolved.discovery.artifactAvailability,
      stage2eDependencyObjects: resolved.discovery.stage2eDependencyObjects,
      countersNote: resolved.discovery.countersNote,
    },
    schemaRoleResolution: {
      overallStatus: resolved.schemaRoleResolution.overallStatus,
      executionEligibility: resolved.schemaRoleResolution.executionEligibility,
      candidateRanking: resolved.schemaRoleResolution.candidateRanking,
      competingCandidates: resolved.schemaRoleResolution.competingCandidates,
      resolutionExplanation: resolved.schemaRoleResolution.resolutionExplanation,
      temporalResolution: resolved.schemaRoleResolution.temporalResolution,
      roleAssignmentsByRole: resolved.schemaRoleResolution.roleAssignmentsByRole,
      audit: resolved.schemaRoleResolution.audit,
      chosenRelationPath: resolved.schemaRoleResolution.chosenRelationPath,
    },
    candidates: resolved.candidates,
    selectedCandidateRef: resolved.selectedCandidateRef,
    fieldBindings: resolved.fieldBindings,
    relationPathResolution: resolved.schemaRoleResolution.chosenRelationPath ?? [],
    grainCardinalityAssessment: {
      grainAssessment: resolved.grainAssessment,
      cardinalityAssessment: resolved.cardinalityAssessment,
    },
    currentnessAssessment: {
      mode: resolved.currentnessMode,
      evidenceRefs: resolved.currentnessEvidenceRefs,
    },
    semanticAttributionStatus: resolved.semanticAttributionStatus,
    blockingGaps: resolved.blockingGaps,
    allGatesResolvedExact: resolved.allGatesResolvedExact,
    executionEligible: resolved.executionEligible,
    phaseA: {
      discoveryCompleted: true,
      logicalRequestCreated: false,
      queryPlanCreated: false,
      compiledSelectCreated: false,
      compiledSelectValidated: false,
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
      metadataOnlyOracleConnections: 0,
    },
    model: {
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      modelGeneratedSqlUsed: 0,
      modelModifiedCompiledSql: 0,
    },
    approvals: {
      stage3dProductionBindingsAdded: 0,
      stage3dProductionBindingsModified: 0,
      reusePolicyEntriesAdded: 0,
      reusePolicyEntriesModified: 0,
      planningEligibleBindingsAdded: 0,
      realDecisionEventsApplied: 0,
      realApprovedGenericBindingsCreated: 0,
    },
  };

  if (!resolved.employeeSourceAvailable && !options.declaredEmployeeColumns) {
    const result = {
      ...base,
      pilotStatus: 'blocked_exact_source_unavailable' as TimeWorkGroupPilotStatus,
      businessResultValidationStatus: 'not_executed',
      chatResponse: chatBlocked,
      safetyCounters: counters,
      strictErrors: assertTimeWorkGroupStrictZeros(counters),
    };
    maybeWrite(repoRoot, options, result);
    return result;
  }

  if (!resolved.executionEligible) {
    const compile = compileTimeWorkGroupSelect({
      resolution: resolved,
      employeeNumber,
      counters,
    });
    const result = {
      ...base,
      pilotStatus: 'blocked_missing_exact_time_work_group_binding' as TimeWorkGroupPilotStatus,
      businessResultValidationStatus: 'not_executed',
      queryPlanStatus: 'not_created_gates_incomplete',
      compiledSelect: {
        compileStatus: 'blocked',
        blocked: compile.blocked,
        reason: compile.reason,
        sqlText: null,
        sqlSha256: null,
        validation: null,
      },
      bindValues: null,
      phaseB: null,
      chatResponse: chatBlocked,
      employeeRecordCount: null,
      currentTimeWorkGroupRowCount: null,
      multiplicityStatus: null,
      safetyCounters: counters,
      strictErrors: assertTimeWorkGroupStrictZeros(counters),
      oracleConnectionsOpened: 0,
      oracleConnectionsClosed: 0,
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
    };
    maybeWrite(repoRoot, options, result);
    return result;
  }

  // Eligible path — compile deterministic SELECT; Phase B execution is explicit.
  const compile = compileTimeWorkGroupSelect({
    resolution: resolved,
    employeeNumber,
    counters,
  });
  void phase;
  void P1_TIME_WORK_GROUP_QUESTION;
  if (compile.blocked || !compile.compiled) {
    const result = {
      ...base,
      pilotStatus: 'blocked_missing_exact_time_work_group_binding' as TimeWorkGroupPilotStatus,
      businessResultValidationStatus: 'not_executed',
      compiledSelect: {
        compileStatus: 'blocked',
        blocked: true,
        reason: compile.reason,
        sqlText: null,
        sqlSha256: null,
        validation: null,
      },
      bindValues: null,
      chatResponse: chatBlocked,
      safetyCounters: counters,
      strictErrors: assertTimeWorkGroupStrictZeros(counters),
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
    };
    maybeWrite(repoRoot, options, result);
    return result;
  }

  const result = {
    ...base,
    pilotStatus: 'dry_run_ok_awaiting_phase_b' as TimeWorkGroupPilotStatus,
    businessResultValidationStatus: 'not_executed',
    logicalRequest: {
      ...base.logicalRequest,
      created: true,
      reason: 'compiled_from_schema_role_resolution',
    },
    compiledSelect: {
      compileStatus: 'ok',
      blocked: false,
      reason: compile.reason,
      sqlText: compile.compiled.sqlText,
      sqlSha256: compile.compiled.sqlSha256,
      validation: null,
    },
    bindValues: compile.compiled.bindValues,
    chatResponse: chatBlocked,
    safetyCounters: counters,
    strictErrors: assertTimeWorkGroupStrictZeros(counters),
    businessSelectStatementsExecuted: 0,
    businessRowsRead: 0,
  };
  maybeWrite(repoRoot, options, result);
  return result;
}

function maybeWrite(
  repoRoot: string,
  options: TimeWorkGroupRunOptions,
  result: Record<string, unknown>,
) {
  if (options.writeArtifacts === false) return;
  const outDir =
    options.outDir ?? path.join(repoRoot, '.local', 'p1-employee-time-work-group-pilot');
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, obj: unknown) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2), 'utf8');

  write('discovery-audit-v1.json', {
    scenarioId: result.scenarioId,
    discovery: result.discovery,
    pilotStatus: result.pilotStatus,
    blockingGaps: result.blockingGaps,
  });
  write('application-anchor-resolution-v1.json', {
    anchors: (result.discovery as { applicationAnchors?: unknown })?.applicationAnchors ?? [],
    semanticAttributionStatus: result.semanticAttributionStatus,
  });
  write('candidate-set-v1.json', {
    candidates: result.candidates,
    selectedCandidateRef: result.selectedCandidateRef,
  });
  write('field-resolution-v1.json', result.fieldBindings ?? []);
  write('relation-path-resolution-v1.json', result.relationPathResolution ?? []);
  write('grain-cardinality-assessment-v1.json', result.grainCardinalityAssessment ?? {});
  write('currentness-assessment-v1.json', result.currentnessAssessment ?? {});
  write('schema-role-resolution-audit-v1.json', result.schemaRoleResolution ?? {});

  if (result.logicalRequest) write('logical-request-v1.json', result.logicalRequest);
  if (result.compiledSelect && (result.compiledSelect as { sqlText?: string }).sqlText) {
    write('query-plan-v1.json', result.queryPlan ?? {});
    write('compiled-select-v1.json', result.compiledSelect);
    write('execution-audit-v1.json', result.phaseB ?? {});
    write('chat-response-v1.json', result.chatResponse ?? {});
  } else {
    write('chat-response-v1.json', result.chatResponse ?? {});
  }

  (result as { localArtifactPaths?: string[] }).localArtifactPaths = [
    '.local/p1-employee-time-work-group-pilot/discovery-audit-v1.json',
    '.local/p1-employee-time-work-group-pilot/application-anchor-resolution-v1.json',
    '.local/p1-employee-time-work-group-pilot/candidate-set-v1.json',
    '.local/p1-employee-time-work-group-pilot/field-resolution-v1.json',
    '.local/p1-employee-time-work-group-pilot/relation-path-resolution-v1.json',
    '.local/p1-employee-time-work-group-pilot/grain-cardinality-assessment-v1.json',
    '.local/p1-employee-time-work-group-pilot/currentness-assessment-v1.json',
    '.local/p1-employee-time-work-group-pilot/chat-response-v1.json',
  ];
}
