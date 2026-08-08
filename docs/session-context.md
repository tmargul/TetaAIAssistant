# Kontekst rozmów — Teta AI Assistant

> **Plik żywy** — uzupełniany po ważnych ustaleniach w czacie. Synchronizuje się przez git między komputerami.
> Ostatnia aktualizacja: **2026-08-08** (Stage 2 unwrap Teusink + correctness patch)

---

## Notatki sesji (2026-08-08) — Stage 2 FINAL CORRECTNESS + UNWRAP

- HEAD = origin/main = **`b8a3002`**; Stage 2 **niezacommitowany**; B3A stash untouched
- Unwrap: lokalna adaptacja **Niels Teusink** (public domain) za `OraclePlsqlUnwrapProvider`
- AKT_DANE vector: len **247210**, sha256 **5c10b6ad…e3f0**, head `PACKAGE BODY AKT_DANE IS` — **match**
- Live corpus: unwrapSucceeded **14723**/14771 (~99.7%); reads/writes/calls recovered via unwrap: 46639 / 18737 / 144147
- Integrity (real sets): dangling/broken/dup = **0**; materializedNodes=233467
- Fixes: real ALL_SOURCE wrap payload; endpoint integrity; VIEW/TABLE/synonym resolve; owner QualifiedName; literal masking; PROGRAM_UNIT + ALL_ARGUMENTS signatures; call resolve; derived lookup; trigger metadata events
- Verdict pending architect: code ready; **do not commit until architect OK**

## Notatki sesji (2026-08-07) — Stage 1 ACCEPTED

- Commit: **`b8a3002afadbbf6ed63df1dd4d29313b8ac6327c`**

## Otwarte

- [ ] Architect: final Stage 2 commit approval
- [ ] Optional: stream ALL_ARGUMENTS (currently buffered 873334)
- [ ] B3A stash — do not restore
- [ ] Do not start Stage 3
