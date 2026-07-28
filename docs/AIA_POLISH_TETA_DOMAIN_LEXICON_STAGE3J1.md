# AIA — Polish Teta Domain Lexicon (Stage 3J.1)

Multidomain lexicon framework with Help discovery (local, uncommitted).

## Cel i granice

- rejestr domen + deterministyczny leksykon PL
- bootstrap approved: **hr** + **payroll**
- Help coverage/candidates bez auto-approve
- Stage 3J.2: zatwierdzanie pojęć z dokumentacji modułowej (nierozpoczęty)

## Domain registry / approved lexicon

- domains: core, organization, hr, payroll, time_and_attendance, finance, accounting, invoicing, receivables_payables, fixed_assets, teta_me
- approved entries: 4
- by domain: `{"hr":{"approvedLexiconConcepts":2,"approvedLexiconAliases":9},"payroll":{"approvedLexiconConcepts":2,"approvedLexiconAliases":9}}`
- helpAutoApprovedConcepts: 0

## Help coverage

- formsTotal: 3561
- formsWithHelp: 1771
- helpDocumentsInGraph: 1771
- helpFieldCount: 26658
- helpActionCount: 152
- helpDocumentsWithActions: null
- helpDocumentsWithActionsUnavailable: true
- helpDocumentsWithActionsUnavailableReason: Stage 3A links action_control via help_field DESCRIBES, but those help_field nodes have no DESCRIBES path from help_document; document assignment is unavailable without rebuilding Stage 3A
- orphanHelpActions: 152
- registeredDomainsMissingFromCoverage: []

### perDomain (wszystkie zarejestrowane)

```json
[
  {
    "domainId": "accounting",
    "formsWithHelp": 22,
    "helpDiscoveredCandidates": 144,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "core",
    "formsWithHelp": 0,
    "helpDiscoveredCandidates": 0,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "not_applicable"
  },
  {
    "domainId": "finance",
    "formsWithHelp": 31,
    "helpDiscoveredCandidates": 58,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "fixed_assets",
    "formsWithHelp": 26,
    "helpDiscoveredCandidates": 150,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "hr",
    "formsWithHelp": 655,
    "helpDiscoveredCandidates": 2009,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "invoicing",
    "formsWithHelp": 32,
    "helpDiscoveredCandidates": 236,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "organization",
    "formsWithHelp": 24,
    "helpDiscoveredCandidates": 107,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "payroll",
    "formsWithHelp": 15,
    "helpDiscoveredCandidates": 61,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "receivables_payables",
    "formsWithHelp": 22,
    "helpDiscoveredCandidates": 92,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  },
  {
    "domainId": "teta_me",
    "formsWithHelp": 0,
    "helpDiscoveredCandidates": 0,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "unclassified"
  },
  {
    "domainId": "time_and_attendance",
    "formsWithHelp": 31,
    "helpDiscoveredCandidates": 117,
    "helpAutoApprovedConcepts": 0,
    "classificationConfidence": "candidate"
  }
]
```

## Fixture vs safety probes

- fixtureReferenceCount / passed: 198 / 198
- fixtureDomainCategories: `{"payroll":176,"hr":6,"time_and_attendance":1,"invoicing":2,"accounting":2,"fixed_assets":1,"multi_domain":1,"unrecognized":9}`
- crossDomainSafetyProbesExecuted / passed: 9 / 9
- probesPassingWithoutActualDomainEvidence: 0

## Semantic probe evidence (expected vs actual)

### hr_find_expiring

```json
{
  "id": "hr_find_expiring",
  "expected": {
    "domainIds": [
      "hr"
    ],
    "status": "resolved",
    "routingStatus": "recognized_but_not_routed",
    "category": "hr"
  },
  "actual": {
    "domainIds": [
      "hr"
    ],
    "conceptIds": [],
    "operationId": "neutral_find_expiring",
    "status": "resolved",
    "resolutionKind": "single_domain",
    "category": "hr",
    "capabilityStatus": "not_available_yet",
    "routingStatus": "recognized_but_not_routed",
    "scope": "recognized_but_not_routed"
  },
  "passed": true
}
```

### cross_domain_rcp_payroll

```json
{
  "id": "cross_domain_rcp_payroll",
  "expected": {
    "domainIds": [
      "payroll",
      "time_and_attendance"
    ],
    "status": "resolved",
    "routingStatus": "recognized_but_not_routed",
    "category": "multi_domain"
  },
  "actual": {
    "domainIds": [
      "payroll",
      "time_and_attendance"
    ],
    "conceptIds": [
      "payroll_component"
    ],
    "operationId": null,
    "status": "resolved",
    "resolutionKind": "multi_domain",
    "category": "multi_domain",
    "capabilityStatus": "recognized_but_not_routed",
    "routingStatus": "recognized_but_not_routed",
    "scope": "recognized_but_not_routed"
  },
  "passed": true
}
```

### cross_domain_invoice_accounting

```json
{
  "id": "cross_domain_invoice_accounting",
  "expected": {
    "domainIds": [
      "accounting",
      "invoicing"
    ],
    "status": "resolved",
    "routingStatus": "recognized_but_not_routed",
    "category": "multi_domain"
  },
  "actual": {
    "domainIds": [
      "accounting",
      "invoicing"
    ],
    "conceptIds": [],
    "operationId": null,
    "status": "resolved",
    "resolutionKind": "multi_domain",
    "category": "multi_domain",
    "capabilityStatus": "recognized_but_not_routed",
    "routingStatus": "recognized_but_not_routed",
    "scope": "recognized_but_not_routed"
  },
  "passed": true
}
```

### generic_ambiguous_document

```json
{
  "id": "generic_ambiguous_document",
  "expected": {
    "domainIds": [],
    "status": "unresolved",
    "routingStatus": null,
    "category": "unresolved"
  },
  "actual": {
    "domainIds": [],
    "conceptIds": [],
    "operationId": "neutral_inspect",
    "status": "unresolved",
    "resolutionKind": "unresolved",
    "category": "unresolved",
    "capabilityStatus": null,
    "routingStatus": "unresolved",
    "scope": "unresolved"
  },
  "passed": true
}
```

## Cross-domain / unresolved safety counters

```json
{
  "queriesIncorrectlyDefaultedToHr": 0,
  "queriesIncorrectlyDefaultedToPayroll": 0,
  "crossDomainQueriesCollapsedToSingleDomain": 0,
  "unknownDomainAutoSelections": 0,
  "genericDocumentAutoMappedToAccounting": 0,
  "genericListAutoMappedToPayroll": 0,
  "genericValueAutoMappedToPayroll": 0,
  "unresolvedQueriesAssignedDomainScope": 0,
  "unresolvedQueriesAssignedPayrollScope": 0,
  "unresolvedQueriesAssignedHrScope": 0,
  "unresolvedQueriesMarkedNotAvailableYet": 0,
  "ambiguousQueriesMarkedNotAvailableYet": 0,
  "probesPassingWithoutActualDomainEvidence": 0
}
```

## Migration counters

```json
{
  "stage3jPlannerHardcodedSignalsRemaining": 0,
  "snapshotGateHardcodedSignalsRemaining": 0,
  "unsupportedHardcodedSignalsRemaining": 0,
  "legacyLanguageRuleFallbacks": 0,
  "lexiconResolutionFallbacks": 0
}
```

## Verification

```json
{
  "stage3j1TestsExecuted": 271,
  "stage3j1TestsPassed": 271,
  "stage3j1TestsFailed": 0,
  "languageFixtureCases": 198,
  "languageFixturePassed": 198,
  "languageFixtureFailed": 0,
  "stage3jRegressionExecuted": 161,
  "stage3jRegressionPassed": 161,
  "stage3bStage3iExecuted": 174,
  "stage3bStage3iPassed": 174,
  "apiBuildExitCode": 0,
  "webBuildExitCode": 0
}
```

## Strict

- strictErrors: []

## Out of scope

Employee payroll values, component design, comparison, payroll calculation, Oracle formula execution.
