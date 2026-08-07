# Kontekst rozmów — Teta AI Assistant

> **Plik żywy** — uzupełniany po ważnych ustaleniach w czacie. Synchronizuje się przez git między komputerami.
> Ostatnia aktualizacja: **2026-08-07** (Stage 1 ACE — accepting & committing; Stage 2 starting)

---

## Notatki sesji (2026-08-07) — Stage 1 FINALIZE

- `stage1ApplicationCodeGraph=accepted`
- `implementationStatus=accepted_with_known_runtime_boundaries`
- Integrity: `persistedDuplicateEdges=0`, `brokenEndpointsAgainstUnionGraph=0`, `danglingEdgesPersisted=0`, `invalidEdgeBugs=0`
- Payroll + unseen Sales: passed
- Runtime boundaries: 264 (known, not a defect)
- Module: `apps/api/src/teta-application-code-graph-stage1/`
- Docs: `docs/AIA_APPLICATION_CODE_GRAPH_STAGE1.md` + `.json`
- `nextRoadmapStage=stage2_oracle_source_index`
- Local only: `.local/application-code-graph-stage1/` — nie commitować
- B3A stash untouched

## Notatki sesji (2026-08-07) — Stage 0 ACCEPTED (`9764a5f`)

- `stage0GenericSchemaRoleResolver=accepted_foundation`

## Otwarte

- [ ] Stage 2 Oracle Source Index — starting after Stage 1 commit
- [ ] Evidence Resolver v2 / ACE wire into Stage 0 — later
- [ ] B3A stash — do not restore
