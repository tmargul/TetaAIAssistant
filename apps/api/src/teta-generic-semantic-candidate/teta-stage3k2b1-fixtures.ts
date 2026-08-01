import type { DiscoveryOptions } from './teta-candidate-discovery';
import type { RawEvidenceObservation } from './teta-evidence-lineage';

const HASH = '2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3';

function obs(
  nodeId: string,
  familyOverride: RawEvidenceObservation['familyOverride'],
  supports: RawEvidenceObservation['supports'],
  strength: RawEvidenceObservation['strength'] = 'verified_exact',
): RawEvidenceObservation {
  return {
    nodeId,
    familyOverride,
    supports,
    strength,
    sourceStage: 'synthetic',
    graphSourceHash: HASH,
    originObservationId: nodeId,
  };
}

/** Synthetic fixture overrides keyed by synthetic target id S1–S15 helpers. */
export const SYNTHETIC_FIXTURE_DEFS = {
  S1: {
    note: 'exact strong evidence → sufficient_for_decision when scope+grain forced',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: {
          skipStage3d: true,
          knownGaps: [],
          forceScopeProven: true,
          forceGrainProven: true,
          observations: [
            obs('oracle-object:SYN:VIEW:EMP', 'oracle_metadata_ddl', ['concept']),
            obs('form:syn-emp', 'application_form_control', ['concept']),
          ],
        },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S2: {
    note: 'inferred-only → needs_more_evidence',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: { skipStage3d: true, inferredOnly: true, observations: [] },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S3: {
    note: 'heuristic-only → needs_more_evidence',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: { skipStage3d: true, heuristicOnly: true, observations: [] },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S4: {
    note: 'conflicting evidence',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: {
          skipStage3d: true,
          conflicts: ['two_incompatible_meanings'],
          observations: [
            obs('oracle-object:SYN:A', 'oracle_metadata_ddl', ['concept']),
          ],
        },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S5: {
    note: 'duplicate same-origin evidence → counts as 1 family',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: {
          skipStage3d: true,
          observations: [
            obs('oracle-object:SYN:DUP', 'oracle_metadata_ddl', ['concept']),
            {
              ...obs('oracle-object:SYN:DUP', 'oracle_metadata_ddl', ['concept']),
              // same originObservationId
            },
            {
              nodeId: 'oracle-object:SYN:DUP',
              familyOverride: 'oracle_metadata_ddl',
              supports: ['value'],
              strength: 'verified_exact',
              sourceStage: 'synthetic',
              graphSourceHash: HASH,
              originObservationId: 'oracle-object:SYN:DUP',
            },
          ],
        },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S6: {
    note: 'prior Stage3D approval + same underlying evidence → no double count',
    // Uses real P1 Stage3D path; discovery expands prior approval separately.
    options: { targetIds: ['P1'] } satisfies Partial<DiscoveryOptions>,
  },
  S7: {
    note: 'stale graph hash',
    options: {
      targetIds: ['P1'],
      overrideGraphSourceHash: 'deadbeef'.repeat(8),
    } satisfies Partial<DiscoveryOptions>,
  },
  S8: {
    note: 'policy-only change → same candidateFingerprint, different evaluation fingerprint',
    options: {
      targetIds: ['P1'],
      candidateEvaluationPolicyVersion: 'teta-aia-generic-semantic-candidate-evaluation-policy-v1-alt',
      overridePolicyContentHash: 'alt-policy-content-hash',
    } satisfies Partial<DiscoveryOptions>,
  },
  S9: {
    note: 'changed evidence → different candidateFingerprint',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: {
          observations: [
            obs('oracle-object:SYN:EXTRA', 'package_dependency', ['concept']),
          ],
        },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S10: {
    note: 'changed scope → different candidateFingerprint',
    // Handled in tests by mutating applicability after discovery clone.
    options: { targetIds: ['P1'] } satisfies Partial<DiscoveryOptions>,
  },
  S11: {
    note: 'leading zero identity',
    options: { targetIds: ['P2'] } satisfies Partial<DiscoveryOptions>,
  },
  S12: {
    note: 'ambiguous business meaning',
    options: {
      targetIds: ['P1'],
      syntheticOverrides: {
        P1: {
          skipStage3d: true,
          ambiguities: ['ambiguous_business_meaning'],
          observations: [
            obs('oracle-object:SYN:AMB', 'oracle_metadata_ddl', ['concept']),
            obs('form:syn-amb', 'application_form_control', ['concept']),
          ],
        },
      },
    } satisfies Partial<DiscoveryOptions>,
  },
  S13: {
    note: 'review pack contains no automatic approval',
    options: { targetIds: ['P1', 'P2', 'P3', 'P4'] } satisfies Partial<DiscoveryOptions>,
  },
  S14: {
    note: 'production reuse policy unchanged',
    options: { targetIds: ['P1'] } satisfies Partial<DiscoveryOptions>,
  },
  S15: {
    note: 'no Oracle/SQL/model/Qdrant',
    options: { targetIds: ['P1', 'P2', 'P3', 'P4'] } satisfies Partial<DiscoveryOptions>,
  },
} as const;

export type SyntheticFixtureId = keyof typeof SYNTHETIC_FIXTURE_DEFS;
