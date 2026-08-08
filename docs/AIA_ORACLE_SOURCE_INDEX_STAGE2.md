# AIA — Oracle Source Index (Stage 2)

**Status:** `implemented_awaiting_review`  
**Contract:** `teta-aia-oracle-source-index-stage2-v1`  
**Stage 1 prerequisite:** `b8a3002`  
**runtimeCopilotDependencies:** `0`  
**Review (2026-08-08):** correctness blockers patched; Teusink unwrap live-validated

## Unwrap

- Algorithm: Niels Teusink unwrap.py (public domain) — Oracle 10g/11g
- Adapter: `OraclePlsqlUnwrapProvider` (local only; no online API)
- AKT_DANE vector: length `247210`, sha256 `5c10b6ad76101677bd37e8fc135522d0f8e6c17944731fb242d51d357a56e3f0`
- Live: `unwrapSucceeded=14723/14771` (~99.7%)

## Correctness patches

- Real ALL_SOURCE wrapped payload (no marker stub)
- Endpoint integrity via materialized/base/runtime sets (not edge-created nodes)
- Inventory VIEW/TABLE/SYNONYM resolution; QualifiedName owner semantics
- String/q-literal masking before static extraction
- PROGRAM_UNIT + ALL_ARGUMENTS signatures; routine attribution when safe
- Trigger events from ALL_TRIGGERS.TRIGGERING_EVENT when present

## Live highlights (TETA_ADMIN)

- `programReadEdges=118576`, integrity dangling/broken/dup=0
- `reads/writes/callsRecoveredViaUnwrap`: 46639 / 18737 / 144147
- Payroll + unseen view acceptance: passed

## CLI

```bash
pnpm --filter @teta/api run osi:stage2 -- --provider=oracle_metadata
```

Do not commit until architect final OK. Do not start Stage 3.
