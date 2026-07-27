/**
 * Stage 3F — approval policy.
 *
 * A live Oracle connection requires *both* operator flags **or** a complete trusted Stage 3G
 * chat-route approval constructed server-side. Anything less keeps the stage offline, which is
 * what makes the standard `audit --strict` run provably connection-free. Writes, commits, DDL and
 * PL/SQL are never allowed regardless of approvals.
 */
import type {
  Stage3fCliExecutionApproval,
  Stage3fExecutionApproval,
  Stage3fPolicyDecision,
  Stage3fTrustedChatReportApproval,
} from './teta-oracle-executor.types';

export const STAGE3F_APPROVAL_FLAGS = {
  executeRealOracle: '--execute-real-oracle',
  confirmReadonlyExecution: '--confirm-readonly-execution',
} as const;

export const STAGE3F_NO_APPROVAL_REASON =
  'Live Oracle execution requires both --execute-real-oracle and --confirm-readonly-execution; running offline with a fake adapter.';

export const STAGE3F_APPROVED_REASON =
  'Operator approved a single read-only SELECT: no write, no commit, no DDL, no PL/SQL.';

export const STAGE3F_TRUSTED_CHAT_APPROVED_REASON =
  'Trusted Stage 3G chat report route approved a single read-only SELECT: no write, no commit, no DDL, no PL/SQL.';

export const STAGE3F_TRUSTED_CHAT_NO_APPROVAL_REASON =
  'Trusted chat report approval is incomplete or unauthorized; live Oracle connection refused.';

export function noApproval(): Stage3fCliExecutionApproval {
  return {
    approvalSource: 'cli_flags',
    executeRealOracle: false,
    confirmReadonlyExecution: false,
  };
}

export function fullApproval(): Stage3fCliExecutionApproval {
  return {
    approvalSource: 'cli_flags',
    executeRealOracle: true,
    confirmReadonlyExecution: true,
  };
}

export function isTrustedChatReportApproval(
  approval: Stage3fExecutionApproval | null | undefined,
): approval is Stage3fTrustedChatReportApproval {
  return approval?.approvalSource === 'trusted_chat_report_route';
}

function trustedChatFieldsPresent(approval: Stage3fTrustedChatReportApproval): string[] {
  const missing: string[] = [];
  if (!approval.routeId?.trim()) missing.push('routeId');
  if (!approval.authenticatedUserId?.trim()) missing.push('authenticatedUserId');
  if (!approval.expectedSqlSha256?.trim()) missing.push('expectedSqlSha256');
  if (!approval.purpose?.trim()) missing.push('purpose');
  if (!approval.workMode?.trim()) missing.push('workMode');
  if (!approval.role?.trim()) missing.push('role');
  return missing;
}

function trustedChatAuthorized(approval: Stage3fTrustedChatReportApproval): boolean {
  const roleOk = approval.role === 'admin';
  const vendorOk = approval.workMode === 'vendor';
  return roleOk || vendorOk;
}

export function evaluateExecutionPolicy(
  approval: Stage3fExecutionApproval | null | undefined,
): Stage3fPolicyDecision {
  if (isTrustedChatReportApproval(approval)) {
    const missingFields = trustedChatFieldsPresent(approval);
    const authorized = trustedChatAuthorized(approval);
    const liveOracleAllowed = missingFields.length === 0 && authorized;
    const missingApprovals = [
      ...missingFields.map((field) => `trusted_chat_report_route.${field}`),
      ...(authorized ? [] : ['trusted_chat_report_route.role_or_workMode']),
    ];
    return {
      liveOracleAllowed,
      connectionAllowed: liveOracleAllowed,
      writeAllowed: false,
      commitAllowed: false,
      ddlAllowed: false,
      plsqlAllowed: false,
      missingApprovals,
      reason: liveOracleAllowed
        ? STAGE3F_TRUSTED_CHAT_APPROVED_REASON
        : STAGE3F_TRUSTED_CHAT_NO_APPROVAL_REASON,
    };
  }

  const cli = approval as Stage3fCliExecutionApproval | null | undefined;
  const executeRealOracle = cli?.executeRealOracle === true;
  const confirmReadonlyExecution = cli?.confirmReadonlyExecution === true;

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
