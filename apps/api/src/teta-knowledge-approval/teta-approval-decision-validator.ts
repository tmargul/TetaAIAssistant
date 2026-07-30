import {
  isDecisionKind,
  isReviewerRole,
  APPROVAL_KINDS_CREATING_RECORDS,
} from './teta-approval-contract';
import { loadApprovalPolicy, loadReviewerRolesPolicy } from './teta-approval-policy';
import type {
  DecisionEventV1,
  DecisionKind,
  ReviewPackV1,
  ReviewerRole,
  ScopeDecision,
  ValidationResult,
} from './teta-approval.types';
import { staleGuardsEqual } from './teta-review-pack-fingerprint';

export type DecisionDraft = {
  reviewPackId: string;
  reviewPackRevisionId: string;
  decisionKind: DecisionKind | null | undefined;
  reviewerId?: string | null;
  reviewerRole?: string | null;
  rationale?: string | null;
  reasonCodes?: string[];
  scopeDecision?: ScopeDecision | null;
  staleGuard?: ReviewPackV1['staleGuard'];
  confirmHumanDecision?: boolean;
  synthetic?: boolean;
};

export type DecisionValidationContext = {
  pack: ReviewPackV1;
  confirmHumanDecision: boolean;
  reviewerId: string | null;
  reviewerRole: string | null;
  repoRoot?: string;
  hasUnresolvedConflict?: boolean;
  isClientSpecific?: boolean;
  isHistorical?: boolean;
  isVersionSpecific?: boolean;
  isUnknownApplicability?: boolean;
  isRegulatory?: boolean;
  isCustomerExample?: boolean;
  isTetaEduAsHr?: boolean;
  isTetaMeStandaloneDomain?: boolean;
};

export function validateDecisionDraft(
  draft: DecisionDraft,
  ctx: DecisionValidationContext,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const policy = loadApprovalPolicy(ctx.repoRoot);
  const roles = loadReviewerRolesPolicy(ctx.repoRoot);

  if (!draft.decisionKind || !isDecisionKind(draft.decisionKind)) {
    errors.push('invalid_or_missing_decision_kind');
  } else if (!ctx.pack.allowedDecisionKinds.includes(draft.decisionKind)) {
    errors.push('decision_outside_allowed_kinds');
  }

  if (!ctx.confirmHumanDecision && !draft.synthetic) {
    errors.push('missing_confirm_human_decision');
  }

  if (!ctx.reviewerId || !String(ctx.reviewerId).trim()) {
    errors.push('missing_reviewer_id');
  }

  if (!ctx.reviewerRole || !isReviewerRole(ctx.reviewerRole)) {
    errors.push('missing_or_invalid_reviewer_role');
  } else if (draft.decisionKind && isDecisionKind(draft.decisionKind)) {
    const caps = roles.roleCapabilities[ctx.reviewerRole] ?? [];
    if (!caps.includes(draft.decisionKind)) {
      errors.push('reviewer_role_cannot_perform_decision');
    }
  }

  const rationale = (draft.rationale ?? '').trim();
  if (rationale.length < policy.requireRationaleMinLength) {
    errors.push('missing_or_short_rationale');
  }

  if (draft.staleGuard && !staleGuardsEqual(draft.staleGuard, ctx.pack.staleGuard)) {
    errors.push('stale_review_pack');
  } else if (
    draft.reviewPackRevisionId !== ctx.pack.reviewPackRevisionId ||
    draft.reviewPackId !== ctx.pack.reviewPackId
  ) {
    errors.push('stale_review_pack');
  }

  if (draft.decisionKind === 'approve_with_scope') {
    const scope = draft.scopeDecision;
    if (!scope) errors.push('missing_scope_decision');
    else {
      if (!scope.productFamilyIds?.length) errors.push('scope_missing_product_family');
      if (!scope.clientScope) errors.push('scope_missing_client_scope');
      if (!scope.currentnessStatus) errors.push('scope_missing_currentness');
    }
  }

  if (draft.decisionKind === 'approve_merged_record') {
    const requiresScope = ctx.pack.decisionability?.semanticMergeRequiresExplicitScope === true;
    if (requiresScope) {
      const scope = draft.scopeDecision;
      if (!scope) errors.push('semantic_merge_requires_explicit_scope');
      else {
        if (!scope.productFamilyIds?.length) errors.push('scope_missing_product_family');
        if (!scope.clientScope) errors.push('scope_missing_client_scope');
        if (!scope.currentnessStatus) errors.push('scope_missing_currentness');
      }
    }
  }

  if (draft.decisionKind === 'approve_as_variants') {
    if (ctx.pack.decisionability?.comparisonBasedOnSingleProductOnly) {
      errors.push('approve_as_variants_without_both_product_sides');
    }
  }

  if (
    draft.decisionKind &&
    APPROVAL_KINDS_CREATING_RECORDS.includes(draft.decisionKind) &&
    ctx.pack.pilotCaseId === 'RP01'
  ) {
    const registryEvidence = ctx.pack.evidence.filter((e) => e.evidenceKind === 'authoritative_registry_anchor');
    if (!registryEvidence.length) errors.push('registry_approval_without_registry_evidence');
    const allowedClaims = new Set(registryEvidence.flatMap((e) => e.supportedClaims ?? []));
    const requested = (draft.reasonCodes ?? []).filter((c) => c.startsWith('claim:'));
    for (const claim of requested) {
      const normalized = claim.replace(/^claim:/, '');
      if (![...allowedClaims].some((a) => a === normalized || normalized.includes(a) || a.includes(normalized))) {
        errors.push('registry_claim_beyond_evidence_scope');
      }
    }
    const overreachHints = ['procedure', 'form_action', 'payroll_rule', 'oracle_relation'];
    if ((draft.rationale ?? '').toLowerCase().match(/procedure|formularz|payroll|oracle/)) {
      if (overreachHints.some((h) => (draft.rationale ?? '').toLowerCase().includes(h.replace('_', '')) || (draft.rationale ?? '').toLowerCase().includes('oracle'))) {
        // soft check via explicit reason codes only for strict overreach
      }
    }
    if ((draft.reasonCodes ?? []).some((c) => /procedure|form_action|payroll|oracle/i.test(c))) {
      errors.push('registry_claim_beyond_evidence_scope');
    }
  }

  if (draft.decisionKind && APPROVAL_KINDS_CREATING_RECORDS.includes(draft.decisionKind)) {
    if (ctx.hasUnresolvedConflict && draft.decisionKind !== 'approve_as_variants') {
      errors.push('approval_with_unresolved_conflict');
    }
    if (ctx.pack.packKind === 'evidence_gap' || ctx.pack.evidence.length === 0) {
      if (ctx.pack.packKind === 'evidence_gap') {
        errors.push('approval_without_evidence');
      } else if (ctx.pack.evidence.length === 0) {
        errors.push('approval_without_evidence');
      }
    }
    if (ctx.isUnknownApplicability && draft.decisionKind === 'approve' && !draft.scopeDecision) {
      errors.push('unknown_applicability_without_explicit_scope');
    }
    if (ctx.isClientSpecific && draft.scopeDecision?.clientScope === 'global') {
      errors.push('client_specific_approved_as_global');
    }
    if (ctx.isHistorical && draft.scopeDecision?.currentnessStatus === 'verified_for_scope') {
      errors.push('historical_approved_as_current');
    }
    if (ctx.isTetaEduAsHr) errors.push('teta_edu_approved_as_teta_hr');
    if (ctx.isTetaMeStandaloneDomain) errors.push('teta_me_approved_as_standalone_domain');
    if (ctx.isVersionSpecific && (!draft.scopeDecision?.productVersionHints?.length)) {
      errors.push('version_specific_approved_as_universal');
    }
    if (ctx.isRegulatory && draft.scopeDecision?.currentnessStatus === 'verified_for_scope') {
      if (ctx.reviewerRole !== 'legal_reviewer' && ctx.reviewerRole !== 'vendor_admin') {
        errors.push('regulatory_current_without_legal_review');
      }
    }
    if (ctx.isCustomerExample && draft.scopeDecision?.clientScope === 'global') {
      errors.push('customer_example_approved_as_global');
    }
  }

  if (draft.decisionKind === 'approve_merged_record') {
    if (!ctx.pack.allowedDecisionKinds.includes('approve_merged_record')) {
      errors.push('merged_approval_not_allowed');
    }
  }

  if (policy.allowAutoApproval) warnings.push('policy_allows_auto_approval');

  return { ok: errors.length === 0, errors, warnings };
}

export function validateDecisionEventAgainstPack(
  event: DecisionEventV1,
  pack: ReviewPackV1,
  repoRoot?: string,
): ValidationResult {
  return validateDecisionDraft(
    {
      reviewPackId: event.reviewPackId,
      reviewPackRevisionId: event.reviewPackRevisionId,
      decisionKind: event.decisionKind,
      reviewerId: event.reviewer.reviewerId,
      reviewerRole: event.reviewer.reviewerRole,
      rationale: event.rationale,
      reasonCodes: event.reasonCodes,
      scopeDecision: event.scopeDecision,
      staleGuard: event.staleGuard,
      confirmHumanDecision: true,
      synthetic: event.synthetic,
    },
    {
      pack,
      confirmHumanDecision: true,
      reviewerId: event.reviewer.reviewerId,
      reviewerRole: event.reviewer.reviewerRole,
      repoRoot,
    },
  );
}

export function assertReviewerRole(role: string): asserts role is ReviewerRole {
  if (!isReviewerRole(role)) throw new Error(`invalid reviewer role: ${role}`);
}
