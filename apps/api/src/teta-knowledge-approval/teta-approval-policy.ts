import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { DecisionKind, ReviewPackKind } from './teta-approval.types';

export type ApprovalPolicyV1 = {
  policyVersion: string;
  allowAutoApproval: boolean;
  allowRealDecisionWithoutConfirmation: boolean;
  allowStalePackApplication: boolean;
  allowApprovalWithoutEvidence: boolean;
  allowApprovalWithUnresolvedConflict: boolean;
  allowConflictAutoResolve: boolean;
  allowLocalModel: boolean;
  allowEmbeddings: boolean;
  allowOracleConnections: boolean;
  allowRagChunkGeneration: boolean;
  allowQdrantCalls: boolean;
  allowStage3kStart: boolean;
  maxExcerptChars: number;
  requireRationaleMinLength: number;
  realPilotDecisionEventsAllowedThisIteration: number;
  realApprovedRecordsAllowedThisIteration: number;
  strict: Record<string, number>;
};

export type ReviewPriorityPolicyV1 = {
  policyVersion: string;
  priorityOrder: string[];
  priorityScores: Record<string, number>;
  priorityBands: Record<'critical' | 'high' | 'normal' | 'low', number>;
};

export type ReviewPackPolicyV1 = {
  policyVersion: string;
  maxExcerptChars: number;
  preferRefsWithoutFullSourceForAcceptancePilot: boolean;
  allowSyntheticExcerptsInFixtures: boolean;
  requireStaleGuard: boolean;
  requireAllowedDecisionKinds: boolean;
  evidenceGapAllowsEmptyEvidence: boolean;
  defaultAllowedByPackKind: Record<ReviewPackKind, DecisionKind[]>;
};

export type ReviewerRolesPolicyV1 = {
  policyVersion: string;
  roles: string[];
  roleCapabilities: Record<string, DecisionKind[]>;
  regulatoryCurrentnessRequiresLegalReviewer: boolean;
  forbidGitConfigIdentity: boolean;
};

export type ApprovedQuestionPolicyV1 = {
  policyVersion: string;
  separateCandidateAndApprovedCoverage: boolean;
  forbidApprovedSupportedWithoutApprovedRecord: boolean;
  pilotCaseApprovedCoverageDefaults: Record<string, string>;
  unsupportedCandidateWithoutEvidence: string;
};

export type PilotCaseDef = {
  pilotCaseId: string;
  title: string;
  packKind: ReviewPackKind;
  selection: Record<string, unknown>;
  allowedDecisionKinds: DecisionKind[];
};

export type PilotCasesPolicyV1 = {
  policyVersion: string;
  cases: PilotCaseDef[];
};

function configDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, 'apps', 'api', 'config', 'teta-knowledge-approval');
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadApprovalPolicy(repoRoot?: string): ApprovalPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-approval-policy-v1.json'));
}

export function loadReviewPriorityPolicy(repoRoot?: string): ReviewPriorityPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-review-priority-policy-v1.json'));
}

export function loadReviewPackPolicy(repoRoot?: string): ReviewPackPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-review-pack-policy-v1.json'));
}

export function loadReviewerRolesPolicy(repoRoot?: string): ReviewerRolesPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-reviewer-roles-v1.json'));
}

export function loadApprovedQuestionPolicy(repoRoot?: string): ApprovedQuestionPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-approved-question-policy-v1.json'));
}

export function loadPilotCasesPolicy(repoRoot?: string): PilotCasesPolicyV1 {
  return readJson(path.join(configDir(repoRoot), 'teta-stage3j2e-pilot-cases-v1.json'));
}

export function validateApprovalConfigs(repoRoot?: string): { ok: boolean; errors: string[]; files: string[] } {
  const dir = configDir(repoRoot);
  const files = [
    'teta-approval-policy-v1.json',
    'teta-review-priority-policy-v1.json',
    'teta-review-pack-policy-v1.json',
    'teta-reviewer-roles-v1.json',
    'teta-approved-question-policy-v1.json',
    'teta-stage3j2e-pilot-cases-v1.json',
  ];
  const errors: string[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (!existsSync(p)) {
      errors.push(`missing:${f}`);
      continue;
    }
    try {
      JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      errors.push(`invalid_json:${f}`);
    }
  }
  if (!errors.length) {
    const policy = loadApprovalPolicy(repoRoot);
    if (policy.allowAutoApproval) errors.push('policy_allows_auto_approval');
    if (policy.allowLocalModel) errors.push('policy_allows_local_model');
    if (policy.allowEmbeddings) errors.push('policy_allows_embeddings');
    if (policy.allowConflictAutoResolve) errors.push('policy_allows_conflict_auto_resolve');
    if (policy.allowStage3kStart) errors.push('policy_allows_stage3k');
    if (policy.realPilotDecisionEventsAllowedThisIteration !== 0) {
      errors.push('policy_allows_real_decisions_this_iteration');
    }
    if (policy.realApprovedRecordsAllowedThisIteration !== 0) {
      errors.push('policy_allows_real_approved_records_this_iteration');
    }
    const pilots = loadPilotCasesPolicy(repoRoot);
    if (pilots.cases.length !== 7) errors.push(`pilot_cases_count:${pilots.cases.length}`);
    const ids = new Set(pilots.cases.map((c) => c.pilotCaseId));
    for (let i = 1; i <= 7; i++) {
      const id = `RP0${i}`;
      if (!ids.has(id)) errors.push(`missing_pilot:${id}`);
    }
  }
  return { ok: errors.length === 0, errors, files: files.map((f) => path.join(dir, f)) };
}
