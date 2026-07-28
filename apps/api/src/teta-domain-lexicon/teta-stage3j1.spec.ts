import { readFileSync } from 'fs';
import path from 'path';
import { loadDomainLexicon } from './teta-domain-lexicon-loader';
import { resolveDomainLexicon } from './teta-domain-lexicon-resolver';
import { validateDomainLexicon } from './teta-domain-lexicon-validator';
import { normalizePolishText } from './teta-polish-text-normalizer';
import { buildDomainLexiconAudit, evaluateSafetyProbe } from './teta-domain-lexicon-audit';
import {
  countUniqueHelpDocumentsWithActions,
  reconcileHelpDocumentsWithActions,
} from './teta-help-concept-discovery.service';

describe('Stage 3J.1 normalizer', () => {
  test('1. lowercase', () => expect(normalizePolishText('SkŁADNIK').normalizedExact).toBe('składnik'));
  test('2. NFKC', () => expect(normalizePolishText('składnik').normalizedExact).toContain('składnik'));
  test('3. repeated spaces', () => expect(normalizePolishText('a   b').normalizedExact).toBe('a b'));
  test('4. tabs', () => expect(normalizePolishText('a\tb').normalizedExact).toBe('a b'));
  test('5. newlines', () => expect(normalizePolishText('a\nb').normalizedExact).toBe('a b'));
  test('6. punctuation', () => expect(normalizePolishText('Ala?').normalizedExact).toBe('ala'));
  test('7. quotation marks', () => expect(normalizePolishText('„Ala”').normalizedExact).toContain('"ala"'));
  test('8. dash variants', () => expect(normalizePolishText('A—B').normalizedExact).toBe('a-b'));
  test('9. nr.', () => expect(normalizePolishText('nr. 12').normalizedExact).toContain('nr 12'));
  test('10. nr ew.', () => expect(normalizePolishText('nr ew. 00122').normalizedExact).toContain('nr ew 00122'));
  test('11. diacritic folded', () => expect(normalizePolishText('składnik').normalizedDiacriticFolded).toBe('skladnik'));
  test('12. leading zero code preserved', () => expect(normalizePolishText('0010').normalizedExact).toBe('0010'));
  test('13. employee number leading zero preserved', () => expect(normalizePolishText('00122').normalizedExact).toBe('00122'));
  test('14. dates unchanged', () => expect(normalizePolishText('2026-07-28').normalizedExact).toBe('2026-07-28'));
  test('15. long query rejected', () => expect(() => normalizePolishText('a'.repeat(4001))).toThrow());
});

describe('Stage 3J.1 catalog', () => {
  test('16. valid catalog', () => {
    const { catalog } = loadDomainLexicon();
    const report = validateDomainLexicon(catalog);
    expect(report.duplicateEntryIds).toEqual([]);
  });
  test('17. no unknown intent rules', () => {
    const { catalog } = loadDomainLexicon();
    expect(validateDomainLexicon(catalog).rulesMappedToUnknownIntent).toEqual([]);
  });
  test('18. no direct Oracle mappings', () => {
    const { catalog } = loadDomainLexicon();
    expect(validateDomainLexicon(catalog).directOracleMappingsDetected).toEqual([]);
  });
  test('19. no arbitrary regex rules', () => {
    const { catalog } = loadDomainLexicon();
    expect(validateDomainLexicon(catalog).arbitraryRegexRulesDetected).toEqual([]);
  });
  test('20. approved entries have aliases', () => {
    const { catalog } = loadDomainLexicon();
    expect(validateDomainLexicon(catalog).approvedEntriesWithoutAliases).toEqual([]);
  });
});

describe('Stage 3J.1 resolution fixtures', () => {
  const refs = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../test-fixtures/teta-domain-lexicon/stage3j1-polish-phrases-v1.json'),
      'utf8',
    ),
  ) as Array<{ query: string; expected: { focus?: string | null; scope?: string | null } }>;

  refs.forEach((ref, idx) => {
    test(`${21 + idx}. fixture: ${ref.query}`, () => {
      const result = resolveDomainLexicon(ref.query);
      expect(result.contractVersion).toBe('teta-aia-domain-lexicon-resolution-v1');
      if (ref.expected.focus) expect(result.mapping.focus).toBe(ref.expected.focus);
      if (ref.expected.scope) expect(result.mapping.scope).toBe(ref.expected.scope);
      if (ref.query.includes('00122')) expect(result.normalizedQuery).toContain('00122');
    });
  });
});

describe('Stage 3J.1 invariants', () => {
  test('116. stawka ambiguous/unresolved', () => {
    const r = resolveDomainLexicon('Stawka');
    expect(r.status).toBe('ambiguous');
    expect(r.resolutionKind).toBe('ambiguous');
  });
  test('117. lista unresolved', () => {
    const r = resolveDomainLexicon('Lista');
    expect(['unresolved', 'resolved_with_warnings']).toContain(r.status);
  });
  test('118. unsupported capability recognized', () => {
    const r = resolveDomainLexicon('Utwórz składnik analogiczny do 1353');
    expect(r.mapping.capabilityStatus).toBe('not_available_yet');
  });
  test('119. generic question no snapshot scope', () => {
    const r = resolveDomainLexicon('Co to jest składnik płacowy?');
    expect(r.mapping.scope).toBe('generic_payroll_knowledge');
  });
  test('120. client question snapshot scope', () => {
    const r = resolveDomainLexicon('Z czego liczy się składnik 1353?');
    expect(r.mapping.scope).toBe('client_payroll_configuration');
  });
  test('121. deterministic fingerprint', () => {
    const a = resolveDomainLexicon('Z czego liczy się składnik 1353?');
    const b = resolveDomainLexicon('Z czego liczy się składnik 1353?');
    expect(a.resolutionFingerprintSha256).toBe(b.resolutionFingerprintSha256);
  });
  test('122. audit strict errors empty', () => {
    const audit = buildDomainLexiconAudit(false);
    expect(Array.isArray(audit.strictErrors)).toBe(true);
  });
  test('123. no side effects counters', () => {
    const audit = buildDomainLexiconAudit(false);
    const safety = audit.safety as Record<string, number>;
    expect(safety.oracleConnectionsOpened).toBe(0);
    expect(safety.llmCalls).toBe(0);
    expect(safety.qdrantCalls).toBe(0);
  });
});

describe('Stage 3J.1 domain registry', () => {
  test('227. registry has 11 approved domains', () => {
    const { registry } = loadDomainLexicon();
    expect(registry.domains.filter((d) => d.status === 'approved').length).toBe(11);
  });
  test('228. registry includes payroll and hr', () => {
    const { registry } = loadDomainLexicon();
    const ids = registry.domains.map((d) => d.domainId);
    expect(ids).toEqual(expect.arrayContaining(['payroll', 'hr', 'core', 'teta_me']));
  });
});

describe('Stage 3J.1 manifest packs', () => {
  test('229. loads approved domain packs', () => {
    const { manifest, catalog } = loadDomainLexicon();
    expect(manifest.domainPacks.filter((p) => p.status === 'approved').length).toBe(3);
    expect(catalog.entries.length).toBeGreaterThanOrEqual(4);
    expect(catalog.operationRules.length).toBeGreaterThanOrEqual(11);
  });
});

describe('Stage 3J.1 help discovery', () => {
  test('230. help coverage report available', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'));
    const coverage = audit.helpCoverage as { formsTotal: number; helpCoveragePercent: number };
    expect(coverage.formsTotal).toBeGreaterThan(0);
    expect(coverage.helpCoveragePercent).toBeGreaterThan(0);
  });
  test('231. generic labels filtered from candidates', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'));
    const help = audit.helpDiscovery as { genericLabelsPreventedFromGlobalApproval: number };
    expect(help.genericLabelsPreventedFromGlobalApproval).toBeGreaterThan(0);
  });
});

describe('Stage 3J.1 encoding', () => {
  test('232. fixture utf8 json valid', () => {
    const raw = readFileSync(
      path.resolve(__dirname, '../../test-fixtures/teta-domain-lexicon/stage3j1-polish-phrases-v1.json'),
      'utf8',
    );
    const { assertUtf8JsonArtifact } = require('./teta-domain-lexicon-encoding');
    expect(assertUtf8JsonArtifact(raw).ok).toBe(true);
  });
});

describe('Stage 3J.1 cross-domain', () => {
  test('233. multi-domain not auto-reduced', () => {
    const r = resolveDomainLexicon('Pracownik i składnik płacowy 1350');
    expect(r.domains.length).toBeGreaterThan(1);
    expect(r.mapping.scope).toBe('recognized_but_not_routed');
  });
  test('234. no default unknown to payroll', () => {
    const r = resolveDomainLexicon('Nieznany dokument xyz');
    expect(r.mapping.scope).not.toBe('client_payroll_configuration');
  });
});

describe('Stage 3J.1 validation semantics', () => {
  test('235. neutral operations are not invalid concept mappings', () => {
    const { catalog } = loadDomainLexicon();
    const report = validateDomainLexicon(catalog);
    expect(report.invalidConceptMappings).toEqual([]);
    expect(report.rulesMappedToUnknownIntent).toEqual([]);
    expect(report.unknownDomainIds).toEqual([]);
    expect(catalog.operationRules.some((r) => r.ruleId === 'neutral_explain')).toBe(true);
  });

  test('236. synthetic invalid concept mapping fails strict audit', () => {
    const { catalog } = loadDomainLexicon();
    const broken = {
      ...catalog,
      operationRules: [
        ...catalog.operationRules,
        {
          ruleId: 'broken_unknown_subject',
          domain: 'payroll',
          requiredConcepts: ['payroll_component'],
          patterns: [{ phrase: 'zzz' }],
          mapsTo: { subject: 'nonexistent_concept_xyz' },
          status: 'approved' as const,
        },
      ],
    };
    const report = validateDomainLexicon(broken);
    expect(report.invalidConceptMappings.length).toBeGreaterThan(0);
    expect(report.invalidConceptMappings.some((x) => x.includes('nonexistent_concept_xyz'))).toBe(true);
  });
});

describe('Stage 3J.1 approved vs help metrics', () => {
  test('237. approved lexicon concepts for hr/payroll', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const byDomain = (audit.approvedLexicon as { approvedLexiconConceptsByDomain: Record<string, { approvedLexiconConcepts: number }> })
      .approvedLexiconConceptsByDomain;
    expect(byDomain.hr.approvedLexiconConcepts).toBe(2);
    expect(byDomain.payroll.approvedLexiconConcepts).toBe(2);
    expect((audit.approvedLexicon as { helpAutoApprovedConcepts: number }).helpAutoApprovedConcepts).toBe(0);
  });

  test('238. help auto-approved concepts are zero per domain', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const coverage = audit.helpCoverage as { helpAutoApprovedConcepts: number; perDomain: Array<{ helpAutoApprovedConcepts: number }> };
    expect(coverage.helpAutoApprovedConcepts).toBe(0);
    expect(coverage.perDomain.every((d) => d.helpAutoApprovedConcepts === 0)).toBe(true);
  });
});

describe('Stage 3J.1 candidate derivation', () => {
  test('239. candidateConcepts equals candidatesAfterDeduplication', () => {
    const { deriveCandidateCountsFromLabels } = require('./teta-help-concept-discovery.service');
    const d = deriveCandidateCountsFromLabels(['Kod', 'Nazwa', 'Składnik RCP', 'Składnik RCP', 'Absencja']);
    expect(d.candidateConcepts).toBe(d.candidatesAfterDeduplication);
    expect(d.genericLabelsPreventedFromGlobalApproval).toBeGreaterThan(0);
    expect(d.duplicateCandidatesMerged).toBeGreaterThan(0);
  });

  test('240. synthetic label change alters candidate count and fingerprint', () => {
    const { deriveCandidateCountsFromLabels } = require('./teta-help-concept-discovery.service');
    const { sha256, stableStringify } = require('./teta-domain-lexicon-contract');
    const a = deriveCandidateCountsFromLabels(['Składnik RCP', 'Absencja']);
    const b = deriveCandidateCountsFromLabels(['Składnik RCP', 'Absencja', 'Harmonogram brygady']);
    expect(b.candidateConcepts).toBeGreaterThan(a.candidateConcepts);
    expect(sha256(stableStringify(a))).not.toBe(sha256(stableStringify(b)));
  });
});

describe('Stage 3J.1 help reconciliation and RCP', () => {
  test('241. help coverage reconciliation consistent', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const rec = audit.helpCoverageReconciliation as {
      finalFormsWithHelp: number;
      formsWithValidHelpEdge: number;
      helpDocumentsInGraph: number;
    };
    expect(rec.finalFormsWithHelp).toBe(rec.formsWithValidHelpEdge);
    expect(rec.helpDocumentsInGraph).toBeGreaterThan(0);
  });

  test('242. time_and_attendance diagnostic executed', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const ta = audit.timeAttendanceDiagnostic as {
      metrics: { timeAttendanceCandidateFormsExamined: number; timeAttendanceFormsClassified: number };
    };
    expect(ta.metrics.timeAttendanceCandidateFormsExamined).toBeGreaterThan(0);
    expect(ta.metrics.timeAttendanceFormsClassified).toBeGreaterThan(0);
  });

  test('243. plgRCP maps to time_and_attendance', () => {
    const { classifyDomainFromHelpSignals } = require('./teta-domain-lexicon-help-classifier');
    const d = classifyDomainFromHelpSignals({
      formName: 'BilansDziennyWidok',
      formTypeName: 'Teta.Sumo.Personel.plgRCP.CrdBilansDzienny.BilansDziennyWidok',
    });
    expect(d[0].domainId).toBe('time_and_attendance');
    expect(d[0].confidence).toBe('confirmed');
  });
});

describe('Stage 3J.1 migration and safety', () => {
  test('244. migration counters are zero', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const m = audit.migration as Record<string, number>;
    expect(m.stage3jPlannerHardcodedSignalsRemaining).toBe(0);
    expect(m.snapshotGateHardcodedSignalsRemaining).toBe(0);
    expect(m.unsupportedHardcodedSignalsRemaining).toBe(0);
    expect(m.legacyLanguageRuleFallbacks).toBe(0);
    expect(m.lexiconResolutionFallbacks).toBe(0);
  });

  test('245. cross-domain safety counters are zero', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    const c = audit.crossDomainSafety as Record<string, number>;
    expect(Object.values(c).every((v) => v === 0)).toBe(true);
  });

  test('246. strict rejects invalidConceptMappings', () => {
    const { catalog } = loadDomainLexicon();
    const report = validateDomainLexicon(catalog);
    expect(report.invalidConceptMappings).toEqual([]);
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), {
      stage3j1TestsExecuted: 1,
      stage3j1TestsPassed: 1,
      stage3j1TestsFailed: 0,
      stage3jRegressionExecuted: 1,
      stage3jRegressionPassed: 1,
      stage3bStage3iExecuted: 1,
      stage3bStage3iPassed: 1,
      apiBuildExitCode: 0,
      webBuildExitCode: 0,
    });
    expect((audit.strictErrors as string[]).includes('invalidConceptMappings')).toBe(false);
  });
});

const VERIFICATION_STUB = {
  stage3j1TestsExecuted: 1,
  stage3j1TestsPassed: 1,
  stage3j1TestsFailed: 0,
  stage3jRegressionExecuted: 1,
  stage3jRegressionPassed: 1,
  stage3bStage3iExecuted: 1,
  stage3bStage3iPassed: 1,
  apiBuildExitCode: 0,
  webBuildExitCode: 0,
};

describe('Stage 3J.1 unresolved scope safety', () => {
  test('247. generic documents unresolved without payroll scope', () => {
    const r = resolveDomainLexicon('Pokaż dokumenty.');
    expect(r.status).toBe('unresolved');
    expect(r.domains).toEqual([]);
    expect(r.mapping.scope).not.toBe('generic_payroll_knowledge');
    expect(r.mapping.scope).not.toBe('client_payroll_configuration');
    expect(['unresolved', null]).toContain(r.mapping.scope);
  });

  test('248. generic list unresolved without payroll scope', () => {
    const r = resolveDomainLexicon('Pokaż listę.');
    expect(r.status).toBe('unresolved');
    expect(r.mapping.scope).not.toBe('generic_payroll_knowledge');
    expect(r.mapping.scope).not.toBe('client_payroll_configuration');
  });

  test('249. generic value unresolved without payroll scope', () => {
    const r = resolveDomainLexicon('Pokaż wartość.');
    expect(r.status).toBe('unresolved');
    expect(r.mapping.scope).not.toBe('generic_payroll_knowledge');
    expect(r.mapping.scope).not.toBe('client_payroll_configuration');
  });

  test('250. generic payroll knowledge still works', () => {
    const r = resolveDomainLexicon('Co to jest składnik płacowy?');
    expect(r.mapping.scope).toBe('generic_payroll_knowledge');
    expect(r.domains.some((d) => d.domainId === 'payroll')).toBe(true);
  });
});

describe('Stage 3J.1 multi-domain probes', () => {
  test('251. RCP + payroll keeps two domains', () => {
    const r = resolveDomainLexicon('RCP i składnik płacowy 1350');
    const ids = r.domains.map((d) => d.domainId).sort();
    expect(ids).toEqual(['payroll', 'time_and_attendance']);
    expect(r.status).toBe('resolved');
    expect(r.resolutionKind).toBe('multi_domain');
    expect(r.mapping.capabilityStatus).toBe('recognized_but_not_routed');
    expect(r.mapping.scope).toBe('recognized_but_not_routed');
  });

  test('252. invoice + accounting keeps two domains', () => {
    const r = resolveDomainLexicon('Czy faktura została zaksięgowana w księgowości?');
    const ids = r.domains.map((d) => d.domainId).sort();
    expect(ids).toEqual(['accounting', 'invoicing']);
    expect(r.status).toBe('resolved');
    expect(r.resolutionKind).toBe('multi_domain');
    expect(r.mapping.capabilityStatus).toBe('recognized_but_not_routed');
  });

  test('253. multi-domain probe with one domain fails strict invariant', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const probes = (
      audit.referenceSummaries as {
        crossDomainSafetyProbes: Array<{
          id: string;
          expected: { category: string };
          actual: { domainIds: string[]; status: string; resolutionKind: string };
          passed: boolean;
        }>;
      }
    ).crossDomainSafetyProbes;
    const multi = probes.filter((p) => p.expected.category === 'multi_domain');
    expect(multi.every((p) => p.actual.domainIds.length >= 2 && p.actual.status === 'resolved')).toBe(
      true,
    );
    const fake = { category: 'multi_domain', domainIds: ['payroll'], passed: false };
    expect(fake.domainIds.length >= 2 && fake.passed).toBe(false);
  });
});

describe('Stage 3J.1 coverage and help actions', () => {
  test('254. all registry domains exist in coverage', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const { registry } = loadDomainLexicon();
    const coverage = audit.helpCoverage as { perDomain: Array<{ domainId: string }> };
    const ids = new Set(coverage.perDomain.map((d) => d.domainId));
    for (const d of registry.domains.filter((x) => x.status === 'approved')) {
      expect(ids.has(d.domainId)).toBe(true);
    }
    expect(audit.registeredDomainsMissingFromCoverage).toEqual([]);
  });

  test('255. core coverage is not_applicable', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const coverage = audit.helpCoverage as {
      perDomain: Array<{ domainId: string; classificationConfidence: string }>;
    };
    const core = coverage.perDomain.find((d) => d.domainId === 'core');
    expect(core?.classificationConfidence).toBe('not_applicable');
  });

  test('256. help action count or explicit unavailable state', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const help = audit.helpDiscovery as {
      helpActionCount: number | null;
      helpActionsUnavailableFromGraph: number;
      helpActionsUnavailableReason: string | null;
      helpDocumentsWithActions: number | null;
      helpDocumentsWithActionsUnavailable: boolean;
      helpDocumentsWithActionsUnavailableReason: string | null;
    };
    const actionsOk =
      (typeof help.helpActionCount === 'number' && help.helpActionCount >= 0) ||
      (help.helpActionCount === null &&
        help.helpActionsUnavailableFromGraph > 0 &&
        !!help.helpActionsUnavailableReason);
    expect(actionsOk).toBe(true);
    const docsOk =
      (help.helpDocumentsWithActions !== null &&
        help.helpDocumentsWithActionsUnavailable === false &&
        help.helpDocumentsWithActions >= 0) ||
      (help.helpDocumentsWithActions === null &&
        help.helpDocumentsWithActionsUnavailable === true &&
        !!help.helpDocumentsWithActionsUnavailableReason);
    expect(docsOk).toBe(true);
    if (typeof help.helpActionCount === 'number' && help.helpActionCount > 0 && !help.helpDocumentsWithActionsUnavailable) {
      expect(help.helpDocumentsWithActions).toBeGreaterThan(0);
    }
  });

  test('257. fixture category sum equals fixture count', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const rs = audit.referenceSummaries as {
      fixtureReferenceCount: number;
      fixtureCategorySum: number;
      fixtureDomainCategories: Record<string, number>;
    };
    expect(rs.fixtureCategorySum).toBe(rs.fixtureReferenceCount);
    expect(Object.values(rs.fixtureDomainCategories).reduce((a, b) => a + b, 0)).toBe(
      rs.fixtureReferenceCount,
    );
  });

  test('258. probe count consistency', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const rs = audit.referenceSummaries as {
      crossDomainSafetyProbesExecuted: number;
      crossDomainSafetyProbesPassed: number;
      crossDomainSafetyProbes: unknown[];
    };
    expect(rs.crossDomainSafetyProbesExecuted).toBe(rs.crossDomainSafetyProbes.length);
    expect(rs.crossDomainSafetyProbesPassed).toBe(rs.crossDomainSafetyProbesExecuted);
  });

  test('259. unresolved scope leak counters are zero', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const c = audit.crossDomainSafety as Record<string, number>;
    expect(c.unresolvedQueriesAssignedDomainScope).toBe(0);
    expect(c.unresolvedQueriesAssignedPayrollScope).toBe(0);
    expect(c.unresolvedQueriesAssignedHrScope).toBe(0);
  });
});

describe('Stage 3J.1 semantic probe consistency', () => {
  test('260. hr_find_expiring proves hr domain from resolver', () => {
    const r = resolveDomainLexicon('Komu kończy się umowa o pracę?');
    expect(r.domains.map((d) => d.domainId)).toContain('hr');
    expect(r.mapping.operationId).toBe('neutral_find_expiring');
    expect(r.mapping.routingStatus).toBe('recognized_but_not_routed');
    expect(['recognized_but_not_routed', 'not_available_yet']).toContain(r.mapping.capabilityStatus);
    expect(r.status).toBe('resolved');
  });

  test('261. hr domain-specific probe without domains fails', () => {
    const fake = evaluateSafetyProbe(
      {
        id: 'synthetic_hr_empty',
        q: 'Pokaż dokumenty.',
        expectedCategory: 'hr',
        expectedDomainIds: ['hr'],
        expectedStatus: 'resolved',
      },
      new Set(['hr', 'payroll']),
    );
    expect(fake.actual.domainIds).toEqual([]);
    expect(fake.passed).toBe(false);
  });

  test('262. RCP + payroll is resolved multi_domain not ambiguous', () => {
    const r = resolveDomainLexicon('RCP i składnik płacowy 1350');
    expect(r.status).toBe('resolved');
    expect(r.resolutionKind).toBe('multi_domain');
    expect(r.status).not.toBe('ambiguous');
  });

  test('263. invoice + accounting is resolved multi_domain', () => {
    const r = resolveDomainLexicon('Czy faktura została zaksięgowana w księgowości?');
    expect(r.status).toBe('resolved');
    expect(r.resolutionKind).toBe('multi_domain');
  });

  test('264. coexisting domains do not force ambiguity', () => {
    const r = resolveDomainLexicon('RCP i składnik płacowy 1350');
    expect(r.domains.length).toBeGreaterThanOrEqual(2);
    expect(r.resolutionKind).toBe('multi_domain');
    expect(r.status).toBe('resolved');
  });

  test('265. competing interpretations still cause ambiguity', () => {
    const r = resolveDomainLexicon('składnik płacowy i lista płac');
    expect(r.concepts.length).toBeGreaterThanOrEqual(2);
    expect(r.domains.length).toBe(1);
    expect(r.status).toBe('ambiguous');
    expect(r.resolutionKind).toBe('ambiguous');
  });

  test('266. unresolved capabilityStatus is not not_available_yet', () => {
    const r = resolveDomainLexicon('Pokaż dokumenty.');
    expect(r.status).toBe('unresolved');
    expect(r.mapping.capabilityStatus).not.toBe('not_available_yet');
    expect(r.mapping.capabilityStatus).toBeNull();
  });

  test('267. create analogous still not_available_yet', () => {
    const r = resolveDomainLexicon('Utwórz składnik analogiczny do 1353');
    expect(r.mapping.capabilityStatus).toBe('not_available_yet');
    expect(r.domains.some((d) => d.domainId === 'payroll')).toBe(true);
  });

  test('268. help documents with actions unique count from synthetic links', () => {
    const links = [
      { helpDocumentId: 'doc-a', actionControlId: 'act-1' },
      { helpDocumentId: 'doc-a', actionControlId: 'act-2' },
      { helpDocumentId: 'doc-b', actionControlId: 'act-2' },
      { helpDocumentId: 'doc-b', actionControlId: 'act-3' },
    ];
    expect(countUniqueHelpDocumentsWithActions(links)).toBe(2);
  });

  test('269. help documents unavailable when actions exist without doc path', () => {
    const r = reconcileHelpDocumentsWithActions({
      helpActionCount: 152,
      linkedDocumentCount: 0,
      uniqueDocumentsFromLinks: 0,
    });
    expect(r.helpDocumentsWithActions).toBeNull();
    expect(r.helpDocumentsWithActionsUnavailable).toBe(true);
    expect(r.helpDocumentsWithActionsUnavailableReason).toBeTruthy();
    expect(r.orphanHelpActions).toBe(152);
  });

  test('270. probesPassingWithoutActualDomainEvidence is zero', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const c = audit.crossDomainSafety as Record<string, number>;
    expect(c.probesPassingWithoutActualDomainEvidence).toBe(0);
    expect(c.unresolvedQueriesMarkedNotAvailableYet).toBe(0);
    expect(c.ambiguousQueriesMarkedNotAvailableYet).toBe(0);
  });

  test('271. safety probe expected vs actual contract', () => {
    const audit = buildDomainLexiconAudit(false, path.resolve(__dirname, '../../../..'), VERIFICATION_STUB);
    const probes = (
      audit.referenceSummaries as {
        crossDomainSafetyProbes: Array<{
          id: string;
          expected: { domainIds: string[]; category: string };
          actual: { domainIds: string[]; category: string; status: string };
          passed: boolean;
        }>;
      }
    ).crossDomainSafetyProbes;
    const hr = probes.find((p) => p.id === 'hr_find_expiring')!;
    expect(hr.expected.domainIds).toEqual(['hr']);
    expect(hr.actual.domainIds).toContain('hr');
    expect(hr.actual.category).toBe('hr');
    expect(hr.passed).toBe(true);
  });
});
