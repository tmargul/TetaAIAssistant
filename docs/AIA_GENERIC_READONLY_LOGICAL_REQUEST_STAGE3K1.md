# Stage 3K.1 — Generic Read-Only Query Intent & Logical Request Model

**Status:** `accepted_offline_foundation`  
**Stage 3K:** `started_foundation`  
**Stage 3K.2:** `not_started`  
**nextStage:** `stage3k2_semantic_binding_design`  
**Human review:** `PASS_WITH_FINALIZATION` (`humanReviewStatus=accepted`)  
**Oracle / SQL / model / Qdrant / embeddings:** none

## Goal

Answer: **what does the user want to retrieve?** — not which SQL to run.

```
Polish user question
  → Stage3K1 routing proposal (capability adapters)
  → GenericQueryAnalysisResult (delegated | rejected | generic)
  → LogicalReadonlyRequest only for generic (teta-logical-readonly-request-v1)
  → interpretationStatus × capabilityStatus
  → executionEligibility (Stage 3K.1: never eligible)
```

Ends **before** Stage 3C plan / compiler / executor.

## Hard boundaries

Forbidden on the logical contract: `sql`, `sqlText`, `select`, `from`, `whereSql`, `joinSql`, `procedureName`, `oracleObjectName`, `rawOracleColumn`.

Production orchestrator is **not** rewired. Legacy LLM→SQL path is **fenced, not removed**.

Dedicated routes win only on **capability match** (e.g. occupational health expiry + period), not topic keywords.

No new canonical business concepts in 3K.1 — surfaces use `surfaceMeaningKey` with `conceptKey: null`.

## Interpretation vs capability (canonical)

Two independent axes — recognition ≠ downstream support.

**interpretationStatus** (do we understand the request?):
- `resolved`
- `needs_clarification`
- `unresolved`
- `rejected` / `delegated` on the analysis layer

**capabilityStatus** (does Stage 3K.1 mark downstream support?):
- `supported`
- `partially_supported`
- `unsupported`
- `not_applicable`

Example — K2: `interpretationStatus=resolved` and `capabilityStatus=unsupported` (`filter_equals` not opened downstream).

Legacy/derived `status` on `LogicalReadonlyRequest` is a **convenience field only**, not a canonical readiness or execution signal. Prefer `interpretationStatus` × `capabilityStatus`.

## Execution fence

`capabilityStatus=supported` does **not** mean execution readiness.

Stage 3K.1 ends before Stage 3C; business authorization remains NOT_READY; production orchestrator is not rewired.

`executionEligibility` on `GenericQueryAnalysisResult`:
- generic → `not_evaluated`
- delegated → `not_applicable`
- rejected → `blocked`
- **never** `eligible` in Stage 3K.1 (`stage3k1ExecutionEligibleRequests = 0`)

## Key contracts

| Artifact | Version |
|----------|---------|
| Logical request | `teta-logical-readonly-request-v1` |
| Analysis result | `teta-generic-query-analysis-v1` |
| Language PL | `teta-aia-generic-query-language-pl-v1` |
| Routing policy | `teta-aia-generic-query-routing-v1` |
| Capabilities | `teta-aia-generic-query-capabilities-v1` |
| Legacy LLM SQL fence | `teta-aia-legacy-llm-sql-fence-v1` |

Intent: `generic_readonly_query` (offline only).

## Routing precedence (proposal)

1. dedicated deterministic engine  
2. payroll engine  
3. application Help  
4. Stage 3J.2F runtime knowledge  
5. `generic_readonly_query`  
6. clarification / unsupported  

## Module / CLI

- Module: `apps/api/src/teta-generic-query/`
- CLI: `pnpm --filter @teta/api run generic-query:stage3k1 -- …`
  - `validate-config`
  - `classify --query "..."`
  - `build-request` / `analyze --query "..."`
  - `run-fixtures`
  - `audit --strict`

## Fixtures

K1–K12 + N1–N5 + routing R1–R7 (capability-based dedicated, payroll/help/knowledge adapters, temporal, aggregation, ambiguity, mutation/raw SQL/injection rejection).

## Interpretive notes

- Does not open Stage 3C/3E/3F gates.
- Business authorization remains NOT_READY for live generic querying.
- Live generic still blocked by: business auth, generic semantic bindings, generic Stage 3C planning, unsupported filter/aggregate capabilities, legacy LLM→SQL migration.
- Next design step: Stage 3K.2 semantic binding design — **not started** in this slice.
