# Stage 3K Readiness Review — Generic Ad-hoc Query Model

**Status:** `ready_for_stage3k_foundation`  
**Implementation:** not started  
**Review HEAD:** `4276c2c487a78655abc1ac6a77374c7c3d381b2f` (`main` = `origin/main`, clean)  
**Oracle / model / Qdrant / embeddings / SQL execution in this review:** none

## Verdict (one paragraph)

Existing Stages **3A–3H** already implement the *shape* required for a safe Generic Ad-hoc Query Model (graph evidence → semantic roles → typed readonly plan → deterministic SELECT compiler → readonly executor), and Stage **3J.2F** already covers runtime knowledge retrieval—so Stage 3K must **not** be treated as RAG/knowledge. Content and gates are still **BHP-template-scoped**; the plan/compiler lack general predicates, aggregates, history subjects, and pagination; **business row authorization is deferred**; and chat still has a **legacy LLM→SQL** escape hatch. Foundations are therefore sufficient to start an **offline foundation slice** (logical request model + intent + routing fences) without live Oracle—not a live generic pilot and not a blank-check “ready”.

Stage 3J.2E approved registry/content counts are **not** the sole readiness gate for 3K.

### Interpretive notes (accepted)

- **Q8 READY_WITH_RESTRICTIONS** reflects the existing **BHP-bound** cross-domain report path only; it does **not** mean generic cross-domain readiness.
- **Q9 READY_WITH_RESTRICTIONS** reflects dedicated Stage **3I/3J** payroll engines; it does **not** mean generic payroll query readiness.
- Stage **3J.2E** approved content count is **not** a standalone Stage 3K gate.
- Business authorization **NOT_READY** blocks production generic **live** querying, but does **not** block offline Stage **3K.1** foundation work.

---

## What Stage 3K is / is not

| Is | Is not |
|----|--------|
| Generic Ad-hoc Query Model for structured client data | Client knowledge pack |
| Safe read-only report/query without blind LLM SQL | RAG / docs Q&A |
| Intent → logical request → graph evidence → plan → compile → execute | Approval-knowledge or source-backed prose generation (that is 3J.2E/3J.2F) |

**Target pipeline (must keep):**  
user language → intent / result shape → entity+attribute resolution → graph-backed semantic evidence → deterministic logical query plan → deterministic SQL compiler → readonly executor.

**Forbidden:** question → LLM invents SQL → execute.

---

## Dependency verdicts (A–J)

| ID | Area | Verdict |
|----|------|---------|
| A | Canonical graph | **READY** |
| B | Polish language resolution | **PARTIAL** |
| C | Business semantics | **PARTIAL** |
| D | Generic query-plan expressiveness | **PARTIAL** |
| E | Deterministic compiler | **PARTIAL** |
| F | Read-only executor | **READY** |
| G | Chat routing | **PARTIAL** |
| H | Business authorization | **NOT_READY** |
| I | Ambiguity handling | **PARTIAL** |
| J | Temporal / currentness | **PARTIAL** |

---

## Stage 3C capability matrix (`teta-aia-readonly-query-plan-v1`)

Evidence: `apps/api/src/teta-query-planner/teta-query-plan.types.ts`, planners, `teta-query-safety-policy-v1.json`, `teta-stage3c.spec.ts`. Gate: intent `build_employee_report` + subject `occupational_health_examinations` only.

### Sources

| Capability | Status |
|------------|--------|
| Single source | SUPPORTED |
| Multiple sources | SUPPORTED |
| Row-producing | SUPPORTED |
| Filter-only | SUPPORTED |
| Arbitrary graph-backed join tree | PARTIAL (template + approved relations; not free-form user joins) |
| Optional / LEFT | SUPPORTED |
| Existence | SUPPORTED |

### Projection

| Capability | Status |
|------------|--------|
| Raw field | SUPPORTED |
| Lookup / display | SUPPORTED |
| Aliases | PARTIAL (`displayLabel`, not full SQL AS model) |
| Computed expression | NOT_SUPPORTED |
| Multiple projections | SUPPORTED |
| Duplicate logical fields | NOT_SUPPORTED |

### Filters

| Capability | Status |
|------------|--------|
| Equality | PARTIAL (join/existence `equals`; no general value-eq filter AST) |
| Inequality | NOT_SUPPORTED |
| > >= < <= | PARTIAL (inside `effective_on_date` only) |
| BETWEEN / date range | SUPPORTED (`half_open_date_interval` + 3H rewrites) |
| IN / NOT IN | NOT_SUPPORTED |
| IS NULL / IS NOT NULL | PARTIAL (via `*_or_null` operators, not first-class filters) |
| LIKE / contains / prefix | NOT_SUPPORTED |
| Case-insensitive string | NOT_SUPPORTED |
| AND | PARTIAL (implicit flat list) |
| OR / nested boolean | NOT_SUPPORTED |
| Relative dates | SUPPORTED |
| Effective-date / current-record | SUPPORTED |
| User literals as binds | PARTIAL (policy requires binds; general bind map not first-class on 3C plan) |

### Result operations

| Capability | Status |
|------------|--------|
| ORDER BY ASC/DESC | SUPPORTED |
| NULLS FIRST/LAST | NOT_SUPPORTED |
| LIMIT / FETCH | PARTIAL (safety `maxRows=500` only) |
| TOP-N | PARTIAL (same cap; not ranked TOP-N AST) |
| DISTINCT | NOT_SUPPORTED |
| COUNT / SUM / AVG / MIN / MAX | NOT_SUPPORTED |
| GROUP BY / HAVING | NOT_SUPPORTED |
| Pagination | NOT_SUPPORTED |

---

## Stage 3E capability matrix (`teta-aia-oracle-select-v1`)

Compiler supports the BHP plan shape end-to-end: access-object sources, INNER/LEFT equality joins, column projections, half-open / rolling / explicit / effective_on filters, correlated EXISTS, binds, ORDER BY, `FETCH FIRST`. It rejects cycles, self-joins, cartesian, RIGHT joins, DISTINCT/WITH/IN-subqueries, aggregates, and non-BHP intent/subject.

| Capability family | plannerSupport | compilerSupport | executorCompatible | tested | liveProven |
|-------------------|----------------|-----------------|--------------------|--------|------------|
| Multi-source INNER/LEFT equals tree | SUPPORTED | SUPPORTED | yes | yes | yes (BHP) |
| Filter-only + correlated EXISTS | SUPPORTED | SUPPORTED | yes | yes | yes |
| Half-open month interval | SUPPORTED | SUPPORTED | yes | yes | yes |
| Rolling / explicit date interval | PARTIAL (3H rewrite) | SUPPORTED | yes | yes | explicit yes; rolling no |
| Effective-on DATA_OD/DO | SUPPORTED | SUPPORTED | yes | yes | yes |
| `user_literal_equals` binds | NOT_SUPPORTED in 3C | SUPPORTED (3E extension) | yes | yes | no |
| Aggregates / GROUP BY / HAVING / DISTINCT / pagination | NOT_SUPPORTED | NOT_SUPPORTED | no | no | no |
| General LIKE / IN / OR trees | NOT_SUPPORTED | NOT_SUPPORTED | no | no | no |

**Rule:** planner-only or compiler-only support does **not** count as Stage 3K end-to-end.

---

## Semantic coverage (Stage 3D)

**Verdict: B — framework generic, content mostly BHP** (for generic ad-hoc behaviorally close to **C**).

| Metric | Value |
|--------|------:|
| Ontology subjects | **1** (`occupational_health_examinations`) |
| Approved bindings | **31** (8+8+7+3+3+2) |
| Unresolved / ambiguous in-subject | **0 / 0** |
| Stage 3C/3E/3F gate | BHP report only |

Roles of interest: pracownik/stanowisko/JO/umowa(as filter)/BHP **bound**; firma/dział/nieobecność/urlop/wynagrodzenie/składnik/wykształcenie/adres/staż/przełożony **missing** from 3D.

---

## Graph path tests A–H (offline only)

| Case | Result |
|------|--------|
| A current position name | Deterministic **only** with approved binding; raw graph highly ambiguous |
| B organizational unit | Same |
| C position history | Graph evidence exists; **no** ontology history subject → not deterministic for 3K |
| D BHP exam type | Ready for approved BHP subject |
| E education | Partial raw evidence; unresolved semantically |
| F address | **Not ready** (broken/mislinked grain in graph evidence) |
| G contracts | Bound as **filter_only** EXISTS qualifier, not list subject |
| H payroll components | Graph + 3I/3J exist; **not** wired into 3D query semantics |

---

## Language phrase tests

| Phrase | Class |
|--------|-------|
| aktualne stanowisko | resolved (BHP business language / role) |
| nazwa stanowiska | resolved |
| dział pracownika | ambiguous |
| jednostka organizacyjna | resolved |
| data zatrudnienia | ambiguous |
| pracownicy zatrudnieni po 1 stycznia | ambiguous |
| pracownicy bez aktualnych badań | multi_domain |
| historia stanowisk | ambiguous |
| ile osób pracuje w każdym dziale | unresolved |
| pracownicy z Warszawy | unresolved |
| pokaż 10 najnowszych umów | unresolved |

Stage 3J.1: 11 registered domains, but only **4** approved lexicon concepts (2 HR + 2 payroll). Help surface is large; auto-approved Help concepts for routing = **0**.

---

## Intent / read-shape / routing

- Closed `PlannerIntentType` union has **no** `generic_readonly_query` today.
- Adding it is feasible without breaking BHP if catalog scores stay distinct and 3G/3F gates remain subject-locked until generalized deliberately.
- Desired structured shape `{ entity, projections, filters, relations, temporalScope, grouping, aggregations, ordering, limit }` is **only partially** representable in current plan AST (no grouping/aggregations/general filters).
- **Actual chat order:** payroll 3J → canonical BHP → classify route → help/llm_only/clarify → plugin → **LLM SQL loop**.
- **3J.2F is not wired into chat.**
- **Generic fallback can bypass the deterministic planner** (`oracle-agent.service.ts` `answer.sql`).

Proposed precedence (target for 3K design): dedicated → payroll → Help → 3J.2F knowledge → `generic_readonly_query` → clarification/unsupported.

---

## Ambiguity model

| Layer | Support |
|-------|---------|
| 3A | `resolved \| ambiguous \| unresolved \| conflicting` — no auto-resolve |
| 3B | `needs_clarification`, clarification questions |
| 3C | maps to `needs_user_clarification` / `needs_selection` |
| 3D | binding `ambiguous`/`unresolved`; sparse clarification hints |

**Reusable:** clarification/selection plumbing.  
**Gap:** few multi-meaning candidate catalogs for generic HR phrases (“dział”, “data zatrudnienia”, “wynagrodzenie”).

---

## Currentness / historical semantics

Formalized (mostly BHP/sysdate): `effective_on_date`, open-ended `DATA_DO`, half-open/rolling/explicit periods (3H), current position vs historical leak guard on approved path.

**Not formalized for generic 3K:** as-of parameter as first-class ontology, history-list subjects, automatic choice between “current” vs “full history” from language alone.

---

## Access & security

| Layer | Status |
|-------|--------|
| Technical SQL safety (3C/3E/3F) | SELECT-only, no `*`, binds, no dblink/FOR UPDATE/PLSQL/hints/comments, row/column/timeout caps | **READY** |
| Business data authorization | `authorization.status=deferred`, `filtersApplied=false`, assumed `TETA_ADMIN` | **NOT_READY** |

**Production blocker for generic querying:** system does not yet know which firms/employees/OUs the logged user may see. Technical safety ≠ business authorization.

---

## Query classes Q1–Q10

| Class | Readiness | Notes |
|-------|-----------|-------|
| Q1 lookup | READY_WITH_RESTRICTIONS | Only via dedicated/bound paths; not open generic |
| Q2 list | NOT_READY | No generic employee-list subject/template |
| Q3 multi-filter | NOT_READY | Missing general predicates + city/date semantics |
| Q4 history | NOT_READY | No history subject |
| Q5 negative/existence | READY_WITH_RESTRICTIONS | EXISTS pattern proven for BHP |
| Q6 aggregate | NOT_READY | No GROUP BY/COUNT in plan+compiler |
| Q7 top-N | NOT_READY | Only safety maxRows |
| Q8 cross-domain | READY_WITH_RESTRICTIONS | BHP report already joins employee+exam+position+OU |
| Q9 payroll | READY_WITH_RESTRICTIONS | Dedicated 3I/3J engine; not 3D ad-hoc |
| Q10 ambiguous | READY_WITH_RESTRICTIONS | Clarification contracts exist; generic candidate catalogs thin |

---

## Legacy LLM→SQL audit

| Path | LLM writes SQL? | Chat-wired? | Bypass planner? |
|------|-----------------|-------------|-----------------|
| Canonical 3B→3F | No | Yes | No (when matched) |
| Plugin/metadata SQL | No | Yes | Yes vs 3B–3E |
| **LLM `answer.sql` loop** | **Yes** | **Yes** | **Yes** |
| `call_procedure` tool | PL/SQL | If env allowlist on | Yes |
| 3J.2F knowledge | No SQL | Bridge exists; **not in chat** | n/a |

Stage 3K should **fence or deprecate** the LLM SQL path as the generic fallback, not extend it.

---

## Recommended first slice — Stage 3K.1

**Title:** Generic Read-Only Query Intent & Logical Request Model

| | |
|--|--|
| **Goal** | Offline contract from PL utterance → structured logical readonly request + clarification, with routing precedence vs dedicated/payroll/knowledge/legacy |
| **Inputs** | Utterance; 3B intent framework; 3J.1 lexicon; 3D shapes; 3A resolve statuses (offline) |
| **Outputs** | `generic_readonly_query` type/catalog proposal; `LogicalReadonlyRequest`; clarification candidates; routing contract; offline fixtures |
| **Reuse** | 3A–3D frameworks, 3B statuses, safety-policy *shape*, 3G short-circuit pattern |
| **Non-goals** | Oracle, SQL compile/execute, LLM SQL, opening 3C/3E/3F to all subjects, all Q-classes, row-auth product, replacing 3A–3H |

### Acceptance cases (offline, illustrative)

1. Dedicated BHP/payroll questions still classify away from generic.
2. Ambiguous “dział pracownika” → `needs_clarification` with ≥2 candidates (no auto-pick).
3. Aggregate “ile osób… w każdym dziale” → `unsupported` / explicit gap (no fake plan).
4. Knowledge/help-shaped questions do not become generic readonly.
5. No SQL text, no Oracle connect, no model call in the slice.

---

## Explicitly do **not** build yet

- Live Oracle generic pilot  
- Arbitrary LLM SQL  
- Aggregate/GROUP BY compiler work as first slice  
- Full multi-subject ontology population in one go  
- Business row-authorization product (design dependency, later)  
- Address/education subjects without graph repair  
- Silent deletion of legacy agent without a migration fence  

---

## Boundaries observed in this review

`oracleConnections=0`, `sqlExecuted=0`, `localModelCalls=0`, `remoteModelCalls=0`, `qdrantCalls=0`, `embeddingCalls=0`, production code unchanged.
