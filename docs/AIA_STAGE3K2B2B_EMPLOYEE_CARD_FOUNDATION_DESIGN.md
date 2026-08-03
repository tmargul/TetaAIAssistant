# Stage 3K.2B2B — Employee Card Foundation Gap Closure Design

**Status:** design corrected — `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  
**previousHumanReviewVerdict:** (initial design review)  
**humanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  
**stage3k2b2bStatus:** `not_started`  
**stage3k2b2bReadiness:** `ready_for_employee_source_gap_collectors`  
**Stage 3K.2B2:** `started_bounded_gap_resolution` (not completed)  
**Stage 3K.2B2A:** `accepted_offline_bounded_gap_resolution_and_reevaluation`  
**nextImplementationSlice:** `stage3k2b2b1_employee_master_source_and_composite_card_identity_offline_evidence_pilot`  
**Oracle / SQL / model / Qdrant:** none used  

Baseline (must remain):

- production reuse policy: `defaultReuse=deny`, `reusableRoles=[]`
- `planningEligibleBindings=0`
- P1/P2 human decisions remain `request_more_evidence` (**not** applied)
- `realCandidateApprovalStatus=no_candidates_approved`
- P6/P7 design-only; no production binding

---

## 1. Goal

Design a safe offline path to close the **employee-card foundation** (kartoteka), not natural-person identity:

```
P1 employee master/card source + grain
P2 employee_number (re-evaluation dependency only)
P6 employee_card_number
P7 employee_card_identity
training_participant → employee master (typed attributable path)
```

**Stage 3K.2B2B does not approve bindings.** Gap closed ≠ candidate approved.  
This stage does **not** establish runtime execution access.

---

## 2. Concept separation (mandatory)

| Concept | Must not collapse into |
|---------|------------------------|
| employee person concept | one kartoteka row |
| employee card / master record | natural person |
| employment episode | person identity / kartoteka |
| employee_number | unique kartoteka alone |
| employee_card_number | badge / payroll / document / training / benefit card |
| employee_card_identity | person identity (PESEL etc.) |
| internal technical ID | business identity facets |
| training participant role | independent person root |

**P1 grain in this stage:**

```
businessGrain = one_row_per_employee_card_or_master_record
```

Forbidden grain labels: `one_row_per_natural_person`, `one_row_per_person`.

Invariant counter (must remain 0):

- `employeeCardGrainCollapsedIntoPersonIdentity`

---

## 3. Semantic source vs application access surface

Runtime access is **out of scope** for this stage. Split:

| Ref | Meaning |
|-----|---------|
| `semanticMasterSourceRef` | source that proves identity / card grain |
| `applicationAccessSurfaceRefs[]` | forms/views/gateways the application actually uses |
| `runtimeExecutionAccessObjectRef` | future execution object — **not set here** |

### TetaEmployeeMasterSourceCandidate (corrected)

```
candidateId
semanticSourceKind: table | view | gateway_projection | composed_source
semanticMasterSourceRef
applicationAccessSurfaceRefs[]
runtimeExecutionAccessObjectRef        # null in this stage
runtimeAccessEligibility:
  not_evaluated | blocked | requires_separate_access_binding | eligible_after_separate_approval
authorizationDomainStatus:
  deferred | not_evaluated | blocked
businessRole: employee_master
applicationAnchors[]
technicalSourceRefs[]
identityFacets[]
grainAssessment                       # card/master record grain
keyPreservationAssessment
scopeAssessment
dependencies[]
conflicts[]
evidenceStatus
approvalReadiness                     # never ready for production apply in 3K.2B2B
```

### Invariants

- A base table may prove grain or identity.
- A base table does **not** automatically become the runtime query source.
- Application view/access surface must not be bypassed without separate evaluation.
- This stage does not establish execution access.

Required zero counters:

- `baseTableEvidencePromotedToRuntimeAccess`
- `applicationAccessSurfaceBypassClaims`

Default for any direct-table semantic proof found offline:

```
runtimeAccessEligibility = requires_separate_access_binding
authorizationDomainStatus = deferred
```

---

## 4. Offline input audit (safe aggregates)

Sources (local, untracked): Stage 3A index; Stage 3K.2B2A packs v5 / audit; P1 real-graph-read; H1–H5; Stage 2D SqlJoin corpus; Stage 2E graph NDJSON. No live Oracle.

### Available

Employee object as VIEW; DEPENDS_ON (2); HAS_COLUMN; base PK via DEPENDS_ON (insufficient alone); unattributed FK mass on bases; SqlJoin corpus; gateway column inventory (name patterns only — not bindings); H1–H5; P1 scope `supported_bounded_confirmed`; P2 identity facets (string / leading zeros / composite business rule).

### Missing

`view_definition_evidence_unavailable`; proven view key preservation; direct PK/UK on employee VIEW; attributable typed training_participant → employee_master path; discovered P6/P7 candidates.

---

## 5. P1 — Employee card/master source / grain

### Variants

**A. Direct canonical employee-master source** — table (or equivalent) with explicit key/grain; may support **semantic** grain; `runtimeAccessEligibility=requires_separate_access_binding`.

**B. Key-preserving employee-master view** — view remains access/semantic surface only if key preservation proven (not from base PK alone).

### EmployeeViewKeyPreservationAssessment

```
viewSourceRef
baseEmployeeSourceRefs[]
projectedIdentityFacets[]
projectedTechnicalKey
joinEvidence
joinCardinalities
rowMultiplyingRelations[]
filters / aggregations / distinctUsage / unionUsage / groupingUsage
duplicateRisk
keyPreservationStatus: proven | supported_partial | unproven | conflicting
evidenceRefs[]
unresolvedRisks[]
viewDefinitionEvidenceStatus: available | view_definition_evidence_unavailable
```

Hard rule: base-table PK via DEPENDS_ON alone ⇒ never `proven`.

---

## 6. Decouple P2 scope from P1 grain

P2 **scope applicability** and P1 **grain** are independent dimensions.

Allowed outcome example:

| Dimension | Value |
|-----------|-------|
| P2 scope | `supported_bounded_confirmed` |
| P2 grain/source dependency | `blocked_by_p1_grain` |
| P2 generic activation | `false` |
| P2 planning | `false` |

P2 scope may derive from: H1 bounded applicability; technical P2→P1 relation; usage in the same feature families.  
Missing P1 grain does **not** invalidate scope evidence by itself.

### EmployeeFoundationDependencyStatus

```
scopeDependencyStatus
grainDependencyStatus
reevaluationDependencyStatus
genericActivationDependencyStatus
planningDependencyStatus
```

Required zeros:

- `p2ScopeBlockedOnlyBecauseOfP1Grain`
- `scopeAndGrainDependencyConflations`

---

## 7. P6 — employee_card_number

Business meaning: numer kartoteki which with `employee_number` forms unique employee card (H4). No hardcoded physical column name.

Anchored starts only: employee-master application anchor; employee-number control/source; employee source candidate; field on employee-card form; explicit unresolved identity dependency.

Forbidden: global name scan (NR_KARTY / KARTA / CARD / …).

### EmployeeCardNumberEvidenceAssessment

```
semanticLabelEvidence
applicationContextEvidence
technicalPathEvidence
employeeSourceDependency
datatypeEvidence
formatEvidence
negativeDistinctionEvidence[]
sameRecordAsEmployeeNumberEvidence
scopeEvidence
unresolvedRisks[]
```

---

## 8. P7 — employee_card_identity + business vs technical uniqueness

Components: `employee_number` + `employee_card_number`.  
H4: `uniquenessScope=whole_database`, `firmScoped=false` — business rule, not technical proof.

### CompositeIdentityEvidenceAssessment (corrected)

```
componentRoles[]
componentCandidateIds[]
sameSourceEvidence
sameRecordEvidence
businessUniquenessRuleStatus: confirmed | partial | unknown | conflicting
technicalUniquenessEnforcementStatus: proven | supported_partial | not_found | unavailable | conflicting
technicalConstraintRefs[]
businessRuleRefs[]
exactOneSemantics:
  technically_enforced
  | business_expected_with_runtime_cardinality_guard
  | not_supported
  | conflicting
scope
firmScoped: false
dependencies[]          # P1/P2/P6 fingerprints
activationStatus        # fail-closed in 3K.2B2B
```

H4 ⇒ `businessUniquenessRuleStatus=confirmed` only.  
Does **not** auto-set `technicalUniquenessEnforcementStatus=proven`.

If technical constraint unproven:

```
exactOneSemantics = business_expected_with_runtime_cardinality_guard
```

Requirement (design; not implemented yet): multiple matches → no silent selection → clarification / selectable results. No SQL/runtime guard in this stage.

Required zeros:

- `businessRuleUsedAsTechnicalConstraint`
- `exactOneGuaranteedWithoutTechnicalOrRuntimeGuard`

---

## 9. P2 behavior after P6/P7

Preserve for `employee_number` alone: `exactOneGuaranteed=false`; `multiResultFilterAllowed=true`; exact string; never select first silently.

| Outcome | Behavior |
|---------|----------|
| zero matches | empty result if semantics resolved — not mapping failure |
| one match | may support composite exact-one **candidate** only after P7 evidence |
| multiple cards | clarification / multi-result — no auto-pick |
| missing card number | incomplete composite; P2 multi-result rules |
| ambiguous identity | clarification |

---

## 10. Training participant — applicability scoped

H2 confirms dependent-role **meaning**, not global applicability across all H1 business areas.

Relation applicability must come from:

- real training application anchor;
- product surface;
- feature family;
- participant source evidence.

```
relationApplicability
applicationFeatureFamily
applicationAnchorRefs[]
```

If no training application anchor ⇒ `requires_additional_source` (not “global training relation”).

### Confirmation

Allowed: `typed_foreign_key_reference` | `verified_gateway_relation` | `verified_sqljoin_relation` | `composed_verified_relation`  
plus application role attribution.

Forbidden as confirmation: name similarity; `*_ID` alone; shared label/DLL/package.

### SemanticRelationAttributionEvidence

```
sourceBusinessRole / targetBusinessRole
sourceTechnicalRefs[] / targetTechnicalRefs[]
relationRefs[] / relationKinds[]
applicationAnchors[]
gatewayRefs[] / sqlJoinRefs[]
pathFingerprint
relationApplicability
applicationFeatureFamily
attributionStatus: proven | supported_partial | unresolved | conflicting
ambiguityCandidates[] / conflicts[]
evidenceStrength
```

Typed FK without application-role attribution ⇒ not `proven`.

---

## 11. Application-first flow

```
user question / screenshot / known form
  → ApplicationContextAnchor
  → form/control
  → dataset/gateway
  → employee source (semantic) + access surfaces
  → identity facets
  → typed relations
  → semantic candidate
```

Screenshot ≠ DB mapping. Vision not in scope.

---

## 12. Human questions (last resort)

After offline collectors. Business-only questions (label kinds, one kartoteka vs history, form variants). Never ask for table/column/FK/join/package/view definition.

---

## 13. Versioned foundation evidence policy

**Policy id/version:** `teta-aia-employee-card-foundation-evidence-policy-v1`  
**Future path:** `apps/api/config/teta-employee-card-foundation-evidence-policy-v1.json`

Not an approval policy and not a reuse policy. Controls:

- direct master source evidence;
- view key-preservation thresholds;
- row-multiplication detection;
- typed relation attribution;
- P6 semantic evidence;
- P2/P6 same-record proof;
- composite identity sufficiency;
- business vs technical uniqueness;
- scope/grain dependency separation;
- collector phase gates;
- staleness;
- fail-closed statuses.

Thresholds must not live only in TypeScript.

---

## 14. Staleness / fingerprints

Every observation and assessment carries:

```
graphSourceHash
sourceStageVersion
collectorVersion
sourceArtifactFingerprint
foundationPolicyVersion
foundationPolicyHash
candidateFingerprint
dependencyFingerprints[]
```

Change of graph / policy / P1 / P2 / P6 / application anchor / relation attribution ⇒ mark dependent results **stale**. No silent carry-forward.

P7 fingerprint depends at minimum on: P1, P2, P6, H4, same-record evidence fingerprints.

### EmployeeFoundationStalenessVector

```
inputs[]
stale: boolean
staleReasons[]
```

---

## 15. Bounded collectors (design only until 3K.2B2B1)

| Collector | Purpose |
|-----------|---------|
| `employee_master_source_collector` | semantic master + access surfaces |
| `view_key_preservation_collector` | key preservation assessment |
| `employee_identity_facet_collector` | facets on master neighborhood |
| `employee_card_number_collector` | P6 anchored discovery |
| `same_record_identity_collector` | P2+P6 same-record |
| `composite_identity_collector` | P7 assessment |
| `training_participant_anchor_collector` | training form/control start |
| `typed_relation_attribution_collector` | attributed typed path |
| `constraint_consistency_collector` | technical uniqueness vs H4 |
| `application_context_identity_collector` | form/control identity context |

Each declares: `inputAnchors`, `allowedNodeTypes`, `allowedEdgeTypes`, `maxDepth`, `maxCandidates`, `outputEvidenceClasses`, `prohibitedInference`, `failureStatus`.

No free search. Empty ≠ invent mapping.

---

## 16. Dependency DAG + phase gates

```
P1 employee master/card source
 ├── P2 employee_number
 ├── P6 employee_card_number
 ├── P7 employee_card_identity → P2, P6, P1
 └── training_participant relation → P1
```

No cycles. Status dimensions: semantic / technical_mapping / reevaluation / generic_activation / planning.

### Stage 3K.2B2B1 internal phase gates

| Phase | Work |
|-------|------|
| 1 | P1 source/grain |
| 2 | training_participant attribution |
| 3 | P6 anchored discovery |
| 4 | P7 composite assessment |
| 5 | P2 dependency re-evaluation |

Gates:

- P6 may start only with a real bounded employee-master anchor.
- P7 only when P2 candidate + P6 candidate + same-record evidence result exist.
- If P1 remains unresolved: P6/P7 may be **diagnostics-only**; no `approvalReadiness`; no generic activation improvement; foundation outcome fail-closed.

Required zeros:

- `p6DiscoveryWithoutEmployeeMasterAnchor`
- `p7AssessmentWithoutP2P6SameRecordEvidence`
- `downstreamCandidateActivatedWithBlockingP1`

---

## 17. Re-evaluation (future)

New evidence → new fingerprints → dependency vectors → **existing** Stage 3K.2B1 evaluator → review packs → human decision.  
Gap resolved ≠ approved. Thresholds unchanged.

---

## 18. Readiness + first slice

**Readiness:** `ready_for_employee_source_gap_collectors`  
**Stage 3K.2B2B:** `not_started`

### Next slice

`stage3k2b2b1_employee_master_source_and_composite_card_identity_offline_evidence_pilot`

Priority: Phase 1 → 2 → 3 → 4 → 5.  
Exclude: P3/P4/P5, payroll, person identity, live execution, approval.

---

## 19. Things not to build

approval application; Stage 3D / reuse / planning eligibility; Stage 3C / SQL compiler / Oracle executor; live sampling; free schema search; OCR/Vision; person dedup / PESEL; current position / position name; runtime cardinality guard implementation (requirement only).

---

## 20. Artifacts

- `docs/AIA_STAGE3K2B2B_EMPLOYEE_CARD_FOUNDATION_DESIGN.md`
- `docs/AIA_STAGE3K2B2B_EMPLOYEE_CARD_FOUNDATION_DESIGN.json`
- Local traces: `.local/stage3k2b2b-design/` (untracked)
