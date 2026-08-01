# Stage 3K.2B1 — Generic Semantic Binding Candidate Discovery + Human Review Pack

**Status:** `accepted_offline_candidate_discovery_and_review_pack`  
**previousHumanReviewVerdict:** `PATCH_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**acceptedInfrastructure:** `candidate_discovery_and_review_pack`  
**realCandidateApprovalStatus:** `no_candidates_approved`  
**Stage 3K.2B:** `started_candidate_discovery` (not completed)  
**Stage 3K.2B2:** `not_started`  
**nextStage:** `stage3k2b2_semantic_evidence_gap_resolution_design`  
**Design baseline:** `d930538`  
**Oracle / SQL / model / Qdrant:** none  

---

## Human review of infrastructure (not production approval)

| Pilot | Human decision (infra review only) |
|-------|-------------------------------------|
| P1 employee | `request_more_evidence` |
| P2 employee_identity.employee_number | `request_more_evidence` |
| P3 current_position | `request_more_evidence` |
| P4 position_name | `request_more_evidence` |

These decisions are **not** applied to Stage 3D or reuse policy.  
No `approve_generic_reuse` / `approve_with_scope` for P1–P4.  
`realDecisionEventsApplied=0`, `realApprovedGenericBindingsCreated=0`.

---

## Goal (accepted)

```
SemanticCoverageTarget
  → deterministic candidate discovery (approved anchors only)
  → TetaGenericSemanticBindingCandidate
  → candidate validation + versioned evaluation policy
  → HumanReviewPack v2 (evidenceItems, evaluationTrace, scope/grain/deps)
  → PENDING HUMAN DECISION (infra)
```

No production apply. No Stage 3D / reuse-policy mutation. No planning eligibility upgrades.

---

## Invariants enforced

| Invariant | Value |
|-----------|-------|
| Evaluation policy | versioned JSON config |
| Fingerprint split | `candidateFingerprint` ≠ `candidateEvaluationFingerprint` |
| Evidence items | `evidenceItems` + `lineageKey` in review packs |
| `approved_stage3d_role` | priorApprovalReference only (not independent) |
| Scope expansion | explicit assessment; unproven visible as gap |
| Result grain | explicit assessment |
| Dependencies | fail-closed for reuse activation |
| `reviewPackStatus` ≠ `approvalReadiness` | pack may be `generated` while approval `blocked_*` |
| Real pilot decisions applied | **0** |
| Production reuse policy | `defaultReuse=deny`, `reusableRoles=[]` |
| planningEligibleBindings | **0** |

Policy thresholds were **not** lowered to force P1–P4 through.

---

## Real evidence gaps (safe aggregates)

### P1 employee
- scope expansion unproven;
- employee grain partial;
- generic Teta HR applicability not proven.

### P2 employee_identity.employee_number
- P1 dependency pending;
- bounded Teta HR scope unproven;
- identity semantic evidence incomplete.

### P3 current_position
- scope expansion unproven;
- cardinality unresolved;
- multiple current records unresolved;
- tie ambiguity policy unresolved.

### P4 position_name
- generic position concept/source dependency pending;
- scope expansion unproven;
- display lookup technically supported, but generic activation blocked.

---

## Module

`apps/api/src/teta-generic-semantic-candidate/`

Evaluation policy: `apps/api/config/teta-generic-semantic-candidate-evaluation-policy-v1.json`

CLI: `npm run generic-semantic:stage3k2b1 -- audit|discover|validate-targets|validate-policy`

Local artifacts (untracked):

- `.local/stage3k2b1/review-packs/` (v1)
- `.local/stage3k2b1/review-packs-v2/`
- `.local/stage3k2b1/evidence/`
- `.local/stage3k2b1/stage3k2b1-audit-v2.json`

---

## What this slice does NOT do

- mutate Stage 3D production registry
- mutate reuse policy
- approve real candidates / apply real decisions to production
- generate or execute SQL / Oracle
- build Stage 3C plans
- LLM / Qdrant / embeddings
- start Stage 3K.2B2 / approval application

---

## Next

`stage3k2b2_semantic_evidence_gap_resolution_design` (design only; **not started**).  
**Not** approval application — all real candidates remain `needs_more_evidence` / `blocked_more_evidence`.
