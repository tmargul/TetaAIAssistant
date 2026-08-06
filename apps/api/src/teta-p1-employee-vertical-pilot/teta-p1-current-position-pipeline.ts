import fs from 'fs';
import path from 'path';
import { decryptSecret } from '../oracle/oracle-crypto';
import { validateCompiledSql } from '../teta-oracle-compiler/teta-oracle-compiled-sql-validator';
import { createFakeOracleAdapter } from '../teta-oracle-executor/teta-oracle-fake-adapter';
import { fullApproval } from '../teta-oracle-executor/teta-oracle-execution-policy';
import { createOracleReadOnlyAdapter } from '../teta-oracle-executor/teta-oracle-readonly-adapter';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import { resolveAppSqlitePath } from '../teta-candidate-scoped-view-metadata-export/teta-view-metadata-oracle-client';
import { buildCurrentPositionChatResponse } from './teta-p1-current-position-chat';
import {
  buildCurrentPositionLogicalRequest,
  buildCurrentPositionQueryPlan,
  compileCurrentPositionSelect,
} from './teta-p1-current-position-compile';
import { resolveCurrentPositionBindings } from './teta-p1-current-position-resolve';
import {
  assertCurrentPositionStrictZeros,
  buildCurrentPositionExactQuestion,
  emptyCurrentPositionCounters,
  P1_CURRENT_POSITION_ACCEPTED_OUTCOME,
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  P1_CURRENT_POSITION_MAX_ROWS,
  P1_CURRENT_POSITION_SCENARIO_ID,
  P1_VERTICAL_GATE_ENV,
  P1_VERTICAL_OWNER,
  validateCurrentPositionEmployeeNumber,
  type CurrentPositionBusinessValidationStatus,
  type CurrentPositionPilotStatus,
  type CurrentPositionResolvedBinding,
  type FieldResolutionStatus,
} from './teta-p1-current-position.types';

export type CurrentPositionRunOptions = {
  question?: string;
  phase?: 'a' | 'b' | 'auto';
  writeArtifacts?: boolean;
  outDir?: string;
  /** Bounded smoke override — digits only, leading zeros preserved as text. */
  employeeNumber?: string;
  declaredEmployeeColumns?: string[];
  forceStatus?: Partial<
    Record<CurrentPositionResolvedBinding['logicalRole'], FieldResolutionStatus>
  >;
  fakeRows?: unknown[][];
  useFakeExecutor?: boolean;
  skipGateCheck?: boolean;
};

function isGateEnabled(): boolean {
  return process.env[P1_VERTICAL_GATE_ENV] === 'true';
}

function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, ' ').trim();
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readOracleCredentials(repoRoot: string) {
  loadDotEnv(path.join(repoRoot, 'apps', 'api', '.env'));
  loadDotEnv(path.join(repoRoot, '.env'));
  const dbPath = resolveAppSqlitePath(repoRoot);
  if (!dbPath) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret || secret === 'change-me-in-production') return null;
    const row = db
      .prepare(
        `SELECT mode, host, port, identifier_type, identifier, tns_alias, username, password_encrypted
         FROM oracle_connection WHERE id = 1`,
      )
      .get() as
      | {
          mode: string;
          host: string | null;
          port: number | null;
          identifier_type: string | null;
          identifier: string | null;
          tns_alias: string | null;
          username: string;
          password_encrypted: string;
        }
      | undefined;
    if (!row) return null;
    const password = decryptSecret(row.password_encrypted, secret);
    let connectString: string;
    if (row.mode === 'tns') {
      connectString = row.tns_alias?.trim() || '';
    } else if (row.identifier_type === 'serviceName') {
      connectString = `${row.host}:${row.port ?? 1521}/${row.identifier}`;
    } else {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
    }
    return { user: row.username, password, connectString };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function runP1EmployeeCurrentPositionPilot(
  repoRoot: string,
  options: CurrentPositionRunOptions = {},
): Promise<Record<string, unknown>> {
  const counters = emptyCurrentPositionCounters();
  const employeeNumber = validateCurrentPositionEmployeeNumber(
    options.employeeNumber ?? P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  );
  const expectedQuestion = buildCurrentPositionExactQuestion(employeeNumber);
  const question = normalizeQuestion(options.question ?? expectedQuestion);
  const phase = options.phase ?? 'auto';
  const gateOn = options.skipGateCheck ? true : isGateEnabled();

  if (!gateOn) {
    return {
      scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
      pilotStatus: 'blocked_gate_disabled' as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      nextQuestionStatus: 'not_started',
      gateEnabled: false,
      employeeNumber,
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
    };
  }

  if (question !== normalizeQuestion(expectedQuestion)) {
    return {
      scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
      pilotStatus: 'blocked_question_mismatch' as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      nextQuestionStatus: 'not_started',
      gateEnabled: true,
      matchedExactQuestion: false,
      employeeNumber,
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
    };
  }

  const resolved = resolveCurrentPositionBindings({
    repoRoot,
    counters,
    declaredEmployeeColumns: options.declaredEmployeeColumns,
    forceStatus: options.forceStatus,
  });

  if (!resolved.employeeSourceAvailable && !options.declaredEmployeeColumns) {
    return {
      scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
      pilotStatus: 'blocked_exact_source_unavailable' as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      nextQuestionStatus: 'not_started',
      employeeNumber,
      fieldBindings: resolved.bindings,
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
    };
  }

  if (!resolved.allResolvedExact) {
    const employeeMissing = resolved.bindings.some(
      (b) =>
        [
          'employee_first_name',
          'employee_last_name',
          'employee_number',
          'employeePrimaryIdentityColumn',
        ].includes(b.logicalRole) && b.resolutionStatus !== 'resolved_exact',
    );
    return {
      scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
      pilotStatus: (employeeMissing
        ? 'blocked_missing_exact_field_binding'
        : 'blocked_missing_exact_current_position_binding') as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      nextQuestionStatus: 'not_started',
      employeeNumber,
      fieldBindings: resolved.bindings,
      logicalRequestCreated: false,
      queryPlanCreated: false,
      compiledSelectCreated: false,
      compiledSelectValidated: false,
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
    };
  }

  const logicalRequest = buildCurrentPositionLogicalRequest({
    question,
    bindings: resolved.bindings,
    employeeNumber,
  });
  const queryPlan = buildCurrentPositionQueryPlan({
    logicalRequest,
    bindings: resolved.bindings,
  });
  const { compiled, bindValues, sqlHash, temporalPredicates } = compileCurrentPositionSelect({
    bindings: resolved.bindings,
    counters,
    employeeNumber,
  });

  let validated = compiled.validation.ok && compiled.compileStatus === 'compiled';
  if (compiled.sqlText) {
    const again = validateCompiledSql({
      sqlText: compiled.sqlText,
      sourceAliases: compiled.sources.map((s) => s.alias),
      resultAliases: compiled.projections.map((p) => p.resultAlias),
      owners: [P1_VERTICAL_OWNER],
      bindPlaceholders: compiled.binds.map((b) => b.placeholder),
    });
    if (!again.ok) {
      compiled.compileStatus = 'rejected_unsafe';
      validated = false;
    }
  }

  const phaseA = {
    logicalRequestCreated: true,
    queryPlanCreated: true,
    compiledSelectCreated: Boolean(compiled.sqlText),
    compiledSelectValidated: validated,
    oracleConnections: 0,
    businessSelectStatementsExecuted: 0,
  };

  const baseArtifacts = {
    scenarioId: P1_CURRENT_POSITION_SCENARIO_ID,
    pilotOnly: true,
    pilotSourceKind: 'vendor_local_vertical_pilot_source',
    candidateId: 'cand:P1:employee',
    candidateApprovalStatus: 'not_approved',
    productionBindingCreated: false,
    reusePolicyModified: false,
    planningEligibilityModified: false,
    gateEnabled: true,
    matchedExactQuestion: true,
    employeeNumber,
    exactQuestion: expectedQuestion,
    fieldBindings: resolved.bindings,
    joinResolution: resolved.bindings.filter((b) =>
      ['employeeToPositionJoin', 'positionToDictionaryJoin'].includes(b.logicalRole),
    ),
    temporalPredicates,
    logicalRequest,
    queryPlan,
    compiledSelect: {
      compileStatus: compiled.compileStatus,
      sqlText: compiled.sqlText,
      sqlSha256: sqlHash,
      binds: compiled.binds,
      validation: compiled.validation,
    },
    bindValues,
    phaseA,
    nextQuestionStatus: 'not_started',
  };

  if (!phaseA.compiledSelectValidated) {
    const result = {
      ...baseArtifacts,
      pilotStatus: 'blocked_phase_a_failed' as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
    };
    maybeWrite(repoRoot, options, result, null, null);
    return result;
  }

  if (phase === 'a') {
    const result = {
      ...baseArtifacts,
      pilotStatus: 'dry_run_ok_awaiting_phase_b' as CurrentPositionPilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      safetyCounters: counters,
      strictErrors: assertCurrentPositionStrictZeros(counters),
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
    };
    maybeWrite(repoRoot, options, result, null, null);
    return result;
  }

  let executionAudit: Record<string, unknown> | null = null;
  let chatResponse: Record<string, unknown> | null = null;
  let pilotStatus: CurrentPositionPilotStatus =
    P1_CURRENT_POSITION_ACCEPTED_OUTCOME.pilotStatus;
  let businessResultValidationStatus: CurrentPositionBusinessValidationStatus =
    P1_CURRENT_POSITION_ACCEPTED_OUTCOME.businessResultValidationStatus;
  let pilotTechnicalStatus: 'passed' | 'failed' | 'blocked' =
    P1_CURRENT_POSITION_ACCEPTED_OUTCOME.pilotTechnicalStatus;
  let pilotBusinessStatus: 'passed' | 'pending' | 'failed' =
    P1_CURRENT_POSITION_ACCEPTED_OUTCOME.pilotBusinessStatus;

  try {
    process.env[P1_VERTICAL_GATE_ENV] = 'true';
    const useFake = options.useFakeExecutor === true || options.fakeRows !== undefined;
    const adapter = useFake
      ? createFakeOracleAdapter({
          selectResult: {
            columns: compiled.projections.map((p) => p.resultAlias),
            rows: options.fakeRows ?? [],
            metaData: compiled.projections.map((p) => ({
              name: p.resultAlias,
              dbTypeName: 'VARCHAR2',
            })),
          },
        })
      : (() => {
          const credentials = readOracleCredentials(repoRoot);
          if (!credentials) throw new Error('oracle_credentials_unavailable');
          return createOracleReadOnlyAdapter({
            credentials,
            bindNames: compiled.binds.map((b) => b.name),
          });
        })();

    const executor = new TetaOracleReadOnlyExecutorService();
    const execResult = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256 ?? sqlHash,
      bindValues,
    });

    if (execResult.executionStatus === 'rejected' || execResult.executionStatus === 'failed') {
      if (
        !useFake &&
        /NJS-510|timeout|unavailable|credentials/i.test(
          String(execResult.rejection?.message ?? ''),
        )
      ) {
        pilotStatus = 'blocked_oracle_unavailable';
        pilotTechnicalStatus = 'blocked';
      } else {
        pilotStatus = 'blocked_phase_a_failed';
        pilotTechnicalStatus = 'failed';
      }
      pilotBusinessStatus = 'pending';
      businessResultValidationStatus = 'pending_user_comparison_with_teta';
    }

    const normalizedRows: unknown[][] = (execResult.rows ?? []).map((row) =>
      Array.isArray(row) ? [...row] : [],
    );

    const chat = buildCurrentPositionChatResponse({
      rows: normalizedRows,
      limitReached: Boolean(execResult.limitReached),
      maxRows: P1_CURRENT_POSITION_MAX_ROWS,
      counters,
      employeeNumber,
    });

    const execCounters = execResult.audit;
    executionAudit = {
      executionStatus: execResult.executionStatus,
      oracleConnectionsOpened: execCounters.connectionsOpened ?? 0,
      oracleConnectionsClosed: execCounters.connectionsClosed ?? 0,
      oracleConnectionsOpenAfterRun: execCounters.openOracleConnectionsAfterRun ?? 0,
      businessSelectStatementsExecuted: execCounters.businessStatements ?? 0,
      businessResultSetsReturned: (execCounters.resultSetsOpened ?? 0) > 0 ? 1 : 0,
      dmlStatementsExecuted: execCounters.writeStatements ?? 0,
      ddlStatementsExecuted: execCounters.ddlStatements ?? 0,
      plsqlBlocksExecuted: execCounters.plsqlBlocks ?? 0,
      commits: execCounters.commits ?? 0,
      rowCount: chat.report.rowCount,
      columnNames: chat.report.columns.map((c) => c.displayLabel),
      employeeRecordCount: chat.multiplicity.employeeRecordCount,
      currentPositionRowCount: chat.multiplicity.currentPositionRowCount,
      multipleEmployeeRecordsDetected: chat.multiplicity.multipleEmployeeRecordsDetected,
      multipleCurrentPositionRowsDetected: chat.multiplicity.multipleCurrentPositionRowsDetected,
      errorMessage: execResult.rejection?.message ?? null,
    };

    chatResponse = {
      message: chat.message,
      report: {
        ...chat.report,
        rows: chat.report.rows.slice(0, 10),
      },
      deliveryStatus: chat.deliveryStatus,
      previewRows: chat.report.rows.slice(0, 10),
      multiplicity: chat.multiplicity,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/oracle_credentials|NJS-510|unavailable|ECONNREFUSED/i.test(msg)) {
      pilotStatus = 'blocked_oracle_unavailable';
      pilotTechnicalStatus = 'blocked';
    } else {
      pilotStatus = 'blocked_phase_a_failed';
      pilotTechnicalStatus = 'failed';
    }
    pilotBusinessStatus = 'pending';
    businessResultValidationStatus = 'pending_user_comparison_with_teta';
    executionAudit = {
      executionStatus: 'failed',
      errorMessage: msg,
      oracleConnectionsOpened: 0,
      oracleConnectionsClosed: 0,
      oracleConnectionsOpenAfterRun: 0,
      businessSelectStatementsExecuted: 0,
      businessResultSetsReturned: 0,
      dmlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      plsqlBlocksExecuted: 0,
      commits: 0,
    };
  }

  const result = {
    ...baseArtifacts,
    pilotStatus,
    businessResultValidationStatus,
    pilotTechnicalStatus,
    pilotBusinessStatus,
    currentPositionBindingValidationStatus:
      P1_CURRENT_POSITION_ACCEPTED_OUTCOME.currentPositionBindingValidationStatus,
    acceptedOutcome: P1_CURRENT_POSITION_ACCEPTED_OUTCOME,
    phaseB: executionAudit,
    chatResponse,
    approvals: {
      stage3dProductionBindingsAdded: 0,
      stage3dProductionBindingsModified: 0,
      reusePolicyEntriesAdded: 0,
      reusePolicyEntriesModified: 0,
      planningEligibleBindingsAdded: 0,
      realDecisionEventsApplied: 0,
      realApprovedGenericBindingsCreated: 0,
    },
    model: {
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      modelGeneratedSqlUsed: 0,
      modelModifiedCompiledSql: 0,
    },
    safetyCounters: counters,
    strictErrors: assertCurrentPositionStrictZeros(counters),
  };

  maybeWrite(repoRoot, options, result, executionAudit, chatResponse);
  return result;
}

function maybeWrite(
  repoRoot: string,
  options: CurrentPositionRunOptions,
  result: Record<string, unknown>,
  executionAudit: Record<string, unknown> | null,
  chatResponse: Record<string, unknown> | null,
) {
  if (options.writeArtifacts === false) return;
  const employeeNumber =
    typeof result.employeeNumber === 'string'
      ? result.employeeNumber
      : P1_CURRENT_POSITION_EMPLOYEE_NUMBER;
  const outDir =
    options.outDir ??
    (employeeNumber === P1_CURRENT_POSITION_EMPLOYEE_NUMBER
      ? path.join(repoRoot, '.local', 'p1-employee-current-position-pilot')
      : path.join(
          repoRoot,
          '.local',
          'p1-employee-current-position-pilot',
          'runs',
          `employee-${employeeNumber}`,
        ));
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, obj: unknown) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2), 'utf8');

  const auditForDisk = { ...result } as Record<string, unknown>;
  if (auditForDisk.chatResponse && typeof auditForDisk.chatResponse === 'object') {
    const chat = { ...(auditForDisk.chatResponse as Record<string, unknown>) };
    if (chat.report && typeof chat.report === 'object') {
      const report = { ...(chat.report as Record<string, unknown>) };
      report.rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
      chat.report = report;
    }
    auditForDisk.chatResponse = chat;
  }
  write('pilot-audit-v1.json', auditForDisk);
  write('logical-request-v1.json', result.logicalRequest ?? {});
  write('field-resolution-v1.json', result.fieldBindings ?? {});
  write('join-resolution-v1.json', result.joinResolution ?? {});
  write('query-plan-v1.json', result.queryPlan ?? {});
  write('compiled-select-v1.json', result.compiledSelect ?? {});
  write('execution-audit-v1.json', executionAudit ?? { phase: 'a_only' });
  write('chat-response-v1.json', chatResponse ?? { phase: 'a_only' });

  const relBase = path
    .relative(repoRoot, outDir)
    .split(path.sep)
    .join('/');
  (result as { localArtifactPaths?: string[] }).localArtifactPaths = [
    `${relBase}/pilot-audit-v1.json`,
    `${relBase}/logical-request-v1.json`,
    `${relBase}/field-resolution-v1.json`,
    `${relBase}/join-resolution-v1.json`,
    `${relBase}/query-plan-v1.json`,
    `${relBase}/compiled-select-v1.json`,
    `${relBase}/execution-audit-v1.json`,
    `${relBase}/chat-response-v1.json`,
  ];
}
