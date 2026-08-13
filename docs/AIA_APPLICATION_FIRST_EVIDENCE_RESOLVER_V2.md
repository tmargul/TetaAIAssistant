# AIA Stage 4 — Application-First Evidence Resolver v2

**Status:** `STAGE_4_FINAL_STATUS=accepted_and_committed`

**Contract:** `teta-aia-application-first-evidence-resolver-v2`

## Purpose

Generic production pipeline:

```
business concept
→ application semantic anchors
→ Stage 1 ACE traversal
→ Oracle endpoints
→ Stage 2 evidence expansion
→ optional Stage 3 write-path
→ candidate-scoped Oracle source enrichment (VIEW lineage + ALL_TAB_COLUMNS surface)
→ binding hypotheses (coherent subgraph)
→ role candidates
→ Stage 0 decision
```

**Not:** scenario-specific physical resolvers for current_position / payroll / TWG.

## VIEW surface / projection lineage

Distinguishes:

- **A.** exposed VIEW column (ALL_TAB_COLUMNS / CREATE VIEW column list)
- **B.** SELECT projection expression
- **C.** underlying base object/column

Mechanisms:

- `OracleMetadataSourceProvider.loadViewColumnMetadata` — `ALL_TAB_COLUMNS` ordered by `COLUMN_ID`
- `extractViewProjectionLineage` — never uses base column name as exposed VIEW name
- `alignViewProjectionsWithSurface` — ordinal N metadata ↔ projection N; `exact_static` only when deterministic
- Shared-base transfer: `VIEW.EXPOSED_COLUMN` → base → join → dictionary
- `columnLineageHops[]` retains intermediate hops (no fake direct physical FK)

## Accepted current-position blind (core topology)

| Metric | Value |
|--------|-------|
| `goldenCoreTopologyPresent` | **true** |
| `goldenCoreTopologyRank` | 1 |
| `goldenCoreTopologyStatus` | `strong_inference_readonly` |
| `dictionaryReference` | exposed `SSTN_ID` (not base `KASTA_SL_STAN_ID`) |
| `connectedHypotheses` | 1 |
| `sharedBaseOnlyPromotedToExact` | 0 |

Matched core: assignment, subjectReference, dictionaryReference, dictionaryIdentity.

## Bounded static gaps (ACCEPTABLE, fail-closed)

These are **not** Stage 4 failures:

- dictionary display may remain unresolved
- temporal / validFrom / validTo / currentness may remain unresolved
- Stage 3 may return zero relevant evidence
- domains may legitimately resolve `insufficient`
- static source / runtime boundaries remain fail-closed

Do not lower thresholds or fabricate missing roles.

## Invariants

- `scenarioSpecificPhysicalResolutionBranches=0`
- `goldenPhysicalMappingUsedBeforeExtraction=0`
- `sharedBaseOnlyPromotedToExact=0`, `crossPathRoleMerges=0`
- blind/approved isolation leaks = 0
- no business rows / DML / DDL / PLSQL / model calls

## CLI

`pnpm --filter @teta/api run afer:stage4`

Local artifacts (untracked): `.local/application-first-evidence-resolver-v2/`

## Next

Stage 5 — Application-Language Clarification Engine (`insufficient` ≠ always ask the user).
