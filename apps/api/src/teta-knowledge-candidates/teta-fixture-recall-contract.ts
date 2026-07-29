import type { KnowledgeCandidateKind } from './teta-knowledge-candidate.types';

export type FixtureRecallCaseId =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'blocked'
  | 'table';

export type FixtureRecallExpectation = {
  caseId: FixtureRecallCaseId;
  logicalSourceId: string;
  requiredCandidateKinds: KnowledgeCandidateKind[];
  requiredCandidateMinimumCounts: Partial<Record<KnowledgeCandidateKind, number>>;
  forbiddenCandidateKinds: KnowledgeCandidateKind[];
  forbiddenCandidatePatterns: string[];
  optionalCandidateKinds: KnowledgeCandidateKind[];
  maximumUnexpectedCandidates: number;
};

export const FIXTURE_RECALL_EXPECTATIONS: FixtureRecallExpectation[] = [
  {
    caseId: 'A',
    logicalSourceId: 'document:fixture-a-payroll',
    requiredCandidateKinds: ['scenario', 'procedure', 'process_step', 'temporal_rule', 'calculation_rule', 'test_case'],
    requiredCandidateMinimumCounts: {
      scenario: 1,
      procedure: 1,
      process_step: 2,
      temporal_rule: 1,
      calculation_rule: 1,
      test_case: 1,
    },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: ['^Wstęp$', '^Informacje$'],
    optionalCandidateKinds: ['parameter', 'action', 'business_concept'],
    maximumUnexpectedCandidates: 20,
  },
  {
    caseId: 'B',
    logicalSourceId: 'document:fixture-b-edu',
    requiredCandidateKinds: ['process_step', 'status', 'state_transition'],
    requiredCandidateMinimumCounts: {
      process_step: 1,
      status: 1,
      state_transition: 1,
    },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['business_process', 'procedure'],
    maximumUnexpectedCandidates: 15,
  },
  {
    caseId: 'C',
    logicalSourceId: 'document:fixture-c-year',
    requiredCandidateKinds: ['procedure', 'temporal_rule'],
    requiredCandidateMinimumCounts: {
      procedure: 1,
      temporal_rule: 1,
    },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['validation_rule', 'warning', 'process_step'],
    maximumUnexpectedCandidates: 15,
  },
  {
    caseId: 'D',
    logicalSourceId: 'document:fixture-d-ksef',
    requiredCandidateKinds: ['document_type', 'integration'],
    requiredCandidateMinimumCounts: {
      document_type: 1,
      integration: 1,
    },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['procedure', 'warning', 'validation_rule', 'action'],
    maximumUnexpectedCandidates: 15,
  },
  {
    caseId: 'E',
    logicalSourceId: 'training-video:ALL_MOVIES:fixture-e-zu',
    requiredCandidateKinds: [],
    requiredCandidateMinimumCounts: {},
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['business_concept', 'technical_relation', 'procedure', 'action'],
    maximumUnexpectedCandidates: 20,
  },
  {
    caseId: 'F',
    logicalSourceId: 'training-video:ALL_MOVIES:fixture-f-noise',
    requiredCandidateKinds: [],
    requiredCandidateMinimumCounts: {},
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['parameter'],
    maximumUnexpectedCandidates: 10,
  },
  {
    caseId: 'G',
    logicalSourceId: 'document:fixture-g-dup',
    requiredCandidateKinds: ['scenario'],
    requiredCandidateMinimumCounts: { scenario: 1 },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: [],
    maximumUnexpectedCandidates: 5,
  },
  {
    caseId: 'H',
    logicalSourceId: 'document:fixture-h-samesig',
    requiredCandidateKinds: ['scenario'],
    requiredCandidateMinimumCounts: { scenario: 1 },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: [],
    maximumUnexpectedCandidates: 5,
  },
  {
    caseId: 'I',
    logicalSourceId: 'document:fixture-i-workflow',
    requiredCandidateKinds: ['procedure'],
    requiredCandidateMinimumCounts: { procedure: 1 },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['process_step', 'action', 'scenario'],
    maximumUnexpectedCandidates: 10,
  },
  {
    caseId: 'J',
    logicalSourceId: 'document:fixture-j-legal',
    requiredCandidateKinds: ['temporal_rule'],
    requiredCandidateMinimumCounts: { temporal_rule: 1 },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: ['procedure', 'process_step'],
    maximumUnexpectedCandidates: 10,
  },
  {
    caseId: 'blocked',
    logicalSourceId: 'document:fixture-blocked-legacy',
    requiredCandidateKinds: [],
    requiredCandidateMinimumCounts: {},
    forbiddenCandidateKinds: [
      'business_concept',
      'parameter',
      'status',
      'scenario',
      'procedure',
      'process_step',
    ],
    forbiddenCandidatePatterns: [],
    optionalCandidateKinds: [],
    maximumUnexpectedCandidates: 0,
  },
  {
    caseId: 'table',
    logicalSourceId: 'document:fixture-table',
    requiredCandidateKinds: ['parameter'],
    requiredCandidateMinimumCounts: { parameter: 1 },
    forbiddenCandidateKinds: [],
    forbiddenCandidatePatterns: ['^Nazwa$', '^Opis$', '^Wartość$'],
    optionalCandidateKinds: ['business_concept'],
    maximumUnexpectedCandidates: 10,
  },
];

export type FixtureRecallEvaluation = {
  requiredFixtureCandidatesExpected: number;
  requiredFixtureCandidatesFound: number;
  requiredFixtureCandidatesMissing: number;
  fixtureCandidateRecallPercent: number;
  forbiddenFixtureCandidatesProduced: number;
  fixtureCandidatePrecisionChecksPassed: boolean;
  fixtureCandidateRecallChecksPassed: boolean;
  missingByCase: Array<{ caseId: string; missingKinds: string[] }>;
  forbiddenByCase: Array<{ caseId: string; forbiddenKinds: string[]; forbiddenPatterns: string[] }>;
};

export function evaluateFixtureRecall(
  candidatesBySource: Map<string, Array<{ candidateKind: string; canonicalSubjectProposal: { label: string } }>>,
): FixtureRecallEvaluation {
  let expected = 0;
  let found = 0;
  let forbidden = 0;
  const missingByCase: FixtureRecallEvaluation['missingByCase'] = [];
  const forbiddenByCase: FixtureRecallEvaluation['forbiddenByCase'] = [];
  let precisionOk = true;
  let recallOk = true;

  for (const exp of FIXTURE_RECALL_EXPECTATIONS) {
    const cands = candidatesBySource.get(exp.logicalSourceId) ?? [];
    const kindCounts = new Map<string, number>();
    for (const c of cands) {
      kindCounts.set(c.candidateKind, (kindCounts.get(c.candidateKind) ?? 0) + 1);
    }

    const missingKinds: string[] = [];
    for (const kind of exp.requiredCandidateKinds) {
      const min = exp.requiredCandidateMinimumCounts[kind] ?? 1;
      expected += min;
      const have = kindCounts.get(kind) ?? 0;
      if (have >= min) found += min;
      else {
        found += have;
        missingKinds.push(`${kind}:${have}/${min}`);
        recallOk = false;
      }
    }

    // Optional process/procedure for B: at least one of business_process|procedure
    if (exp.caseId === 'B') {
      expected += 1;
      const bp = (kindCounts.get('business_process') ?? 0) + (kindCounts.get('procedure') ?? 0);
      if (bp >= 1) found += 1;
      else {
        missingKinds.push('business_process|procedure:0/1');
        recallOk = false;
      }
    }

    // E: at least one of business_concept|technical_relation and one of procedure|action
    if (exp.caseId === 'E') {
      expected += 2;
      const tech = (kindCounts.get('business_concept') ?? 0) + (kindCounts.get('technical_relation') ?? 0);
      const act = (kindCounts.get('procedure') ?? 0) + (kindCounts.get('action') ?? 0);
      if (tech >= 1) found += 1;
      else {
        missingKinds.push('business_concept|technical_relation:0/1');
        recallOk = false;
      }
      if (act >= 1) found += 1;
      else {
        missingKinds.push('procedure|action:0/1');
        recallOk = false;
      }
    }

    // C optional validation/warning if explicit constraint present — required when validation_rule/warning expected in content
    if (exp.caseId === 'C') {
      expected += 1;
      const vr = (kindCounts.get('validation_rule') ?? 0) + (kindCounts.get('warning') ?? 0);
      if (vr >= 1) found += 1;
      else {
        missingKinds.push('validation_rule|warning:0/1');
        recallOk = false;
      }
    }

    // D optional procedure|warning
    if (exp.caseId === 'D') {
      expected += 1;
      const pw = (kindCounts.get('procedure') ?? 0) + (kindCounts.get('warning') ?? 0) + (kindCounts.get('validation_rule') ?? 0);
      if (pw >= 1) found += 1;
      else {
        missingKinds.push('procedure|warning|validation_rule:0/1');
        recallOk = false;
      }
    }

    const forbiddenKindsHit: string[] = [];
    for (const kind of exp.forbiddenCandidateKinds) {
      if ((kindCounts.get(kind) ?? 0) > 0) {
        forbidden += kindCounts.get(kind) ?? 0;
        forbiddenKindsHit.push(kind);
        precisionOk = false;
      }
    }
    const forbiddenPatternsHit: string[] = [];
    for (const pat of exp.forbiddenCandidatePatterns) {
      const re = new RegExp(pat, 'i');
      for (const c of cands) {
        if (re.test(c.canonicalSubjectProposal.label)) {
          forbidden += 1;
          forbiddenPatternsHit.push(pat);
          precisionOk = false;
        }
      }
    }

    if (missingKinds.length) missingByCase.push({ caseId: exp.caseId, missingKinds });
    if (forbiddenKindsHit.length || forbiddenPatternsHit.length) {
      forbiddenByCase.push({
        caseId: exp.caseId,
        forbiddenKinds: forbiddenKindsHit,
        forbiddenPatterns: forbiddenPatternsHit,
      });
    }
  }

  const missing = Math.max(0, expected - found);
  return {
    requiredFixtureCandidatesExpected: expected,
    requiredFixtureCandidatesFound: found,
    requiredFixtureCandidatesMissing: missing,
    fixtureCandidateRecallPercent: expected === 0 ? 100 : Math.round((found / expected) * 10000) / 100,
    forbiddenFixtureCandidatesProduced: forbidden,
    fixtureCandidatePrecisionChecksPassed: precisionOk && forbidden === 0,
    fixtureCandidateRecallChecksPassed: recallOk && missing === 0,
    missingByCase,
    forbiddenByCase,
  };
}
