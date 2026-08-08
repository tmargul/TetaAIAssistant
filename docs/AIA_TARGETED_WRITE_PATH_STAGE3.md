# AIA — Targeted Write-Path Analyzer (Stage 3)

**Status:** `implemented_with_known_static_boundaries_awaiting_review`  
**implementationStatus:** `implemented_with_known_static_boundaries_awaiting_review`  
**Contract:** `teta-aia-targeted-write-path-stage3-v1`  
**Source stage:** `TWP-S3`  
**Stage 2 prerequisite:** implementation `07fffd9`, acceptance docs `e76b452`  
**runtimeCopilotDependencies:** `0`  
**businessSelectStatementsExecuted:** `0`  
**localModelCalls / remoteModelCalls / ragCalls / qdrantCalls / embeddingCalls:** `0`  
**NOT committed** — awaiting architect review. Do not start Stage 4.

## What this is

Target-driven static analysis: given one Oracle object `X`, reconstruct the
technical write path (who writes it, through which DAC/DAE/DEF/…, which DML,
which parameter/record→column mappings, which validations/lookups) using
Stage 1 ACE + Stage 2 Oracle Source Index facts and targeted source fetch.

It does **not** answer business meaning (Evidence Resolver v2 / Stage 4).

## Module

`apps/api/src/teta-targeted-write-path-stage3/`

| File | Purpose |
|---|---|
| `teta-stage3.types.ts` | Analysis contract, path statuses, confidence, metrics/audit |
| `teta-stage3-gap-matrix.ts` | B1 gap matrix (18 rows) |
| `teta-stage3-load.ts` | Streaming Stage2 WRITES_TO / CALLS + Stage1 DAC loaders |
| `teta-stage3-dml-map.ts` | INSERT/UPDATE/DELETE/record mapping (no name-similarity) |
| `teta-stage3-analyze.ts` | `analyzeWritePath` — discovery, scoped DML, callers, gateways |
| `teta-stage3-extract.ts` | Fixture helper for unit tests |
| `teta-stage3-hardcoding-scan.ts` | Hardcoding counters + post-extraction KP compare |
| `teta-stage3.spec.ts` | 26 unit tests |
| `index.ts` | Barrel |

CLI: `pnpm --filter @teta/api run twp:stage3`  
(`apps/api/src/scripts/targeted-write-path-stage3.ts`)

Local artifacts (gitignored): `.local/targeted-write-path-stage3/`

## Critical live-source fix

Stage 3 live fetch **must** call `OracleMetadataSourceProvider.listCapabilities()`
before `preloadSources()`. Without it, `capabilities.allSource` stays unset and
every body fetch short-circuits to empty/`inaccessible` (false “available”
empty strings → `dmlOperations=0`). Fixed in the CLI.

DML is scoped to the writer **program-unit body** (not the whole PACKAGE BODY)
so sibling procedures are not attributed to every unit.

## Live acceptance (post-fix)

| Target | pathStatus | writers / pkgs | dml | maps | notes |
|---|---|---|---|---|---|
| `T_SKLPL` (KP) | `ambiguous_writers` | 44 / 2 | 44 | 176 | KP chain compare **matched** gateway/DAC/DAE/DEF/table; WSTAW INSERT `R_TEN.*→cols`, ZMIEN UPDATE + selector, USUN DELETE selector |
| `HH_HR_EMPLOYEE_ADDRESSES` | `ambiguous_writers` | 3 / 2 | 3 | 1 | DEF `DELETE_ROW` exact `ID←P_ID`; AGD partial/noisy Stage2 shallow writers; truncated call depth |
| `CR_PDM_INHER_ADR` (optional) | `ambiguous_writers` | 11 / 6 | 9 | 7 | optional post-extraction reference |
| `AP_ANALIZY_XYZ` (unseen auto) | `strong_static_path` | 1 / 1 | 13 | 24 | selected after freeze: 1–40 writers + static DML, excl. KP/HH/CR families |

Hardcoding scan: all counters **0**.  
Oracle metadata only: connections opened=4, metadata SELECTs=79 (no business rows / DML / DDL / PL/SQL exec).

## Known static boundaries (non-blocking)

- Multiple real writers → `ambiguous_writers` (all retained; no first-writer pick)
- MERGE deep positional mapping deferred
- `UPDATE … SET row = record` limited expansion
- Validation detection uses structural name patterns (`strong_static`)
- Call-graph `maxDepth` truncation recorded explicitly
- Stage2 shallow WRITES_TO can list helper units without body DML for that unit

## Tests / build

- Stage 3 unit: **26/26**
- Regressions (Stage2 / Stage1 / Stage0 schema-role / 2A–2E / 2E.1 / 3A / P1): **passed**
- `pnpm --filter @teta/api run build`: **EXIT 0**

## Next

Architect review → commit Stage 3 when approved.  
**Do not** start Evidence Resolver v2 / Stage 4.  
B3A stash untouched.
