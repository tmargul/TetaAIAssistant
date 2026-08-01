# Stage 3K.2B — Generic Semantic Coverage Design / Readiness Review

**Status:** design-only (PASS_WITH_SMALL_DESIGN_CORRECTIONS applied)  
**stage3k2bStatus:** `not_started`  
**stage3k2bReadiness:** `ready_for_candidate_discovery_contract`  
**Stage 3K.2:** `started_approved_binding_adapter`  
**Stage 3K.2A:** `accepted_offline_approved_binding_adapter` (unchanged)  
**Stage 3K.2B implementation:** not started  
**nextImplementationSlice:** `stage3k2b1_candidate_discovery_and_review_pack`  
**Oracle / SQL / model / Qdrant:** none used  

Baseline (must remain):

- production reuse policy: `defaultReuse=deny`, `reusableRoles=[]`
- `planningEligibleBindings=0`

---

## 1. Goal

Design a safe governance process:

```
generic semantic need
  → candidate discovery from canonical evidence
  → candidate semantic binding
  → validation
  → human review / approval
  → approved generic reusable binding
  → Stage 3K.2A adapter (reuse policy pointer)
```

**No auto-approval.** Graph path ≠ semantic binding.

---

## 2. Critical invariants

1. **Graph path ≠ semantic binding.** FK/join existence does not prove “aktualne stanowisko”.
2. **Semantic schema approval ≠ knowledge approval (3J.2E).** Separate decision ledger; may reuse append-only patterns only.
3. **Discovery never mutates production reuse policy.**
4. **Heuristic/inferred evidence never auto-upgrades to approved.**
5. **BHP approved ≠ generic reusable** (already enforced by 3K.2A deny policy).
6. **Do not free-search Oracle column names** (`MIASTO`, `ULICA`, …) as semantic proof.
7. **Single activation authority:** Stage 3D = substance SoT; reuse policy = sole generic runtime activation SoT.  
   `approvedBindingWithoutReusePolicyPointer` → **not** generic reusable. No persisted dual flag `genericReuseAllowed` as activation authority.
8. **`approved_stage3d_role` is priorApprovalReference, not an independent evidence family.**
9. **priorApprovalReferencesCountedAsIndependentEvidence = 0**; **duplicateObservationFamiliesCountedAsIndependent = 0**.

---

## 3. Stage 3D audit summary

| Fact | Value |
|------|--------|
| Subjects | 1 (`occupational_health_examinations`) |
| Approved bindings | 31 |
| Scope fields in 3D JSON | none (subject string only) |
| graphSourceHash | `2e7f0b7e…717f73c3` (matches offline Stage 3A index) |
| Discovery | sources only; never auto-approves projections/relations/temporals |
| Status model | discovered / approved / ambiguous / unresolved / rejected / stale / invalid |

### A. Does Stage 3D suffice to store generic approved bindings?

**Substance: yes.** Sources, projections, relations, valuePaths, temporals, forms, `businessReason`, optional evidence IDs, temporal AST, display valuePaths already exist.

**Reuse governance: no inside 3D.** Cross-subject / generic **runtime** reuse activation lives exclusively in Stage 3K.2A versioned reuse policy pointers. Stage 3D may store semantic approval state, `approvalDecisionRef`, applicability, revision, evidence/dependency metadata — but **not** a second runtime activation flag.

### B. Scope / applicability gaps

Missing in Stage 3D (optional future metadata): productFamily, productSurface, businessArea, clientScope, versionScope, riskClass, requiredDataDomain, approvalDecisionRef, revision.

### C. Registry architecture recommendation — **OPTION A**

**Extend Stage 3D as single source of truth** for binding substance; keep **reuse policy as a versioned pointer ledger** (approvedBindingId / roleKey / scope), not a second Oracle mapping store.

| Criterion | Option A (extend 3D + policy pointers) | Option B (separate registry) |
|-----------|----------------------------------------|------------------------------|
| Single source of truth | Strong | Weaker (dual sync) |
| Backward compatibility | Strong (31 BHP untouched) | Migration risk |
| Scope / versioning | Add optional fields + policy | Full new schema |
| Approval ledger | Separate decision log (not 3J.2E) | Same need |
| Runtime simplicity | 3K.2A already adapts 3D | Extra adapter |
| Staleness | Existing graphSourceHash | Duplicate |
| Testability | Existing validator/resolver | Parallel suite |

**OPTION B rejected** for v1: would duplicate path/evidence and re-wire resolver/3C/3K.2A.

### Migration of existing 31 BHP bindings

**A stay + C reuse governance via policy** (already deny + restrictedSubjects).  
Do **not** rewrite each binding with scope fields now. Optional later: subject-level `homeSubjectScope` documentation metadata without touching the 31 rows.

---

## 4. Offline graph inspection (read-only)

- Index: `.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite` (exists; ~864k nodes / ~993k edges)
- Tools: `graph:stage3a` resolve/trace-oracle; `semantics:stage3d` validate/explain-role
- Traces (vendor/local only): `.local/stage3k2b-design/` — **not for repo commit**
- Candidates inspected (aggregate): employee master + identity columns, current_position (+ columns/FKs), OU dictionary, employment contracts view, BHP exam sources, negative probes for `NT_KP_ADRESY` / `WYNAGRODZENIA` names → unresolved

Identity column types (offline):

| Facet | Column | Type | Implication |
|-------|--------|------|-------------|
| first name | IMIE | VARCHAR2 | name facet |
| last name | NAZWISKO | VARCHAR2 | name facet |
| employee_number | NR_EWIDENCYJNY | VARCHAR2 | **string**; leading zeros preserved |
| internal_id | ID | NUMBER | ≠ employee_number |

---

## 5. Contracts (design only — not implemented)

### 5.1 `TetaGenericSemanticBindingCandidate`

```
candidateId, conceptKey, roleKey, relationMeaning, valueKind, resultGrain
applicability: { productFamily, productSurface, businessArea, clientScope, versionScope }
temporalPolicy
evidenceBundle, evidenceStrength, independentEvidenceFamilies
priorApprovalRefs[]   # e.g. approved_stage3d_role — NOT counted as independent family
graphSourceHash
ambiguities[], conflicts[], warnings[]
riskClass
requiredDataDomain?, authorizationSensitivity?
candidateFingerprint              # semantic identity only (no actor/decision/approval-policy)
candidateEvaluationFingerprint    # candidateFingerprint + candidateEvaluationPolicyVersion
candidateStatus: proposed | needs_review | insufficient_evidence | conflicting | stale | rejected
```

### 5.1a Fingerprint split

| Fingerprint | Includes | Excludes |
|-------------|----------|----------|
| `candidateFingerprint` | concept/role/meaning/relation/value/grain, evidence bundle + provenance, applicability, temporal, graph/dependency vector | actor, review decision, approval threshold, approval/evaluation policy version |
| `candidateEvaluationFingerprint` | candidateFingerprint + candidateEvaluationPolicyVersion | — |
| `decisionFingerprint` | candidateFingerprint + candidateEvaluationFingerprint + actor + decision + reason + policyVersion + dependencyVector | UI pack formatting |
| approved binding revision fingerprint | substance + evidence + scope + dependency | review-pack UI format alone |

Policy-only change → same `candidateFingerprint`, different `candidateEvaluationFingerprint`.  
Evidence/path/scope/meaning change → different `candidateFingerprint`.

### 5.2 `TetaGenericSemanticBindingDecision`

Allowed: `approve_generic_reuse` | `approve_with_scope` | `request_more_evidence` | `reject` | `defer` | `revoke` | `supersede`

Must include: actor, timestamp, reason, policyVersion, candidateFingerprint, candidateEvaluationFingerprint, dependencyVector, decisionFingerprint.

**Never auto-approve.** Separate from Stage 3J.2E knowledge decisions.

### 5.3 Approved binding substance (Stage 3D) + activation (reuse policy)

Stage 3D may store:

```
approvedBindingId, revision, conceptKey, roleKey
semanticMeaning, resultGrain, relationUsage, valueKind, temporalSemantics
applicability, evidenceRefs, dependencyVector
approvalDecisionRef
status: active | superseded | revoked | stale
```

**Do NOT persist runtime-authoritative `genericReuseAllowed=true` on the binding.**

Generic runtime reuse is active **only** when versioned reuse policy points to:

`approvedBindingId + revision + scope`

Invariant:

```
approvedBindingWithoutReusePolicyPointer → not generic reusable
```

3K.2A `resolveApprovalReuse` reads the policy. Physical Oracle IDs remain **internal**.

### 5.4 Evidence strength classes

| Class | May support human approval? |
|-------|-----------------------------|
| verified_exact | yes |
| verified_composed | yes (with grain/temporal explicit) |
| supported_by_multiple_independent_edges | yes |
| supported_by_single_authoritative_mapping | yes with higher risk threshold |
| inferred | review only; no auto-upgrade |
| heuristic | review only; no auto-upgrade |
| conflicting | block approval |

### 5.5 Provenance families (independent corroboration)

Independent **technical** evidence families (count families, not raw edges):

- `oracle_metadata_ddl`
- `application_form_control`
- `dataset_gateway_join`
- `sqljoin_reconstruction`
- `lookup_display_path`
- `help_semantic_mapping`
- `package_dependency`

**Not an independent family:**

```
priorApprovalReference: { type: approved_stage3d_role, … }
```

Discovery expands Stage 3D approved roles into **underlying** evidence, maps to families, and deduplicates by original observation lineage.  
Do **not** count gateway evidence + `approved_stage3d_role` as two independent proofs.

Invariants: `priorApprovalReferencesCountedAsIndependentEvidence=0`, `duplicateObservationFamiliesCountedAsIndependent=0`.

### 5.6 Risk classes

| Class | Examples | Evidence threshold |
|-------|----------|--------------------|
| normal_reference | position_name display | standard |
| temporal_sensitive | current_position, history | temporal policy mandatory; multi-row policy |
| configuration_sensitive | OU assignment rules | meaning comparison pack |
| payroll_sensitive | base_salary, payroll_result | elevated; not in first pilot |
| identity_sensitive | employee_number, name, internal_id | facet separation mandatory |

### 5.7 Reuse policy update flow (single activation authority)

```
human decision approve_*
  → append decision log
  → record semantic approval / revision on Stage 3D substance (optional metadata)
  → versioned reuse policy entry MUST point to approvedBindingId + revision + scope
  → 3K.2A resolveApprovalReuse reads policy ONLY
```

Without a policy pointer, an approved Stage 3D binding remains **not** generically reusable.  
Policy does **not** copy Oracle mappings. Production stays deny until explicit decision.

### 5.8 Graph revalidation

Pin `graphSourceHash`. On mismatch → `stale`. Fast revalidation may produce a **revalidation candidate** if canonical IDs/path/semantics match — **never silent carry-forward**.

### 5.9 Discovery vs approval

| Discovery may | Discovery must not |
|---------------|--------------------|
| search candidates | choose business meaning without evidence |
| trace paths | approve / write production mapping |
| compare evidence | Oracle SQL execute/generate |
| score quality / conflicts | mutate reuse policy |

---

## 6. Human review pack (UX)

Business-first pack:

1. Business question / meaning  
2. Candidate role  
3. Evidence summary (families, strength)  
4. Scope (e.g. Teta HR)  
5. Risk class  
6. Ambiguities / conflicts  
7. Decision buttons  

Raw graph IDs only in expandable vendor audit detail.

---

## 7. Coverage matrix C01–C23

Outcomes: EVIDENCE_SUFFICIENT_FOR_CANDIDATE | EVIDENCE_PARTIAL | AMBIGUOUS | NO_SEMANTIC_EVIDENCE | GRAPH_ONLY_NOT_SEMANTIC | OUTSIDE_GENERIC_SCOPE  

Approval readiness: READY_FOR_HUMAN_REVIEW | NEEDS_MORE_EVIDENCE | AMBIGUOUS | CONFLICTING | NO_CANDIDATE  

| ID | Role | Graph/semantic evidence | Outcome | Approval readiness | Risk |
|----|------|-------------------------|---------|--------------------|------|
| C01 | employee | Approved Stage 3D source; offline node resolve OK; BHP businessReason | EVIDENCE_SUFFICIENT_FOR_CANDIDATE (generic meaning needs review: BHP-scoped reason) | READY_FOR_HUMAN_REVIEW | normal_reference |
| C02 | employee_identity.name | IMIE+NAZWISKO columns exist; Stage 3D has first/last projections; no composed full-name role | EVIDENCE_PARTIAL | NEEDS_MORE_EVIDENCE (composition policy) | identity_sensitive |
| C03 | employee_identity.employee_number | Approved projection; VARCHAR2 offline | EVIDENCE_SUFFICIENT_FOR_CANDIDATE | READY_FOR_HUMAN_REVIEW | identity_sensitive |
| C04 | employee_identity.internal_id | ID NUMBER column exists; **no Stage 3D role today** | EVIDENCE_PARTIAL | NEEDS_MORE_EVIDENCE | identity_sensitive |
| C05 | current_position | Approved source+relation+temporal; multi-row risk not proven 1:1 | EVIDENCE_PARTIAL | NEEDS_MORE_EVIDENCE (cardinality/tie-break) | temporal_sensitive |
| C06 | position_name | Approved projection+valuePath display NAZWA; not SSTN_ID | EVIDENCE_SUFFICIENT_FOR_CANDIDATE | READY_FOR_HUMAN_REVIEW | normal_reference |
| C07 | position_history | Same assignment table can be historical; **no history role**; must not reuse current temporal | EVIDENCE_PARTIAL | NEEDS_MORE_EVIDENCE | temporal_sensitive |
| C08 | organizational_unit | Dictionary source approved | EVIDENCE_PARTIAL | AMBIGUOUS (which assignment meaning?) | configuration_sensitive |
| C09 | employee_current_organizational_unit | BHP authoritative path = via current_position.JEOR_ID; employee→OU marked not authoritative | AMBIGUOUS | AMBIGUOUS | configuration_sensitive |
| C10 | active_employment | Approved filter_only + temporal; not list root | EVIDENCE_SUFFICIENT_FOR_CANDIDATE (as filter role) | READY_FOR_HUMAN_REVIEW (scoped as filter_only) | temporal_sensitive |
| C11 | employment_contract | Contracts view exists; Stage 3D treats as filter source not subject | GRAPH_ONLY_NOT_SEMANTIC / EVIDENCE_PARTIAL | NEEDS_MORE_EVIDENCE | temporal_sensitive |
| C12 | employment_start_date | DATA_OD on contracts ≠ unique business meaning | AMBIGUOUS | AMBIGUOUS | temporal_sensitive |
| C13 | first_employment_date | No dedicated evidence/role | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | temporal_sensitive |
| C14 | health_examination | Strong BHP approved binding | EVIDENCE_SUFFICIENT_FOR_CANDIDATE (BHP home subject) | READY_FOR_HUMAN_REVIEW (scope=BHP/home) | normal_reference |
| C15 | health_examination_currentness | Current-month temporal ≠ “aktualne na dzień” | AMBIGUOUS | AMBIGUOUS | temporal_sensitive |
| C16 | employee_without_current_health_examination | Needs negative-existence role; must not reuse month-end | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | temporal_sensitive |
| C17 | base_salary | No Stage 3D role; name probe unresolved; 3I/3J not schema evidence | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | payroll_sensitive |
| C18 | payroll_result | Same | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | payroll_sensitive |
| C19 | employee_cost | Same | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | payroll_sensitive |
| C20 | residence_address | No approved semantics; ad-hoc name unresolved | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | identity_sensitive |
| C21 | registered_address | Same | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | identity_sensitive |
| C22 | work_location | Same | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | configuration_sensitive |
| C23 | locality/city display | Same; free column search forbidden | NO_SEMANTIC_EVIDENCE | NO_CANDIDATE | normal_reference |

---

## 8. Domain findings

### Identity
Must expose facets: `name` | `employee_number` | `internal_id`.  
`00122` → employee_number string; never surname; never coerce to internal_id 122.  
Name composition (IMIE+NAZWISKO vs single surface) needs explicit candidate policy.

### Position
Current: assignment card + `current_position_on_oracle_sysdate` + open-ended DATA_DO.  
Display: SSTN_ID → dictionary NAZWA (valuePath).  
History: separate role/grain; never reuse current temporal.  
Multi-current-row possibility: **unproven** → approval blocked until policy stated (fail / ambiguous / ordered selection — not silent FETCH FIRST 1).

### Organizational unit
Two paths: (1) via current_position.JEOR_ID (BHP authoritative for OU **name**), (2) employee→OU supporting bridge marked non-authoritative.  
**Do not promote BHP OU-via-position as universal employee→OU** without human comparison pack.

### Employment
`active_employment` = qualifying filter (EXISTS), not contract list subject.  
`employment_contract` as list-root = missing subject semantics.  
`employment_start_date` vs first employment vs current contract start = separate roles.

### Health examination
Strong BHP home-subject bindings.  
Month-end validity ≠ current-on-date ≠ negative existence.  
Negative existence needs its own role before generic K5 planning readiness.

### Compensation / payroll
No schema semantic evidence in Stage 3D; Stage 3I/3J engines are **not** schema bindings. Keep clarification-only at 3K.1/3K.2A.

### Location / address
No approved multi-type address semantics; speculative view names unresolved. Treat as NO_CANDIDATE until evidence bundle exists per address type.

---

## 9. K1 dependency feasibility

Query target: „Jakie aktualne stanowisko ma pracownik X?”

| Element | Status |
|---------|--------|
| employee | READY (candidate-reviewable; generic reuse not approved) |
| employee identity | MISSING/PARTIAL (number READY candidate; name composition PARTIAL; internal_id PARTIAL) |
| current_position relation | PARTIAL (cardinality/tie-break open) |
| current temporal semantics | READY candidate (exists; must stay role-scoped) |
| position display value | READY candidate |

**Verdict:** K1 is a **feasible pilot target after human review of a small binding set**, not yet planning-ready under deny. Prefer employee_number identity facet for first E2E to avoid name-composition ambiguity.

---

## 10. First human-approval pilot (exactly 4) — do not approve now

Target future query: „Jakie aktualne stanowisko ma pracownik 00122?”

| # | Role | Notes |
|---|------|-------|
| P1 | **employee** | Teta HR root candidate; BHP home subject disclosed |
| P2 | **employee_identity.employee_number** | VARCHAR2 / leading zeros; identity_sensitive |
| P3 | **current_position** | remains **NEEDS_MORE_EVIDENCE** until cardinality / multi-current-row / tie policy resolved; pack may end in `request_more_evidence` |
| P4 | **position_name** | display_business_value via valuePath |

**Not in first pilot pack:** `active_employment` (may be a later candidate; not a K1 dependency), OU, history, compensation, location, negative exam existence.

---

## 11. Business authorization placeholders

Each candidate/approved binding may carry `requiredDataDomain` + `authorizationSensitivity`.  
3K.2A/2B must **not** assert user entitlements. Auth remains a later gate; `executionEligibility` stays separate.

---

## 12. Versioning

See §5.1a. Summary:

- `candidateFingerprint` — semantic identity only  
- `candidateEvaluationFingerprint` — + evaluation policy version  
- `decisionFingerprint` — + actor/decision/reason/policy/dependency  
- approved binding revision fingerprint — substance changes only; **not** UI pack format alone  

Same semantic inputs → same `candidateFingerprint`.

---

## 13. Next implementation slice

### `stage3k2b1_candidate_discovery_and_review_pack`

Offline-only:

1. Candidate contract + fingerprinting  
2. Deterministic discovery from Stage 3A + Stage 3D evidence (no auto-select meaning)  
3. Human review pack generator (`.local` dumps)  
4. Decision contract + append-only decision log schema (empty / no production applies)  
5. Tests for discovery safety + no reuse-policy mutation  

**Explicitly NOT in 3K.2B1:**

- activating `reusableRoles`
- mutating production Stage 3D approvals
- SQL / Oracle / Stage 3C plans
- LLM / Qdrant / embeddings
- auto-approval
- OU/payroll/location pilots

---

## 14. Readiness

**stage3k2bReadiness = `ready_for_candidate_discovery_contract`**

Not `ready_for_limited_human_binding_pilot` until review pack + decision ledger exist.  
Not general `ready`.

---

## 15. Files

Repo (design only):

- `docs/AIA_STAGE3K2B_SEMANTIC_COVERAGE_DESIGN.md`
- `docs/AIA_STAGE3K2B_SEMANTIC_COVERAGE_DESIGN.json`
- `docs/session-context.md`

Local (untracked):

- `.local/stage3k2b-design/*`
