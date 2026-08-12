# AIA — Targeted Write-Path Analyzer (Stage 3)

**Status:** `accepted`  
**implementationStatus:** `accepted_with_bounded_static_boundaries`  
**liveSignatureResolution:** `accepted`  
**applicationReachableUnseenAcceptance:** `passed`  
**crossRoutineAssignmentLeakageCount:** `0`  
**Contract:** `teta-aia-targeted-write-path-stage3-v1`  
**Source stage:** `TWP-S3`  
**Stage 2 prerequisite:** implementation `07fffd9`, acceptance docs `e76b452`  
**runtimeCopilotDependencies:** `0`  
**nextRoadmapStage:** `stage4_application_first_evidence_resolver_v2`

## What this is

Target-driven static analysis: given one Oracle object `X`, reconstruct the
technical write path (who writes it, through which DAC/DAE/DEF/…, which DML,
which parameter/record→column mappings, which validations/lookups) using
Stage 1 ACE + Stage 2 Oracle Source Index facts and bounded live source/signature
fetch.

It does **not** answer business meaning (Stage 4 Application-First Evidence
Resolver v2).

## Module

`apps/api/src/teta-targeted-write-path-stage3/`

| File | Purpose |
|---|---|
| `teta-stage3.types.ts` | Analysis contract, path statuses, confidence, metrics/audit |
| `teta-stage3-gap-matrix.ts` | B1 gap matrix (18 rows) |
| `teta-stage3-load.ts` | Streaming Stage2 WRITES_TO / CALLS + Stage1 DAC loaders |
| `teta-stage3-dml-map.ts` | INSERT/UPDATE/DELETE/record mapping (no name-similarity) |
| `teta-stage3-signatures.ts` | Bounded ALL_ARGUMENTS signature index + parameter proof |
| `teta-stage3-analyze.ts` | `analyzeWritePath` — discovery, scoped DML, callers, gateways |
| `teta-stage3-extract.ts` | Fixture helper for unit tests |
| `teta-stage3-hardcoding-scan.ts` | Hardcoding counters + post-extraction KP compare |
| `teta-stage3.spec.ts` | Unit tests |
| `index.ts` | Barrel |

CLI: `pnpm --filter @teta/api run twp:stage3`  
(`apps/api/src/scripts/targeted-write-path-stage3.ts`)

Local artifacts (gitignored): `.local/targeted-write-path-stage3/`

## Accepted live properties

- Routine-level CALL traversal with ordered `callHops` (`routine_exact` vs `package_fallback`)
- Scoped DML and record dataflow per writer program unit
- Bounded live `ALL_ARGUMENTS` signatures (`oracle_all_arguments`, not full corpus scan)
- `direct_param` only with signature evidence; header fallback degrades to `strong_static`
- TABLE/VIEW/SYNONYM lookup resolution via Stage 2 inventory
- Owner-aware target matching
- Application-reachable unseen: `TETA_ADMIN.AP_CENY_EWIDENCYJNE` (320 candidates, Stage1+Stage2 evidence)
- Fail-closed runtime/static boundaries

### KP live facts (accepted)

| Metric | Value |
|---|---|
| `argumentSignaturesLoaded` | 44 |
| `signatureSource` | `oracle_all_arguments` |
| `crossRoutineAssignmentLeakageCount` | 0 |
| USUN | `P_ID` = `direct_param`, `DELETE FROM T_SKLPL WHERE ID=P_ID` |
| Validations | package-wide false attribution removed (89→0 scoped call sites) |

## Ordered path documentation (fail-closed)

Stage 3 distinguishes three hop classes in output:

| Class | Meaning |
|---|---|
| **exact routine hops** | `callHops.matchKind=routine_exact`, caller/callee are `PROGRAM_UNIT` identities |
| **package-level fallback hops** | `callHops.matchKind=package_fallback`, degraded confidence (`strong_static` or `unresolved`, never `exact_static` path) |
| **missing static hops** | Post-extraction acceptance reports explicit gap, e.g. `kpBrokenHop=missing_dac_hop` |

**Accepted non-blocking boundary:** `kpOrderedPathMatched=false`, `kpBrokenHop=missing_dac_hop` — part of the KP caller path remains at package-body level rather than fully routine-resolved. Stage 3 correctly fails closed; this is **not** claimed as a full exact DAC→DAE→DEF routine chain.

Do not promote `package_fallback` to `routine_exact`.

## Known static boundaries (non-blocking)

- KP `missing_dac_hop` in complete ordered routine chain
- Package-level CALL fallback where routine endpoint unavailable
- Dynamic SQL / runtime-only boundaries
- Failed/unsupported unwrap boundaries inherited from Stage 2
- MERGE deep mapping deferred
- Bounded call traversal (`maxDepth`)
- Source fetch bounds when explicitly reported (`source_package_fetch_cap`)
- Multiple real writers → `ambiguous_writers` (all retained)

## Tests / build

- Stage 3 unit: **32/32**
- Regressions (Stage2 / Stage1 / Stage0 / 2A–2E / 2E.1 / 3A / P1): **passed**
- `pnpm --filter @teta/api run build`: **EXIT 0**

## Next

Stage 4 — Application-First Evidence Resolver v2.  
B3A stash untouched. Do not start Stage 5 Clarification Engine.
