import type {
  EvidenceClaim,
  EvidenceFamily,
  SchemaEvidenceGraph,
  TemporalResolution,
  TemporalResolutionMode,
} from './teta-schema-role-resolution.types';
import { inferColumnRoles } from './teta-schema-role-inference';

/**
 * Generic temporal role resolution — naming alone is never enough for
 * effective_date_range; requires additional non-convention families.
 */
export function resolveTemporalRoles(input: {
  graph: SchemaEvidenceGraph;
  assignmentObjectRef: string | null;
  requiresCurrent: boolean;
}): TemporalResolution {
  if (!input.requiresCurrent) {
    return {
      mode: 'unresolved',
      evidenceFamiliesSatisfied: [],
      supportingEvidenceRefs: [],
      explanation: 'Temporal resolution not required for this question.',
    };
  }
  if (!input.assignmentObjectRef) {
    return {
      mode: 'unresolved',
      evidenceFamiliesSatisfied: [],
      supportingEvidenceRefs: [],
      explanation: 'No assignment object available for temporal role resolution.',
    };
  }

  const inferred = inferColumnRoles(input.graph).filter(
    (r) => r.objectRef === input.assignmentObjectRef,
  );
  const from = inferred.find((r) => r.role === 'valid_from');
  const to = inferred.find((r) => r.role === 'valid_to');
  const flag = inferred.find((r) => r.role === 'current_flag');

  const claimsForAssignment = input.graph.claims.filter(
    (c) => c.object === input.assignmentObjectRef || c.subject === input.assignmentObjectRef,
  );
  const families = uniqueFamilies([
    ...claimsForAssignment.map((c) => c.family),
    ...(input.graph.documentationClaims ?? [])
      .filter((c) => /period|obowiązyw|valid|data_od|effective/i.test(c.claimType + (c.notes ?? '')))
      .map((c) => c.family),
  ]);

  const nonConventionSupport = claimsForAssignment.some(
    (c) =>
      c.family === 'application_semantic' ||
      c.family === 'application_technical' ||
      c.family === 'implementation_usage' ||
      c.family === 'documentation_semantic' ||
      c.family === 'oracle_structural',
  );

  if (flag && nonConventionSupport) {
    return {
      mode: 'exact_current_flag',
      currentFlag: { objectRef: flag.objectRef, column: flag.column, activeValue: 'Y' },
      evidenceFamiliesSatisfied: families,
      supportingEvidenceRefs: [...flag.evidenceRefs, ...claimRefs(claimsForAssignment)],
      explanation: 'Current flag column supported by non-convention evidence.',
    };
  }

  if (from && to && nonConventionSupport) {
    const mode: TemporalResolutionMode = 'effective_date_range';
    return {
      mode,
      validFrom: { objectRef: from.objectRef, column: from.column },
      validTo: { objectRef: to.objectRef, column: to.column },
      evidenceFamiliesSatisfied: families,
      supportingEvidenceRefs: [
        ...from.evidenceRefs,
        ...to.evidenceRefs,
        ...claimRefs(claimsForAssignment),
      ],
      explanation:
        'Valid-from/valid-to pair supported by UI/docs/usage evidence beyond naming.',
    };
  }

  if (from && to && !nonConventionSupport) {
    return {
      mode: 'unresolved',
      validFrom: { objectRef: from.objectRef, column: from.column },
      validTo: { objectRef: to.objectRef, column: to.column },
      evidenceFamiliesSatisfied: ['schema_convention'],
      supportingEvidenceRefs: [...from.evidenceRefs, ...to.evidenceRefs],
      explanation:
        'Temporal column names found, but naming similarity alone cannot establish currentness.',
    };
  }

  const snapshotClaim = claimsForAssignment.find(
    (c) => c.claimType === 'current_snapshot_source' || c.roleHint === 'assignment_grain',
  );
  if (snapshotClaim) {
    return {
      mode: 'current_snapshot_source',
      evidenceFamiliesSatisfied: [snapshotClaim.family],
      supportingEvidenceRefs: snapshotClaim.provenance,
      explanation: 'Evidence asserts assignment source stores only current rows.',
    };
  }

  return {
    mode: 'unresolved',
    evidenceFamiliesSatisfied: families,
    supportingEvidenceRefs: claimRefs(claimsForAssignment),
    explanation: 'No supported temporal interpretation could be established.',
  };
}

function uniqueFamilies(list: EvidenceFamily[]): EvidenceFamily[] {
  return [...new Set(list)];
}

function claimRefs(claims: EvidenceClaim[]): string[] {
  return claims.flatMap((c) => c.provenance).slice(0, 20);
}
