import type { SemanticApplicationAnchor } from './teta-stage4-anchors';
import type { OracleCandidate } from './teta-stage4-oracle-expand';
import {
  anchorAlignsWithCandidate,
  assessCandidateSemanticCoherence,
  buildSemanticAnchorCohorts,
  buildCandidateSemanticAssessments,
  normalizedConceptTerms,
  semanticGateAllowsStrong,
} from './teta-stage4-domain-coherence';
import { buildBindingHypotheses } from './teta-stage4-hypotheses';
import type { SchemaEvidenceGraph } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

function anchor(partial: Partial<SemanticApplicationAnchor> & { anchorId: string; label: string }): SemanticApplicationAnchor {
  return {
    anchorType: 'pa_plugin',
    recognitionSource: 'test',
    recognitionConfidence: 'strong',
    semanticEvidence: [`pa:${partial.anchorId}`],
    matchTokens: [],
    ...partial,
  };
}

function candidate(ref: string, acePath: string[], reached: string): OracleCandidate {
  const [owner, objectName] = ref.split('.');
  return {
    oracleCanonicalId: ref,
    owner: owner!,
    objectName: objectName!,
    objectType: 'VIEW',
    reachedFromApplicationNode: reached,
    acePath,
    aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
    aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
    candidateRoleHypotheses: ['assignment_source'],
    supportingEvidence: ['ace:GATEWAY_READS_FROM_ORACLE_OBJECT'],
    negativeEvidence: [],
    stage2Facts: {
      readsFrom: [],
      writesTo: [],
      calls: [],
      joinsTo: [],
      joinDetails: [],
      references: [],
    },
  };
}

describe('Stage 4 domain coherence', () => {
  it('compound concept outranks isolated shared token', () => {
    const concept = 'grupa czasu pracy';
    const terms = normalizedConceptTerms(concept);
    expect(terms.some((t) => t.includes('grupa'))).toBe(true);

    const anchors = [
      anchor({
        anchorId: 'twg',
        label: 'Grupa czasu pracy',
        formRef: 'form-twg',
        matchTokens: ['grupa', 'czasu', 'pracy'],
      }),
      anchor({
        anchorId: 'work',
        label: 'Karty pracy',
        formRef: 'form-kp',
        matchTokens: ['pracy'],
      }),
    ];
    const cStrong = candidate(
      'TETA_ADMIN.NT_KP_KDR_QUES_GR_CZASU_PRACY',
      ['gateway|Teta.Sumo.Personel.bosPracownik.TG.GrupaCzasuPracyQuestionnairesTG'],
      'gateway|Teta.Sumo.Personel.bosPracownik.TG.GrupaCzasuPracyQuestionnairesTG',
    );
    const cWeak = candidate(
      'TETA_ADMIN.KP_KDR_QUES_MIEJSCA_PRACY',
      ['gateway|Teta.Sumo.Personel.bosPracownik.TG.MiejscePracyQuestionnairesTG'],
      'gateway|Teta.Sumo.Personel.bosPracownik.TG.MiejscePracyQuestionnairesTG',
    );

    const strong = assessCandidateSemanticCoherence({
      candidate: cStrong,
      businessConcept: concept,
      anchors,
      cohorts: buildSemanticAnchorCohorts({ anchors, businessConcept: concept }),
      tokenDocFreq: new Map([['pracy', 5]]),
      candidateCount: 10,
    });
    const weak = assessCandidateSemanticCoherence({
      candidate: cWeak,
      businessConcept: concept,
      anchors,
      cohorts: buildSemanticAnchorCohorts({ anchors, businessConcept: concept }),
      tokenDocFreq: new Map([['pracy', 5]]),
      candidateCount: 10,
    });

    expect(strong.semanticCoherence).not.toBe('none');
    expect(['strong', 'moderate']).toContain(strong.semanticCoherence);
    expect(weak.semanticCoherence === 'weak' || weak.semanticCoherence === 'none').toBe(true);
    expect(semanticGateAllowsStrong('strong_inference_readonly', strong)).toBe(true);
    expect(semanticGateAllowsStrong('strong_inference_readonly', weak)).toBe(false);
  });

  it('cross-product Finance Okresy collision is weak for Personel okresy wypowiedzeń', () => {
    const concept = 'Okresy wypowiedzeń';
    const anchors = [
      anchor({
        anchorId: 'personel',
        label: 'Okresy wypowiedzeń',
        formRef: 'form-ow',
        matchTokens: ['okresy', 'wypowiedzeń'],
      }),
    ];
    const finance = candidate(
      'TETA_ADMIN.NT_RK_VAT_OVAT',
      [
        'gateway|Teta.Sumo.Finances.bosDokumentyVat.TG.OkresyVatTG',
        'application_form|finances.plgdokumentyvat',
      ],
      'gateway|Teta.Sumo.Finances.bosDokumentyVat.TG.OkresyVatTG',
    );
    const assess = assessCandidateSemanticCoherence({
      candidate: finance,
      businessConcept: concept,
      anchors,
      cohorts: buildSemanticAnchorCohorts({ anchors, businessConcept: concept }),
      tokenDocFreq: new Map([['okresy', 8]]),
      candidateCount: 12,
    });
    expect(assess.crossProductTokenCollisions || assess.semanticCoherence !== 'strong').toBe(true);
    expect(semanticGateAllowsStrong('strong_inference_readonly', assess)).toBe(false);
  });

  it('unrelated anchor cannot strengthen candidate without path alignment', () => {
    const anchors = [
      anchor({ anchorId: 'a', label: 'Alpha Panel', formRef: 'form-alpha-panel', matchTokens: ['alpha'] }),
      anchor({ anchorId: 'b', label: 'Beta Panel', formRef: 'form-beta-panel', matchTokens: ['beta'] }),
    ];
    const c = candidate('TETA_ADMIN.OBJ_A', ['gateway|AlphaPanelTG'], 'gateway|AlphaPanelTG');
    expect(anchorAlignsWithCandidate(anchors[0]!, c)).toBe(true);
    expect(anchorAlignsWithCandidate(anchors[1]!, c)).toBe(false);
  });

  it('technical strong + semantic weak does not allow strong binding gate', () => {
    const assess = assessCandidateSemanticCoherence({
      candidate: candidate('TETA_ADMIN.X', ['gateway|UnrelatedTG'], 'gateway|UnrelatedTG'),
      businessConcept: 'grupa czasu pracy',
      anchors: [anchor({ anchorId: '1', label: 'Grupa czasu pracy', matchTokens: ['grupa'] })],
      cohorts: buildSemanticAnchorCohorts({
        anchors: [anchor({ anchorId: '1', label: 'Grupa czasu pracy', matchTokens: ['grupa'] })],
        businessConcept: 'grupa czasu pracy',
      }),
      tokenDocFreq: new Map(),
      candidateCount: 1,
    });
    expect(assess.technicalConfidence).toBe('strong');
    expect(semanticGateAllowsStrong('strong_inference_readonly', assess)).toBe(false);
  });

  it('isolated assignment_source no longer promoted to strong in hypotheses', () => {
    const graph: SchemaEvidenceGraph = {
      objects: [
        {
          objectRef: 'TETA_ADMIN.ASSIGN_ONLY',
          owner: 'TETA_ADMIN',
          objectName: 'ASSIGN_ONLY',
          objectType: 'VIEW',
          tags: ['assignment_candidate'],
          columns: [],
        },
      ],
      relations: [],
      claims: [
        {
          family: 'application_technical',
          claimType: 'gateway_read',
          object: 'TETA_ADMIN.ASSIGN_ONLY',
          roleHint: 'assignment_source',
          provenance: ['ace:hit'],
        },
      ],
    };
    const oracle = {
      oracleEndpointsReached: 1,
      oracleCandidatesConsidered: 1,
      stage2EvidenceItemsLoaded: 1,
      candidates: [
        candidate('TETA_ADMIN.ASSIGN_ONLY', ['gateway|SomeTG'], 'gateway|SomeTG'),
      ],
      discoveryOrigin: 'application_first' as const,
      stage2EvidenceTypesConsumed: [],
    };
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: ['assignment_source', 'dictionary_reference'],
    });
    expect(hyps[0]?.roleBindings.assignment_source?.status).not.toBe('strong_inference_readonly');
  });

  it('buildCandidateSemanticAssessments tracks cohort metrics', () => {
    const built = buildCandidateSemanticAssessments({
      businessConcept: 'test concept alpha beta',
      anchors: [
        anchor({ anchorId: '1', label: 'Alpha Beta Form', formRef: 'f1', matchTokens: ['alpha', 'beta'] }),
      ],
      candidates: [
        candidate('TETA_ADMIN.T1', ['gateway|AlphaBetaTG'], 'gateway|AlphaBetaTG'),
        candidate('TETA_ADMIN.T2', ['gateway|OtherTG'], 'gateway|OtherTG'),
      ],
    });
    expect(built.metrics.semanticCohortsBuilt).toBeGreaterThanOrEqual(1);
    expect(built.assessments.length).toBe(2);
  });

  it('semantic evidence without path alignment does not allow strong gate', () => {
    const anchors = [
      anchor({ anchorId: 'g', label: 'Grupa czasu pracy', formRef: 'form-grupa', matchTokens: ['grupa'] }),
    ];
    const unrelated = candidate(
      'TETA_ADMIN.UNRELATED',
      ['gateway|TotallyOtherTG'],
      'gateway|TotallyOtherTG',
    );
    expect(anchorAlignsWithCandidate(anchors[0]!, unrelated)).toBe(false);
    const assess = assessCandidateSemanticCoherence({
      candidate: unrelated,
      businessConcept: 'grupa czasu pracy',
      anchors,
      cohorts: buildSemanticAnchorCohorts({ anchors, businessConcept: 'grupa czasu pracy' }),
      tokenDocFreq: new Map(),
      candidateCount: 1,
    });
    expect(assess.semanticEvidencePathAligned).toBe(false);
    expect(semanticGateAllowsStrong('strong_inference_readonly', assess)).toBe(false);
  });

  it('multiple weak tokens from unrelated paths do not combine into strong gate', () => {
    const anchors = [
      anchor({ anchorId: 'a', label: 'Alpha Beta', formRef: 'form-a', matchTokens: ['alpha', 'beta'] }),
      anchor({ anchorId: 'b', label: 'Gamma Delta', formRef: 'form-b', matchTokens: ['gamma', 'delta'] }),
    ];
    const c = candidate('TETA_ADMIN.X', ['gateway|AlphaBetaTG'], 'gateway|AlphaBetaTG');
    const assess = assessCandidateSemanticCoherence({
      candidate: c,
      businessConcept: 'gamma delta concept',
      anchors,
      cohorts: buildSemanticAnchorCohorts({ anchors, businessConcept: 'gamma delta concept' }),
      tokenDocFreq: new Map([['delta', 4], ['gamma', 4]]),
      candidateCount: 8,
    });
    expect(semanticGateAllowsStrong('strong_inference_readonly', assess)).toBe(false);
  });
});
