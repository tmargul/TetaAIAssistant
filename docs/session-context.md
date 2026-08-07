# Kontekst rozmów — Teta AI Assistant

> **Plik żywy** — uzupełniany po ważnych ustaleniach w czacie. Synchronizuje się przez git między komputerami.
> Ostatnia aktualizacja: **2026-08-07** (Stage 0 generic schema role resolver — ACCEPTED)

---

## Notatki sesji (2026-08-07) — Stage 0 ACCEPTED (`PASS_WITH_FINALIZATION_AND_COMMIT`)

- `stage0GenericSchemaRoleResolver=accepted_foundation`
- `approvedBindingReuse=supported` — current-position → `proven_exact` via Stage 3D approved evidence (expected production path)
- `blindPhysicalRediscovery=not_yet_supported_requires_application_code_graph` — not a Stage 0 defect
- `previousIndependentRediscoveryClaim=superseded_invalid` — see SUPERSEDED note below
- Modes: `approved_binding_reuse` | `blind_physical_rediscovery` (leak guards)
- Module: `apps/api/src/teta-schema-role-resolution/`
- TWG: `twgBlindResolutionStatus=blocked_or_conflicting`; `twgBusinessSelectExecuted=false`; `twgPhysicalSeedsAdded=0`
- `scenarioSpecificPhysicalMappings=0`; no Stage 3D/reuse/planning mutations
- `nextRoadmapStage=stage1_application_code_graph_extractor` — **not started**
- B3A stash remains: `WIP Stage 3K.2B2B2B3A paused for P1 vertical MVP`
- Local audit only: `.local/schema-role-resolver-foundation-review/` — nie commitować

### SUPERSEDED_BY_STAGE_0_FOUNDATION_REVIEW

- Older WIP claim that current-position was **independently rediscovered** → `proven_exact` is **false**.
- `previousIndependentRediscoveryClaim=invalid`
- Reason: Stage 3D adapter supplied the complete approved physical mapping into the old resolver path.
- Current truth:
  - `approved_binding_reuse`: proven_exact using approved Stage 3D evidence (valid production)
  - `blind_physical_rediscovery`: insufficient / not_yet_supported (expected until Stage 1)
- Blind result is **not** a regression; Stage 1 must supply application/code-grounded assignment path, joins, temporal evidence.

## Notatki sesji (2026-08-06) — P1 pilots (ACCEPTED, on main)

| Scenario | Commit | Notes |
|----------|--------|-------|
| surname prefix report | `391414a` | `NT_KP_PRC_PRACOWNICY`, 8 rows |
| current position by number | `4bff459` | `00122` empty / `00069` single |
| surname + current position | `2be311e` | LEFT JOIN, 8 employees |

- Gate: `TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT`
- Module: `apps/api/src/teta-p1-employee-vertical-pilot/`

## Stage 3K (skrót)

- 3K.2B2B2B2 accepted (`75c623a`); 3K.2B2B2B3 design ready, runtime not started
- B3A paused in stash for P1 vertical MVP

## Środowisko

| Element | Wartość |
|---------|---------|
| Dev | `pnpm dev` — API `:3000`, web `:5173` |
| VM Oracle | `WIN-PDDJCBNU8LI` (Hyper-V Default Switch) |
| Host Oracle (SQLite) | **`172.29.48.145`**:1521 SID **`TETAHR`** |
| IP docelowe VM | `172.27.16.145` — potwierdzić `Test-NetConnection` przed sync |
| Tryb | `TETA_ORACLE_MODE=real` (dane połączenia w UI/SQLite, nie `.env`) |
| Fake konta | `teta_admin`/`admin`, `teta_user`/`user` — tylko fake |

## Otwarte

- [ ] Stage 1 Application Code Graph Extractor — **not started** (needed for blind rediscovery)
- [ ] TWG revisit after Stage 1+
- [ ] B3A remains in stash — do not restore
- [ ] VM Oracle IP sync `172.27.16.145` vs current `172.29.48.145`
- [ ] RAG smoke / Qdrant; produkcyjne `TETA_ADMIN_CHECK_SQL`

## Starsze (bullet)

- Stage 3J–3J.2F completed; Stage 3H BHP report live path exists
- View metadata P1 export/import accepted; `.local` artifacts not for git
