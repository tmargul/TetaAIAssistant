# Stage 3K.2B2A — Bounded Semantic Evidence Gap Resolution + Re-evaluation

**Status:** `accepted_offline_bounded_gap_resolution_and_reevaluation`  
**previousHumanReviewVerdict:** `PATCH_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**acceptedInfrastructure:** `bounded_semantic_evidence_gap_resolution_and_reevaluation`  
**realCandidateApprovalStatus:** `no_candidates_approved`  

**Stage 3K:** `started_foundation`  
**Stage 3K.2:** `started_approved_binding_adapter`  
**Stage 3K.2B:** `started_candidate_discovery`  
**Stage 3K.2B2:** `started_bounded_gap_resolution` (not completed)  
**Stage 3K.2B2A:** `accepted_offline_bounded_gap_resolution_and_reevaluation`  
**Stage 3K.2B2B:** `not_started`  
**nextStage:** `stage3k2b2b_employee_card_foundation_gap_closure_design`  

**Oracle / SQL / model / Qdrant:** none  

---

## Human review of infrastructure (not production approval)

| Pilot | Human decision (infra review only) | Why (safe summary) |
|-------|-------------------------------------|--------------------|
| P1 employee | `request_more_evidence` | Bounded scope business-confirmed; view grain key preservation remains partial; training_participant business dependency confirmed, technical attributable typed path unresolved |
| P2 employee_identity.employee_number | `request_more_evidence` | Semantic identity + string/leading zeros confirmed; composite employee-card identity known; P1 dependency not sufficient for generic activation; scope inheritance blocked while P1 grain open; P6/P7 design-only |

These decisions are **not** applied to Stage 3D or reuse policy.  
No `approve_generic_reuse` / `approve_with_scope`.  
`realDecisionEventsApplied=0`, `realApprovedGenericBindingsCreated=0`.

---

## Goal (accepted)

```
existing candidate
  → explicit evidence gaps
  → bounded offline collectors (anchored)
  → human domain evidence (H1–H5) when required
  → gap-resolution evidence bundle
  → actual Stage 3K.2B1 re-evaluation
  → review pack v5
  → PENDING HUMAN DECISION (infra)
```

Gap resolved ≠ candidate approved.  
Generic activation and planning eligibility remain fail-closed.

---

## Accepted infrastructure

- bounded anchored collectors (no global free search)
- versioned gap-resolution policy (`gapResolutionRules` in JSON)
- application context anchor contract
- fixture vs real evidence separation
- H1–H5 as `human_confirmed_business_rule` (not approval)
- actual Stage 3K.2B1 offline evaluator (`evaluateAgainstPolicy`)
- candidate fingerprint vs evaluation fingerprint
- view grain key-preservation requirement
- typed dependency requirement for confirmed dependent roles
- dependency-based scope inheritance
- clarification / empty-result semantics
- generic activation fail-closed
- planning eligibility fail-closed

Policy thresholds were **not** lowered.

---

## Safe candidate summaries

### P1 employee

- scope: `supported_bounded_confirmed` (personnel / payroll / occupational_health)
- grain: `partial` — view key preservation not proven
- training_participant: business dependency confirmed (dependent employee role); technical attributable typed graph path unresolved
- human decision: `request_more_evidence`
- `genericActivationEligible=false`, `planningEligible=false`

### P2 employee_identity.employee_number

- semantic label confirmed (employee number / numer ewidencyjny)
- datatype: string; leading zeros significant
- standalone `exactOneGuaranteed=false`; `multiResultFilterAllowed=true`
- composite identity requires: employee_number + employee_card_number
- uniqueness scope: whole_database; `firmScoped=false`
- reemployment may retain or change employee number (no same-person inference from number alone)
- scope inheritance remains blocked while P1 grain blocking
- P6/P7 remain design-only
- human decision: `request_more_evidence`
- `genericActivationEligible=false`, `planningEligible=false`

---

## Production baseline (unchanged)

| Invariant | Value |
|-----------|-------|
| defaultReuse | `deny` |
| reusableRoles | `[]` |
| planningEligibleBindings | **0** |
| Stage 3D production bindings | unchanged |
| Real approvals applied | **0** |

---

## Module

`apps/api/src/teta-semantic-evidence-gap/`

Gap policy: `apps/api/config/teta-semantic-evidence-gap-resolution-policy-v1.json`  
Policy version: `teta-aia-semantic-evidence-gap-resolution-policy-v1`

CLI: `npm run generic-semantic:stage3k2b2a -- audit|audit --strict|validate-policy|resolve-gaps`

Local artifacts (untracked; do not commit):

- `.local/stage3k2b2a/review-packs-v5/`
- `.local/stage3k2b2a/stage3k2b2a-audit-v5.json`
- `.local/stage3k2b2a/human-evidence/`
- `.local/stage3k2b2a/real-graph-traces/`

---

## What this slice does NOT do

- mutate Stage 3D production registry
- mutate reuse policy
- approve real candidates / apply real decisions to production
- generate or execute SQL / Oracle
- build Stage 3C plans
- LLM / Qdrant / embeddings
- start Stage 3K.2B2B / P3 / P4 / P5
- implement approval application

---

## Next stage (not started)

`stage3k2b2b_employee_card_foundation_gap_closure_design`

Intended future goals (design only until started):

- resolve P1 employee source/grain
- resolve training_participant typed dependency
- discover P6 employee_card_number
- discover P7 employee_card_identity
- re-evaluate P1/P2/P6/P7
