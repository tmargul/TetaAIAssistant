# AIA — Oracle Source Index (Stage 2)

**Status:** `accepted`  
**implementationStatus:** `accepted_with_bounded_static_boundaries`  
**Contract:** `teta-aia-oracle-source-index-stage2-v1`  
**Source stage:** `OSI-S2`  
**Stage 1 prerequisite:** `b8a3002`  
**Stage 2 commit:** `07fffd9ebe54f5c5798e984ff6a60f53ff786eb1`  
**unwrapProvider:** `local_oracle_plsql_unwrap`  
**runtimeCopilotDependencies:** `0`  
**remoteUnwrapCalls:** `0`  
**nextRoadmapStage:** `stage3_targeted_write_path_analyzer`

## Acceptance

| Metric | Value |
|---|---|
| persistedDuplicateEdges | 0 |
| danglingEdgesPersisted | 0 |
| brokenEndpointsAgainstUnionGraph | 0 |
| payrollAcceptance | passed |
| unseenAcceptance | passed |
| unwrapAttempted | 14771 |
| unwrapSucceeded | 14723 |
| unwrapFailed | 21 |
| unwrapUnsupported | 27 |
| unwrapSuccessRate | ≈99.7% |
| readsRecoveredViaUnwrap | 46639 |
| writesRecoveredViaUnwrap | 18737 |
| callsRecoveredViaUnwrap | 144147 |

### AKT_DANE vector

- unwrappedByteLength: `247210`
- unwrappedSha256: `5c10b6ad76101677bd37e8fc135522d0f8e6c17944731fb242d51d357a56e3f0`
- head: `PACKAGE BODY AKT_DANE IS`

## Unwrap

- Algorithm: Niels Teusink unwrap.py (public domain) — Oracle 10g/11g
- Adapter: `OraclePlsqlUnwrapProvider` (local only; no online API)

## Known non-blocking limitations

- 21 `unwrap_failed`, 27 `unwrap_unsupported` (classified; not correctness blockers)
- ALL_ARGUMENTS currently buffered in memory (~873k rows)
- Source-object buffering not yet production-optimized

## CLI

```bash
pnpm --filter @teta/api run osi:stage2 -- --provider=oracle_metadata
```

Module: `apps/api/src/teta-oracle-source-index-stage2/`
