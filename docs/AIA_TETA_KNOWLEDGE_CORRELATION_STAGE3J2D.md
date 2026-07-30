# AIA — Candidate Correlation, Deduplication, Variants & Conflicts (Stage 3J.2D)

Deterministyczna korelacja na immutable candidate batches Stage 3J.2C. Wynik to wyłącznie proposed relations, proposed records, clusters, review tasks i Q01–Q21 coverage.

## Patch użyteczności (real correlation)

- Dodano kontrakt `teta-candidate-correlation-cluster-v1` i budowę klastrów korelacji.
- `unknown_or_partial applicability` nie oznacza już automatycznie 1 record na 1 occurrence.
- Proposed records są grupowane po klastrach z rozdziałem po applicability partition.
- Review tasks są grupowane i mają jawny `reviewKind`, `reasonCodes`, `requiredHumanDecision`.
- Golden evaluator dodaje reason codes i obsługę reguł Q14/Q21.
- Dodano raport diagnostyczny current pilot i overlap pilot.

## Verification (aggregates)

- stage3j2d tests: **811/811**
- fixture packs A–V: **22/22**
- regressions: 3J.2C **382/382**, 3J.2B **235/235**, 3J.2A **180/180**, 3J.1 **271/271**, 3J **161/161**
- builds: API **0**, web **0**
- strict audit: `strictErrors=[]`

## Real pilot (82 occurrences)

- candidateOccurrences read/preserved: **82/82**
- evidenceEntries read/preserved: **82/82**
- evidence invariant: `occurrencesWithoutEvidenceEntries=0`, `evidenceEntriesWithMissingCandidateOccurrence=0`
- relationDecisions: **48** (po pair-eligibility gate)
- proposedRecords: **71** (multi-occurrence tylko przy jawnym merge status)
- mergeStatus accounting (multi-occurrence=11): `exact=0`, `semantic=0`, `enriched=0`, `variant=0`, `conflict=0`, `requires_review_before_merge=11`
- clusters: **61** (multi-occurrence: **9**)
- stage3j2dRealCorrelationStatus: **demonstrated_with_review**
- Q01–Q21: supported **1**, partial **1**, requires_review **0**, unsupported **19**
- Q21: **supported** (`registry_surface_anchor`)

## Overlap pilot (debug vs acceptance)

- sources extracted: **20**, blocked: **0**
- Debug (`--max-candidates 420`): `partial_input_debug_only`, strict intentionally fails (`candidateOccurrencesExcludedByDebugLimit>0`).
- Acceptance (bez limitu): **1074/1074 occurrences loaded+preserved**, `excludedByDebugLimit=0`.
- evidenceEntries (acceptance): **1074/1074 preserved** (metryka liczona jako suma wpisów evidence, nie jako liczba occurrences).
- Pair eligibility (acceptance): `pairsEnteringBlocking=161492`, `pairsPassingPairEligibility=19115`, `pairsSkippedByPairEligibility=142377`.
- Relation decisions (acceptance): **19115** (`exact=108`, `semantic=41`, `requires_review=18966`).
- Proposed records / clusters (acceptance): `474` records (`165` multi-occurrence), `360` clusters (`152` multi-occurrence).
- mergeStatus accounting (acceptance, multi-occurrence=165): `exact=78`, `semantic=7`, `enriched=0`, `variant=0`, `conflict=0`, `requires_review_before_merge=80`; with merge-supporting relation=`85`, without merge-supporting relation=`0`.
- Review compression (acceptance): `reviewTasksCreated=100`, `reviewTaskCompressionRatio=189.66`.
- Review task reconciliation (primary grouping, rozłączne): `cluster=98`, `question=2`, pozostałe `0`; suma = `100`, `reviewTaskCountReconciliationOk=true`.
- Q21: **supported** (`registry_surface_anchor`) w debug i acceptance.
- Q14: **unsupported** (`no_matching_evidence`) na acceptance run (brak matching KSeF evidence w tym korpusie).

## Golden coverage interpretation (acceptance corpus)

- Evaluator działał na pełnym input (`1074/1074`), bez debug limitu (`matchingEvidenceExcludedByCandidateLimit=0`).
- Statusy `unsupported/no_matching_evidence` dla Q01–Q05, Q14, Q15–Q18 wynikają z luki candidate/source coverage, nie z błędu klasyfikacji korelacji.
- Brak evidence nie jest uzupełniany heurystycznie ani modelem.
- Q07 pozostaje `partially_supported`, Q08 `requires_review`, Q21 `supported` (`registry_surface_anchor`).

## Stage 3J.2E readiness

`ready_with_review` tylko dla acceptance/full-input run (`acceptanceRunInputComplete=true`) — real correlation demonstrated, review tasks skompresowane, ale pozostają luki dowodowe. Stage 3J.2E nadal nierozpoczęty.
