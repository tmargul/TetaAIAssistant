# AIA Oracle SELECT Compiler — Stage 3E

Generated: 2026-07-25T07:20:53.371Z

## Summary

| Field | Value |
|-------|-------|
| Contract | `teta-aia-oracle-select-v1` |
| Dialect | `oracle19c` |
| Source plan contract | `teta-aia-readonly-query-plan-v1` |
| Stage 3D bindings | `teta-aia-business-semantic-bindings-v1` |
| Graph hash | `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3` |
| Graph index schema | `teta-aia-graph-index-v1` |
| Live source planStatus | `ready_for_compilation` |
| Live compileStatus | `compiled` |
| Live `sqlSha256` | `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` |
| Live SQL lines | 28 |
| Report grain | `health_examination` |
| Sources (row-producing / filter-only) | 6 / 1 |
| Main join tree edges | 5 |
| Existence filters | 1 |
| Projections / predicates / ordering | 8 / 5 / 3 |
| Binds | 0 |
| Access column remaps | 8 |
| Validation ok | true |
| References passed | 13 / 13 |
| Deterministic | true |
| SQL artifact hash / text mismatches | 0 / 0 |
| Session-context hash mismatch | 0 |
| Typecheck errors | 0 |
| Strict errors | 0 |

## Live compiled SQL (Reference A)

Question: _Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu._

```sql
SELECT
  S01.NR_EWIDENCYJNY AS EMPLOYEE_NUMBER,
  S01.IMIE AS EMPLOYEE_FIRST_NAME,
  S01.NAZWISKO AS EMPLOYEE_LAST_NAME,
  S03.NAZWA AS EXAMINATION_TYPE_NAME,
  S02.DATA_WYKONANIA AS EXAMINATION_VALID_FROM,
  S02.DATA_WAZNOSCI AS EXAMINATION_VALID_TO,
  S06.NAZWA AS POSITION_NAME,
  S05.NAZWA AS ORGANIZATIONAL_UNIT_NAME
FROM TETA_ADMIN_P.NT_KP_PRC_PRACOWNICY S01
INNER JOIN TETA_ADMIN_P.NT_KP_KDR_BADANIA_BHP S02 ON S02.PRAC_ID = S01.ID
INNER JOIN TETA_ADMIN.NT_KP_SLO_BADANIA_BHP S03 ON S02.SLB_ID = S03.ID
LEFT JOIN TETA_ADMIN.NT_KP_KDR_STANOWISKA S04 ON S01.ID = S04.PRAC_ID
  AND S04.DATA_OD <= SYSDATE
  AND (S04.DATA_DO IS NULL OR S04.DATA_DO >= SYSDATE)
LEFT JOIN TETA_ADMIN.NT_PA_SLO_JEDNOSTKI_ORG S05 ON S04.JEOR_ID = S05.ID
LEFT JOIN TETA_ADMIN.NT_KP_SLO_STANOWISKA S06 ON S04.SSTN_ID = S06.ID
WHERE S02.DATA_WAZNOSCI >= TRUNC(SYSDATE,'MM')
  AND S02.DATA_WAZNOSCI < ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)
  AND EXISTS (
    SELECT 1
    FROM TETA_ADMIN.NT_KP_KDR_UMOWY_O_PRACE E01
    WHERE E01.PRAC_ID = S01.ID
      AND E01.DATA_OD <= SYSDATE
      AND (E01.DATA_DO IS NULL OR E01.DATA_DO >= SYSDATE)
  )
ORDER BY S02.DATA_WAZNOSCI ASC, S01.NAZWISKO ASC, S01.IMIE ASC
FETCH FIRST 500 ROWS ONLY
```

`sqlSha256` = `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` (sha256 of the UTF-8 statement text, no trailing newline)

## Sources (access objects only)

`row_source` entries appear in FROM/JOIN; `filter_only` entries exist only inside a correlated
EXISTS and use the separate `E` alias space.

| Alias | Role | Usage | Access object | Logical object | Enrichment |
|-------|------|-------|---------------|----------------|------------|
| S01 | `employee` | `row_source` | `TETA_ADMIN_P.NT_KP_PRC_PRACOWNICY` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY` | no |
| S02 | `health_examination` | `row_source` | `TETA_ADMIN_P.NT_KP_KDR_BADANIA_BHP` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_BADANIA_BHP` | no |
| S03 | `examination_type` | `row_source` | `TETA_ADMIN.NT_KP_SLO_BADANIA_BHP` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_SLO_BADANIA_BHP` | no |
| S04 | `current_position` | `row_source` | `TETA_ADMIN.NT_KP_KDR_STANOWISKA` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_STANOWISKA` | yes |
| S05 | `organizational_unit` | `row_source` | `TETA_ADMIN.NT_PA_SLO_JEDNOSTKI_ORG` | `oracle-object:TETA_ADMIN:VIEW:NT_PA_SLO_JEDNOSTKI_ORG` | yes |
| E01 | `active_employment` | `filter_only` | `TETA_ADMIN.NT_KP_KDR_UMOWY_O_PRACE` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_UMOWY_O_PRACE` | no |
| S06 | `position_dictionary` | `row_source` | `TETA_ADMIN.NT_KP_SLO_STANOWISKA` | `oracle-object:TETA_ADMIN:VIEW:NT_KP_SLO_STANOWISKA` | no |

## Projections

| # | Business role | Expression | Result alias | Label |
|---|---------------|-----------|--------------|-------|
| 1 | `employee_number` | `S01.NR_EWIDENCYJNY` | `EMPLOYEE_NUMBER` | Numer ewidencyjny |
| 2 | `employee_first_name` | `S01.IMIE` | `EMPLOYEE_FIRST_NAME` | Imię |
| 3 | `employee_last_name` | `S01.NAZWISKO` | `EMPLOYEE_LAST_NAME` | Nazwisko |
| 4 | `examination_type_name` | `S03.NAZWA` | `EXAMINATION_TYPE_NAME` | Rodzaj badania |
| 5 | `examination_valid_from` | `S02.DATA_WYKONANIA` | `EXAMINATION_VALID_FROM` | Data od |
| 6 | `examination_valid_to` | `S02.DATA_WAZNOSCI` | `EXAMINATION_VALID_TO` | Data do |
| 7 | `position_name` | `S06.NAZWA` | `POSITION_NAME` | Stanowisko |
| 8 | `organizational_unit_name` | `S05.NAZWA` | `ORGANIZATIONAL_UNIT_NAME` | Jednostka organizacyjna |

## Join tree

Root: `employee` (S01) — `TETA_ADMIN_P.NT_KP_PRC_PRACOWNICY`

| # | Keyword | Joined | Anchor | ON |
|---|---------|--------|--------|----|
| 1 | INNER JOIN | `health_examination` (S02) | `employee` (S01) | `S02.PRAC_ID = S01.ID` |
| 2 | INNER JOIN | `examination_type` (S03) | `health_examination` (S02) | `S02.SLB_ID = S03.ID` |
| 3 | LEFT JOIN | `current_position` (S04) | `employee` (S01) | `S01.ID = S04.PRAC_ID` |
| 4 | LEFT JOIN | `organizational_unit` (S05) | `current_position` (S04) | `S04.JEOR_ID = S05.ID` |
| 5 | LEFT JOIN | `position_dictionary` (S06) | `current_position` (S04) | `S04.SSTN_ID = S06.ID` |

## Predicates

| # | Filter role | Type | Placement | SQL |
|---|-------------|------|-----------|-----|
| 1 | `examination_valid_to_in_current_month` | `half_open_date_interval` | where | `S02.DATA_WAZNOSCI >= TRUNC(SYSDATE,'MM')` |
| 2 | `examination_valid_to_in_current_month` | `half_open_date_interval` | where | `S02.DATA_WAZNOSCI < ADD_MONTHS(TRUNC(SYSDATE,'MM'),1)` |
| 3 | `employee_active_on_oracle_sysdate` | `correlated_exists` | where | `EXISTS (SELECT 1 FROM TETA_ADMIN.NT_KP_KDR_UMOWY_O_PRACE E01 WHERE E01.PRAC_ID = S01.ID AND E01.DATA_OD <= SYSDATE AND (E01.DATA_DO IS NULL OR E01.DATA_DO >= SYSDATE))` |
| 4 | `current_position_on_oracle_sysdate` | `effective_on_date` | join_on (`join:employee:current_position`) | `S04.DATA_OD <= SYSDATE` |
| 5 | `current_position_on_oracle_sysdate` | `effective_on_date` | join_on (`join:employee:current_position`) | `(S04.DATA_DO IS NULL OR S04.DATA_DO >= SYSDATE)` |

Predicates that belong to a LEFT JOIN source are attached to that join's `ON` clause; moving them
to `WHERE` would turn the outer join into an inner join and drop employees whose enrichment rows
are missing.

## Existence filters (grain-preserving qualification)

An employee can hold several employment contracts, and after the temporal filter there is still no
cardinality proof that at most one row survives. Joining the contract object would therefore
multiply examination rows, so the qualifying condition is compiled as a correlated
`EXISTS (SELECT 1 …)` instead. The report grain stays `health_examination`.

| # | Filter role | Relation | Correlated row source | Filter-only source | Correlation | Preserves grain |
|---|-------------|----------|-----------------------|--------------------|-------------|-----------------|
| 1 | `employee_active_on_oracle_sysdate` | `employee_to_active_employment` | `employee` (S01) | `active_employment` (E01) | `E01.PRAC_ID = S01.ID` | true |

## Artifact hash consistency

Every artifact below is compared against an independent `sha256` of the compiled statement, so a
stale hash in one file cannot survive an audit run.

| Artifact | Hash | SQL text | Detail |
|----------|------|----------|--------|
| `compiled.sqlSha256` | ok | n/a | compiler hash matches an independent sha256 of sqlText |
| `docs\AIA_ORACLE_SELECT_COMPILER_STAGE3E.json` | ok | n/a | liveSqlSha256=7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |
| `docs\AIA_ORACLE_SELECT_COMPILER_STAGE3E.md` | ok | ok | documented SQL block and hash compared |
| `.local\AIA_ORACLE_SELECT_COMPILER_STAGE3E.audit.json` | ok | ok | compiled.sqlSha256=7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |
| `.local\AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.json` | ok | ok | compiled.sqlSha256=7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |
| `.local\AIA_ORACLE_SELECT_COMPILER_STAGE3E.reference-bhp.sql` | ok | ok | sha256 of stored statement=7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |
| `docs\session-context.md` | ok | n/a | recorded sqlSha256=7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |

## Ordering

- `S02.DATA_WAZNOSCI ASC` (examination_valid_to_ascending)
- `S01.NAZWISKO ASC` (employee_last_name_ascending)
- `S01.IMIE ASC` (employee_first_name_ascending)

## Binds

_none — every value derives from the canonical graph plus `SYSDATE`_

## References

| Ref | Scenario | compileStatus | Rejection | Validation |
|-----|----------|---------------|-----------|------------|
| A | Live BHP plan (Stage 3D bindings) compiles to a single read-only SELECT | `compiled` | — | ok |
| B | Fixture BHP plan compiles with positional aliases and access objects only | `compiled` | — | ok |
| C | Plan that is not ready_for_compilation is rejected without SQL | `rejected_not_ready` | `source_plan_not_ready_for_compilation` | — |
| D | Plan that grants SQL execution is rejected as unsafe | `rejected_unsafe` | `execution_policy_violation` | — |
| E | HRM owner never reaches a compiled statement | `rejected_unsafe` | `forbidden_owner` | — |
| F | Cyclic join graph is unsupported in v1 | `rejected_unsupported` | `cyclic_join_graph_unsupported` | — |
| G | User-supplied literal is passed as a bind variable, never inlined | `compiled` | — | ok |
| H | Missing HAS_COLUMN evidence on the access object blocks compilation | `rejected_invalid_plan` | `missing_access_column_evidence` | — |
| I | Active employment qualifies employees through a correlated EXISTS, never a row-producing join | `compiled` | — | ok |
| J | Joining a filter-only source into the main tree is rejected as unsafe | `rejected_unsafe` | `filter_only_source_in_join_tree` | — |
| K | A filter-only source with no existence filter is rejected as unsafe | `rejected_unsafe` | `filter_only_source_without_existence_filter` | — |
| L | An uncorrelated EXISTS would not filter rows and is rejected | `rejected_unsafe` | `uncorrelated_existence_filter` | — |
| M | Projecting a filter-only column is rejected as unsafe | `rejected_unsafe` | `filter_only_source_in_projection` | — |

## Counters (live compilation)

| Counter | Value |
|---------|-------|
| statementsCompiled | 1 |
| finalSqlGenerated | 1 |
| sqlExecuted | 0 |
| oracleConnections | 0 |
| oracleWrites | 0 |
| businessDataRowsRead | 0 |
| xlsxFilesRead | 0 |
| qdrantCalls | 0 |
| embeddingCalls | 0 |
| llmCalls | 0 |
| agentCalls | 0 |
| selectStar | 0 |
| unqualifiedColumns | 0 |
| sqlComments | 0 |
| optimizerHints | 0 |
| semicolons | 0 |
| dmlStatements | 0 |
| plsqlBlocks | 0 |
| dbLinks | 0 |
| forUpdateClauses | 0 |
| withClauses | 0 |
| multipleStatements | 0 |
| unboundUserLiterals | 0 |
| cartesianJoins | 0 |
| crossJoins | 0 |
| selfJoins | 0 |
| cyclicJoinGraphs | 0 |
| invalidIdentifiers | 0 |
| missingAccessColumns | 0 |
| forbiddenOwnerReferences | 0 |
| logicalObjectsUsedInSql | 0 |
| reportGrainDefined | 1 |
| rowProducingSources | 6 |
| filterOnlySources | 1 |
| existenceFiltersCompiled | 1 |
| filterOnlySourcesInMainJoinTree | 0 |
| filterOnlyAliasesOutsideExists | 0 |
| filterOnlySourcesProjected | 0 |
| filterOnlySourcesUsedForOrdering | 0 |
| unprovenFilterJoinCardinality | 0 |
| possibleReportRowMultiplication | 0 |
| distinctAddedToHideMultiplicity | 0 |
| arbitrarySubqueriesDetected | 0 |
| uncorrelatedExistsDetected | 0 |
| existsWithoutSemanticEvidence | 0 |
| uncontrolledSubqueries | 0 |
| inSubqueries | 0 |
| distinctClauses | 0 |

## Strict errors

_none_

## Notes

- Stage 3E consumes `teta-aia-readonly-query-plan-v1` and does not modify Stage 3A–3D contracts.
- SQL always reads from the plan's `accessObject`; logical (`TETA_ADMIN`) objects are used only to
  look up column evidence, which is then remapped to the access owner via `HAS_COLUMN`.
- Identifiers must match `^[A-Z][A-Z0-9_$#]*$`; nothing is quoted and nothing is concatenated from
  free text.
- No Oracle connection, no SQL execution, no business data read, no Qdrant / embeddings / LLM / agent.
- The compiled statement has no trailing semicolon and uses LF newlines with a two-space indent.
