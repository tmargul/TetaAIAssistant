# Stage 3K.2B2B1 — Employee Master Source and Composite Card Identity Offline Evidence Pilot

**Status:** `accepted_offline_employee_foundation_evidence_pilot`  
**previousHumanReviewVerdict:** `PATCH_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**acceptedInfrastructure:** `employee_card_foundation_offline_evidence_pilot`  
**realCandidateApprovalStatus:** `no_candidates_approved`  

**Stage 3K:** `started_foundation`  
**Stage 3K.2B2:** `started_bounded_gap_resolution`  
**Stage 3K.2B2A:** `accepted_offline_bounded_gap_resolution_and_reevaluation`  
**Stage 3K.2B2B:** `started_employee_source_gap_closure` (not completed)  
**Stage 3K.2B2B1:** `accepted_offline_employee_foundation_evidence_pilot`  
**Stage 3K.2B2B2:** `not_started`  
**nextStage:** `stage3k2b2b2_employee_foundation_offline_source_evidence_enrichment_design`  

**Oracle / SQL / Stage 3C / model / Qdrant:** none  

---

## Human review of infrastructure (not production approval)

| Pilot | Human decision | Why (safe summary) |
|-------|----------------|--------------------|
| P1 employee | `request_more_evidence` | Card/master grain accepted as target; source/view key-preservation remains partial; application data surface not confirmed |
| P2 employee_number | `request_more_evidence` | Scope supported independently; grain dependency blocked by P1; evaluator ran offline; activation/planning fail-closed |
| P6 employee_card_number | `not_ready_for_approval_decision` | Usage diagnostics-only; no non-heuristic technical path |
| P7 employee_card_identity | `not_ready_for_approval_decision` | H4 confirms business uniqueness only; same-record unproven; exact-one not supported |

These decisions are **not** applied to Stage 3D or reuse policy.  
No approval decision events created or applied.  
`realDecisionEventsApplied=0`, `realApprovedGenericBindingsCreated=0`.

---

## Accepted infrastructure

- semantic source vs application anchor vs application data surface split
- employee-card grain separate from person identity
- versioned employee foundation evidence policy
- bounded anchored collectors; no global name search
- view key-preservation fail-closed rule
- business uniqueness vs technical enforcement split
- same-record phase gate for composite identity
- P6 discovery status vs usage eligibility split
- actual Stage 3K.2B1 evaluation vs discovery distinction
- explicit blocked-evaluation reasons
- source-gap request generation
- staleness and dependency fingerprints
- no automatic runtime access inference
- no automatic approval / activation / planning

---

## Foundation evidence policy

- Path: `apps/api/config/teta-employee-card-foundation-evidence-policy-v1.json`
- Version: `teta-aia-employee-card-foundation-evidence-policy-v1`
- Hash: `af2ac8cff8e55dc6ff73c7cf21604baed55c6028aaadf117d9f277c4e1c98651`
- Not an approval policy; not a reuse policy

---

## Safe candidate summaries

### P1 employee

- sourceOutcome: `supported_partial`
- businessGrain: `one_row_per_employee_card_or_master_record`
- grainStatus: `partial`
- semanticMasterSourceRef: existing employee view reference (repo-safe)
- applicationAnchorRefs: existing form anchor
- applicationDataSurfaceRefs: `[]`
- applicationDataSurfaceStatus: `requires_additional_source`
- runtimeExecutionAccessObjectRef: `null`
- runtimeAccessEligibility: `requires_separate_access_binding`
- viewDefinitionEvidenceStatus: `view_definition_evidence_unavailable`
- genericActivationEligible: `false`
- planningEligible: `false`

### P2 employee_number

- scope: `supported_bounded_confirmed`
- grainDependencyStatus: `blocked_by_p1_grain`
- evaluatorExecuted: `true`
- evaluatorKind: `stage3k2b1_policy_evaluator`
- evidenceAssessment: `needs_more_evidence`
- exactOneGuaranteed: `false`
- multiResultFilterAllowed: `true`
- genericActivationEligible: `false`
- planningEligible: `false`

### P6 employee_card_number

- discoveryStatus: `requires_additional_source`
- usageEligibility: `diagnostics_only`
- technicalPathEvidence: `null`
- support basis: no non-heuristic semantic/technical path evidence in offline pilot
- negative distinctions retained as design constraints
- genericActivationEligible: `false`
- planningEligible: `false`

### P7 employee_card_identity

- businessUniquenessRuleStatus: `confirmed` (H4)
- technicalUniquenessEnforcementStatus: `not_found`
- sameRecordEvidenceStatus: `unproven`
- compositeIdentityStatus: `needs_more_evidence`
- exactOneSemantics: `not_supported`
- runtimeCardinalityGuardRequirement: `deferred_until_same_record_proven`
- genericActivationEligible: `false`
- planningEligible: `false`

---

## Open source-gap requests (kinds only)

| gapKind | Effect if resolved |
|---------|--------------------|
| `view_definition_evidence` | P1 key-preservation/grain may be re-evaluated |
| `training_application_anchor` | training_participant business-role attribution may be traced technically |
| `employee_card_number_semantic_path` | P6 technical mapping and P2/P6 same-record may be assessed |

These are **not** human Oracle-mapping questions.  
Live Oracle extraction is out of scope for this stage.

---

## Production posture (unchanged)

- `defaultReuse=deny`
- `reusableRoles=[]`
- `planningEligibleBindings=0`
- `realApprovedGenericBindings=0`
- Stage 3D production bindings unchanged
- reuse policy unchanged

---

## Next stage (not started)

**Stage 3K.2B2B2 — Employee Foundation Offline Source Evidence Enrichment Design**

`nextStage=stage3k2b2b2_employee_foundation_offline_source_evidence_enrichment_design`  
`Stage 3K.2B2B2=not_started`

Future design scope only:

- view definition / equivalent key-preservation evidence
- application data-surface evidence
- training application anchor acquisition
- employee-card-number semantic path acquisition
- controlled refresh of Stage 2E/3A artifacts
- re-run P1/P2/P6/P7 evidence pilots

Do not start Stage 3K.2B2B2, P3/P4/P5, approval application, or live Oracle extraction from this document.
