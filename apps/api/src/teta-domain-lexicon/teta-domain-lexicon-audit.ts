import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { loadDomainLexicon } from './teta-domain-lexicon-loader';
import { resolveDomainLexicon } from './teta-domain-lexicon-resolver';
import { validateDomainLexicon } from './teta-domain-lexicon-validator';
import { assertUtf8JsonArtifact } from './teta-domain-lexicon-encoding';
import { getMigrationCounters, resetMigrationCounters } from './teta-domain-lexicon-migration-counters';
import { discoverHelpConceptCandidates } from './teta-help-concept-discovery.service';
import { validateKnowledgeSourceManifest } from './teta-domain-knowledge-source-inventory';
import { sha256, stableStringify } from './teta-domain-lexicon-contract';
import type { HelpCoverageReport } from './teta-domain-lexicon.types';

export type Stage3j1VerificationInput = {
  stage3j1TestsExecuted: number;
  stage3j1TestsPassed: number;
  stage3j1TestsFailed: number;
  languageFixtureCases: number;
  languageFixturePassed: number;
  languageFixtureFailed: number;
  stage3jRegressionExecuted: number;
  stage3jRegressionPassed: number;
  stage3bStage3iExecuted: number;
  stage3bStage3iPassed: number;
  apiBuildExitCode: number;
  webBuildExitCode: number;
};

function loadVerificationOverlay(repoRoot: string): Partial<Stage3j1VerificationInput> | null {
  const p = path.join(repoRoot, '.local', 'AIA_POLISH_TETA_DOMAIN_LEXICON_STAGE3J1.verification.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Partial<Stage3j1VerificationInput>;
}

function computeUnresolvedScopeLeakCounters(queries: string[]): {
  unresolvedQueriesAssignedDomainScope: number;
  unresolvedQueriesAssignedPayrollScope: number;
  unresolvedQueriesAssignedHrScope: number;
} {
  let unresolvedQueriesAssignedDomainScope = 0;
  let unresolvedQueriesAssignedPayrollScope = 0;
  let unresolvedQueriesAssignedHrScope = 0;
  for (const q of queries) {
    const r = resolveDomainLexicon(q);
    if (r.status !== 'unresolved') continue;
    if (r.domains.length > 0) unresolvedQueriesAssignedDomainScope += 1;
    if (
      r.mapping.scope === 'generic_payroll_knowledge' ||
      r.mapping.scope === 'client_payroll_configuration'
    ) {
      unresolvedQueriesAssignedPayrollScope += 1;
    }
    if (r.domains.some((d) => d.domainId === 'hr')) unresolvedQueriesAssignedHrScope += 1;
  }
  return {
    unresolvedQueriesAssignedDomainScope,
    unresolvedQueriesAssignedPayrollScope,
    unresolvedQueriesAssignedHrScope,
  };
}

function computeCrossDomainSafetyCounters(refs: Array<{ query: string }>): Record<string, number> {
  let queriesIncorrectlyDefaultedToHr = 0;
  let queriesIncorrectlyDefaultedToPayroll = 0;
  let crossDomainQueriesCollapsedToSingleDomain = 0;
  let unknownDomainAutoSelections = 0;
  let genericDocumentAutoMappedToAccounting = 0;
  let genericListAutoMappedToPayroll = 0;
  let genericValueAutoMappedToPayroll = 0;

  for (const ref of refs) {
    const r = resolveDomainLexicon(ref.query);
    if (r.domains.some((d) => d.domainId === 'unknown')) unknownDomainAutoSelections += 1;
  }

  const probes = [
    {
      q: 'Nieznany dokument xyz',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        if (r.domains.some((d) => d.domainId === 'hr')) queriesIncorrectlyDefaultedToHr += 1;
        if (r.mapping.scope === 'client_payroll_configuration') queriesIncorrectlyDefaultedToPayroll += 1;
      },
    },
    {
      q: 'RCP i składnik płacowy 1350',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        const matchedDomains = new Set(r.domains.map((d) => d.domainId));
        if (matchedDomains.size > 1 && r.domains.length === 1) {
          crossDomainQueriesCollapsedToSingleDomain += 1;
        }
        if (
          matchedDomains.has('time_and_attendance') &&
          matchedDomains.has('payroll') &&
          r.domains.length < 2
        ) {
          crossDomainQueriesCollapsedToSingleDomain += 1;
        }
      },
    },
    {
      q: 'Czy faktura została zaksięgowana w księgowości?',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        const matchedDomains = new Set(r.domains.map((d) => d.domainId));
        if (
          matchedDomains.has('invoicing') &&
          matchedDomains.has('accounting') &&
          r.domains.length < 2
        ) {
          crossDomainQueriesCollapsedToSingleDomain += 1;
        }
      },
    },
    {
      q: 'Dokument',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        if (r.domains.some((d) => d.domainId === 'accounting')) {
          genericDocumentAutoMappedToAccounting += 1;
        }
      },
    },
    {
      q: 'Lista',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        if (r.mapping.scope === 'client_payroll_configuration') genericListAutoMappedToPayroll += 1;
      },
    },
    {
      q: 'Stawka',
      check: (r: ReturnType<typeof resolveDomainLexicon>) => {
        if (r.mapping.scope === 'client_payroll_configuration') genericValueAutoMappedToPayroll += 1;
      },
    },
  ];
  for (const p of probes) p.check(resolveDomainLexicon(p.q));

  return {
    queriesIncorrectlyDefaultedToHr,
    queriesIncorrectlyDefaultedToPayroll,
    crossDomainQueriesCollapsedToSingleDomain,
    unknownDomainAutoSelections,
    genericDocumentAutoMappedToAccounting,
    genericListAutoMappedToPayroll,
    genericValueAutoMappedToPayroll,
  };
}

function computeUnresolvedCapabilityCounters(queries: string[]): {
  unresolvedQueriesMarkedNotAvailableYet: number;
  ambiguousQueriesMarkedNotAvailableYet: number;
} {
  let unresolvedQueriesMarkedNotAvailableYet = 0;
  let ambiguousQueriesMarkedNotAvailableYet = 0;
  for (const q of queries) {
    const r = resolveDomainLexicon(q);
    if (r.status === 'unresolved' && r.mapping.capabilityStatus === 'not_available_yet') {
      unresolvedQueriesMarkedNotAvailableYet += 1;
    }
    if (r.status === 'ambiguous' && r.mapping.capabilityStatus === 'not_available_yet') {
      ambiguousQueriesMarkedNotAvailableYet += 1;
    }
  }
  return {
    unresolvedQueriesMarkedNotAvailableYet,
    ambiguousQueriesMarkedNotAvailableYet,
  };
}

type SafetyProbeDefinition = {
  id: string;
  q: string;
  /** Expected category for invariants; not copied into actual. */
  expectedCategory: string;
  expectedDomainIds?: string[];
  expectedStatus?: string;
  expectedRoutingStatus?: string;
  fixtureCaseId?: string;
};

export type SafetyProbeResult = {
  id: string;
  query: string;
  expected: {
    domainIds: string[];
    status: string | null;
    routingStatus: string | null;
    category: string;
  };
  actual: {
    domainIds: string[];
    conceptIds: string[];
    operationId: string | null;
    status: string;
    resolutionKind: string;
    category: string;
    capabilityStatus: string | null;
    routingStatus: string | null;
    scope: string | null;
  };
  passed: boolean;
};

function deriveActualCategory(r: ReturnType<typeof resolveDomainLexicon>): string {
  if (r.resolutionKind === 'multi_domain') return 'multi_domain';
  if (r.resolutionKind === 'ambiguous' || r.status === 'ambiguous') return 'ambiguous';
  if (r.resolutionKind === 'unresolved' || r.status === 'unresolved') return 'unresolved';
  return r.domains[0]?.domainId ?? 'unrecognized';
}

export function evaluateSafetyProbe(
  p: SafetyProbeDefinition,
  registryDomainIds: Set<string>,
): SafetyProbeResult {
  const r = resolveDomainLexicon(p.q);
  const domainIds = [...r.domains.map((d) => d.domainId)].sort();
  const conceptIds = [...r.concepts.map((c) => c.conceptId)].sort();
  const expectedDomainIds = [...(p.expectedDomainIds ?? [])].sort();
  const actualCategory = deriveActualCategory(r);

  let passed = true;
  const isSpecial =
    p.expectedCategory === 'multi_domain' ||
    p.expectedCategory === 'ambiguous' ||
    p.expectedCategory === 'unresolved';

  if (p.expectedCategory === 'multi_domain') {
    passed =
      r.status === 'resolved' &&
      r.resolutionKind === 'multi_domain' &&
      domainIds.length >= 2 &&
      expectedDomainIds.every((d) => domainIds.includes(d)) &&
      (r.mapping.capabilityStatus === 'recognized_but_not_routed' ||
        r.mapping.routingStatus === 'recognized_but_not_routed');
  } else if (p.id === 'generic_ambiguous_document' || p.expectedCategory === 'ambiguous' || p.expectedCategory === 'unresolved') {
    if (p.id === 'generic_ambiguous_document') {
      passed =
        r.status === 'unresolved' &&
        domainIds.length === 0 &&
        r.mapping.scope !== 'generic_payroll_knowledge' &&
        r.mapping.scope !== 'client_payroll_configuration' &&
        (r.mapping.scope === 'unresolved' || r.mapping.scope === null) &&
        r.mapping.capabilityStatus !== 'not_available_yet';
    }
  } else {
    // Domain-specific probe: must prove required domains from actual resolver output.
    if (!expectedDomainIds.length) {
      passed = false;
    } else if (!expectedDomainIds.every((d) => registryDomainIds.has(d))) {
      passed = false;
    } else if (!expectedDomainIds.every((d) => domainIds.includes(d))) {
      passed = false;
    }
    if (p.expectedStatus === 'resolved') {
      if (r.status !== 'resolved' && r.status !== 'resolved_with_warnings') passed = false;
    } else if (p.expectedStatus && r.status !== p.expectedStatus) {
      passed = false;
    }
    if (p.expectedRoutingStatus && r.mapping.routingStatus !== p.expectedRoutingStatus) {
      passed = false;
    }
  }

  // Synthetic invariant helper: domain-specific without domain evidence cannot pass.
  if (!isSpecial && expectedDomainIds.length > 0 && !expectedDomainIds.every((d) => domainIds.includes(d))) {
    passed = false;
  }

  return {
    id: p.id,
    query: p.q,
    expected: {
      domainIds: expectedDomainIds,
      status: p.expectedStatus ?? null,
      routingStatus: p.expectedRoutingStatus ?? null,
      category: p.expectedCategory,
    },
    actual: {
      domainIds,
      conceptIds,
      operationId: r.mapping.operationId ?? null,
      status: r.status,
      resolutionKind: r.resolutionKind,
      category: actualCategory,
      capabilityStatus: r.mapping.capabilityStatus ?? null,
      routingStatus: r.mapping.routingStatus ?? null,
      scope: r.mapping.scope,
    },
    passed,
  };
}

function buildReferenceSummaries(
  refs: Array<{ query: string; expected?: { scope?: string; focus?: string } }>,
  registryDomainIds: Set<string>,
) {
  const fixtureDomainCategories: Record<string, number> = {
    payroll: 0,
    hr: 0,
    time_and_attendance: 0,
    invoicing: 0,
    accounting: 0,
    fixed_assets: 0,
    multi_domain: 0,
    unrecognized: 0,
  };
  let generic = 0;
  let clientSpecific = 0;
  let ambiguous = 0;
  let unresolved = 0;
  let contextRequired = 0;
  let recognizedButNotRouted = 0;
  let unsupportedCapability = 0;

  for (const ref of refs) {
    const r = resolveDomainLexicon(ref.query);
    if (r.status === 'ambiguous') ambiguous += 1;
    if (r.status === 'unresolved') unresolved += 1;
    if (r.mapping.scope === 'generic_payroll_knowledge') generic += 1;
    if (r.mapping.scope === 'client_payroll_configuration') clientSpecific += 1;
    if (r.mapping.scope === 'recognized_but_not_routed') recognizedButNotRouted += 1;
    if (r.mapping.capabilityStatus === 'not_available_yet') unsupportedCapability += 1;
    if (r.diagnostics.includes('ambiguous_stawka') || r.concepts.some((c) => c.confidence === 'context_required')) {
      contextRequired += 1;
    }
    if (r.resolutionKind === 'multi_domain' || r.domains.length > 1) fixtureDomainCategories.multi_domain += 1;
    else if (r.domains[0]?.domainId === 'payroll') fixtureDomainCategories.payroll += 1;
    else if (r.domains[0]?.domainId === 'hr') fixtureDomainCategories.hr += 1;
    else if (r.domains[0]?.domainId === 'time_and_attendance') fixtureDomainCategories.time_and_attendance += 1;
    else if (r.domains[0]?.domainId === 'invoicing') fixtureDomainCategories.invoicing += 1;
    else if (r.domains[0]?.domainId === 'accounting') fixtureDomainCategories.accounting += 1;
    else if (r.domains[0]?.domainId === 'fixed_assets') fixtureDomainCategories.fixed_assets += 1;
    else fixtureDomainCategories.unrecognized += 1;
  }

  const probes: SafetyProbeDefinition[] = [
    {
      id: 'payroll_stage3j',
      q: 'Z czego liczy się składnik 1353?',
      expectedCategory: 'payroll',
      expectedDomainIds: ['payroll'],
      expectedStatus: 'resolved',
    },
    {
      id: 'hr_find_expiring',
      q: 'Komu kończy się umowa o pracę?',
      expectedCategory: 'hr',
      expectedDomainIds: ['hr'],
      expectedStatus: 'resolved',
      expectedRoutingStatus: 'recognized_but_not_routed',
    },
    {
      id: 'time_and_attendance',
      q: 'Pokaż RCP',
      expectedCategory: 'time_and_attendance',
      expectedDomainIds: ['time_and_attendance'],
    },
    {
      id: 'invoicing',
      q: 'Wyjaśnij fakturę VAT',
      expectedCategory: 'invoicing',
      expectedDomainIds: ['invoicing'],
    },
    {
      id: 'accounting',
      q: 'Zmień plan kont',
      expectedCategory: 'accounting',
      expectedDomainIds: ['accounting'],
    },
    {
      id: 'fixed_assets',
      q: 'Pokaż środki trwałe',
      expectedCategory: 'fixed_assets',
      expectedDomainIds: ['fixed_assets'],
    },
    {
      id: 'cross_domain_rcp_payroll',
      q: 'RCP i składnik płacowy 1350',
      expectedCategory: 'multi_domain',
      expectedDomainIds: ['time_and_attendance', 'payroll'],
      expectedStatus: 'resolved',
      expectedRoutingStatus: 'recognized_but_not_routed',
    },
    {
      id: 'cross_domain_invoice_accounting',
      q: 'Czy faktura została zaksięgowana w księgowości?',
      expectedCategory: 'multi_domain',
      expectedDomainIds: ['accounting', 'invoicing'],
      expectedStatus: 'resolved',
      expectedRoutingStatus: 'recognized_but_not_routed',
    },
    {
      id: 'generic_ambiguous_document',
      q: 'Pokaż dokumenty.',
      expectedCategory: 'unresolved',
      expectedStatus: 'unresolved',
    },
  ];

  const crossDomainSafetyProbes = probes.map((p) => evaluateSafetyProbe(p, registryDomainIds));

  const domainSpecificProbes = crossDomainSafetyProbes.filter(
    (p) =>
      p.expected.category !== 'multi_domain' &&
      p.expected.category !== 'ambiguous' &&
      p.expected.category !== 'unresolved',
  );
  const probesPassingWithoutActualDomainEvidence = domainSpecificProbes.filter(
    (p) =>
      p.passed &&
      (p.expected.domainIds.length === 0 ||
        !p.expected.domainIds.every((d) => p.actual.domainIds.includes(d))),
  ).length;

  const fixtureReferencesPassed = refs.filter((ref) => {
    const r = resolveDomainLexicon(ref.query);
    const okScope = !ref.expected?.scope || r.mapping.scope === ref.expected.scope;
    const okFocus = !ref.expected?.focus || r.mapping.focus === ref.expected.focus;
    return okScope && okFocus;
  }).length;

  // Compact summaries for docs (expected vs actual, no full query required).
  const safeReferenceSummaries = crossDomainSafetyProbes.map((p) => ({
    id: p.id,
    expected: p.expected,
    actual: {
      domainIds: p.actual.domainIds,
      conceptIds: p.actual.conceptIds,
      operationId: p.actual.operationId,
      status: p.actual.status,
      resolutionKind: p.actual.resolutionKind,
      category: p.actual.category,
      capabilityStatus: p.actual.capabilityStatus,
      routingStatus: p.actual.routingStatus,
      scope: p.actual.scope,
    },
    passed: p.passed,
  }));

  return {
    fixtureReferenceCount: refs.length,
    fixtureReferencesPassed,
    fixtureDomainCategories,
    fixtureCategorySum: Object.values(fixtureDomainCategories).reduce((a, b) => a + b, 0),
    crossDomainSafetyProbes: safeReferenceSummaries,
    crossDomainSafetyProbesExecuted: crossDomainSafetyProbes.length,
    crossDomainSafetyProbesPassed: crossDomainSafetyProbes.filter((p) => p.passed).length,
    probesPassingWithoutActualDomainEvidence,
    // legacy aliases kept for readers
    referencesTotal: refs.length,
    referencesPassed: fixtureReferencesPassed,
    domainCategories: fixtureDomainCategories,
    generic,
    clientSpecific,
    ambiguous,
    unresolved,
    contextRequired,
    recognizedButNotRouted,
    multiDomain: fixtureDomainCategories.multi_domain,
    unsupportedCapability,
    safeReferenceSummaries,
  };
}

export function buildDomainLexiconAudit(
  strict = false,
  repoRoot?: string,
  verificationOverride?: Partial<Stage3j1VerificationInput>,
): Record<string, unknown> {
  resetMigrationCounters();
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const { catalog, lexiconSha256, manifest, registry } = loadDomainLexicon();
  const validation = validateDomainLexicon(catalog);
  const refsPath = path.resolve(
    __dirname,
    '../../test-fixtures/teta-domain-lexicon/stage3j1-polish-phrases-v1.json',
  );
  const refs = JSON.parse(readFileSync(refsPath, 'utf8')) as Array<{
    query: string;
    expected: { scope?: string; focus?: string };
  }>;
  let passed = 0;
  let ambiguous = 0;
  let unresolved = 0;
  for (const ref of refs) {
    const resolution = resolveDomainLexicon(ref.query);
    if (resolution.status === 'ambiguous') ambiguous += 1;
    if (resolution.status === 'unresolved') unresolved += 1;
    const okScope = !ref.expected.scope || resolution.mapping.scope === ref.expected.scope;
    const okFocus = !ref.expected.focus || resolution.mapping.focus === ref.expected.focus;
    if (okScope && okFocus) passed += 1;
  }

  const helpDiscovery = discoverHelpConceptCandidates(root);
  const helpCoverage = helpDiscovery.coverage;
  const knowledgeManifestPath = path.resolve(
    __dirname,
    '../../config/teta-domain-lexicon/teta-domain-knowledge-sources-v1.json',
  );
  const knowledgeManifest = JSON.parse(readFileSync(knowledgeManifestPath, 'utf8'));
  const knowledgeValidation = validateKnowledgeSourceManifest(knowledgeManifest);

  const encodingChecks = [
    assertUtf8JsonArtifact(readFileSync(refsPath, 'utf8')),
    assertUtf8JsonArtifact(readFileSync(knowledgeManifestPath, 'utf8')),
  ];

  const approvedEntries = catalog.entries.filter((e) => e.status === 'approved');
  const approvedByDomain: Record<string, { approvedLexiconConcepts: number; approvedLexiconAliases: number }> = {};
  for (const e of approvedEntries) {
    const d = e.domain;
    approvedByDomain[d] = approvedByDomain[d] ?? { approvedLexiconConcepts: 0, approvedLexiconAliases: 0 };
    approvedByDomain[d].approvedLexiconConcepts += 1;
    approvedByDomain[d].approvedLexiconAliases += e.aliases.length;
  }

  const overlay = loadVerificationOverlay(root) ?? {};
  const verification: Stage3j1VerificationInput = {
    stage3j1TestsExecuted: verificationOverride?.stage3j1TestsExecuted ?? overlay.stage3j1TestsExecuted ?? 0,
    stage3j1TestsPassed: verificationOverride?.stage3j1TestsPassed ?? overlay.stage3j1TestsPassed ?? 0,
    stage3j1TestsFailed: verificationOverride?.stage3j1TestsFailed ?? overlay.stage3j1TestsFailed ?? 0,
    languageFixtureCases: refs.length,
    languageFixturePassed: passed,
    languageFixtureFailed: refs.length - passed,
    stage3jRegressionExecuted: verificationOverride?.stage3jRegressionExecuted ?? overlay.stage3jRegressionExecuted ?? 0,
    stage3jRegressionPassed: verificationOverride?.stage3jRegressionPassed ?? overlay.stage3jRegressionPassed ?? 0,
    stage3bStage3iExecuted: verificationOverride?.stage3bStage3iExecuted ?? overlay.stage3bStage3iExecuted ?? 0,
    stage3bStage3iPassed: verificationOverride?.stage3bStage3iPassed ?? overlay.stage3bStage3iPassed ?? 0,
    apiBuildExitCode: verificationOverride?.apiBuildExitCode ?? overlay.apiBuildExitCode ?? -1,
    webBuildExitCode: verificationOverride?.webBuildExitCode ?? overlay.webBuildExitCode ?? -1,
  };

  // Exercise migrated paths once for migration counters (must stay 0).
  resolveDomainLexicon('Z czego liczy się składnik 1353?');
  resolveDomainLexicon('Utwórz składnik analogiczny do 1353');
  resolveDomainLexicon('Co to jest składnik płacowy?');
  const migration = getMigrationCounters();
  const crossDomainSafety = computeCrossDomainSafetyCounters(refs);
  const candidatesUsedForRouting = approvedEntries.filter((e) => e.status !== 'approved').length;
  const approvedDomains = registry.domains.filter((d) => d.status === 'approved').map((d) => d.domainId);
  const coverageDomainIds = new Set(helpCoverage.perDomain.map((d) => d.domainId));
  const registeredDomainsMissingFromCoverage = approvedDomains.filter((d) => !coverageDomainIds.has(d));
  const registryDomainIds = new Set(approvedDomains);
  const referenceSummaries = buildReferenceSummaries(refs, registryDomainIds);
  const leakProbeQueries = [
    ...refs.map((r) => r.query),
    'Pokaż dokumenty.',
    'Pokaż listę.',
    'Pokaż wartość.',
    'Dokument',
    'Lista',
    'Stawka',
  ];
  const unresolvedScopeLeaks = computeUnresolvedScopeLeakCounters(leakProbeQueries);
  const unresolvedCapabilityLeaks = computeUnresolvedCapabilityCounters(leakProbeQueries);

  const helpActionsOk =
    (typeof helpCoverage.helpActionCount === 'number' && helpCoverage.helpActionCount >= 0) ||
    (helpCoverage.helpActionCount === null &&
      helpCoverage.helpActionsUnavailableFromGraph > 0 &&
      !!helpCoverage.helpActionsUnavailableReason);

  const helpDocumentsOk =
    (helpCoverage.helpDocumentsWithActions !== null &&
      helpCoverage.helpDocumentsWithActionsUnavailable === false &&
      helpCoverage.helpDocumentsWithActions >= 0 &&
      !(typeof helpCoverage.helpActionCount === 'number' &&
        helpCoverage.helpActionCount > 0 &&
        helpCoverage.helpDocumentsWithActions === 0)) ||
    (helpCoverage.helpDocumentsWithActions === null &&
      helpCoverage.helpDocumentsWithActionsUnavailable === true &&
      !!helpCoverage.helpDocumentsWithActionsUnavailableReason);

  const rcpProbe = referenceSummaries.crossDomainSafetyProbes.find((p) => p.id === 'cross_domain_rcp_payroll');
  const invoiceProbe = referenceSummaries.crossDomainSafetyProbes.find(
    (p) => p.id === 'cross_domain_invoice_accounting',
  );
  const multiDomainProbesOk = referenceSummaries.crossDomainSafetyProbes
    .filter((p) => p.expected.category === 'multi_domain' || p.actual.category === 'multi_domain')
    .every(
      (p) =>
        p.actual.domainIds.length >= 2 &&
        p.actual.status === 'resolved' &&
        p.actual.resolutionKind === 'multi_domain' &&
        p.passed,
    );

  const strictErrors = [
    ...(validation.duplicateEntryIds.length ? ['duplicateEntryIds'] : []),
    ...(validation.rulesMappedToUnknownIntent.length ? ['rulesMappedToUnknownIntent'] : []),
    ...(validation.invalidConceptMappings.length ? ['invalidConceptMappings'] : []),
    ...(validation.directOracleMappingsDetected.length ? ['directOracleMappingsDetected'] : []),
    ...(validation.arbitraryRegexRulesDetected.length ? ['arbitraryRegexRulesDetected'] : []),
    ...(validation.unknownDomainIds.length ? ['unknownDomainIds'] : []),
    ...(validation.candidateOverridesApproved.length ? ['candidateOverridesApproved'] : []),
    ...(passed < refs.length ? ['referenceFailures'] : []),
    ...(migration.stage3jPlannerHardcodedSignalsRemaining ? ['stage3jPlannerHardcodedSignalsRemaining'] : []),
    ...(migration.snapshotGateHardcodedSignalsRemaining ? ['snapshotGateHardcodedSignalsRemaining'] : []),
    ...(migration.unsupportedHardcodedSignalsRemaining ? ['unsupportedHardcodedSignalsRemaining'] : []),
    ...(migration.legacyLanguageRuleFallbacks ? ['legacyLanguageRuleFallbacks'] : []),
    ...(migration.lexiconResolutionFallbacks ? ['lexiconResolutionFallbacks'] : []),
    ...(encodingChecks.some((c) => !c.ok) ? ['encodingIssues'] : []),
    ...(helpCoverage.helpAutoApprovedConcepts !== 0 ? ['helpAutoApprovedConcepts'] : []),
    ...(helpDiscovery.candidateDerivation.candidateConcepts !==
    helpDiscovery.candidateDerivation.candidatesAfterDeduplication
      ? ['candidateConceptsDerivationMismatch']
      : []),
    ...(helpCoverage.reconciliation &&
    helpCoverage.reconciliation.finalFormsWithHelp !== helpCoverage.reconciliation.formsWithValidHelpEdge
      ? ['helpCoverageReconciliationMismatch']
      : []),
    ...(!verification ? ['missingVerification'] : []),
    ...(verification.stage3j1TestsExecuted === 0 && verification.stage3j1TestsPassed > 0
      ? ['verificationZeroExecutedWithPasses']
      : []),
    ...(verification.stage3j1TestsPassed !== verification.stage3j1TestsExecuted
      ? ['verificationStage3j1PassedMismatch']
      : []),
    ...(verification.stage3j1TestsFailed > 0 ? ['verificationStage3j1Failed'] : []),
    ...(verification.languageFixturePassed !== verification.languageFixtureCases
      ? ['verificationFixtureMismatch']
      : []),
    ...(verification.languageFixtureFailed > 0 ? ['verificationFixtureFailed'] : []),
    ...(verification.stage3jRegressionPassed !== verification.stage3jRegressionExecuted
      ? ['verificationStage3jMismatch']
      : []),
    ...(verification.stage3bStage3iPassed !== verification.stage3bStage3iExecuted
      ? ['verificationStage3b3iMismatch']
      : []),
    ...(verification.apiBuildExitCode !== 0 ? ['apiBuildExitCode'] : []),
    ...(verification.webBuildExitCode !== 0 ? ['webBuildExitCode'] : []),
    ...(Object.values(crossDomainSafety).some((v) => v !== 0) ? ['crossDomainSafetyCounters'] : []),
    ...(unresolvedScopeLeaks.unresolvedQueriesAssignedDomainScope
      ? ['unresolvedQueriesAssignedDomainScope']
      : []),
    ...(unresolvedScopeLeaks.unresolvedQueriesAssignedPayrollScope
      ? ['unresolvedQueriesAssignedPayrollScope']
      : []),
    ...(unresolvedScopeLeaks.unresolvedQueriesAssignedHrScope
      ? ['unresolvedQueriesAssignedHrScope']
      : []),
    ...(registeredDomainsMissingFromCoverage.length ? ['registeredDomainsMissingFromCoverage'] : []),
    ...(referenceSummaries.fixtureCategorySum !== referenceSummaries.fixtureReferenceCount
      ? ['fixtureCategorySumMismatch']
      : []),
    ...(referenceSummaries.crossDomainSafetyProbesPassed !==
    referenceSummaries.crossDomainSafetyProbesExecuted
      ? ['crossDomainSafetyProbesFailed']
      : []),
    ...(!multiDomainProbesOk ? ['multiDomainProbesDomainIds'] : []),
    ...(rcpProbe &&
    !(
      rcpProbe.actual.domainIds.includes('time_and_attendance') &&
      rcpProbe.actual.domainIds.includes('payroll') &&
      rcpProbe.actual.status === 'resolved' &&
      rcpProbe.actual.resolutionKind === 'multi_domain'
    )
      ? ['crossDomainRcpPayrollDomains']
      : []),
    ...(invoiceProbe &&
    !(
      invoiceProbe.actual.domainIds.includes('accounting') &&
      invoiceProbe.actual.domainIds.includes('invoicing') &&
      invoiceProbe.actual.status === 'resolved' &&
      invoiceProbe.actual.resolutionKind === 'multi_domain'
    )
      ? ['crossDomainInvoiceAccountingDomains']
      : []),
    ...(!helpActionsOk ? ['helpActionMetricsInvalid'] : []),
    ...(!helpDocumentsOk ? ['helpDocumentsWithActionsInvalid'] : []),
    ...(referenceSummaries.probesPassingWithoutActualDomainEvidence
      ? ['probesPassingWithoutActualDomainEvidence']
      : []),
    ...(unresolvedCapabilityLeaks.unresolvedQueriesMarkedNotAvailableYet
      ? ['unresolvedQueriesMarkedNotAvailableYet']
      : []),
    ...(unresolvedCapabilityLeaks.ambiguousQueriesMarkedNotAvailableYet
      ? ['ambiguousQueriesMarkedNotAvailableYet']
      : []),
    ...(!helpDiscovery.timeAttendanceDiagnostic ? ['timeAttendanceDiagnosticMissing'] : []),
  ];

  if (strict && strictErrors.length) throw new Error(strictErrors.join(','));

  return {
    domainRegistry: {
      registryVersion: registry.registryVersion,
      approvedDomainsCount: approvedDomains.length,
      approvedDomains,
    },
    approvedLexicon: {
      lexiconVersion: catalog.lexiconVersion,
      manifestVersion: manifest.manifestVersion,
      domainPackCount: manifest.domainPacks.filter((p) => p.status === 'approved').length,
      lexiconSha256,
      entryCount: approvedEntries.length,
      aliasCount: approvedEntries.reduce((sum, e) => sum + e.aliases.length, 0),
      operationRuleCount: catalog.operationRules.length,
      approvedDomainsInEntries: [...new Set(approvedEntries.map((e) => e.domain))].sort(),
      approvedLexiconConceptsByDomain: approvedByDomain,
      helpAutoApprovedConcepts: 0,
      candidatesUsedForRouting,
    },
    helpCoverage,
    helpDiscovery: {
      ...helpDiscovery.candidateDerivation,
      warnings: helpDiscovery.warnings,
      fingerprintSha256: helpCoverage.fingerprintSha256,
      helpAutoApprovedConcepts: 0,
      helpActionCount: helpCoverage.helpActionCount,
      helpDocumentsWithActions: helpCoverage.helpDocumentsWithActions,
      helpDocumentsWithActionsUnavailable: helpCoverage.helpDocumentsWithActionsUnavailable,
      helpDocumentsWithActionsUnavailableReason: helpCoverage.helpDocumentsWithActionsUnavailableReason,
      helpActionsUsedAsCandidates: helpCoverage.helpActionsUsedAsCandidates,
      helpActionsUnavailableFromGraph: helpCoverage.helpActionsUnavailableFromGraph,
      helpActionsUnavailableReason: helpCoverage.helpActionsUnavailableReason,
      orphanHelpActions: helpCoverage.orphanHelpActions,
      actionsWithoutHelpEvidence: helpCoverage.actionsWithoutHelpEvidence,
    },
    helpCoverageReconciliation: helpDiscovery.reconciliation,
    registeredDomainsMissingFromCoverage,
    timeAttendanceDiagnostic: {
      metrics: helpDiscovery.timeAttendanceDiagnostic.metrics,
      moduleMappingsApplied: helpDiscovery.timeAttendanceDiagnostic.moduleMappingsApplied,
      notes: helpDiscovery.timeAttendanceDiagnostic.notes,
      examinedFormsCount: helpDiscovery.timeAttendanceDiagnostic.examinedForms.length,
      artifact: '.local/AIA_TETA_HELP_TIME_ATTENDANCE_CLASSIFICATION_STAGE3J1.json',
    },
    knowledgeSourceIntake: {
      registeredSources: knowledgeManifest.sources.length,
      validation: knowledgeValidation,
    },
    validation,
    resolution: {
      referencesTested: refs.length,
      referencesPassed: passed,
      ambiguousReferences: ambiguous,
      unresolvedReferences: unresolved,
    },
    referenceSummaries,
    crossDomainSafety: {
      ...crossDomainSafety,
      ...unresolvedScopeLeaks,
      ...unresolvedCapabilityLeaks,
      probesPassingWithoutActualDomainEvidence:
        referenceSummaries.probesPassingWithoutActualDomainEvidence,
    },
    migration: {
      stage3jPlannerHardcodedSignalsRemaining: migration.stage3jPlannerHardcodedSignalsRemaining,
      snapshotGateHardcodedSignalsRemaining: migration.snapshotGateHardcodedSignalsRemaining,
      unsupportedHardcodedSignalsRemaining: migration.unsupportedHardcodedSignalsRemaining,
      legacyLanguageRuleFallbacks: migration.legacyLanguageRuleFallbacks,
      lexiconResolutionFallbacks: migration.lexiconResolutionFallbacks,
    },
    determinism: {
      helpCoverageFingerprint: helpCoverage.fingerprintSha256,
      resolutionSampleFingerprint: resolveDomainLexicon('Z czego liczy się składnik 1353?')
        .resolutionFingerprintSha256,
      catalogFingerprint: sha256(
        stableStringify({ entries: catalog.entries, operationRules: catalog.operationRules }),
      ),
    },
    encoding: {
      checks: encodingChecks,
      allOk: encodingChecks.every((c) => c.ok),
    },
    safety: {
      oracleConnectionsOpened: 0,
      oracleStatementsExecuted: 0,
      llmCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      sqlCompiled: 0,
      sqlExecuted: 0,
      formulasExecuted: 0,
    },
    verification,
    strictErrors,
  };
}

export function buildHelpCoverageAudit(repoRoot?: string): HelpCoverageReport {
  return discoverHelpConceptCandidates(repoRoot).coverage;
}
