# Stage 3K.2 — Semantic Binding Design / Readiness Review

**Review only — no implementation, no Oracle, no SQL, no model, no commit.**

| Field | Value |
|-------|-------|
| Stage 3K.2 status (entry) | `not_started` |
| Stage 3K.2 readiness | **`ready_for_stage3k2_approved_binding_adapter`** |
| Stage 3K | `started_foundation` |
| Stage 3K.1 | `accepted_offline_foundation` (`0cc5c35`) |
| nextStage (after this review) | `stage3k2a_semantic_binding_contract_and_approved_adapter` |
| HEAD at review | `0cc5c35363c0cf573d7f65a7271685e94c782e15` = `origin/main` |
| Oracle / SQL / model / Qdrant | **0** |

---

## 1. Goal

Design the layer between:

```
Stage 3K.1 LogicalReadonlyRequest
        ↓
Stage 3K.2 semantic binding
        ↓
CanonicalSemanticBindingResult
        ↓
resolved | ambiguous | unresolved | stale | rejected | discovered
        ↓
(later) Stage 3C-compatible planning
```

**Question answered by 3K.2:**  
Does every logical element of the request have a proven business meaning and a physical path in the Teta model?

**Not answered by 3K.2:** QueryPlan, SQL, Oracle SELECT, execution policy, live row auth, chat rewiring.

Hard rule retained from 3K.1: `executionEligibility` never `eligible`; `capabilityStatus=supported` ≠ execute.

---

## 2. Stage 3D audit (real counts)

### Framework vs content

| Layer | Verdict |
|-------|---------|
| **FRAMEWORK** | Generic: status model, loaders, validator, discovery (no auto-approve), `TetaBusinessRoleResolver`, value-path / temporal resolvers, 3C adapter, audit CLI |
| **CONTENT** | **BHP-only**: 1 subject `occupational_health_examinations`; all bindings serve that subject |

**Effective for generic ad-hoc:** behaves like BHP-specific (same as Stage 3K readiness verdict B).

### Counts

| Metric | Count |
|--------|------:|
| Ontology subjects | **1** |
| Unique ontology roleKeys | **26** (+ 2 form roles in bindings only) |
| Approved bindings | **31** |
| Discovered / ambiguous / unresolved / stale / invalid (registry) | **0** |
| Sources | 8 |
| Projections | 8 |
| Relations | 7 |
| Value paths (lookup/display) | 3 |
| Temporals | 3 |
| Forms | 2 |
| `sourceUsage=filter_only` | 1 (`active_employment`) |
| `relation.usage=filter_only` | 1 (`employee_to_active_employment`) |
| `preferDisplayText` projections | 3 (`position_name`, `organizational_unit_name`, `examination_type_name`) |

### Config versions

- Ontology: `teta-aia-business-ontology-v1`
- Bindings: `teta-aia-business-semantic-bindings-v1`
- Language: `teta-aia-business-language-pl-v1`
- Contract: `teta-aia-business-semantics-v1`
- `graphSourceHash`: `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3`

### Binding status enum (reuse — do not fork)

```
SemanticBindingStatus =
  discovered | approved | ambiguous | unresolved | rejected | stale | invalid
```

### Concept coverage vs Stage 3K.1

| Concept / surface | In Stage 3D content? | Notes |
|-------------------|----------------------|-------|
| employee | yes | source + identity projections |
| position | as `current_position` only | **not** bare `position`; **not** history |
| organizational_unit | yes | enrichment; authoritative display via **current_position** |
| active_employment | yes | **filter_only** |
| health_examination | yes | report grain for BHP template |
| employment_contract | **no** | only via active employment → contracts view |
| employment_date | **no** | |
| compensation | **no** | |
| location / address | **no** | |
| department | **no** | |
| position_history | **no** | |
| negative_existence (exam) | **no** dedicated role | |

### Paths that must NOT become generic defaults

- OU via `current_position` (BHP enrichment path) ≠ generic “employee in unit X”
- `employee_to_organizational_unit` marked `projectionUsage=not_used_for_this_projection` in BHP content
- `examination_valid_to_in_current_month` ≠ “employees without current exams”
- `current_position` ≠ position history

---

## 3. Stage 3A graph audit (offline)

| Item | Status |
|------|--------|
| Local SQLite index | **AVAILABLE** `.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite` (~2.3 GB) |
| `sourceHash` / `graphSourceHash` | `2e7f0b7e…f73c3` (matches 3D bindings pin) |
| Nodes / edges | 864 320 / 992 993 |
| Conflicts (unresolved) | 5 432 (mostly `oracle_owner_conflict`) |
| DISPLAYS_FROM / BINDS_LOOKUP | 834 / 834 |
| Temporal as first-class graph | **No** — temporal lives in Stage 3D bindings |
| Public HTTP API | **None** — library + CLI only |
| Offline evidence APIs | `CanonicalGraphResolverService` resolve/trace/subgraph; 3D/3C thin clients |

**For 3K.2 design:** may store canonical node/edge/path IDs internally; must not copy raw SQL or user-visible Oracle metadata into public DTOs.

---

## 4. Proposed contracts (design only)

**Contract family:** `teta-aia-generic-semantic-binding-v1`

### A. `TetaGenericSemanticBindingRequest`

| Purpose | Wrap a Stage 3K.1 analysis / logical request for offline binding |
| Fields | `contractVersion`, `analysisResultRef` / inline `LogicalReadonlyRequest`, `inputFingerprintSha256`, `policyVersion`, `dependencyVector` (expected), `options` (e.g. `allowDiscoveredInDiagnostics`) |
| Boundary | Server-side only |

### B. `TetaGenericSemanticBindingResult`

| Purpose | Canonical output of 3K.2 |
| Fields | `contractVersion`, `resultStatus` (`semantically_bound` \| `partially_bound` \| `needs_clarification` \| `unresolved` \| `delegated` \| `rejected`), `rootBinding`, `fieldBindings[]`, `filterBindings[]`, `relationBindings[]`, `temporalBinding`, `aggregationTargets[]`, `orderingTarget`, `resultGrain`, `clarifications[]`, `warnings[]`, `executionEligibility: 'not_evaluated'`, fingerprints, `dependencyVector` |
| Note | Delegated/rejected 3K.1 analyses → `resultStatus` delegated/rejected, **no element bindings** |

### C. `TetaSemanticElementBinding`

Minimum fields (aligned with Stage 3D naming):

```
logicalElementId
surfaceText
surfaceMeaningKey          # from 3K.1; may be null
requestedConceptKey        # from 3K.1 conceptKey; may be null

resolvedBusinessConceptKey # ontology/business concept if bound
resolvedRoleKey            # Stage 3D roleKey when applicable

bindingStatus              # SemanticBindingStatus (+ optional 'invalid')
evidenceStatus             # proven | partial | missing | conflicting
selectionRequired
applicability              # productFamily / businessArea / clientScope hooks (placeholders)
temporalSemantics          # role-scoped; not global-only
relationUsage              # row_producing | filter_only | lookup_display | temporal_qualifier | supporting_only | null
valueKind                  # business_value | foreign_key_identity | display_business_value | null

graphEvidenceRefs[]        # INTERNAL ids only
approvedBindingRefs[]      # Stage 3D binding ids/role keys
warnings[]
requiredAuthorizationScopes[]   # placeholders; not evaluated
requiredDataDomains[]
```

### D. `TetaSemanticClarification`

Human-facing candidates: business concept, role, label, why plausible, evidenceStatus, scope, temporal meaning. **No Oracle names.** No auto-select among multiple approved business-correct candidates.

### E. `TetaSemanticEvidenceTrace` (audit DTO)

Internal: path IDs, edge IDs, binding IDs, conflict views, hashes, reasons. **Never sent to browser/client.**

### F. `TetaSemanticBindingPolicy`

Precedence: approved-only for planning candidates; discovered diagnostics-only; never auto-approve; surfaceMeaningKey never invents canonical concepts; BHP subject grain must not be assumed for generic requests; `executionEligibility` fixed `not_evaluated`.

### G. `TetaSemanticBindingCapabilityManifest`

Declares which 3K.1 capabilities / surfaces the adapter can bind today vs leave unresolved (versioned).

---

## 5. Core principles

1. **Concept recognition ≠ semantic binding.** `conceptKey=employee` in 3K.1 does not imply an approved path to fetch the employee.
2. **Lexicon match ≠ physical mapping.**
3. **Approved vs discovered:** only `approved` may later be a deterministic planning candidate; discovered is diagnostics-only.
4. **No auto-approve.**
5. **Knowledge claim approval (3J.2E) ≠ semantic schema binding approval (3D/3K.2).**
6. **Internal evidence ≠ public logical request.**

---

## 6. Surface meaning resolution flow

```
surfaceMeaningKey
    ↓
candidate business concepts / roles (from ontology + language + policy)
    ↓
0 candidates     → unresolved
1 approved       → resolved (bindingStatus=approved)
>1 plausible     → ambiguous (clarification)
discovered-only  → discovered (not executable / not planning-ready)
```

Stage 3K.2 **must not** introduce new canonical business concepts.

Surfaces from 3K.1: `employment_date`, `compensation`, `location`, `department`, `employee_identity`.

---

## 7. Identity model (recommendation)

Stage 3K.1: `employee_identity` / `matches_identity` / `rawText` / leading-zero strings.

Proposed semantic identity slots (design):

| Slot | Meaning | Notes |
|------|---------|-------|
| `employee_identity.name` | person name surface | may be ambiguous (homonyms) |
| `employee_identity.employee_number` | ewidencyjny / badge | **string**; preserve leading zeros (`00122`) |
| `employee_identity.internal_id` | opaque internal id | only if explicitly indicated |

Rules:

- Do **not** map to Oracle columns in 3K.2 public contract.
- Reuse Stage 3D projections `employee_number`, `employee_first_name`, `employee_last_name` as **approved identity facets** when binding under employee source — still not execution.
- Query `pracownik 00122` → number slot; never guess surname.
- Stage 3J.1 lexicon may hint `employee_number` subject — recognition only.

---

## 8. Temporal model (recommendation)

Reuse Stage 3D temporal types:

- `half_open_date_interval`
- `effective_on_date`
- clock: `oracle_sysdate` (internal)

**Temporal is role-scoped**, not only global `temporalScope` from 3K.1:

| Logical temporal | Needs |
|------------------|-------|
| current position | `current_position_on_oracle_sysdate` (exists, BHP content) |
| current contract / active employment | `employee_active_on_oracle_sysdate` |
| exam validity current month | BHP-specific; **not** for K5 negative existence |
| history | **MISSING** role (no `position_history`) |
| as_of / date_range | framework exists; content mostly absent for generic |

Public binding may carry `temporalRoleKey` + `effectiveDatePolicyRef` — **not** raw `DATA_OD`/`DATA_DO`.

---

## 9. Lookup / display model

Reuse Stage 3D:

- `preferDisplayText`
- valuePaths ending on display column (reject ID endpoints)
- Stage 3A `DISPLAYS_FROM` / lookup paths as **internal evidence**, not public

Planner later must know: `valueRequestedValue = display_business_value` for “stanowisko” / “jednostka” names.

---

## 10. Relation semantics

Reuse Stage 3D:

- `row_producing` | `filter_only`
- `rowSemantics=exists`, `preservesReportGrain`

Extend in 3K.2 element binding (classification only):

- `lookup_display`
- `temporal_qualifier`
- `supporting_only`

**K2:** do not pick shortest graph path; do not silently reuse BHP OU-via-position as generic employee→OU approved relation without a dedicated approved generic role.

**K5:** negative existence must preserve **employee** grain (not exam-row grain of BHP report).

---

## 11. Grain model

Reuse Stage 3C/3D notion of `reportGrain` as **business-level** `resultGrain` (not Oracle tables).

| Fixture | Suggested resultGrain |
|---------|----------------------|
| K1 | `employee` |
| K4 | `position_history_record` (concept missing) |
| K5 | `employee` |
| K6 | `organizational_unit_group` (or unresolved department group) |
| K7 | `employment_contract` (concept missing as subject) |
| BHP dedicated report | `health_examination` (existing template) |

---

## 12. Ambiguity model

First-class `TetaSemanticClarification` / candidates. No Oracle in labels. No score-based auto-select when ≥2 approved business-correct candidates.

---

## 13. Staleness / dependency vector

```
{
  graphSourceHash,
  ontologyVersion,
  semanticBindingsVersion,
  businessLanguageVersion,
  lexiconVersion?,          # if used for identity hints
  stage3k1ContractVersion,
  stage3k2BindingContractVersion
}
```

Fingerprints:

- `semanticBindingInputFingerprint` — request + policy + dependency vector
- `semanticBindingResultFingerprint` — stable stringify of public result (no timestamps, paths, machine ids)

`graphSourceHash` change → approved bindings become `stale` (same rule as Stage 3D resolver).

---

## 14. Runtime vs audit DTO

| DTO | Contents |
|-----|----------|
| Runtime | statuses, role/concept keys, clarifications, grain, warnings; no verbose provenance |
| Audit trace | node/edge/path IDs, conflicts, hashes, reasons — server-only |

---

## 15. Readiness matrix

| Element | Status | Reason |
|---------|--------|--------|
| employee | READY_WITH_RESTRICTIONS | Approved source under BHP subject; reusable as role but subject context is BHP |
| employee_identity | READY_WITH_RESTRICTIONS | Projections exist; identity slots not formalized as 3K.2 roles yet |
| position | AMBIGUOUS / MISSING_CONCEPT | Only `current_position`; bare `position` absent |
| position_name | READY_APPROVED | Value path + preferDisplayText (BHP content) |
| position_history | MISSING_BINDING | No history role; current_position must not substitute |
| organizational_unit | READY_WITH_RESTRICTIONS | Exists; generic emp→OU not approved for projection |
| active_employment | READY_WITH_RESTRICTIONS | filter_only + temporal |
| employment_contract | MISSING_CONCEPT | No ontology subject/role as list root |
| employment_date | MISSING_BINDING | Surface only in 3K.1 |
| health_examination | READY_WITH_RESTRICTIONS | Approved; grain is exam-centric for BHP |
| health_examination_currentness | AMBIGUOUS | Current-month expiry ≠ absence of current exam |
| department | UNRESOLVED | Surface; OU is candidate only with evidence |
| compensation | MISSING_CONCEPT | Unbound meanings in 3K.1 clarification |
| location/address | MISSING_CONCEPT | Graph may have columns; no approved semantics |

---

## 16. K1–K12 design verdicts

| ID | Logical (3K.1) | Semantic readiness | Expected 3K.2 outcome |
|----|----------------|--------------------|------------------------|
| K1 | resolved / supported / not_evaluated | Partial: employee + current_position + display name + identity facets | `partially_bound` or `needs_clarification` if identity ambiguity |
| K2 | resolved / unsupported filter_equals | OU path ambiguous / BHP-specific | `needs_clarification` or `unresolved` for relation |
| K3 | needs_clarification / unsupported | employment_date missing; active_employment filter_only exists | `needs_clarification` |
| K4 | resolved / history unsupported | position_history missing | `unresolved` (history) |
| K5 | resolved / negative_existence unsupported | exam exists; negative-existence path not approved | `unresolved` or `partially_bound` without executable absence |
| K6 | needs_clarification aggregate | department unresolved; aggregate out of scope for binding | `needs_clarification` |
| K7 | unresolved top-N contracts | employment_contract missing | `unresolved` |
| K8–K10 | delegated | Do not bind | `delegated` |
| K11 | needs_clarification compensation | no compensation roles | `needs_clarification` / `unresolved` |
| K12 | unresolved location | no location semantics | `unresolved` |
| N1–N5 | rejected | Do not bind | `rejected` |

No fixture is `semantically_bound` end-to-end for **generic** planning with today’s content alone (K1 closest under restrictions).

---

## 17. What can reuse Stage 3D directly

- `SemanticBindingStatus` enum
- Source / projection / relation / valuePath / temporal binding shapes
- `filter_only` / `row_producing` / `preservesReportGrain`
- Value-path display rules (no ID endpoints)
- Temporal AST types + stale-on-`graphSourceHash` mismatch
- Role resolver machinery (subject-scoped today)
- Graph client `getNodeById` / `resolveNode` for evidence validation

---

## 18. What must NOT be reused generically

- Subject `occupational_health_examinations` as default grain for all ad-hoc queries
- OU-via-`current_position` as the generic employee→OU relation
- Current-month exam validity as “no current exam”
- `current_position` as history
- BHP form bindings as Help/routing substitutes
- Stage 3I/3J payroll engines as automatic compensation semantic bindings
- 3J.2E knowledge approvals as Oracle mapping approvals
- Auto-promoting discovered graph paths to approved

---

## 19. Missing semantics (priority)

1. Generic `position` vs `current_position` vs `position_history`
2. Generic employee→OU relation (approved, non-BHP-grain)
3. `employment_contract` as list/root subject
4. `employment_date` roles (first vs current contract start)
5. Negative existence / currentness for health examinations (employee grain)
6. Compensation / payroll-result semantic roles (schema, not engine)
7. Location / address / city residence vs work
8. Formal `employee_identity.*` slots in ontology
9. as_of / date_range content beyond BHP clocks

---

## 20. First implementation slice (exactly one)

### Stage 3K.2A — Generic Semantic Binding Contract + Approved Stage 3D Adapter

**In scope:**

- Introduce `teta-aia-generic-semantic-binding-v1` types + offline builder from 3K.1 analysis
- Adapter that maps logical elements → **existing approved** Stage 3D roles when role keys clearly match
- Otherwise emit `unresolved` / `ambiguous` / clarifications
- Dependency vector + fingerprints + staleness hooks
- Runtime result vs internal evidence trace split
- Offline tests/fixtures against K1–K12 / N1–N5 (no Oracle)

**Out of scope (explicitly NOT to build):**

- New Oracle mappings / ontology mass expansion
- Auto-approve discovered
- SQL / QueryPlan / executor / chat rewiring
- Model / Qdrant / embeddings
- Business authorization evaluation
- `executionEligibility=eligible`
- Treating BHP grain as generic default

---

## 21. Readiness decision

**`ready_for_stage3k2_approved_binding_adapter`**

Rationale:

- 3K.1 foundation accepted
- 3D framework + 31 approved bindings + pinned graph hash available offline
- Graph index present for evidence refs
- Content gaps are large, but an approved-only adapter that mostly returns unresolved/partial is still a correct next slice
- **Not** `ready_for_stage3k2_limited_semantic_pilot` (no live/chat pilot)
- **Not** bare `ready`

Live generic execution remains blocked by: business auth, missing generic bindings, Stage 3C expressiveness, unsupported capabilities, legacy LLM→SQL.

---

## 22. Explicit non-goals reminder

Do not implement Stage 3K.2 in this review. Do not commit. Do not open Oracle/SQL/model/Qdrant.
