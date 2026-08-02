import {
  FEATURE_FAMILY_REGISTRY,
  SHARED_GATEWAY_FORMS,
} from './teta-stage3k2b2a-fixtures';
import type {
  Stage3k2b2aSafetyCounters,
  TetaApplicationFeatureFamilyEvidence,
} from './teta-gap.types';

export function classifyFeatureFamiliesFromRegistry(): {
  families: TetaApplicationFeatureFamilyEvidence[];
  independentObservationGroups: string[];
  countersDelta: Partial<Stage3k2b2aSafetyCounters>;
} {
  const families = FEATURE_FAMILY_REGISTRY.filter((f) => f.classificationStatus === 'classified');
  const unclassifiedAttempt = 0;
  const groups = new Set<string>();
  for (const f of families) {
    for (const g of f.originObservationGroups) groups.add(g);
  }
  // Shared gateway forms: count as one observation group, not independent families
  groups.add(SHARED_GATEWAY_FORMS.observationGroup);
  return {
    families,
    independentObservationGroups: [...groups].sort(),
    countersDelta: {
      formsCountedAsIndependentFeaturesWithoutClassification: unclassifiedAttempt,
    },
  };
}

export function wouldCountSharedGatewayFormsAsIndependent(): boolean {
  // Explicitly false — policy forbids
  return false;
}

export function featureFamilyKeys(): string[] {
  return FEATURE_FAMILY_REGISTRY.map((f) => f.featureFamilyKey);
}
