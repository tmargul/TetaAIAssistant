# AIA Business Semantics — Stage 3D

Generated: 2026-07-25T07:17:40.395Z

## Summary

| Field | Value |
|------|-------|
| Contract | `teta-aia-business-semantics-v1` |
| Ontology | `teta-aia-business-ontology-v1` |
| Bindings | `teta-aia-business-semantic-bindings-v1` |
| Identity | `teta-aia-canonical-id-v1` |
| Graph hash | `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3` |
| Validation OK | true |
| Reference BHP planStatus | `ready_for_compilation` |
| Approved bindings | 31 |
| Strict errors | 0 |

## Value paths

- **position_name:** current_position:SSTN_ID → position_dictionary:ID → position_dictionary:NAZWA
- **examination_type_name:** health_examination:SLB_ID → examination_type:ID → examination_type:NAZWA
- **organizational_unit_name (authoritative):** current_position:JEOR_ID → organizational_unit:ID → organizational_unit:NAZWA

## Temporal mechanisms

### Active employee

effective_on_date on active_employment DATA_OD/DATA_DO (openEndedEndAllowed=true); correlated EXISTS on employee.ID = active_employment.PRAC_ID (usage=filter_only, rowSemantics=exists) so contracts qualify employees without multiplying report rows

### Current position

effective_on_date on current_position DATA_OD/DATA_DO (openEndedEndAllowed=true, startInclusive=true, endInclusive=true, clock=oracle_sysdate)

## Patch metrics (current position / OU)

| Metric | Value |
|--------|-------|
| currentPositionTemporalBindingsRequired | 1 |
| currentPositionTemporalBindingsApproved | 1 |
| currentPositionFiltersResolved | 1 |
| currentPositionFiltersMissing | 0 |
| historicalPositionLeakRisk | 0 |
| competingOrganizationalUnitPaths | 0 |
| projectionPathsWithMultipleAuthoritativeSources | 0 |

## Live filters (Reference A)

- `examination_valid_to_in_current_month` (resolved)
- `employee_active_on_oracle_sysdate` (resolved)
- `current_position_on_oracle_sysdate` (resolved)

## Side-effect counters

| Counter | Value |
|---------|-------|
| finalSqlGenerated | 0 |
| sqlExecuted | 0 |
| oracleConnections | 0 |
| qdrantCalls | 0 |
| llmCalls | 0 |
| agentCalls | 0 |

## Strict errors

_none_

## Reference plan (live)

```json
{
  "planStatus": "ready_for_compilation",
  "sources": [
    "employee",
    "health_examination",
    "examination_type",
    "current_position",
    "organizational_unit",
    "active_employment",
    "position_dictionary"
  ],
  "projections": [
    "employee_number",
    "employee_first_name",
    "employee_last_name",
    "examination_type_name",
    "examination_valid_from",
    "examination_valid_to",
    "position_name",
    "organizational_unit_name"
  ],
  "filters": [
    "examination_valid_to_in_current_month",
    "employee_active_on_oracle_sysdate",
    "current_position_on_oracle_sysdate"
  ],
  "joins": [
    "current_position→organizational_unit",
    "current_position→position_dictionary",
    "employee→current_position",
    "health_examination→employee",
    "health_examination→examination_type"
  ]
}
```

## Notes

- Stage 3D binds business roles to canonical graph node IDs (JSON registry only).
- Stage 3C contract versions / safety policy / plan status enums are unchanged.
- Current position requires `current_position_on_oracle_sysdate` (historical leak risk otherwise).
- `organizational_unit_name` authoritative path starts at `current_position`; employee→OU is supporting/not used for projection.
- No SQL generation, Oracle data reads, Qdrant, embeddings, LLM, or agent calls.
