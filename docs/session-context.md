# Kontekst rozmów — Teta AI Assistant

> Ostatnia aktualizacja: **2026-08-17** (Stage 1 connectivity commit + AIA eval harness)

## Stan bazowy (commitowany)

- Stage 4 domain coherence: `accepted_and_committed` (`ace2ce8`)
- Stage 5: `accepted_and_committed` (`ace2ce8`)
- Stage 1 dataset connectivity: `accepted_and_committed`
- **SHA produkcji:** `a667d0de7692853cfac81152c85c0bb027152428`

## Stage 1 dataset connectivity (committed)

- `GATEWAY_BINDS_DATASET` tylko z pair-specific static evidence (Stage2B/Stage2D)
- Precision audit: `3086` edges, `boScopedOnlyEdges=0`, `cartesianRiskEdges=0`
- TWG: `HarmonogramPracowikaTG → GrupaCzasuPracyPracownika` **nie** materializowany (brak pair-specific proof) — poprawne fail-closed
- TWG status: `stage1_graph_connectivity_gap` (bez patchowania w tej sesji)

## Interactive AIA eval harness (LOCAL, uncommitted)

- Uruchomienie: `pnpm --filter @teta/api run aia:eval`
- Smoke: `pnpm --filter @teta/api run aia:eval-smoke`
- Pliki: `apps/api/src/aia-eval/*`, `apps/api/src/scripts/aia-eval-cli.ts`, `aia-eval-smoke.ts`
- Logi sesji: `.local/aia-eval/sessions/`
- Akceptowane executory P1: prefix nazwiska, aktualne stanowisko, prefix+stanowisko
- TWG kontrolne: `INSUFFICIENT_EVIDENCE` (bez fabrykacji odpowiedzi)

## Otwarte

- [ ] Commit harness po pierwszej sesji użytkownika (opcjonalnie)
- [ ] Stage 6 diagnostic scripts/docs — lokalne, bez commita
- [ ] B3A w stash
