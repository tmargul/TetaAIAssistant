/**
 * Stage 3F — controlled read-only executor.
 *
 * Order of operations is the safety property: gate the compiled statement, check the approval flags,
 * and only then open a connection. The preflight settles the session identity before the business
 * statement runs, and the statement executed is byte-for-byte `compiled.sqlText` — this service never
 * builds, rewrites or concatenates SQL.
 */
import { validateCompiledSql } from '../teta-oracle-compiler/teta-oracle-compiled-sql-validator';
import type { TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { gateCompiledSelect } from './teta-oracle-execution-gate';
import { evaluateExecutionPolicy } from './teta-oracle-execution-policy';
import { emptyStage3fCounters } from './teta-oracle-executor-contract';
import { buildResultColumns } from './teta-oracle-result-metadata';
import { isUnsupportedOracleDbType, normalizeRows } from './teta-oracle-result-normalizer';
import { isLimitReached, validateReadResult } from './teta-oracle-result-validator';
import { validateSessionUser } from './teta-oracle-session-validator';
import {
  STAGE3F_DIALECT,
  STAGE3F_MAX_COLUMNS,
  STAGE3F_MAX_ROWS,
  STAGE3F_RESULT_CONTRACT_VERSION,
  STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
  STAGE3F_STATEMENT_TIMEOUT_MS,
  type Stage3fAdapterSelectResult,
  type Stage3fAuditCounters,
  type Stage3fExecutionRequest,
  type Stage3fExecutionStatus,
  type Stage3fGateReport,
  type Stage3fPolicyDecision,
  type Stage3fResultColumn,
  type Stage3fResultValidation,
  type Stage3fResultRow,
  type Stage3fViolation,
  type TetaOracleReadResult,
} from './teta-oracle-executor.types';

const TIMEOUT_ERROR_RE = /timeout|timed out|DPI-1067|ORA-01013|NJS-500/i;

export class Stage3fTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Statement exceeded the ${timeoutMs} ms Stage 3F timeout and was cancelled`);
    this.name = 'Stage3fTimeoutError';
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Stage3fTimeoutError) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return TIMEOUT_ERROR_RE.test(message);
}

/** Error text may echo Oracle diagnostics; row values never reach it because no row is bound. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown error');
}

type Timings = TetaOracleReadResult['timings'];

function emptyTimings(): Timings {
  return {
    gateMs: 0,
    connectMs: 0,
    preflightMs: 0,
    executeMs: 0,
    normalizeMs: 0,
    totalMs: 0,
  };
}

type BuildResultInput = {
  compiled: TetaCompiledOracleSelect;
  executionStatus: Stage3fExecutionStatus;
  gate: Stage3fGateReport;
  policy: Stage3fPolicyDecision;
  columns: Stage3fResultColumn[];
  rows: Stage3fResultRow[];
  sessionUser: string | null;
  counters: Stage3fAuditCounters;
  timings: Timings;
  resultValidation: Stage3fResultValidation | null;
  rejection: Stage3fViolation | null;
  warnings: Stage3fViolation[];
  generatedAt: string;
};

function buildResult(input: BuildResultInput): TetaOracleReadResult {
  const maxRows = input.compiled.limits?.maxRows ?? STAGE3F_MAX_ROWS;
  const hashOk =
    input.gate.checks.sql_hash_recomputed === true && input.gate.recomputedSqlSha256 !== null;
  const revalidated = input.gate.checks.revalidated_compiled_sql === true;
  return {
    contractVersion: STAGE3F_RESULT_CONTRACT_VERSION,
    executionStatus: input.executionStatus,
    sourceSelectContractVersion: STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
    dialect: STAGE3F_DIALECT,
    intent: input.compiled.intent,
    subject: input.compiled.subject,
    reportGrain: input.compiled.reportGrain ?? null,
    sourceSqlSha256: input.compiled.sqlSha256 ?? null,
    sqlSha256: input.gate.recomputedSqlSha256,
    sessionUser: input.sessionUser,
    oracleSession: {
      verified: input.sessionUser === 'TETA_ADMIN',
      sessionUser: input.sessionUser,
    },
    rowCount: input.rows.length,
    columnCount: input.columns.length,
    limitReached: input.rows.length > 0 && isLimitReached(input.rows.length, maxRows),
    columns: input.columns,
    rows: input.rows,
    limits: {
      maxRows,
      maxColumns: input.compiled.limits?.maxColumns ?? STAGE3F_MAX_COLUMNS,
      statementTimeoutMs: input.compiled.limits?.statementTimeoutMs ?? STAGE3F_STATEMENT_TIMEOUT_MS,
    },
    timings: input.timings,
    safety: {
      compiledHashVerified: hashOk,
      sqlRevalidated: revalidated,
      writesAttempted: input.counters.writeStatements,
      commits: input.counters.commits,
    },
    gate: input.gate,
    policy: input.policy,
    resultValidation: input.resultValidation,
    rejection: input.rejection,
    warnings: input.warnings,
    audit: {
      deterministic: true,
      executorContractVersion: STAGE3F_RESULT_CONTRACT_VERSION,
      sourceSelectContractVersion: STAGE3F_SOURCE_SELECT_CONTRACT_VERSION,
      generatedAt: input.generatedAt,
      ...input.counters,
    },
  };
}

/**
 * Races the driver call against a client-side deadline. On expiry the adapter is asked to break the
 * statement so the server stops working on a result nobody will read.
 */
async function executeWithDeadline(
  work: Promise<Stage3fAdapterSelectResult>,
  timeoutMs: number,
  onTimeout: () => Promise<void>,
): Promise<Stage3fAdapterSelectResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void onTimeout().finally(() => reject(new Stage3fTimeoutError(timeoutMs)));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // The abandoned driver promise must not surface as an unhandled rejection.
    void work.catch(() => undefined);
  }
}

export class TetaOracleReadOnlyExecutorService {
  async execute(request: Stage3fExecutionRequest): Promise<TetaOracleReadResult> {
    const now = request.now ?? (() => Date.now());
    const clock = request.clock ?? (() => new Date());
    const startedAt = now();
    const counters = emptyStage3fCounters();
    const timings = emptyTimings();
    const warnings: Stage3fViolation[] = [];
    const compiled = request.compiled;

    const gateStartedAt = now();
    const gate = gateCompiledSelect({
      compiled,
      expectedSqlSha256: request.expectedSqlSha256 ?? null,
      bindValues: request.bindValues,
    });
    timings.gateMs = now() - gateStartedAt;

    const policy = evaluateExecutionPolicy(request.approval);
    const baseColumns = buildResultColumns({
      projections: compiled?.projections ?? [],
    }).columns;

    const finish = (
      executionStatus: Stage3fExecutionStatus,
      rejection: Stage3fViolation | null,
      extra: Partial<BuildResultInput> = {},
    ): TetaOracleReadResult => {
      timings.totalMs = now() - startedAt;
      return buildResult({
        compiled,
        executionStatus,
        gate,
        policy,
        columns: extra.columns ?? baseColumns,
        rows: extra.rows ?? [],
        sessionUser: extra.sessionUser ?? null,
        counters,
        timings,
        resultValidation: extra.resultValidation ?? null,
        rejection,
        warnings,
        generatedAt: clock().toISOString(),
      });
    };

    if (!gate.ok) {
      counters.statementsRejectedByGate = 1;
      return finish('rejected', {
        code: gate.violations[0]?.code ?? 'gate_rejected',
        message: `Execution gate rejected the compiled select (${gate.violations.length} violation(s))`,
      });
    }

    if (!policy.liveOracleAllowed) {
      return finish('rejected', {
        code: 'execution_not_approved',
        message: `Missing approval flag(s): ${policy.missingApprovals.join(' ')}`,
      });
    }

    const adapter = request.adapter;
    if (!adapter) {
      return finish('failed', {
        code: 'missing_oracle_adapter',
        message: 'No Oracle adapter was supplied',
      });
    }

    const limits = compiled.limits;
    const maxRows = limits.maxRows;
    const timeoutMs = limits.statementTimeoutMs;

    const connectStartedAt = now();
    try {
      await adapter.openConnection();
      counters.connectionsOpened = 1;
    } catch (error) {
      timings.connectMs = now() - connectStartedAt;
      return finish('failed', {
        code: 'oracle_connection_failed',
        message: errorMessage(error),
      });
    }
    timings.connectMs = now() - connectStartedAt;

    const closeQuietly = async () => {
      try {
        await adapter.closeConnection();
        counters.connectionsClosed = 1;
      } catch (error) {
        warnings.push({
          code: 'connection_close_failed',
          message: errorMessage(error),
        });
      }
    };

    try {
      const preflightStartedAt = now();
      let rawSessionUser: string;
      try {
        rawSessionUser = await adapter.executePreflightSessionUser();
        counters.preflightStatements = 1;
      } catch (error) {
        timings.preflightMs = now() - preflightStartedAt;
        counters.sessionUserRejections = 1;
        return finish('rejected', {
          code: 'preflight_failed',
          message: errorMessage(error),
        });
      }
      timings.preflightMs = now() - preflightStartedAt;

      const session = validateSessionUser(rawSessionUser);
      if (!session.ok) {
        counters.sessionUserRejections = 1;
        return finish('rejected', session.violation, {
          sessionUser: session.sessionUser,
        });
      }

      const binds = compiled.binds.map((bind) => (request.bindValues ?? {})[bind.name] ?? null);

      const executeStartedAt = now();
      let raw: Stage3fAdapterSelectResult;
      try {
        raw = await executeWithDeadline(
          adapter.executeSelect(compiled.sqlText!, binds, { maxRows, timeoutMs }),
          timeoutMs,
          async () => {
            if (!adapter.break) return;
            try {
              await adapter.break();
              counters.statementBreaks += 1;
            } catch {
              // A failed break is not worse than the timeout itself; the connection is closed next.
            }
          },
        );
        counters.businessStatements = 1;
      } catch (error) {
        timings.executeMs = now() - executeStartedAt;
        if (isTimeoutError(error)) {
          counters.timeouts = 1;
          return finish('timed_out', {
            code: 'statement_timeout',
            message: errorMessage(error),
          });
        }
        return finish('failed', {
          code: 'statement_execution_failed',
          message: errorMessage(error),
        });
      }
      timings.executeMs = now() - executeStartedAt;

      const normalizeStartedAt = now();
      const declaredDbTypes: Record<string, string | undefined> = {};
      for (const meta of raw.metaData ?? []) {
        declaredDbTypes[meta.name] = meta.dbTypeName;
        if (isUnsupportedOracleDbType(meta.dbTypeName)) {
          return finish(
            'rejected',
            {
              code: 'unsupported_result_type',
              message: `Column ${meta.name} has unsupported Oracle type ${meta.dbTypeName}`,
            },
            {
              columns: buildResultColumns({
                projections: compiled.projections,
                declaredDbTypes,
              }).columns,
              rows: [],
            },
          );
        }
      }
      const metadata = buildResultColumns({
        projections: compiled.projections,
        declaredDbTypes,
      });
      warnings.push(...metadata.violations);
      const columns = metadata.columns;

      const normalized = normalizeRows(raw.rows ?? [], columns);
      warnings.push(...normalized.warnings);
      counters.businessRowsRead = normalized.rows.length;
      timings.normalizeMs = now() - normalizeStartedAt;

      const resultValidation = validateReadResult({
        columns,
        rows: normalized.rows,
        driverColumns: raw.columns ?? [],
        maxRows,
      });

      if (normalized.violations.length || !resultValidation.ok) {
        const combined: Stage3fResultValidation = {
          ok: false,
          checks: resultValidation.checks,
          violations: [...normalized.violations, ...resultValidation.violations],
        };
        return finish(
          'rejected',
          {
            code: combined.violations[0]?.code ?? 'result_shape_rejected',
            message: `Result validation failed with ${combined.violations.length} violation(s)`,
          },
          { columns, rows: [], resultValidation: combined },
        );
      }

      const limitReached = isLimitReached(normalized.rows.length, maxRows);
      if (limitReached) {
        warnings.push({
          code: 'limit_reached',
          message:
            'Zwrócono maksymalny limit 500 wierszy; wynik może być niepełny.',
        });
      }

      const successStatus =
        limitReached
          ? 'limit_reached'
          : normalized.rows.length === 0
            ? 'completed_empty'
            : 'completed';

      return finish(successStatus, null, {
        columns,
        rows: normalized.rows,
        sessionUser: session.sessionUser,
        resultValidation,
      });
    } finally {
      await closeQuietly();
    }
  }
}

/**
 * Independent re-check callers can run on a statement before handing it to the executor. Exported so
 * the CLI `validate-compiled` subcommand does not need to reach into the compiler module.
 */
export function inspectCompiledSelect(compiled: TetaCompiledOracleSelect) {
  const gate = gateCompiledSelect({ compiled });
  const tokenValidation = compiled.sqlText
    ? validateCompiledSql({
        sqlText: compiled.sqlText,
        sourceAliases: compiled.sources
          .filter((source) => source.usage !== 'filter_only')
          .map((source) => source.alias),
        resultAliases: compiled.projections.map((projection) => projection.resultAlias),
        owners: compiled.sources.map((source) => source.accessOwner),
        bindPlaceholders: compiled.binds.map((bind) => bind.placeholder),
        existenceAliases: compiled.sources
          .filter((source) => source.usage === 'filter_only')
          .map((source) => source.alias),
      })
    : null;

  return { gate, tokenValidation };
}
