# Stage 6 Acceptance — architect review pack (local)

> Stage 4 domain-coherence and Stage 5 are committed at `ace2ce8`. This document tracks local, uncommitted Stage 1 connectivity closure + same-input TWG re-acceptance.

## Stage 1 connectivity closure (generic, evidence-backed)

- Implemented in `teta-stage1-extract.ts`:
  - add `GATEWAY_BINDS_DATASET` only when static owner proof exists in Stage2D/Stage2B facts
  - sources: dataset declaring TG/MTG, `mainSource.evidence[].resolvedMember` gateway, BO->gateway + Stage2D dataset coexistence
  - no name similarity, no assembly-only linking, no TWG literals in production logic
- Baseline audit: `.local/stage1-dataset-connectivity/baseline-dataset-connectivity-v1.json`
- After patch audit: `.local/stage1-dataset-connectivity/connectivity-before-after-v1.json`

## Stage 6 TWG same-input re-acceptance (v5)

| Field | Value |
|-------|-------|
| Freeze SHA | `ace2ce8ed641756d31c4eb4fe8155182e0b6c9e4` |
| TWG request | `Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.` |
| Physical seed count | `0` |
| falseStrongBindings | `[]` |
| Stage 5 | `technicalGapOnly=true`, `clarificationRequired=false` |

### Reachability change

- Before patch: `dataset|GrupaCzasuPracyPracownika` orphaned from blind seeds.
- After patch: dataset reachable in full ACE and retained subgraph.
- Shortest path example:
  - `gateway|Teta.Sumo.Personel.bosCzasPracy.TG.HarmonogramPracownikaTG`
  - `-> GATEWAY_BINDS_DATASET (strong_static_inference)`
  - `dataset|GrupaCzasuPracyPracownika`
  - `-> APPLICATION_JOIN (unresolved)`
  - `oracle_object|TETA_ADMIN.NT_KP_SLO_UMOWY`

### Current TWG boundary after Stage 1 fix

- Reachability gap moved from Stage 1 to Stage 4 processing:
  - `TWG_REACHABILITY_DIAGNOSTIC_STATUS=stage4_unresolved_relation_discovery_gap`
- Secondary gap remains Stage 4-side and is **not patched** in this run.

## Unseen safety

- Question: `Jakie okresy wypowiedzeń są dostępne w słowniku personelu?`
- Assignment false strong: none (`[]`)

## Local artifacts

- Stage 1: `.local/stage1-dataset-connectivity/`
- Stage 6: `.local/stage6-acceptance/twg-stage1-connectivity-v5/`
