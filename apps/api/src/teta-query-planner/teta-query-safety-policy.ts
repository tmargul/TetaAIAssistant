/**
 * Stage 3C — safety policy loader + plan limits.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { STAGE3C_SAFETY_POLICY_VERSION } from './teta-query-plan.types';

export type QuerySafetyPolicy = {
  version: string;
  logicalOperation: 'SELECT';
  allowSelectStar: false;
  maxRows: number;
  maxColumns: number;
  statementTimeoutMs: number;
  requireBindVariablesForUserValues: boolean;
  forbidDbLinks: boolean;
  forbidForUpdate: boolean;
  forbidPlSql: boolean;
  forbidDynamicSql: boolean;
  forbidWithDefinedFunctions: boolean;
  forbidOracleHints: boolean;
  forbidSqlComments: boolean;
  forbidRawSqlInPlan: boolean;
  forbidCartesianJoins: boolean;
  authorization: {
    status: 'deferred';
    assumedOracleUser: string;
    filtersApplied: false;
    reason: string;
  };
  executionPolicyDefaults: {
    sqlCompilationAllowed: false;
    sqlExecutionAllowed: false;
    oracleConnectionAllowed: false;
    oracleWriteAllowed: false;
    fileReadAllowed: false;
    reason: string;
  };
  ownerPolicy: {
    preferredCanonicalOwner: string;
    allowedAccessOwners: string[];
    forbiddenAutoSelectOwners: string[];
    preferApplicationViewOverBaseTable: boolean;
    baseTableRequiresGraphPath: boolean;
    equalCandidatesRequireSelection: boolean;
  };
};

export function defaultSafetyPolicyPath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-query-safety-policy-v1.json');
}

export function loadSafetyPolicy(filePath: string): QuerySafetyPolicy {
  if (!existsSync(filePath)) {
    throw new Error(`Missing safety policy file: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as QuerySafetyPolicy;
  if (raw.version !== STAGE3C_SAFETY_POLICY_VERSION) {
    throw new Error(
      `Unsupported safety policy version: ${raw.version} (expected ${STAGE3C_SAFETY_POLICY_VERSION})`,
    );
  }
  if (raw.allowSelectStar !== false) {
    throw new Error('Safety policy must set allowSelectStar=false');
  }
  if (raw.maxRows !== 500 || raw.maxColumns !== 20 || raw.statementTimeoutMs !== 30000) {
    throw new Error('Safety policy limits must be maxRows=500, maxColumns=20, timeout=30000');
  }
  return raw;
}

const RAW_SQL_KEYS = new Set([
  'sql',
  'query',
  'statement',
  'sqlText',
  'whereSql',
  'joinSql',
  'rawExpression',
  'selectSql',
]);

export function countRawSqlFragments(value: unknown, depth = 0): number {
  if (depth > 40 || value == null) return 0;
  if (typeof value === 'string') {
    // Reject obvious SQL fragments stored as values.
    if (/\b(SELECT|FROM|WHERE|JOIN)\b/i.test(value) && /\bFROM\b/i.test(value)) return 1;
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((n, v) => n + countRawSqlFragments(v, depth + 1), 0);
  }
  if (typeof value === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (RAW_SQL_KEYS.has(k)) n += 1;
      n += countRawSqlFragments(v, depth + 1);
    }
    return n;
  }
  return 0;
}
