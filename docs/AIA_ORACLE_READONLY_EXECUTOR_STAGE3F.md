# AIA — Stage 3F Controlled Read-Only Oracle Executor + XLSX

> Generated 2026-07-27T08:04:18.712Z. Contains **metadata only** — never employee rows, names, or employee numbers.

## Architecture

`TetaCompiledOracleSelect` (Stage 3E)
→ execution gate (recomputed `sqlSha256` + Stage 3E `validateCompiledSql`)
→ explicit operator flags (`--execute-real-oracle` **and** `--confirm-readonly-execution`)
→ session preflight (`SYS_CONTEXT('USERENV','SESSION_USER')` must be `TETA_ADMIN`)
→ exactly one business SELECT (`compiled.sqlText` + binds, `autoCommit=false`)
→ `TetaOracleReadResult`
→ optional XLSX under `.local/exports/` (SheetJS + OOXML probes via `jszip`).

Module: `apps/api/src/teta-oracle-executor/`. CLI: `pnpm --filter @teta/api run executor:stage3f`.

A central `finally` closes the ResultSet then the connection on every path; counters are snapshotted only after successful close.

## Offline audit

Fixture / fake-adapter path. **Does not open real Oracle.**

| Metric | Value |
|--------|-------|
| oracleConnectionsOpened | 0 |
| businessStatementsExecuted | 0 |
| fixtureXlsxExportsGenerated | 1 |
| fixtureXlsxParsebackOk | true |
| References tested / passed | 4 / 4 |
| Writes / commits / retries | 0 / 0 / 0 |
| LLM / Qdrant / agent | 0 / 0 / 0 |
| Row data leaks | 0 |
| Strict errors | [] |

## Live audit

Live Reference A (BHP). Metrics below are **live-only** — fixture XLSX is not included.

| Field | Value |
|-------|-------|
| Requested | true |
| Status | `completed_empty` |
| Session user | `TETA_ADMIN` |
| sqlSha256 | `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` |
| rowCount / columnCount | 0 / 8 |
| limitReached | false |
| oracleConnectionsOpened / Closed | 1 / 1 |
| openOracleConnectionsAfterRun | 0 |
| connectionCloseFailures | 0 |
| resultSetsOpened / Closed | 1 / 1 |
| resultSetCloseFailures | 0 |
| preflight / business statements | 1 / 1 |
| liveXlsxExportsRequested / Generated | 1 / 1 |
| live XLSX rows / columns / sheets | 0 / 8 / 2 |
| liveXlsxParsebackOk | true |
| XLSX file | `badania_bhp_koniec_waznosci_2026-07-27_100418.xlsx` |
| XLSX sha256 | `7443bfd4242c0799f3a2153112ce7ba82f042143de9c7f4a372fc35bacbbf7fe` |
| Duration ms | 4132 |

## Safety confirmations

- Exactly one business SELECT on a successful live run
- Preflight statements = 1 on live success
- Connection opened and closed exactly once on live success
- ResultSet opened and closed equally
- 0 writes / 0 commits / 0 retries
- 0 LLM / Qdrant / agent / chat / public SQL endpoints
- No personal data in this document
- Real Oracle requires `--execute-real-oracle` **and** `--confirm-readonly-execution`

## Reference results

- **offline-gate-accept**: status=`completed` — recomputedSha256=dda844dc9e3d0ef2d63591ff4f9d44a827d3d53034c0babbde6bafdf696de4b4
- **offline-no-approval**: status=`rejected` code=`execution_not_approved` — connectionsOpened=0
- **offline-fake-execute**: status=`completed` — rowCount=2; columnCount=8; connectionsClosed=1
- **offline-xlsx-export**: status=`exported` — fileSha256=8c92e1072fe3be240369ba7c510dab1f95de77999faaa9735f81240c2c52945d; parsebackOk=true
