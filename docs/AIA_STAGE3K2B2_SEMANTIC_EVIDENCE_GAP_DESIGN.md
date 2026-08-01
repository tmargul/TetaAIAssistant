# Stage 3K.2B2 — Semantic Evidence Gap Resolution Design / Readiness Review

**Status:** design accepted with small corrections (`PASS_WITH_SMALL_DESIGN_CORRECTIONS_BEFORE_COMMIT`)  
**previousHumanReviewVerdict:** (initial design awaiting review)  
**humanReviewVerdict:** `PASS_WITH_SMALL_DESIGN_CORRECTIONS_BEFORE_COMMIT`  
**stage3k2b2Status:** `not_started`  
**stage3k2b2Readiness:** `ready_for_bounded_offline_gap_collectors`  
**Stage 3K.2B:** `started_candidate_discovery`  
**Stage 3K.2B1:** `accepted_offline_candidate_discovery_and_review_pack` (unchanged)  
**Stage 3K.2A:** `accepted_offline_approved_binding_adapter` (unchanged)  
**nextImplementationSlice:** `stage3k2b2a_gap_contracts_bounded_collectors_review_pack_v3`  
**Oracle / SQL / model / Qdrant:** none used  

Baseline (must remain):

- production reuse policy: `defaultReuse=deny`, `reusableRoles=[]`
- `planningEligibleBindings=0`
- P1–P4 human decisions remain `request_more_evidence` (infra only; **not** applied)
- `realCandidateApprovalStatus=no_candidates_approved`

---

## 1. Goal

Design a safe process:

```
existing candidate
  → explicit evidence gaps
  → evidence acquisition plan
  → deterministic offline evidence collectors
  → gap-resolution evidence bundle
  → candidate re-evaluation (Stage 3K.2B1 policy)
  → new human review pack (v3+)
  → human decision
```

**Stage 3K.2B2 does not approve bindings.**  
Gap resolved ≠ candidate approved. It only enables re-evaluation under the existing evaluation policy.

Hard rule: missing evidence ≠ “add a rule”. Forbidden gap “fixes”:

- lowering policy thresholds;
- hand-written Oracle mappings;
- column-name assumptions;
- promoting BHP scope to generic;
- arbitrary cardinality rules;
- old Oracle-agent behavior as semantic truth;
- historical working SQL as generic semantic proof.

Evidence acquisition collects **facts**, not desired outcomes.

**Human expertise is last resort** (see §15): offline collectors first; human only when allowed collectors completed and gap still open.

---

## 2. Input audit (review packs v2)

Sources (local, untracked): `.local/stage3k2b1/review-packs-v2/pack-P{1..4}.json`, `stage3k2b1-audit-v2.json`,  
policy `apps/api/config/teta-generic-semantic-candidate-evaluation-policy-v1.json`  
(hash `c5bfcebfd5a328996603ceb2665cea8fbdf6fec95c19325f33e93542a0950b7a`).

Offline graph: Stage 3A index available (`sourceHash` matches 3D / prior designs). Anchored traces in `.local/stage3k2b2-design/` (not for commit).

### 2.1 Failed blocking rules

| ruleId | candidateId | missing evidence class | current evidence (safe) | why insufficient | potential sources | auto? | humanExpertiseMode |
|--------|-------------|------------------------|-------------------------|------------------|-------------------|-------|--------------------|
| `scope.unprovenBlocks` | cand:P1:employee | `scope_applicability_gap` | 4 obs groups (form/gateway/DDL) all home=`occupational_health_examinations`; priorApprovalRef BHP employee | expansion to `bounded_teta_hr` has zero supporting scope refs; BHP home reason competes | cross-feature form/gateway usage; Help labels outside BHP; classified feature families | partial | `conditional_after_offline_collection` |
| `scope.unprovenBlocks` | cand:P2:…employee_number | `scope_applicability_gap` | 5 groups incl. column DDL; identitySemantics flags present in pack | scope still unproven; inherits BHP home | same as P1 + identity control/Help chains outside BHP | partial | `conditional_after_offline_collection` |
| `identity.employeeGrainDependency` | cand:P2 | `dependency_gap` + `identity_facet_gap` | facet metadata present; deps on P1 `pending` | employee grain dependency not satisfied while P1 inactive | wait P1 re-eval; grain evidence on employee root | yes after P1 | `not_required` |
| `scope.unprovenBlocks` | cand:P3:current_position | `scope_applicability_gap` | relation + temporal DDL columns; 3 priorApprovalRefs BHP | no generic scope proof | cross-feature assignment usage | partial | `conditional_after_offline_collection` |
| `grain.cardinalityResolved` | cand:P3 | `cardinality_gap` / `ambiguity_gap` / `temporal_policy_gap` | grain=`unresolved`; empty cardinalityEvidence; temporal columns exist | open-ended dates ≠ ≤1 current row; no tie policy | constraint/help/package collectors first; then human domain Q | partial | `conditional_after_offline_collection` (or `required` only after those collectors) |
| `risk.requiredSemanticClass.concept` | cand:P4:position_name | `semantic_meaning_gap` / `relation_meaning_gap` | lookup_display_path `verified_composed`; FK≠display proven | display path without standalone **concept** evidence for position reference | position dictionary concept anchors; Help; P5 dependency | partial | `conditional_after_offline_collection` |
| `scope.unprovenBlocks` | cand:P4 | `scope_applicability_gap` | BHP-origin display chain | activation blocked without scope + deps | independent assignment/display surfaces | partial | `conditional_after_offline_collection` |

Non-blocking but relevant: `dependencies.reuseActivation` fails for P2/P3/P4 (inactive deps) — fail-closed activation only.

### 2.2 Offline constraint neighborhood (aggregate)

Anchored Stage 3A / SQLite (read-only) on candidate oracle **views**:

- Views expose `HAS_COLUMN` / `DEPENDS_ON`; **no direct** `PRIMARY_KEY_OF` / `UNIQUE_KEY_OF` on the view nodes.
- Base **TABLE** neighbors via `DEPENDS_ON` **do** carry PK/UK/REFERENCES counts (employee root, position assignment, position dictionary).
- Implication: `constraint_metadata_collector` must follow `DEPENDS_ON` → table → constraint edges; view-level absence ≠ “no constraints”.
- PK/UK on assignment table still **does not** prove “at most one *current* assignment”; temporal overlap remains a business/cardinality gap.

---

## 3. Gap taxonomy

Version: `teta-aia-semantic-evidence-gap-taxonomy-v1`

| gapType | typical blocking rules | auto-collectable? |
|---------|------------------------|-------------------|
| `semantic_meaning_gap` | requiredSemanticClass.*, businessMeaningBeyondDdl | partial (Help/form labels) |
| `scope_applicability_gap` | scope.unprovenBlocks | partial (cross-feature usage) |
| `result_grain_gap` | grain.* | partial |
| `identity_facet_gap` | identity.* | partial |
| `relation_meaning_gap` | requiredSemanticClass.relation | partial |
| `temporal_policy_gap` | temporal / grain on currentness | often human after collectors |
| `cardinality_gap` | grain.cardinalityResolved | rare auto; human after collectors |
| `uniqueness_gap` | identity uniqueness | partial (UK) + human domain |
| `display_value_gap` | grain.displayLinkedToPosition | often already collectable |
| `dependency_gap` | identity.employeeGrainDependency, deps | structural |
| `ambiguity_gap` | ambiguityConflict.ambiguity | collector may surface |
| `conflict_gap` | ambiguityConflict.conflict | collector may surface |
| `provenance_independence_gap` | independence / lineage | collector |
| `currentness_gap` | temporal current semantics | partial + human after collectors |
| `version_scope_gap` | stale / versionScope | collector + metadata |
| `authorization_domain_gap` | (future) domain auth | human / policy |

Each gap record fields:

`gapId`, `candidateId`, `gapType`, `blockingRuleId`, `description`, `requiredEvidence`, `currentEvidenceRefs`, `resolutionStatus`, `resolutionRisk`, `allowedCollectors`, **`humanExpertiseMode`**, `dependencyGapIds`

**`humanExpertiseMode`:** `not_required` | `conditional_after_offline_collection` | `required`

**resolutionStatus:**  
`open` | `collectable_offline` | `requires_human_domain_confirmation` | `requires_additional_source` | `ambiguous` | `conflicting` | `not_resolvable_from_available_evidence` | `resolved_pending_re_evaluation` | `superseded`

**Invariant:** `humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0`

---

## 4. Evidence source inventory

| Source | Can help close | Cannot prove | provenance family | independence limits | currentness | privacy |
|--------|----------------|--------------|-------------------|---------------------|-------------|---------|
| Stage 3A canonical graph | structure, PK/UK/FK, joins, form↔dataset↔oracle paths | business meaning alone; all-HR canonical alone; current-cardinality policy | multi (by node/edge) | same gateway observation ≠ independent | graphSourceHash | offline metadata only |
| Stage 2A form/control | concept/control anchors | Oracle semantics | `application_form_control` | same form GUID = one independence group | artifact FP | UI metadata |
| Stage 2B gateway/Oracle map | dataset↔object lineage | generic HR applicability | `dataset_gateway_join` | shared BO may collapse independence | artifact FP | schema map |
| Stage 2C Help | semantic labels | silent auto-approve | `help_semantic_mapping` | Help copy may lag | artifact FP | product Help text |
| Stage 2D SqlJoin | join reconstruction | currentness / uniqueness policy | `sqljoin_reconstruction` | reconstruction ≠ business rule | artifact FP | graph only |
| Stage 2E provenance | unified edges + constraints | semantic approval | mixed | graph completeness ≠ meaning | sourceHash | offline |
| Stage 3D BHP evidence | priorApprovalReference + technical anchors | generic reuse; independent family | priorApprovalRef **not** independent | BHP-scoped | graphSourceHash match | subject-scoped |
| Stage 3J.1 lexicon | label aliases hints | binding proof | lexicon (non-binding) | weak alone | versioned | offline |
| Product / surface / business-area registries | feature-family classification | employee grain | registry | must not invent from form name alone | versioned | offline |
| Registry/form/plugin | product surface anchors | employee grain | form/plugin | plugin-local | build FP | offline |
| Static DLL metadata | control/dataset types | business rules | form/control | IL≠meaning | build FP | offline |
| Extracted Help HTML | labels | live DB behavior | help | stale Help risk | extraction FP | offline |
| Package deps in graph | rule references | executable semantics without text | `package_dependency` | package name ≠ rule body | graph | offline |

**Disallowed sources for 3K.2B2 collectors:** live Oracle; free column-name scans; RAG as schema truth; historical generated SQL as approval evidence; client-specific runtime rows.

---

## 5. Application context anchor

Contract: **`TetaApplicationContextAnchor`**

Minimum fields:

- `anchorId`
- `origin`: `user_question` | `application_context` | `screenshot_context` | `known_form_context`
- `productFamily`, `productSurface`
- `formId`, `formLabel`
- `tabId`, `tabLabel`
- `controlId`, `controlLabel`
- `helpFieldId`
- `recognizedText`, `recognitionConfidence`
- `selectionRequired`

**Not a semantic binding.** Purpose:

```
question / screenshot
  → form / field
  → existing application↔database graph
```

Screenshot does **not** prove database mapping. Vision/OCR is **out of scope** for 3K.2B2A (contract/interface only).

---

## 6. Offline graph reads & collector start points

Allowed: read-only Stage 3A index via resolver/trace APIs. Prefer APIs; SQLite diagnostics only when API insufficient.

**Allowed collector starts:**

1. `TetaApplicationContextAnchor`
2. existing candidate anchor
3. Stage 3D prior evidence ref
4. unresolved dependency
5. explicit coverage target

**Allowed flow:**

```
form → control → dataset → gateway → Oracle object → typed relation → lookup/display/package evidence
```

**Forbidden:** screen text → random column name → binding.

No rebuild; no arbitrary business-word free search. Detailed traces → `.local/` only.

---

## 7. P1 — Employee gap plan

**Documented gaps:** scope expansion unproven; employee grain partial; generic Teta HR applicability not proven.

### Required proofs

| Axis | Need |
|------|------|
| A business meaning | source = employee master, not exam/contract/position/tech join root |
| B grain | one row ↔ one employee **or** explicit duplicate model |
| C bounded applicability | used across **classified** independent feature families (not “all Teta HR” by default) |
| D competing roots | scan other employee-like roots with different business meaning |

### `EmployeeRootEvidenceAssessment` (design)

- `businessMeaningSupport`
- `grainSupport`
- `crossFeatureUsageSupport`
- `competingRootScan`
- `scopeSupport` (may be `supported_bounded`)
- `unresolvedRisks`

Multiple forms from one gateway observation ⇒ **one** independence group.

Primary collectors: `stage3a_anchor_trace_collector`, `form_usage_collector`, `cross_form_usage_collector`, `gateway_lineage_collector`, `scope_usage_collector`, `competing_root_collector`, `help_semantic_label_collector`, `constraint_metadata_collector`.

**Human fallback (only after collectors):** do **not** default to “canonical across all Teta HR”. Prefer:

> System confirmed the same employee record is used in areas X/Y/Z. In these areas, does it mean the same employee master file, or does any area use a distinct person/participant kind?

Scope of the answer = the indicated feature families only. Later human approval may be `approve_with_scope` (not in this stage).

---

## 8. P2 — Employee number gap plan

**Gaps:** P1 dependency pending; generic scope unproven; identity semantic evidence incomplete (for *generic* activation).

### Required proofs (technical first)

- business label equivalent to registry number;
- control/Help → dataset field → employee source;
- distinction vs internal_id / surname / national id / card / contract number;
- string + leading-zero preservation;
- employee-grain dependency;
- uniqueness **only if evidenced** (do not invent).

### `IdentityFacetEvidenceAssessment` (design)

`facetType=employee_number` plus:  
`semanticLabelEvidence`, `sourceDependency`, `datatypeEvidence`, `formatPreservationEvidence`, `uniquenessEvidence`, `negativeDistinctionEvidence`, `scopeEvidence`.

**Uniqueness missing does not auto-block filter identity.** It may:

- allow filter with multiple matches → clarification / multi-result;
- block exact-single-employee resolution;
- leave uniqueness=`unknown` (not `many`).

**Human fallback (after technical confirmation of label/path/string/leading-zero):** only uniqueness domain questions — firm / database / period; reuse of numbers. No Oracle mapping questions.

---

## 9. P3 — Current position gap plan

Separate axes: (A) semantic currentness rule, (B) data cardinality guarantee, (C) multi-active business behavior, (D) result grain, (E) generic scope.

Offline check targets: unique constraints; relation cardinality metadata; app/validation/package/Help; ordering; primary/default indicator; distinctions (main / additional / substitution / civil / historical).

**Forbidden without business evidence:** latest DATA_OD wins; MAX(ID); FIRST ROW; null DATA_DO alone.

### Allowed outcomes

- `single_current_position_proven`
- `multiple_current_positions_valid` → may bind `current_positions` (plural / list grain); singular question → clarification
- `multiple_current_positions_ambiguous`
- `primary_position_indicator_required`
- `cardinality_not_proven`

Do **not** force a singular semantic role.

**HumanExpertiseMode:** `conditional_after_offline_collection` (or `required` only after constraint/help/package collectors).

**Human fallback (after collectors), ask separately:**

A. Can an employee have several simultaneously effective positions?  
B. Is there a business “primary position”?  
C. If several: return all / return primary / ask user / depends on assignment type?

Do **not** ask about DATA_OD/DATA_DO if the system already confirmed their technical meaning.

---

## 10. P4 — Position name gap plan

Separate: position concept/source | assignment | dictionary identity | display name.

**Do not** bind P4 only to P3 if display is also used for history / other assignments.

### Design dependency target **P5 `position_reference`**

Design-only coverage target (not approved binding): dictionary / concept identity for position, independent of “current” assignment.

P4 full proof chain:

```
assignment_or_reference identity
  → dictionary lookup
  → display text
  → valueKind=display_business_value
```

Explicit: foreign key ≠ business answer (already partially shown by lookup_display_path).

Blocking concept class for P4 is expected to attach to P5 (or equivalent ontology name), not to invent concept from DDL alone.

---

## 11. Cross-candidate dependency DAG

```
P1 employee
 ├── P2 employee_number  [semantic_validity, approval, generic_activation, planning_composition]
 └── P3 current_position [semantic_validity, generic_activation, planning_composition]
P5 position_reference (design)
 ├── P4 position_name [semantic_validity, generic_activation]
 └── (optional) assignment relation for historical display
P3 ──uses──> P5/P4 for display composition (planning), not as P4's only concept root
```

Each edge typed separately: `semantic_validity` | `approval` | `generic_activation` | `planning_composition`.

**Cycle detection (design):** topological sort on dependency graph at plan build and before re-evaluation; cycle ⇒ `conflict_gap` / fail-closed (no activation).

**Priority order (from DAG):**  
1) P1 → 2) P2 → 3) P5 position_reference → 4) P4 → 5) P3 cardinality/temporal (after P1).  
Do not solve P3 before P1. Do not start from approval.

---

## 12. Evidence request contracts

| Type | Role |
|------|------|
| `TetaApplicationContextAnchor` | question/screenshot → form/control (not binding) |
| `TetaSemanticEvidenceGap` | explicit gap record (§3 fields) |
| `TetaSemanticEvidenceRequest` | collectable request |
| `TetaSemanticEvidenceCollectionPlan` | ordered collector plan |
| `TetaSemanticEvidenceObservation` | collected fact + provenance |
| `TetaSemanticGapResolutionResult` | per-gap outcome (not approval) |
| `TetaSemanticCandidateReevaluationRequest` | trigger 3K.2B1 re-eval |
| `TetaApplicationFeatureFamilyEvidence` | classified feature family (§14) |
| `EmployeeRootEvidenceAssessment` | P1 assessment |
| `IdentityFacetEvidenceAssessment` | P2 assessment |
| `SemanticApplicabilityEvidence` | scope (§13) |
| `SemanticGrainEvidence` | grain (§15) |
| `HumanDomainEvidenceRequest` | last-resort business questions (§16) |

### `TetaSemanticEvidenceRequest` minimum

`requestId`, `gapId`, `candidateId`, `requiredEvidenceClass`, `allowedSourceStages`, `anchorRefs`, `collectorType`, `collectionScope`, `expectedSupports`, `prohibitedInference`, `dependencyVector`, `riskClass`, **`humanExpertiseMode`**

---

## 13. Collector types (design only until 3K.2B2A)

| collectorType | solves (examples) | must not infer |
|---------------|-------------------|----------------|
| `stage3a_anchor_trace_collector` | neighborhood / typed paths | business meaning from path alone |
| `form_usage_collector` | form↔control↔dataset | generic scope from one form |
| `help_semantic_label_collector` | labels | approve concept |
| `gateway_lineage_collector` | BO/gateway→oracle | independence across shared BO |
| `cross_form_usage_collector` | feature-family usage | count(forms)=generic |
| `constraint_metadata_collector` | PK/UK/FK via DEPENDS_ON | current-cardinality policy |
| `lookup_display_chain_collector` | FK→dict→display | concept without dict root |
| `package_rule_reference_collector` | package references | executable rule body if absent |
| `scope_usage_collector` | applicability evidence | BHP→all-HR promotion |
| `competing_root_collector` | alternate roots | auto-pick winner |
| `dependency_evidence_collector` | dep status / wire-up | activate reuse |

Each declares: input anchor; allowed traversal; max scope; output evidence classes; provenance family; whether it can clear a blocking rule; prohibited inferences.

### Bounded traversal

`maxDepth`, `allowedNodeTypes`, `allowedEdgeTypes`, `maxCandidates`, `conflictPolicy`.  
**No** global free search on PRAC/EMPLOYEE/STAN/NAZWA/NUMER. Empty result ⇒ gap stays `open`.

---

## 14. Feature family classification — `TetaApplicationFeatureFamilyEvidence`

Feature family **must not** be inferred from form name text or DLL folder alone.

Must derive from: product registry; product surface registry; business area registry; plugin/form ownership; known application hierarchy; canonical provenance.

Fields: `featureFamilyKey`, `productFamily`, `productSurface`, `businessArea`, `formRefs`, `gatewayRefs`, `originObservationGroups`, `classificationEvidence`, `classificationStatus`.

Multiple forms sharing the same underlying gateway observation are **not** automatically independent feature families.

**Invariant:** `formsCountedAsIndependentFeaturesWithoutClassification = 0`

---

## 15. Scope evidence model — `SemanticApplicabilityEvidence`

Fields: `homeScope`, `proposedScope`, `observedUsageScopes`, `independentFeatureFamilies`, `productFamily`, `productSurfaces`, `businessAreas`, `featureFamilies`, `versionScope`, `clientScope`, `scopeConflicts`.

Expansion assessment: `proven_exact` | `supported_bounded` | `partial` | `unproven` | `conflicting`.

**Do not require “canonical across all Teta HR” by default.**  
`supported_bounded` may list e.g. personnel + payroll + occupational_health without claiming all modules. Later approval may be `approve_with_scope` (not now).

Form count ≠ generic applicability; forms must be **classified** independent feature families.

---

## 16. Grain / cardinality model — `SemanticGrainEvidence`

Fields: `businessGrain`, `sourceGrain`, `relationCardinality`, `uniquenessEvidence`, `duplicateRowRisk`, `temporalOverlapRisk`, `multiAssignmentPolicy`, `aggregationRequired`, `selectionRequired`.

Cardinality strength may come from: verified unique constraint; application validation; authoritative business rule; multiple independent technical mappings.

**Absence of constraint ⇒ `unknown`, not `many`.**

---

## 17. Human domain confirmation — `HumanDomainEvidenceRequest`

**Last resort.** Generate only when:

```
allAllowedOfflineCollectorsCompleted = true
AND blockingGapStillOpen = true
```

Invariant: `humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0`

Required content:

- `questionId`, `gapId`, `candidateId`
- `preciseQuestion`, `whyNeeded`
- `factsAlreadyEstablished[]`, `factsStillUnknown[]`
- `possibleAnswers[]` with: `answerKey`, `businessMeaning`, `effectOnCandidate`, `effectOnGrain`, `effectOnScope`, `effectOnClarification`
- `technicalEvidenceSummary`
- `offlineCollectorsCompleted[]`
- `unavailableEvidenceSources[]`

**Forbidden to ask humans** for table / column / FK / join / Oracle mapping when the system can establish that technically. Humans answer **business rules only**.

Expert answer = `human_confirmed_business_rule`, must combine with technical bundle; cannot invent graph paths; cannot auto-activate reuse.

---

## 18. Evidence strength after collection

Keep: `verified_exact` | `verified_composed` | `supported_by_multiple_independent_edges` | `supported_by_single_authoritative_mapping` | `inferred` | `heuristic` | `conflicting` (+ `stale`).

Add fact kinds: `technical_fact` | `business_semantic_fact` | `scope_fact` | `cardinality_fact` | `human_confirmed_business_rule`.

---

## 19. Gap resolution policy (proposed)

**Name:** `teta-aia-semantic-evidence-gap-resolution-policy-v1`  
Config path (implementation): `apps/api/config/teta-semantic-evidence-gap-resolution-policy-v1.json`

Must define: auto-resolvable gap types; conditional human gap types; required collector sequences; minimal evidence facts; feature-family independence rules; bounded applicability rules; stale/currentness checks; dependency completion; when re-evaluation is allowed.

**Resolved gap ⇒ re-evaluate under Stage 3K.2B1 evaluation policy — never approve.**

---

## 20. Re-evaluation flow

```
old candidateFingerprint
+ new evidence observations
→ new candidateFingerprint
→ evaluate under current evaluation policy
→ new candidateEvaluationFingerprint
→ review pack v3 (append; do not overwrite v2)
→ human decision
```

Policy-only change: same candidateFingerprint, different evaluationFingerprint.  
Evidence change: new candidateFingerprint.  
Never silent overwrite of prior packs.

---

## 21. Staleness

Every observation: `graphSourceHash`, `sourceStageVersion`, `collectorVersion`, `sourceArtifactFingerprint`, `dependencyVector`.

Graph change ⇒ observation stale ⇒ gap resolution stale ⇒ re-evaluation required. No silent carry-forward.

---

## 22. Automatic vs human-resolvable (pilot summary)

| Gap cluster | humanExpertiseMode | notes |
|-------------|--------------------|-------|
| P1–P4 scope | `conditional_after_offline_collection` | collectors first; bounded scope OK |
| P2 dependency on P1 | `not_required` | structural after P1 |
| P2 uniqueness domain | `conditional_after_offline_collection` | after label/path/string/zero |
| P3 cardinality / multi-current / primary | `conditional_after_offline_collection` → maybe `required` | only after constraint/help/package |
| P4 concept via P5 + display | `conditional_after_offline_collection` | collectable + dependency |
| Competing roots | collector surfaces; human only if still open | `competing_root_collector` |

---

## 23. K1 feasibility chain

Question: “Jakie aktualne stanowisko ma pracownik 00122?”

| Link | current | missing | collector / human | re-eval effect | blocks |
|------|---------|---------|-------------------|----------------|--------|
| employee root | BHP-anchored; scope unproven | bounded applicability + grain | collectors then conditional human | may clear P1 | all |
| employee_number identity | facet present; dep pending | P1 active + scope | after P1; Help/label | may clear P2 | filter |
| filter semantics | string/leading-zero claimed | uniqueness unknown OK for multi | optional UK + human domain | clarification policy | exact-one |
| employee→position assignment | BHP relation | generic + grain | after P1 | unlocks P3 semantic | position |
| current temporal | temporal columns + BHP temporal | multi-current policy | constraint + human after | cardinality outcome | singular answer |
| position reference | missing as P5 | concept root | P5 discovery/collect | concept class for P4 | display |
| position display | lookup proven | deps + scope | P5/P4 collectors | display ready | answer text |
| cardinality/selection | unresolved | outcome enum §9 | human ± constraints after collectors | singular vs list vs clarify | K1 singular |

**Minimal path to `semantically_bound` (not SQL/execution):**  
P1 bounded scope+grain → P2 dep+identity → P5 concept → P4 display → P3 currentness **and** cardinality outcome. Still requires later **human approval** + reuse policy pointer — out of 3K.2B2 scope.

---

## 24. First implementation slice

**Stage 3K.2B2A — Semantic Evidence Gap Contracts + Bounded Offline Evidence Collectors + Review Pack v3**

Pilot focus: **P1 employee** and **P2 employee_number** (DAG foundation). P3/P4/P5 deferred.

Must not: approve candidates; mutate Stage 3D; mutate reuse policy; Oracle; SQL gen/exec; LLM; Qdrant/embeddings; Stage 3C plans; planning eligibility activation; Vision/OCR.

---

## 25. Explicitly not to build yet

- approval application / real decision ledger apply to production
- Stage 3D production mutations
- reuse policy entries / `reusableRoles`
- live Oracle / SQL / 3C planner
- LLM / RAG / Qdrant / embeddings / Vision
- free-search collectors
- automatic threshold lowering
- full P3 cardinality auto-resolve
- OU / payroll / location pilots

---

## 26. Readiness

**stage3k2b2Readiness:** `ready_for_bounded_offline_gap_collectors`  
**stage3k2b2Status:** `not_started`  
**nextImplementationSlice:** `stage3k2b2a_gap_contracts_bounded_collectors_review_pack_v3`

---

## 27. Local artifacts

- `.local/stage3k2b2-design/` — traces, constraint neighborhood summary (untracked)
- Do not commit `.local/**`

## 28. Strict design counters

- `humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0`
- `formsCountedAsIndependentFeaturesWithoutClassification = 0`
- `priorApprovalReferencesCountedAsIndependentEvidence = 0`
- `duplicateObservationFamiliesCountedAsIndependent = 0`
