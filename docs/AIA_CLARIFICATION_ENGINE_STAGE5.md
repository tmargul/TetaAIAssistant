# AIA Stage 5 — Application-Language Clarification Engine

**Status:** `STAGE_5_FINAL_STATUS=accepted_and_committed`

**Contract:** `teta-aia-clarification-engine-stage5-v1`

## Purpose

When Stage 4 cannot safely choose between **business/application** meanings, decide whether a user clarification can reduce ambiguity.

Critical rules:

- `resolutionStatus=insufficient` **≠** ask the user
- Technical uncertainty is **not** delegated to the user
- Clarification choices come from **surviving application hypotheses**
- Weak surface evidence is **suppressed**
- Clarification answers change **semantic/application context only**
- **No** physical mappings are injected by clarification

## Two situations

| Kind | Action |
|------|--------|
| User-resolvable ambiguity (form/tab/current vs history/…) | Ask in application language |
| Technical evidence gap (missing relation/source/temporal proof) | `technicalGapOnly=true`, no question |

## Pipeline

```
Stage 4 result
→ classify ambiguity (user vs technical)
→ suppress already-resolved dimensions
→ derive hypothesis-backed application surfaces
→ plan ≤1 application-language question
→ apply answer → semantic/application context only
→ optional Stage 4 rerun
```

No LLM. `localModelCalls=0`, `remoteModelCalls=0`.

## Application-surface / which_form policy

1. Candidate must be real application-semantic evidence (not lexicon token, not moduleHint alone).
2. Must link to ≥1 surviving Stage 4 hypothesis.
3. ≥2 eligible choices must **partition** the surviving hypothesis set.
4. Selecting a choice must reduce the viable set (`M < N`).
5. User-facing labels come from proven visible form/view/tab titles.

Lexicon tokens and moduleHint remain **discovery / scope only**.

## forceSemanticDimension

Test/fixture-only via `planClarificationFromStage4Fixture` (`semantic_fixture_test_only`).
Production `planClarificationFromStage4` cannot set it.

## CLI

`pnpm --filter @teta/api run clarify:stage5`

Local artifacts: `.local/clarification-engine-stage5/` (untracked)

## Invariants

- `scenarioSpecificClarificationBranches=0`
- `lexiconTokenUsedAsUserFacingChoice=0`
- `moduleHintOnlyChoices=0`
- `technicalTokensLeakedToUserFacingClarification=0`
- `physicalMappingInjectedByClarification=0`
- `forceSemanticDimensionProductionReachable=0`
- `stage4RediscoveryCallsFromStage5=0`
