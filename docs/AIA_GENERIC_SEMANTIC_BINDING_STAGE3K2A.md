# Stage 3K.2A — Generic Semantic Binding Contract + Approved Stage 3D Adapter

**Status:** `accepted_offline_approved_binding_adapter`  
**Stage 3K.2:** `started_approved_binding_adapter` (not completed)  
**Stage 3K.2B:** `not_started`  
**Stage 3K:** `started_foundation`  
**Design review commit:** `71bcb73`  
**previousHumanReviewVerdict:** `PATCH_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**nextStage:** `stage3k2b_semantic_coverage_design` (design only — not implemented)  
**Oracle / SQL / model / Qdrant:** none

## Goal

```
Stage 3K.1 LogicalReadonlyRequest / analysis
        ↓
3K.2A approved-only Stage 3D adapter (+ reuse policy)
        ↓
TetaGenericSemanticBindingResult (internal)
        ↓
toRuntimeSafeSemanticDto(...)
```

Ends before Stage 3C / SQL / execution.

## Planning readiness vs semantic status

- `resultStatus` = how much we know semantically  
- `planningReadiness` = whether the result may be handed to a future deterministic planner  
- `executionEligibility` remains `not_evaluated` in 3K.2A (never `eligible`)

Under production deny policy (`reusableRoles=[]`), generic K fixtures are `planningReadiness=blocked` even when `resultStatus=partially_bound`.  
`partial` planning readiness is reserved for optional-only gaps.

## Next boundary

Do **not** start Stage 3C generic planner / SQL / Oracle / chat.  
Next design (`stage3k2b_semantic_coverage_design`) must define safe generic reusable approved bindings without promoting BHP assumptions.
