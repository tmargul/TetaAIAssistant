import fs from 'fs';
import path from 'path';
import { decryptSecret } from '../oracle/oracle-crypto';
import { validateCompiledSql } from '../teta-oracle-compiler/teta-oracle-compiled-sql-validator';
import { createFakeOracleAdapter } from '../teta-oracle-executor/teta-oracle-fake-adapter';
import { fullApproval } from '../teta-oracle-executor/teta-oracle-execution-policy';
import { createOracleReadOnlyAdapter } from '../teta-oracle-executor/teta-oracle-readonly-adapter';
import { TetaOracleReadOnlyExecutorService } from '../teta-oracle-executor/teta-oracle-readonly-executor.service';
import { resolveAppSqlitePath } from '../teta-candidate-scoped-view-metadata-export/teta-view-metadata-oracle-client';
import { buildPilotChatResponse } from './teta-p1-vertical-pilot-chat';
import {
  buildPilotLogicalRequest,
  buildPilotQueryPlan,
  compilePilotStartsWithSelect,
} from './teta-p1-vertical-pilot-compile';
import { resolvePilotFields } from './teta-p1-vertical-pilot-field-resolve';
import {
  assertP1VerticalStrictZeros,
  emptyP1VerticalCounters,
  P1_VERTICAL_ACCEPTED_OUTCOME,
  P1_VERTICAL_GATE_ENV,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  P1_VERTICAL_QUESTION,
  type BusinessResultValidationStatus,
  type PilotStatus,
  type P1VerticalSafetyCounters,
} from './teta-p1-vertical-pilot.types';

export type PilotRunOptions = {
  question?: string;
  phase?: 'a' | 'b' | 'auto';
  writeArtifacts?: boolean;
  outDir?: string;
  /** Injected for tests */
  declaredColumns?: string[];
  forceAmbiguous?: Parameters<typeof resolvePilotFields>[0]['forceAmbiguous'];
  fakeRows?: unknown[][];
  skipGateCheck?: boolean;
  /** Force Phase B with fake adapter (unit tests) */
  useFakeExecutor?: boolean;
};

function isGateEnabled(): boolean {
  return process.env[P1_VERTICAL_GATE_ENV] === 'true';
}

function normalizeQuestion(q: string): string {
  return q.replace(/\s+/g, ' ').trim();
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

export async function runP1EmployeeVerticalPilot(
  repoRoot: string,
  options: PilotRunOptions = {},
): Promise<Record<string, unknown>> {
  const counters = emptyP1VerticalCounters();
  const question = normalizeQuestion(options.question ?? P1_VERTICAL_QUESTION);
  const phase = options.phase ?? 'auto';
  const gateOn = options.skipGateCheck ? true : isGateEnabled();

  if (!gateOn) {
    const blocked = {
      pilotStatus: 'blocked_gate_disabled' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      gateEnabled: false,
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
    };
    return blocked;
  }

  if (question !== normalizeQuestion(P1_VERTICAL_QUESTION)) {
    return {
      pilotStatus: 'blocked_question_mismatch' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      gateEnabled: true,
      matchedExactQuestion: false,
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
    };
  }

  const resolved = resolvePilotFields({
    repoRoot,
    counters,
    declaredColumns: options.declaredColumns,
    forceAmbiguous: options.forceAmbiguous,
  });

  if (!resolved.sourceAvailable && !options.declaredColumns) {
    return {
      pilotStatus: 'blocked_exact_source_unavailable' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      gateEnabled: true,
      fieldBindings: resolved.bindings,
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
    };
  }

  if (!resolved.allResolvedExact) {
    return {
      pilotStatus: 'blocked_missing_exact_field_binding' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      gateEnabled: true,
      fieldBindings: resolved.bindings,
      logicalRequestCreated: false,
      queryPlanCreated: false,
      compiledSelectCreated: false,
      compiledSelectValidated: false,
      oracleConnections: 0,
      businessSelectStatementsExecuted: 0,
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
    };
  }

  const logicalRequest = buildPilotLogicalRequest({
    question,
    bindings: resolved.bindings,
  });
  const queryPlan = buildPilotQueryPlan({ logicalRequest, bindings: resolved.bindings });
  const { compiled, bindValues, sqlHash } = compilePilotStartsWithSelect({
    bindings: resolved.bindings,
    counters,
  });

  const validated = compiled.validation.ok && compiled.compileStatus === 'compiled';
  // Re-validate for audit
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
    }
  }

  const phaseA = {
    logicalRequestCreated: true,
    queryPlanCreated: true,
    compiledSelectCreated: Boolean(compiled.sqlText),
    compiledSelectValidated: validated && compiled.compileStatus === 'compiled',
    oracleConnections: 0,
    businessSelectStatementsExecuted: 0,
  };

  const baseArtifacts = {
    pilotOnly: true,
    pilotSourceKind: 'vendor_local_vertical_pilot_source',
    candidateId: 'cand:P1:employee',
    candidateApprovalStatus: 'not_approved',
    productionBindingCreated: false,
    reusePolicyModified: false,
    planningEligibilityModified: false,
    gateEnabled: true,
    matchedExactQuestion: true,
    fieldBindings: resolved.bindings,
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
    exactOracleTarget: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
    phaseA,
  };

  if (!phaseA.compiledSelectValidated) {
    const result = {
      ...baseArtifacts,
      pilotStatus: 'blocked_phase_a_failed' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
    };
    maybeWrite(repoRoot, options, result, null, null);
    return result;
  }

  if (phase === 'a') {
    const result = {
      ...baseArtifacts,
      pilotStatus: 'dry_run_ok_awaiting_phase_b' as PilotStatus,
      businessResultValidationStatus: 'pending_user_comparison_with_teta',
      safetyCounters: counters,
      strictErrors: assertP1VerticalStrictZeros(counters),
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
    };
    maybeWrite(repoRoot, options, result, null, null);
    return result;
  }

  // Phase B
  const executor = new TetaOracleReadOnlyExecutorService();
  let executionAudit: Record<string, unknown> | null = null;
  let chatResponse: Record<string, unknown> | null = null;
  let pilotStatus: PilotStatus = P1_VERTICAL_ACCEPTED_OUTCOME.pilotStatus;
  let businessResultValidationStatus: BusinessResultValidationStatus =
    P1_VERTICAL_ACCEPTED_OUTCOME.businessResultValidationStatus;
  let pilotTechnicalStatus: 'passed' | 'failed' | 'blocked' =
    P1_VERTICAL_ACCEPTED_OUTCOME.pilotTechnicalStatus;
  let pilotBusinessStatus: 'passed' | 'pending' | 'failed' =
    P1_VERTICAL_ACCEPTED_OUTCOME.pilotBusinessStatus;

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
              dbTypeName: p.businessRole === 'employee_birth_date' ? 'DATE' : 'VARCHAR2',
            })),
          },
        })
      : (() => {
          const credentials = readOracleCredentials(repoRoot);
          if (!credentials) {
            throw new Error('oracle_credentials_unavailable');
          }
          return createOracleReadOnlyAdapter({
            credentials,
            bindNames: compiled.binds.map((b) => b.name),
          });
        })();

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
        pilotBusinessStatus = 'pending';
        businessResultValidationStatus = 'pending_user_comparison_with_teta';
      } else {
        pilotStatus = 'blocked_phase_a_failed';
        pilotTechnicalStatus = 'failed';
        pilotBusinessStatus = 'pending';
        businessResultValidationStatus = 'pending_user_comparison_with_teta';
      }
    }

    const normalizedRows: unknown[][] = (execResult.rows ?? []).map((row) =>
      Array.isArray(row) ? [...row] : [],
    );

    const chat = buildPilotChatResponse({
      rows: normalizedRows,
      columnOrder: compiled.projections.map((p) => ({
        businessRole: p.businessRole,
        displayLabel: p.displayLabel ?? p.businessRole,
        valueKind:
          p.businessRole === 'employee_number'
            ? 'text'
            : p.businessRole === 'employee_birth_date'
              ? 'date'
              : 'text',
      })),
      bindings: resolved.bindings,
      limitReached: Boolean(execResult.limitReached),
      maxRows: 500,
      counters,
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
      targetObject: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
      errorMessage: execResult.rejection?.message ?? null,
    };

    chatResponse = {
      message: chat.message,
      report: chat.report,
      deliveryStatus: chat.deliveryStatus,
      previewRows: chat.report.rows.slice(0, 10),
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
    acceptedOutcome: P1_VERTICAL_ACCEPTED_OUTCOME,
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
    strictErrors: assertP1VerticalStrictZeros(counters),
  };

  maybeWrite(repoRoot, options, result, executionAudit, chatResponse);
  return result;
}

function maybeWrite(
  repoRoot: string,
  options: PilotRunOptions,
  result: Record<string, unknown>,
  executionAudit: Record<string, unknown> | null,
  chatResponse: Record<string, unknown> | null,
) {
  if (options.writeArtifacts === false) return;
  const outDir =
    options.outDir ?? path.join(repoRoot, '.local', 'p1-employee-vertical-pilot');
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, obj: unknown) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2), 'utf8');

  // Redact in-memory business rows from the on-disk pilot audit (keep preview only).
  const auditForDisk = { ...result } as Record<string, unknown>;
  if (auditForDisk.chatResponse && typeof auditForDisk.chatResponse === 'object') {
    const chat = { ...(auditForDisk.chatResponse as Record<string, unknown>) };
    if (chat.report && typeof chat.report === 'object') {
      const report = { ...(chat.report as Record<string, unknown>) };
      report.rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
      chat.report = report;
    }
    if (Array.isArray(chat.previewRows)) {
      chat.previewRows = (chat.previewRows as unknown[]).slice(0, 10);
    }
    auditForDisk.chatResponse = chat;
  }
  write('pilot-audit-v1.json', auditForDisk);
  write('logical-request-v1.json', result.logicalRequest ?? {});
  write('query-plan-v1.json', result.queryPlan ?? {});
  write('compiled-select-v1.json', result.compiledSelect ?? {});
  write('execution-audit-v1.json', executionAudit ?? { phase: 'a_only' });
  // Persist chat metadata + preview only (max 10) — never full employee result sets in audit dumps.
  const chatForDisk =
    chatResponse && typeof chatResponse === 'object'
      ? (() => {
          const chat = { ...(chatResponse as Record<string, unknown>) };
          if (chat.report && typeof chat.report === 'object') {
            const report = { ...(chat.report as Record<string, unknown>) };
            const rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
            report.rows = rows;
            chat.report = report;
          }
          if (Array.isArray(chat.previewRows)) {
            chat.previewRows = (chat.previewRows as unknown[]).slice(0, 10);
          }
          return chat;
        })()
      : (chatResponse ?? { phase: 'a_only' });
  write('chat-response-v1.json', chatForDisk);
  (result as { localArtifactPaths?: string[] }).localArtifactPaths = [
    '.local/p1-employee-vertical-pilot/pilot-audit-v1.json',
    '.local/p1-employee-vertical-pilot/logical-request-v1.json',
    '.local/p1-employee-vertical-pilot/query-plan-v1.json',
    '.local/p1-employee-vertical-pilot/compiled-select-v1.json',
    '.local/p1-employee-vertical-pilot/execution-audit-v1.json',
    '.local/p1-employee-vertical-pilot/chat-response-v1.json',
  ];
}
