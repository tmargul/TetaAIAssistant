import {
  SCHEMA_ROLE_SEMANTIC_FAMILIES,
  SCHEMA_ROLE_TECHNICAL_FAMILIES,
  type EvidenceFamily,
  type ExecutionEligibility,
  type SchemaRoleResolutionStatus,
} from './teta-schema-role-resolution.types';

export type StatusPolicyInput = {
  evidenceFamiliesSatisfied: EvidenceFamily[];
  hasDirectTechnicalProof: boolean;
  hasCompleteRelationPath: boolean;
  compatibleTypes: boolean;
  unresolvedContradiction: boolean;
  competingWithinMargin: boolean;
  temporalOk: boolean;
  requiresTemporal: boolean;
  documentationOnly: boolean;
  modelOnly: boolean;
  nameOnly: boolean;
};

/**
 * Explicit status policy — status derives from rules, not an opaque score.
 */
export function evaluateResolutionStatus(input: StatusPolicyInput): {
  status: SchemaRoleResolutionStatus;
  executionEligibility: ExecutionEligibility;
  explanation: string;
} {
  if (input.unresolvedContradiction) {
    return {
      status: 'conflicting',
      executionEligibility: 'blocked',
      explanation: 'Contradicting evidence families remain unresolved.',
    };
  }
  if (input.competingWithinMargin) {
    return {
      status: 'ambiguous',
      executionEligibility: 'blocked',
      explanation: 'Multiple candidates remain within the ambiguity margin.',
    };
  }
  if (input.documentationOnly || input.modelOnly) {
    return {
      status: 'insufficient',
      executionEligibility: 'blocked',
      explanation:
        'Documentation/model semantic claims alone cannot prove a physical mapping.',
    };
  }
  if (input.nameOnly) {
    return {
      status: 'insufficient',
      executionEligibility: 'blocked',
      explanation: 'Object or column name similarity alone is not proof.',
    };
  }

  const semanticOk = input.evidenceFamiliesSatisfied.some((f) =>
    SCHEMA_ROLE_SEMANTIC_FAMILIES.includes(f),
  );
  const technicalFamilies = input.evidenceFamiliesSatisfied.filter((f) =>
    SCHEMA_ROLE_TECHNICAL_FAMILIES.includes(f),
  );
  const technicalCount = new Set(technicalFamilies).size;
  const temporalGate = !input.requiresTemporal || input.temporalOk;

  if (
    input.hasDirectTechnicalProof &&
    input.hasCompleteRelationPath &&
    input.compatibleTypes &&
    temporalGate &&
    semanticOk
  ) {
    return {
      status: 'proven_exact',
      executionEligibility: 'eligible_for_bounded_readonly',
      explanation:
        'Direct technical proof plus semantic attribution and a complete relation path.',
    };
  }

  if (
    semanticOk &&
    technicalCount >= 2 &&
    input.compatibleTypes &&
    input.hasCompleteRelationPath &&
    temporalGate
  ) {
    return {
      status: 'strong_inference_readonly',
      executionEligibility: 'eligible_for_bounded_readonly_pilot',
      explanation:
        'At least one semantic family and two independent technical families with a complete path.',
    };
  }

  return {
    status: 'insufficient',
    executionEligibility: 'blocked',
    explanation:
      'Evidence families do not jointly satisfy proven_exact or strong_inference_readonly.',
  };
}

/** Auxiliary score only — never the sole decision. */
export function auxiliaryEvidenceScore(families: EvidenceFamily[], claimCount: number): number {
  const familyBonus = new Set(families).size * 10;
  return familyBonus + Math.min(claimCount, 20);
}
