/**
 * Stage 3F — approval policy.
 *
 * A live Oracle connection requires *both* operator flags. Anything less keeps the stage offline,
 * which is what makes the standard `audit --strict` run provably connection-free. Writes, commits,
 * DDL and PL/SQL are never allowed regardless of approvals.
 */
import type { Stage3fExecutionApproval, Stage3fPolicyDecision } from './teta-oracle-executor.types';

export const STAGE3F_APPROVAL_FLAGS = {
  executeRealOracle: '--execute-real-oracle',
  confirmReadonlyExecution: '--confirm-readonly-execution',
} as const;

export const STAGE3F_NO_APPROVAL_REASON =
  'Live Oracle execution requires both --execute-real-oracle and --confirm-readonly-execution; running offline with a fake adapter.';

export const STAGE3F_APPROVED_REASON =
  'Operator approved a single read-only SELECT: no write, no commit, no DDL, no PL/SQL.';

export function noApproval(): Stage3fExecutionApproval {
  return { executeRealOracle: false, confirmReadonlyExecution: false };
}

export function fullApproval(): Stage3fExecutionApproval {
  return { executeRealOracle: true, confirmReadonlyExecution: true };
}

export function evaluateExecutionPolicy(
  approval: Stage3fExecutionApproval | null | undefined,
): Stage3fPolicyDecision {
  const executeRealOracle = approval?.executeRealOracle === true;
  const confirmReadonlyExecution = approval?.confirmReadonlyExecution === true;

  const missingApprovals: string[] = [];
  if (!executeRealOracle) missingApprovals.push(STAGE3F_APPROVAL_FLAGS.executeRealOracle);
  if (!confirmReadonlyExecution) {
    missingApprovals.push(STAGE3F_APPROVAL_FLAGS.confirmReadonlyExecution);
  }

  const liveOracleAllowed = missingApprovals.length === 0;

  return {
    liveOracleAllowed,
    connectionAllowed: liveOracleAllowed,
    writeAllowed: false,
    commitAllowed: false,
    ddlAllowed: false,
    plsqlAllowed: false,
    missingApprovals,
    reason: liveOracleAllowed ? STAGE3F_APPROVED_REASON : STAGE3F_NO_APPROVAL_REASON,
  };
}

/** Oracle driver settings Stage 3F pins for every statement it runs. */
export const STAGE3F_CONNECTION_SETTINGS = {
  autoCommit: false,
  readOnlyIntent: true,
} as const;
