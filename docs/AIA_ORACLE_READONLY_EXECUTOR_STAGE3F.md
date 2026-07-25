# AIA — Stage 3F Controlled Read-Only Oracle Executor + XLSX

> Generated 2026-07-25T09:09:32.328Z. Contains **metadata only** — never employee rows, names, or employee numbers.

## Architecture

`TetaCompiledOracleSelect` (Stage 3E)
→ execution gate (recomputed `sqlSha256` + Stage 3E `validateCompiledSql`)
→ explicit operator flags (`--execute-real-oracle` **and** `--confirm-readonly-execution`)
→ session preflight (`SYS_CONTEXT('USERENV','SESSION_USER')` must be `TETA_ADMIN`)
→ exactly one business SELECT (`compiled.sqlText` + binds, `autoCommit=false`)
→ `TetaOracleReadResult`
→ optional XLSX under `.local/exports/` (SheetJS + OOXML probes via `jszip`).

Module: `apps/api/src/teta-oracle-executor/`. CLI: `pnpm --filter @teta/api run executor:stage3f`.

## Execution gate

Before any Oracle connection:

1. Supported Stage 3E contract / `compileStatus=compiled` / `validation.ok`
2. Non-empty `sqlText`; SHA-256 recomputed and matched
3. Intent/subject/dialect limits (`maxRows≤500`, `maxColumns≤20`, timeout ≤30000)
4. Bind completeness
5. Independent Stage 3E SQL revalidation (no `SELECT *`, comments, hints, DML/DDL/PL/SQL, DB link, `FOR UPDATE`, uncontrolled subqueries, owners `HRM`/`UNKNOWN`)

Stage 3F never rewrites SQL.

## Session verification

One preflight statement only:

```sql
SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER FROM DUAL
```

Mismatch → connection closed, no business SELECT.

## Timeout / cancel / no writes

- Business statement deadline: 30000 ms (client race + driver `callTimeout`)
- On timeout: `connection.break()`, close result/connection, status `timed_out`, no retry
- `autoCommit=false`; counters force `writesAttempted=0`, `commits=0`
- No DML / DDL / PL/SQL path exists in the adapter

## Result contract

- Version: `teta-aia-oracle-read-result-v1`
- Statuses: `completed` | `completed_empty` | `limit_reached` | `rejected` | `timed_out` | `failed`
- Column metadata from Stage 3E `projections` (`displayLabel`, `businessRole`, `resultAlias`)
- Supported types: VARCHAR2/NVARCHAR2/CHAR/NCHAR/NUMBER/BINARY_FLOAT/BINARY_DOUBLE/DATE/TIMESTAMP*
- LOB / RAW / XMLTYPE → `unsupported_result_type`
- `employee_number` kept as text (leading zeros)
- Large unsafe JS numbers kept as text where applicable
- Business cell values never enter docs / audit JSON / logs / session notes (`redactReadResult`)

## XLSX exporter

- Version: `teta-aia-oracle-xlsx-export-v1`
- Sheets: `Badania BHP` (data + freeze + autofilter) and `Informacje` (metadata only)
- No formulas / macros / external links; formula-like text (`=`, `+`, `-`, `@`) stored as string cells
- Dates as real Excel dates (`yyyy-mm-dd`); employee number as text
- Empty result still emits headers + info message
- `limit_reached` shows the 500-row warning on Informacje
- Files only under `.local/exports/`; also `exportToBuffer` for a future UI download
- Parseback re-opens bytes (SheetJS + OOXML) before status `exported`

## Offline audit (no Oracle)

| Metric | Value |
|--------|-------|
| Audit mode | `live_oracle` |
| Live requested | true |
| References tested / passed | 4 / 4 |
| Oracle connections opened | 1 |
| Business statements (live) | 1 |
| Writes / commits | 0 / 0 |
| XLSX files written (incl. offline fixture) | 2 |
| XLSX formulas | 0 |
| LLM / Qdrant / agent | 0 / 0 / 0 |
| Row data leaks | 0 |
| Strict errors | [] |

## Live Reference A (BHP)

| Field | Value |
|-------|-------|
| Attempted | true |
| Status | `completed_empty` |
| Session user | `TETA_ADMIN` |
| sqlSha256 | `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` |
| rowCount | 0 |
| columnCount | 8 |
| limitReached | false |
| XLSX file | `badania_bhp_koniec_waznosci_2026-07-25_110932.xlsx` |
| XLSX sha256 | `61bbcdf483b3cb7e77fbda61f3192d3b9685964eb2c89f62a6b1cd7bf3fe5661` |
| Parseback | true |
| Duration ms | 4275 |

## Safety confirmations

- Exactly one business SELECT on a successful live run
- Preflight statements = 1 on live success
- 0 writes / 0 commits
- 0 LLM / Qdrant / agent / chat / public SQL endpoints
- No personal data in this document
- Real Oracle requires `--execute-real-oracle` **and** `--confirm-readonly-execution`

## Reference results

- **offline-gate-accept**: status=`completed` — recomputedSha256=dda844dc9e3d0ef2d63591ff4f9d44a827d3d53034c0babbde6bafdf696de4b4
- **offline-no-approval**: status=`rejected` code=`execution_not_approved` — connectionsOpened=0
- **offline-fake-execute**: status=`completed` — rowCount=2; columnCount=8
- **offline-xlsx-export**: status=`exported` — fileSha256=8db832fdb0b2ef13563d3472bf12b90b656f148ea9d62bbc24b0d80c49bff96f; parsebackOk=true
