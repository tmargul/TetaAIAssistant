# AIA — Application Code Graph Extractor (Stage 1)

**Status:** `accepted` (`accepted_with_known_runtime_boundaries`)  
**Contract:** `teta-aia-application-code-graph-stage1-v1`  
**Source stage tag:** `ACE-S1` (not Stage2E `sourceStage: '1'` = PA_WTYCZKI)  
**Baseline:** Stage 0 commit `9764a5f5c49277952f89b97c74d4013bea32e318`  
**Identity:** reuses `teta-aia-canonical-id-v1` — **no second graph**  
**nextRoadmapStage:** `stage2_oracle_source_index`

## Purpose

Stage 0 proved `blind_physical_rediscovery` cannot reconstruct application→assignment→joins→dictionary→temporal paths because the evidence graph lacks traversable application-code-grounded physical path facts.

Stage 1 extracts **deterministic facts** from existing Stage 2A/2B/2D artifacts:

`FORM → CONTROL → DATASET → BO/DF → TG/MTG → ORACLE (+ joins/lookups/relations)`

It is **not** a semantic inference engine.

## Integrity metrics (v2 — unambiguous)

| Metric | Meaning |
|--------|---------|
| `rawEdgesProduced` | Every `addEdge` attempt before dedup |
| `uniqueEdgesPersisted` | Distinct canonical edge IDs after merge |
| `duplicateEdgesObservedBeforeDedup` | Re-inserts of same canonical ID |
| `duplicateEdgesRemoved` | Re-inserts not persisted as parallel edges (provenance merged) |
| `persistedDuplicateEdges` | Must be **0** |
| `brokenEndpointsAgainstUnionGraph` | Dangling endpoints vs ACE ∪ Stage2E — must be **0** |
| `danglingEdgesPersisted` | Must be **0** |

**Deprecated v1 names (do not use):**

- `duplicateCanonicalEdges` — meant *discarded re-insert attempts* (provenance dropped); **not** duplicates left in the graph
- `brokenEndpointEdges` — meant *path skips* (gateway+dataset without viewName); **not** dangling graph edges

Canonical edge ID = `edgeKind|from.kind|from.name|to.kind|to.name` (no rawValue). Multiple evidence → one edge + merged provenance.

## Reuse (no duplication)

| Stage | Reused for |
|-------|------------|
| 2A | forms, controls, DataSourceTableName, Bindings, BusinessObjectReference, DF refs |
| 2B | BO→gateway, TG TableName/alias, AddJoin evidence, SumoCommandBuilder package, AddRelation, late-binding |
| 2D | effectiveJoins / JoinDefinition / AddJoin / AddColumn-supplied joins, inheritanceKind |
| 2E / 3A | union endpoint resolution (`MAPS_TO_ORACLE_OBJECT`); edge name mapping |

## Acceptance paths (unchanged after integrity patch)

Payroll: `ListyObliczoneWidok → SkladnikiObliczZamknPrac → ListyBaseBO → SkladnikiObliczZamknPracTG → NT_KP_PLC_SKLADNIKI_OBL` (+ lookup `NT_KP_SLO_SKLADNIKI_PLAC`)

Unseen Sales: `DicRodzajeKoncesji → RodzajeKoncesji → RodzajeKoncesjiTG → NT_LG_SLO_RODZAJE_KONCESJI`

## Commands

```bash
pnpm --filter @teta/api run ace:stage1
pnpm --filter @teta/api exec jest src/teta-application-code-graph-stage1/teta-stage1.spec.ts --runInBand
```

## Artifacts

Repo-safe: this file + `AIA_APPLICATION_CODE_GRAPH_STAGE1.json`  
Local v2 (do not commit NDJSON): `.local/application-code-graph-stage1/*-v2.*`  
v1 local audits kept; not overwritten by integrity run.

## Out of scope

Oracle Source Index, Write-Path Analyzer, Evidence Resolver v2, B3A restore, TWG special-casing.
