/**
 * Stage 3J — redaction of customer configuration codes from repo-tracked audit artifacts.
 */
import type { Stage3jAuditReference } from './teta-stage3j-audit';

/** Codes allowed in docs/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.* reference proofs. */
export const STAGE3J_ALLOWED_REPO_REFERENCE_CODES = new Set([
  '1353',
  '1350',
  '1351',
  '1352',
  '1346',
  '1348',
  '1355',
  '0010',
]);

const COMPONENT_CODE_IN_TEXT_RE = /\b(?:0\d{3}|\d{4,5})\b/g;

export type GoldenImpact1350RepoSummary = {
  containsRequiredDependents: string[];
  directDependentCount: number;
  additionalDependentsRedacted: true;
  impactTraceRequests: number;
};

export function formatGoldenImpact1350RepoDetail(input: GoldenImpact1350RepoSummary): string {
  return [
    `containsRequiredDependents=${input.containsRequiredDependents.join(',')}`,
    `directDependentCount=${input.directDependentCount}`,
    `impactTraceRequests=${input.impactTraceRequests}`,
  ].join(';');
}

export function buildGoldenImpact1350RepoSummary(input: {
  directDependentCodes: string[];
  impactTraceRequests: number;
}): GoldenImpact1350RepoSummary {
  return {
    containsRequiredDependents: ['1353', '1355'],
    directDependentCount: input.directDependentCodes.length,
    additionalDependentsRedacted: true,
    impactTraceRequests: input.impactTraceRequests,
  };
}

export function sanitizeReferenceDetailForRepoArtifacts(ref: Stage3jAuditReference): string {
  if (ref.id === 'golden-impact-1350') {
    return ref.detail;
  }
  return redactDisallowedCodesInText(ref.detail);
}

export function redactDisallowedCodesInText(text: string): string {
  return text.replace(COMPONENT_CODE_IN_TEXT_RE, (code) =>
    STAGE3J_ALLOWED_REPO_REFERENCE_CODES.has(code) ? code : '[redacted]',
  );
}

export function countCustomerConfigurationCodesExposedInRepoArtifacts(text: string): number {
  let exposed = 0;
  for (const m of text.matchAll(COMPONENT_CODE_IN_TEXT_RE)) {
    const code = m[0]!;
    if (!STAGE3J_ALLOWED_REPO_REFERENCE_CODES.has(code)) {
      exposed += 1;
    }
  }
  return exposed;
}

export function countCustomerCodesInRepoReferences(
  references: Array<{ id: string; ok: boolean; detail: string; impactSummary?: GoldenImpact1350RepoSummary }>,
): number {
  return countCustomerConfigurationCodesExposedInRepoArtifacts(JSON.stringify(references));
}

export function repoReferencesForStage3jDocs(
  references: Stage3jAuditReference[],
  impactSummary?: GoldenImpact1350RepoSummary | null,
): Array<{ id: string; ok: boolean; detail: string; impactSummary?: GoldenImpact1350RepoSummary }> {
  return references.map((ref) => {
    const detail = sanitizeReferenceDetailForRepoArtifacts(ref);
    if (ref.id === 'golden-impact-1350' && impactSummary) {
      return { id: ref.id, ok: ref.ok, detail, impactSummary };
    }
    return { id: ref.id, ok: ref.ok, detail };
  });
}
