# Kontekst rozmów — Teta AI Assistant

> **Plik żywy** — uzupełniany po ważnych ustaleniach w czacie. Synchronizuje się przez git między komputerami.
> Ostatnia aktualizacja: **2026-07-28** (Stage 3I `032a6a6`; Stage 3J pre-commit audit patch lokalnie, **niezacommitowany**)

---

## Środowisko dev (ten projekt)

| Element | Wartość |
|---------|---------|
| Dev | `pnpm dev` — API `:3000`, web `:5173` |
| VM Oracle | `WIN-PDDJCBNU8LI` (Hyper-V **Default Switch**) |
| Host Oracle w SQLite (aktualnie działający) | **`172.29.48.145`** — port **`1521`**, SID **`TETAHR`**. Ostatni pełny live audit Stage 3H korzystał z tego hosta. |
| IP docelowe VM | **`172.27.16.145`** — po ponownym `Set-TetaVmNetwork.ps1` (brama `172.27.16.1`, `/20`). **Nie** traktować jako potwierdzonego, dopóki `Test-NetConnection 172.27.16.145 -Port 1521` nie przejdzie; potem zsynchronizować host w SQLite. |
| Stare IP (historyczne) | `172.22.240.145`, `172.26.228.145`, `172.20.23.182` — nie używać |
| Port / SID | `1521` / **`TETAHR`** |
| Firewall VM | Reguła TCP 1521 z podsieci hosta (`Set-TetaVmNetwork.ps1`) |
| Teta na VM (share) | mapuj `A:` przez `Connect-TetaHost.ps1` na aktualny host VM (obecnie w praktyce zgodny z SQLite / Default Switch) |
| Ustawienia ścieżek | **Ustawienia → Aplikacja Teta** — `clientDirectory` + `serverDirectory` (zmapowany dysk lub UNC); zapis w SQLite ✅ działa |
| Tryb Oracle w `.env` | `TETA_ORACLE_MODE=real` (na dev; fake tylko do symulacji) |
| `oracledb` | Wersja 7.x, domyślnie **Thin** — Instant Client nie jest wymagany na start |
| Instant Client | Basic Light tylko jeśli Thin nie wystarczy; w paczce offline — opcjonalnie |

### Konta testowe (tylko `TETA_ORACLE_MODE=fake`)

| Rola | Login | Hasło |
|------|-------|-------|
| Admin | `teta_admin` | `admin` |
| User | `teta_user` | `user` |

W trybie **real** logujesz się **prawdziwym kontem Oracle** — `teta_admin` nie istnieje w bazie.

### `.env` API (ustalenia)

- Dane połączenia (host, SID, login techniczny) → **UI aplikacji / SQLite**, nie `.env`
- `TETA_ADMIN_CHECK_SQL` — na dev tymczasowo `SELECT 1 AS is_admin FROM DUAL`; na produkcji zapytanie od zespołu Teta
- `JWT_SECRET` — wymagany przy zapisie hasła Oracle do SQLite (min. sensowna długość)

---

## Ustalenia funkcjonalne (z rozmów)

### Oracle — konfiguracja i logowanie

1. **Edycja połączenia z UI** — zakładka **Ustawienia → Połączenie Oracle** (tylko admin). Hasło przy edycji można zostawić puste (zachowuje poprzednie).
2. **Recovery bez logowania** — na ekranie logowania link *„Problemy z logowaniem? Zmień parametry połączenia Oracle”*; zapis z nagłówkiem `X-Teta-Oracle-Recovery: 1`.
3. **`POST /api/oracle/config`** — bez auth przy pierwszym setupie lub recovery; po skonfigurowaniu wymaga JWT admina.
4. Stara konfiguracja fake (`192.168.1.10`, SID `TETA`) w SQLite powodowała timeout. **Aktualnie działający** host w SQLite: **`172.29.48.145`** / `TETAHR` (port 1521). `172.27.16.145` = adres docelowy po `Set-TetaVmNetwork.ps1` — po zmianie IP VM trzeba zsynchronizować konfigurację Oracle w SQLite. NJS-510 = VM nieosiągalna (brak trasy / VM wyłączona), nie błąd aplikacji.
5. Błędy Oracle (timeout, NJS-510) powinny wracać jako czytelny komunikat (`BadRequestException`), nie HTTP 500.

### Panel aktualizacji (z repo, ten komputer)

- Zakładka **Aktualizacje** w ustawieniach klienta (`ClientUpdatesPanel`, `ServerPathPicker`)
- Ostatnie commity: `763f111` … `4d7c40c` (panel aktualizacji klienta / online)

### Paczki / offline

- Oracle Instant Client w bundle offline — **opcjonalnie**, nie domyślnie
- Qdrant lokalnie: `{katalog_instalacji}/qdrant`
- Modele Ollama: `{katalog_instalacji}/ollama/models` (OLLAMA_MODELS)

### RAG — test fundamentu (ustalenie z zespołu, 2026-06)

**Kolejność prac (nie zmieniać na razie):**

```
knowledge-chunks.jsonl  →  Importer  →  Qdrant  →  Chat
```

**Kryterium sukcesu:** w czacie pytanie *„Co to jest dataset w TETA?”* zwraca właściwy chunk ze szkolenia **`zu1.mp4`**.

**Na teraz potwierdzić tylko:**
- importer działa
- Qdrant przyjął dane
- wyszukiwanie semantyczne działa

**Nie ruszać jeszcze:**
- skracanie chunków (`CHUNK_SECONDS = 180` → docelowo 60–90 s) — to jest w **pipeline wideo**, nie w tej aplikacji
- enrichment Qwen3 w pipeline
- OCR/Vision dla screenów
- dokumentacja i pakiety Oracle

**Import w aplikacji:**
```bash
pnpm rag:validate-chunks -- --input <ścieżka/knowledge-chunks.jsonl>
pnpm rag:global:import-chunks -- --input <ścieżka/knowledge-chunks.jsonl>

# Etap 1 — MP4 → JSONL (+ opcjonalnie Qdrant)
pnpm rag:video:ingest -- --input <ścieżka/zu1.mp4> --no-index
pnpm rag:video:ingest -- --input <ścieżka/zu1.mp4> --merge
```
Wymaga: `TETA_APP_MODE=vendor`, `TETA_VENDOR_SECRET`, uruchomione **Ollama** (`nomic-embed-text`) i **Qdrant** (dla importu; `--no-index` pomija Qdrant).

Dla `rag:video:ingest` dodatkowo: **Python 3.10+**, `pip install -r scripts/rag/requirements-video.txt`, **ffmpeg** w PATH.

Format: `teta-knowledge-chunk-v1` — patrz `docs/rag-pipeline-formats.md`.

### Etap 1 — CLI `rag:video:ingest` ✅

- `scripts/rag/video-ingest.py` — ffmpeg + faster-whisper → JSONL + klatki
- `pnpm rag:video:ingest` — walidacja, kopiowanie klatek, opcjonalnie import Qdrant

### Etap 2–3 — API + UI ✅

- SQLite `video_ingest_jobs`, worker w procesie API (1 job naraz)
- `POST/GET /api/vendor/rag/ingest/video` + strumień NDJSON postępu
- UI: upload MP4 w **Źródła globalne**

### Etap 4 — setup offline ✅

- `Ensure-VideoIngestTools` w `Setup.ps1` (vendor)
- **Offline:** instaluje Python z `installers/python-*.exe`, ffmpeg z `tools/ffmpeg/`, pip z `python-wheels/`
- **Online:** winget (Python 3.12, ffmpeg) + pip z internetu
- `Prepare-OfflineBundle.ps1` pobiera Python, ffmpeg i `pip download` wheeli

**Do przetestowania end-to-end:** Python + ffmpeg na serwerze, upload prawdziwego `zu1.mp4`

### Decyzja: ingest MP4 w aplikacji (Faza 2, bez Fazy 1)

- **Nie** robimy uploadu paczek `.7z` — tylko **bezpośredni upload `.mp4`** w vendor UI.
- Pipeline w aplikacji: MP4 → ffmpeg → Whisper → chunki → ten sam JSONL → istniejący import Qdrant.
- Model Whisper rekomendowany: **`large-v3-turbo`** (polski, szkolenia, szybkość); fallback `large-v3` przy słabej jakości audio.
- Szczegóły planu: patrz ustalenia w czacie 2026-06-18 / plan implementacji (do dopisania po akceptacji).

---


### Stage 3F — 2026-07-27 ✅ (`f957dd2`)

- Status: `completed_empty`
- rowCount / columnCount: 0 / 8
- sqlSha256: `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691`
- connections opened/closed: **1 / 1**; openAfterRun=0; resultSets 1/1
- XLSX: `badania_bhp_koniec_waznosci_2026-07-27_100418.xlsx`
- fileSha256: `7443bfd4242c0799f3a2153112ce7ba82f042143de9c7f4a372fc35bacbbf7fe`
- parseback: true; liveXlsx 0 rows / 8 cols / 2 sheets
- Oracle writes/commits: 0 / 0 (Stage 3F policy)
- Live wymaga flag: `--execute-real-oracle` + `--confirm-readonly-execution`
- Moduł: `apps/api/src/teta-oracle-executor/`; CLI `executor:stage3f`

### Stage 3G — 2026-07-27 ✅ (`603a0d5`)

- routeId: `occupational_health_examinations_current_month`
- audit v2 + trace patch: offline/live/download/ui sections, invarianty `noDirect*`
- status (live): `completed_empty` 0×8
- fileSha256 (live download): `4c67a880647961eb89a7d82b41d232bd119460ef57e88fdcef2e1e05552b850e`
- Oracle opened/closed: 1 / 1; business SELECT: 1; download: 1/1; strictErrors: []
- testy: Stage 3G **139**, Stage 3F **89**
- uiAudit: `not_measured`
- Oracle w SQLite (live 3G/3H): host **`172.29.48.145`**, port 1521, SID `TETAHR`, user `teta_admin`, `TETA_ORACLE_MODE=real`
- Docelowe IP po `Set-TetaVmNetwork.ps1`: `172.27.16.145` — potwierdzić `Test-NetConnection`, potem zaktualizować SQLite
- Stage 3G v1: admin/vendor only; **zacommitowany**

### Stage 3H — 2026-07-27 ✅ (`921c640`)

- Period kinds: `current_month` | `next_month` | `next_n_days` | `explicit_date_range`
- Bindy: current/next month **0**; next_n_days **1×NUMBER `:P001`**; explicit range **2×VARCHAR2 `:P001/:P002`**
- Wartości użytkownika nigdy w `sqlText`; `executionFingerprintSha256` obok `sqlSha256`
- Live A current_month (host SQLite **`172.29.48.145`**): `completed_empty` 0×8; binds 0; sqlSha256=`7b86576c…c691`; fingerprint=`c3c2bdb1…240eb`; Oracle **1/1**; download SHA OK
- Live B date range 01.07–31.07.2026: `completed_empty` 0×8; binds 2 validated; parameterizedStatementsExecuted=1; sqlSha256=`b62ab1e5…72ab`; fingerprint=`67a4edb3…5933`; Oracle **1/1**; download SHA OK
- Offline audit: 21/21 refs; strictErrors=[]
- Testy: Stage 3H **85**; 3B–3G regresja OK; API+web build OK
- CLI: `pnpm --filter @teta/api run chat-report:stage3h [-- --execute-real-oracle --confirm-readonly-execution]`
- Artefakty: `docs/AIA_PARAMETERIZED_BHP_REPORT_STAGE3H.*` (`.local/*` nie w git)


## Otwarte / do sprawdzenia

- [ ] **RAG smoke test:** `_temp/zu1/zu1.jsonl` rozpakowany (44 chunki, `trainings/zu1.mp4`) — import + chat po uruchomieniu Qdrant
- [ ] VM Oracle: docelowe IP **`172.27.16.145`** po `Set-TetaVmNetwork.ps1` — potwierdzić `Test-NetConnection` i zsynchronizować host w SQLite (obecnie działa **`172.29.48.145`**)
- [x] Ścieżki Teta (vendor): share VM + mapowanie dysku na hoście — **Ustawienia → Aplikacja Teta** zapisuje poprawnie
- [ ] Admin zarejestrowany na real Oracle (nie fake `teta_admin`)
- [ ] Produkcyjne `TETA_ADMIN_CHECK_SQL` od zespołu Teta
- [ ] **Oracle agent + wtyczki:** przetestować w czacie (źródło „Baza Oracle”) pytanie o dane z formularza np. wykształcenie → tabela w wyniku
- [ ] **Pipeline Oracle (standard 2026-07-17):** wdrożony w kodzie (probe widoki→tabele→pakiety→LLM); smoke: Beata Styś → KDR → „SPECJALISTA DS. KADR” — potwierdzić w UI
- [x] **Stage 3I:** zacommitowany `032a6a6fee90fe657043e7898b3cce2c68dbff2b`
- [ ] **Stage 3J:** funkcjonalnie gotowy + **pre-commit audit patch** (referencje A–J, runtime/reference split) — **niezacommitowany**
- [ ] **Stage 3J.1 — Polish Teta Domain Lexicon** (patrz notatki poniżej; nie implementować w 3J)

---

## Notatki sesji

### 2026-07-27 / 2026-07-28 — Stage 3I final (stan aktualny)

- Moduł `apps/api/src/teta-payroll-snapshots/` + CLI `payroll-snapshot:stage3i` + UI **Ustawienia → Parametryzacja płac**
- parserVersion: `teta-payroll-report-parser-v1`
- detectionStatus: `valid_payroll_parameters_report`
- reportGeneratedAt: **2020-05-22** (exact), KP **27.61.099494**, PA **27.61.099393**
- TOC/body/matched: **26/26/26**; core/generic/unknown: **4/22/0**
- componentCount: **1037**; componentFormulaCount: **776**
- sqlFormulaCount: **60**; calculationFormulaCount: **81**
- calculationFormulaComponentReferences: **345**
- directDependencyCount: **2136**; unparsedRecordCount: **1**
- Znane zależności: 1350→1346/1348; 1353→1350/1351/1352 (+transitive 1346/1348); 1355→0010/0300/1338/1350
- Stage 3I tests: **136/136**; regresja 3B–3H: **645/645**
- `audit --strict`: EXIT 0; strictErrors: []
- Oracle/LLM/Qdrant/formula execution/DOMAN fallback: **0**
- DOMAN = `customer_example` only — bez pełnych formuł/SQL/nazwy klienta w docs/session-context
- Stage 3I commit: `032a6a6fee90fe657043e7898b3cce2c68dbff2b`
- Stage 3J: **lokalnie gotowy**, niezacommitowany

### 2026-07-28 — Stage 3J pre-commit audit patch (lokalnie)

- **Audit:** `runtimeAudit` vs `referenceAudit` rozdzielone; strict invariants A–J; fingerprint determinism (identyczny input / zmiana depth)
- **Referencje A–J:** wszystkie wykonane na rzeczywistych ścieżkach Stage 3J (golden DOMAN + syntetyczne fixture)
- **0010 leading zero:** fixture `payroll-parameters-polish-encoding.rtf` (golden ma 0010 tylko w zależnościach, nie jako wiersz składnika)
- Stage 3J tests (Jest JSON): **158/158**; regresja 3B+3I (audit): **781/781**
- **Privacy patch:** golden-impact-1350 detail zredagowany w docs/json; pełna lista tylko w `.local/reference-1350-impact.json` (gitignored)
- `ambiguousSelections` instrumentowany z resolvera; `customerConfigurationCodesExposedInRepoArtifacts=0`
- API build + web build: EXIT 0
- `payroll-explanation:stage3j audit --strict`: EXIT 0; strictErrors: []
- runtimeAudit (audit run): impactTraceRequests **4**, directDependentsReturned **19**, guaranteedImpactClaimsMade **0**, calculationFormulaUsesReturned **5**
- Side effects Oracle/LLM/Qdrant/formula execution/DOMAN/legacy fallback: **0**
- Artefakty: `docs/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.*`, `.local/AIA_PAYROLL_COMPONENT_EXPLANATION_STAGE3J.audit.json`, `.local/...reference-1353.json`, `.local/...reference-1350-impact.json`

#### Stage 3J.1 — Polish Teta Domain Lexicon (TODO przyszły)

Zakres: kontrolowane pojęcia biznesowe, synonimy kontekstowe, mapowanie intent/subject/focus — **bez** mapowania do Oracle i **bez** ogólnego słownika PL.

Gdzie dziś rozpoznawane frazy (nie przenosić jeszcze do lexiconu):

| Obszar | Lokalizacja | Typ |
|--------|-------------|-----|
| Intent `inspect_payroll_component` / `explain_payroll_component_configuration` | `apps/api/config/teta-intent-catalog-v1.json` | konfiguracja |
| Intent payroll employee value (`explain_payroll_component`) | `teta-intent-catalog.ts` + `teta-entity-extractor.ts` | kod |
| Focus: dependencies / impact / formula / overview / full | `teta-payroll-component-explanation-planner.ts` (`detectPayrollExplanationFocus`) | kod |
| Intent z query (inspect vs explain configuration) | `teta-payroll-component-explanation-planner.ts` (`INSPECT_SIGNALS`, `EXPLAIN_SIGNALS`) | kod |
| Unsupported intents (create/analog/compare/calculate) | `teta-payroll-component-explanation-planner.ts` (`UNSUPPORTED_PATTERNS`) | kod |
| Chat gate client vs generic knowledge | `teta-payroll-snapshot-chat-gate.ts` (`CLIENT_PATTERNS`, `GENERIC_PATTERNS`) | kod |
| Stage 3B → payrollComponentRequest attach | `teta-evidence-planner.service.ts` | kod |

Do późniejszej migracji do wersjonowanego **Polish Teta Domain Lexicon**: regex/sygnały z plannera i chat-gate (focus + unsupported + client/generic), ewentualnie rozszerzenie intent-catalog o synonimy kontekstowe.

### 2026-07-28 — Stage 3J static payroll component explanation (lokalnie)

- Moduł `apps/api/src/teta-payroll-explanations/` + CLI `payroll-explanation:stage3j` + UI `PayrollComponentExplanationCard`
- contractVersion: `teta-aia-payroll-component-explanation-v1`
- semanticsCatalogVersion: `teta-payroll-component-semantics-v1`
- Golden (lokalny DOMAN): 1353 direct **1350/1351/1352**, transitive **1346/1348**; 1350 impact direct zawiera **1353/1355**
- Stage 3J tests: **158/158** (po audit patch); regresja 3B+3I (audit): **781/781**
- `audit --strict`: EXIT 0; strictErrors: []
- Oracle/LLM/Qdrant/formula execution/DOMAN fallback/legacy fallback: **0**
- raw formula w historii/logach/audycie: **0** (live response może zawierać raw wzór)

### 2026-07-25 — Etap 3E Deterministic Oracle SELECT Compiler ✅ (commit `1751a40`)

- **Zacommitowany** na `main` / `origin/main` jako `1751a40` („Stage 3E”).
- Moduł `apps/api/src/teta-oracle-compiler/` + CLI `compiler:stage3e` (`compile|compile-reference-bhp|validate|audit --strict`).
- Kontrakt `teta-aia-oracle-select-v1`, dialekt `oracle19c`, wejście `teta-aia-readonly-query-plan-v1` (Stage 3C, bez zmian kontraktów 3A–3D).
- Live BHP `sqlSha256` = `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` (bez trailing newline w `sqlText`).
- `filter_only` + skorelowany `EXISTS` dla `active_employment`; `reportGrain=health_examination`.

### 2026-07-25 — Etap 3F Controlled Read-Only Executor + XLSX ✅ (`f957dd2`)

- Moduł `apps/api/src/teta-oracle-executor/` + CLI `executor:stage3f`.
- Live: `completed_empty`, 0×8, opened/closed **1/1**, resultSets **1/1**, liveXlsx **1** (0/8/2), parseback OK.
- Testy Stage 3F: **89**; trusted Stage 3G chat approval path w `evaluateExecutionPolicy`.
- Następne: **Stage 3G** (chat report delivery) — w toku lokalnie, niezacommitowany.

### 2026-07-25 — Etap 3E (szczegóły techniczne, skrót)

- Wejście: plan 3C `ready_for_compilation` → wyjście `TetaCompiledOracleSelect`. `sqlCompilationAllowed=false` w 3C **nie** blokuje kompilacji.
- SQL zawsze z `accessObject`; aliasy `S01…` / `E01…` dla `filter_only`.
- Mapowanie kolumn logicznych → access przez `HAS_COLUMN` (live: remap na `TETA_ADMIN_P`).
- Join tree acykliczny; filtry temporalne `LEFT JOIN` w `ON`.
- **`filter_only` + `EXISTS`:** brak dowodu kardynalności aktywnej umowy → bez `INNER JOIN` employment w drzewie wierszy.
- LIVE BHP (*„Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.”*): `compiled`, 7 sources (**6 row-producing + 1 filter_only**) / 5 joins / 8 projekcji / 5 predykatów (1 = `EXISTS`) / 1 existence filter / 3 ordering / **0** bindów, 28 linii, `FETCH FIRST 500 ROWS ONLY`.
- `sqlSha256` = `7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691` (graphSourceHash `2e7f0b7e…f73c3`, ten sam co 3D). **Jedna wartość we wszystkich artefaktach** — audit liczy własny `sha256(sqlText)` i porównuje z `compiled.sqlSha256`, docs JSON/MD, `.local` sql/json oraz tym plikiem: `sqlArtifactHashMismatches` / `sqlArtifactTextMismatches` / `sessionContextHashMismatch` = **0**, `typecheckErrors` = **0**.
- Osobny token-walidator (23 checki: brak komentarzy, hintów, `SELECT *`, DML/DDL/PLSQL, `FOR UPDATE`, `WITH`, `;`, db-link, niekwalifikowanych kolumn, inline literałów, `DISTINCT`, `IN (…)`, tylko kontrolowany `EXISTS`, aliasy `E*` wyłącznie w `EXISTS`) — live `ok=true`, 0 violations.
- Bindy: user literals → `:P001` (Reference G, fixture); live BHP nie potrzebuje bindów (wszystko z grafu + `SYSDATE`).
- Audity `--strict` **EXIT 0** (3D i 3E); referencje 3E A–M 13/13; `pnpm --filter @teta/api run build` **EXIT 0**; testy **294** passed (`teta-stage3c.spec` 48 / `teta-stage3d.spec` 79 / `teta-stage3e.spec` 167). Artefakty `.local/AIA_ORACLE_SELECT_COMPILER_STAGE3E.{audit.json,reference-bhp.json,reference-bhp.sql}` (gitignored).
- **Bez** wykonania SQL / połączenia Oracle po dane / commita. Nazwy Oracle tylko w fixture'ach i configu, nie w kodzie produkcyjnym.

### 2026-07-24 — Etap 3D Canonical Business Semantics Layer ✅

- Moduł `apps/api/src/teta-business-semantics/` + CLI `semantics:stage3d` (`discover|validate|explain-role|plan-reference-bhp|audit --strict`).
- Kontrakt `teta-aia-business-semantics-v1`; configi: `teta-business-ontology-v1.json`, `teta-business-semantic-bindings-v1.json` (LIVE BHP approved), `teta-business-language-pl-v1.json`.
- `TetaBusinessRoleResolver` — tylko `approved` (+ walidacja hash); discovery bez auto-approve; statusy `discovered|approved|ambiguous|unresolved|rejected|stale|invalid`.
- Integracja 3C (bez zmiany kontraktu/safety/enums): opcjonalny `semanticResolver` w `QueryPlannerOptions`; adapter → source/column/join/filter resolvers.
- LIVE Ref BHP: `planStatus=ready_for_compilation`; trzy filtry: `examination_valid_to_in_current_month`, `employee_active_on_oracle_sysdate`, `current_position_on_oracle_sysdate`.
- `position_name` = SSTN_ID→SLO_STANOWISKA.NAZWA; `examination_type_name` = SLB_ID→SLO_BADANIA_BHP.NAZWA; `organizational_unit_name` = JEOR_ID ze **current_position** → JO.NAZWA (employee→OU = supporting / `not_used_for_this_projection`).
- Aktywny pracownik = `effective_on_date` na umowie; aktualne stanowisko = `effective_on_date` na KDR_STANOWISKA DATA_OD/DATA_DO (`openEndedEndAllowed`, inclusive).
- graphSourceHash: `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3`; identity `teta-aia-canonical-id-v1`.
- Pre-commit patch: temporal current_position + brak konkurencyjnej ścieżki JO; nowe strict metrics (`historicalPositionLeakRisk=0`, `competingOrganizationalUnitPaths=0`).
- Audit `--strict` EXIT 0; testy `teta-stage3d.spec.ts` (71) + `teta-stage3c.spec.ts` (48). Artefakty: `docs/AIA_BUSINESS_SEMANTICS_STAGE3D.md` / `.json`.
- **Bez** SQL / Oracle data / commit bez prośby. Live Oracle names tylko w JSON registry.

### 2026-07-24 — Etap 3C Canonical Read-Only Query Planning Layer ✅

- Moduł `apps/api/src/teta-query-planner/` + CLI `query:stage3c` (`plan|plan-reference-bhp|templates|audit --strict`).
- Kontrakt `teta-aia-readonly-query-plan-v1`; configi: `teta-report-query-templates-v1.json`, `teta-query-safety-policy-v1.json` (bez hardcodu Oracle w produkcji).
- Wejście: Stage 3B `TetaEvidencePlan` → wyjście: `TetaReadOnlyQueryPlan` (bez SQL/Oracle/LLM/Qdrant).
- Scope v1: tylko `build_employee_report` + `occupational_health_examinations`.
- Owner policy: TETA_ADMIN preferowany; TETA_ADMIN_P access OK; HRM/UNKNOWN bez auto-select; equal → `needs_selection`.
- Filtry AST: half-open current month (`oracle_sysdate`); active employee wymaga dowodu grafowego.
- Reference A (live): `needs_graph_resolution` — wszystkie source roles missing (brak semanticTags w live grafie; jawne luki, bez hardcodu). Fixture E: `ready_for_compilation`.
- Audit `--strict` EXIT 0; testy `teta-stage3c.spec.ts` (48). Artefakty: `docs/AIA_READ_ONLY_QUERY_PLANNER_STAGE3C.md` / `.json` (`.local` gitignored).
- **Bez** kompilatora SQL / wykonania Oracle / commit bez prośby.

### 2026-07-24 — Stage 3B evidence contract consistency (pre-commit patch)

- Po 3B.1 audit OK, ale Ref E: `help_document.selectedNodeId` = form; bindingi/kolumny = `resolved` bez ID (z całego podgrafu).
- Patch: `teta-evidence-contract.ts` + ścieżka `help_field→control→bindings→columns`; `HAS_HELP` → prawdziwy `help_document`; bez control → missing / not_applicable (nie fake resolved).
- Nowe strict metrics: `resolvedEvidenceWithoutNodeOrPath`, `evidenceSelectedNodeTypeMismatch`, `fieldEvidenceOutsideResolvedPath`, `bindingResolvedWithoutResolvedControl`, `lookupResolvedWithoutLookupEdge`, `helpDocumentPointingToForm` (=0).
- Bez Stage 3B.2 / 3C / SQL / commit.

### 2026-07-24 — Etap 3B.1 Graph-scoped evidence resolution ✅

- Diagnoza `graphResolved=0`: `resolveForm(nameFragment)` nie trafiał w polską nazwę PA (jest na `plugin_registry_entry`); globalne `resolveField` mieszało help/control/action.
- Fix: plugin→GUID→`resolveForm`; pole tylko ze `formNodeId`; bez formularza → `field_scope_missing` + clarification (bez global search).
- `action_parameter=not_applicable` dla zwykłego pola; import: `businessTarget`+`canonicalCandidates`+`selectionRequiredBeforeExecution`.
- BHP: `graphSearchTerms` z config → Stage 3A; runtime nadal deferred. `ready` ≠ SQL.
- Te same artefakty `docs/AIA_INTENT_EVIDENCE_PLANNER_STAGE3B.*`. Bez Stage 3C / commit bez prośby.

### 2026-07-24 — Etap 3B Intent & Evidence Planning Layer ✅

- Moduł `apps/api/src/teta-planner/` + CLI `planner:stage3b` (`plan|catalog|audit --strict`).
- Kontrakt `teta-aia-evidence-plan-v1`; configi v1: intent catalog, evidence templates, language PL.
- Intencje: payroll / import XLSX / raport / help field / trace→Oracle / unsupported / unknown.
- Klient Stage 3A (bez NDJSON, bez auto-resolve ambiguous); runtime evidence = `deferred`.
- `executionPolicy`: SQL/file/Oracle write = false; guessedEntities/autoResolved = 0.
- Audit `--strict` EXIT 0; refs A–G OK; testy `teta-stage3b.spec.ts` (30).
- Artefakty: `docs/AIA_INTENT_EVIDENCE_PLANNER_STAGE3B.md` / `.json` (`.local` audit gitignored).
- **Bez** Stage 3C / SQL gen / Qdrant / embeddingów / LLM / agenta. Nie commitować bez prośby.

### 2026-07-20 — IP VM Oracle (Default Switch)

- Host `vEthernet (Default Switch)`: **`172.22.240.1/20`** (wcześniej `172.26.224.0/20`).
- VM: **`172.22.240.145`**, brama `172.22.240.1`, adapter **Ethernet 3**.
- Ping host→VM OK. W aplikacji Oracle host = `172.22.240.145` (stary `172.26.228.145` nie działa).

### 2026-07-20 — Qdrant offline (dev)

- Brak usługi `TetaAI-Qdrant` / brak `qdrant.exe` w PATH.
- Dev: pobrano `tools/qdrant/qdrant.exe` (v1.18.3), start: `cd tools\qdrant; .\qdrant.exe` → http://127.0.0.1:6333
- Świeży storage — kolekcje puste; po restarcie hosta trzeba ponownie uruchomić proces i ewentualnie **ponowny import RAG** (wtyczki / metadata).

### 2026-07-21 — aktualne stanowisko + mylący komunikat

- „aktualne stanowisko” → KDR z filtrem `DATA_OD/DATA_DO` vs `SYSDATE`, `FETCH FIRST 1`, tylko kolumna `STANOWISKO`; ranking kandydatów: KDR → IMP → UC.
- Puste raporty z prób probe **nie** idą do UI (`emitReport: false`); UI filtruje raporty bez kolumn / 0 wierszy gdy jest wynik z danymi — stąd znikało „Zapytanie nie zwróciło kolumn” obok tabeli.

### 2026-07-21 — ORA-01756 / stanowisko KDR

- **Przyczyna:** `rewriteSqlLabelsUsingPluginMappings` psuło poprawny SQL z probe (`JOIN`, `s.NAZWA AS STANOWISKO`) → złe FROM / alias `k.` bez tabeli → potem LLM z uciętym SQL → ORA-01756.
- **Fix:** nie rewrite’uj SQL z JOIN/aliasami; nie podmieniaj istniejących kolumn Oracle synonimami innych; nie retargetuj FROM gdy jest już `IPRA_ID`/`PRAC_ID IN (…)`.

### 2026-07-21 — daty i sortowanie tabel (jak Teta)

- Format komórek: **data** → `YYYY-MM-DD`; **data+czas** → `YYYY-MM-DD hh:mm`.
- Kolumny o nazwie `DATA*` → zawsze data bez czasu; czas tylko gdy użytkownik prosi (`z czasem`, `godzina`, …).
- Wynik tabelaryczny: sort **najnowsze na górze** (po `DATA_OD` / pierwszej kolumnie `DATA*`), nulls na dole.
- Pliki: `oracle-result-format.util.ts`, `oracle-query.service.ts`, `oracle-agent.service.ts`.

### 2026-07-21 — stanowiska vs BHP (`SELECT FROM FROM`)

- Pytanie „Wypisz stanowiska…” → po 0 wierszach (np. literówka **Byś** zamiast **Styś**) probe/LLM brał obce obiekty z RAG (np. `NT_KP_BHP_SRODKI_PRACOWNIK` — też ma pole „Stanowisko”) i psuł SQL (`SELECT FROM FROM …`).
- **Fix:** przy `stanowisk*` kandydaci tylko `STANOWISK|UMOWY_UC|ZATRUD|…`; odrzut zepsutego SELECT; nie uruchamiaj gateway SELECT spoza stanowisk.
- Poprawne SQL listy: `SELECT s.NAZWA AS STANOWISKO, … FROM NT_KP_KDR_STANOWISKA` (bez `FETCH FIRST 1`).

### 2026-07-21 — jakość rozmów zawsze najlepsza

- Usunięto combobox **Jakość** z toolbaru czatu (`QualitySelect`).
- `DEFAULT_CHAT_QUALITY = 'high'` — każde zapytanie idzie z profilem najlepszej jakości (API + UI).

### 2026-07-21 — audyt mapowania aplikacji↔Oracle

- Raport: `docs/AIA_APPLICATION_DB_MAPPING_AUDIT.md` (bez zmian kodu).
- Główne awarie: heurystyczne/sprzeczne bindings, strip SqlJoin, widoki bez kolumn w grafie, lokalnie 0× GUID/help_field_text.
- SQLite lokalnie: 107 importów DLL, 2315 app_objects (wszystkie `inferred`).

### 2026-07-21 — plan naprawy ekstrakcji / modelu wiedzy

- Plan: `docs/AIA_KNOWLEDGE_EXTRACTION_REPAIR_PLAN.md` (bez implementacji).
- Etapy: diagnostyka GUID → reconcile XML → help → kolumny widoków → SqlJoin → binding confidence → dedupe → re-import ze stabilnymi chunk id.
- SQL generator / prompty / Qdrant retrieval — poza zakresem do czasu czystych faktów.

### 2026-07-22 — Etap 1 TypeDef metadata (continuation) ✅

- Reader: `tools/TetaDllMetadataReader` (System.Reflection.Metadata, **bez** wykonywania DLL).
- Live: **3030** `verified_exact` (było 0); registryStatus=confirmed dla **3561** PA; Help 1773.
- Referencja: `plgListaPlac` → `…UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen` = verified_exact (ns+name).
- Statusy rozdzielone; `confidence` deprecated. Help nie obniża rejestru.
- **Domknięcie diagnostyczne:** `type_not_found` **4** / `class_name_missing` **128** / `dll_unavailable` **398** / `not_checked` **0**; DLL missing: null 128, physical 21, WebConstellation unsupported 377; 1× `matched_unique_simple_name` + `namespaceMismatch`.
- Raport: `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md` (+ slim JSON w docs/; pełny dump w `.local/…full.json`, gitignored — GitHub limit 100 MB).
- **Etap 1 domknięty** — nie startować Help HTML / bindingów / SqlJoin / Qdrant bez prośby.

### 2026-07-24 — Etap 3A Canonical Graph Access Layer ✅

- Streaming indeks SQLite z `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson` → `.local/AIA_CANONICAL_GRAPH_STAGE3A.sqlite` (`teta-aia-graph-index-v1`).
- Build ~217s: **864320** nodes / **992993** edges / **2.5M** names / **5432** conflicts; integrity 0 missing endpoints.
- `CanonicalGraphIndexService` + `CanonicalGraphResolverService`; CLI `graph:stage3a` (`build|status|resolve|trace-*|audit --strict`).
- Ambiguous nie auto-resolved; konflikty propagowane; target/lookup split; UNKNOWN ≠ confirmed.
- Audit `--strict` EXIT 0; refs A–F OK; testy `teta-stage3a.spec.ts` (21).
- Artefakty: `docs/AIA_CANONICAL_GRAPH_ACCESS_STAGE3A.md` / `.json` (`.local` gitignored).
- **Bez** SQL gen / Qdrant / embeddingów / LLM / agenta (Stage 3B osobno).

### 2026-07-24 — Etap 2E.1 patch metryk dataset_column ✅

- `datasetColumnsResolvedToOracle` / `datasetColumnsUnresolved` = unikalne `dataset_column` w końcowym grafie (nie inkrement przy tworzeniu krawędzi).
- `resolved + unresolved = |dataset_column|`; strict sprawdza spójność z nodes/edges + 3 resolve edges w Ref A.
- Test 18; `--strict-semantic` EXIT 0.

### 2026-07-23 — Etap 2E.1 patch jakościowy (pre-commit) ✅

- `DISPLAYS_FROM` → wyłącznie `dataset_column` (odtworzone edge id; 0 bezpośrednich do `oracle_column`).
- `integrity.orphanNodes` przebudowywane po normalizacji (bez stale `.NET` jako oracle).
- `owner=UNKNOWN` nie może mieć `confirmed*`; remap do typed ID z real owner / demotion `unresolved_owner|preserved_from_dll`.
- Strict: `directLookupDisplayToOracleColumns` / `dotnetNamesTypedAsOracleObjects` / `confirmedOracleObjectsWithUnknownOwner` / `staleOrphanReferences` / `referenceChainsContainingUnknownConfirmedOracle` = **0**; `--strict-semantic` EXIT 0.
- Testy: +3 w `teta-stage2e1.spec.ts` (łącznie 17).

### 2026-07-23 — Etap 2E.1 Canonical Graph Semantic Integrity ✅

- Post-processing **tylko** na wyniku 2E (bez zmiany ekstraktorów 1–2E): domeny, walidacja `oracle_object`, `dataset_column`, Oracle identity owner+type+name, typed refs A–F, orphan classification, conflict metrics.
- CLI: `pnpm --filter @teta/api run diagnose:stage2e -- --from-existing --strict-semantic` (**EXIT 0**).
- Ref A: target `NT_KP_KOS_KARTA_OPISU_STAN.ZSTP_ID` + lookup `NT_KP_SLO_TYPY_STANOWISK.ID/NAZWA` (typed IDs; bez .NET / `TypyStanowisk.*` jako Oracle).
- Ref D: `tbbZamknijMiesiac` + `parameterName=KP_UPR_KART_LIST_ZAMKNIJ_MIES` (merge action:/control: twin).
- Metryki: unexpectedOrphans/invalidDomainOrphans/domainEdgeViolations/brokenEdges/duplicateCanonicalIds = **0**.
- Kod: `teta-stage2e1.*.ts`; testy `teta-stage2e1.spec.ts`. Artefakty: te same `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.*` + NDJSON (sekcja Stage 2E.1).
- **Etap 2E.1 zamknięty.** Nie startować generatora SQL / Qdrant / agenta / embeddingów bez prośby.

### 2026-07-23 — Etap 2E Canonical Knowledge Graph + Oracle enrichment ✅

- Scalenie 1–2D w jeden graf `nodes[]`/`edges[]` ze stabilnymi ID (`teta-aia-canonical-id-v1`), provenance, target/lookup split (`DISPLAYS_FROM`).
- Oracle read-only: ALL_OBJECTS / ALL_TAB_COLUMNS / ALL_CONSTRAINTS / ALL_DEPENDENCIES / ALL_PROCEDURES / ALL_ARGUMENTS; missing-in-db zachowuje fakt DLL.
- Live (--strict): ~836k nodes / ~888k edges; **0** broken edges / **0** duplicate IDs; refs A–F OK; Oracle confirmed ~19.9k / missing **898**.
- CLI: `pnpm --filter @teta/api run diagnose:stage2e` (`--no-oracle`, `--strict`, `--limit`).
- Artefakty: `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.md` / `.json`; NDJSON `.local/…STAGE2E.full.ndjson`.
- Kod: `teta-stage2e.*.ts`; testy `teta-stage2e.spec.ts` (≥15).
- **Etap 2E zamknięty.** Domknięty jakościowo przez **2E.1** (ten sam dzień). Nie startować generatora SQL / Qdrant / agenta bez prośby.

### 2026-07-23 — Etap 2D.1 semantic normalization ✅ (Etap 2D definitywnie zamknięty)

- Warstwa post-IL (bez zmiany dekodera IL / 1 / 2A / 2B / 2C): `teta-stage2d-normalize.ts` + Stage 2B NDJSON tylko odczyt.
- Naprawy: `datasetTable` (nie kolumny typu `SKLP_ID`); `mainSource` z 2B/join; `conditionStatus` (nie `manual_required` dla `AddJoin(...,null)`); merge join evidence; `declared/inherited/effectiveJoins`; `rawAlias`/`normalizedAlias`; projected bez udawania `LIPL.TYTUL` jako DataSet name; deps calculated.
- Live: **1577** datasetTable misclass fixed; **5489** confirmed datasetTable; **5663** confirmed mainSource; **174** duplicate joins merged; **1734** inherited joins; **108** projected bez explicit alias; **1131** calculated deps.
- Referencje A–D OK (NarastajacoBO, ObliczZamknPracTG, ListyBaseBO/LUMO1, null-condition status).
- Artefakty: `docs/AIA_SQLJOIN_STAGE2D.md` / `.json` (sekcja Stage 2D.1); NDJSON `.local/`; CLI bez zmian `diagnose:stage2d`.
- **Etap 2D zamknięty definitywnie.** Nie startować generatora SQL / Qdrant / agenta bez prośby.

### 2026-07-23 — Etap 2D SqlJoin reconstruction ✅

- IL-only model grafowy joinów: `AddJoin` / `JoinDefinition` / `AddColumn`(+join overload) → joinedObject, alias, joinType, condition rozbita, projected/dataset columns.
- Seed: te same bos/BO/DF co Stage 2B (z dumpa 2A). **Bez** SQL, Oracle, Help, Qdrant, LLM.
- CLI: `pnpm --filter @teta/api run diagnose:stage2d` → `docs/AIA_SQLJOIN_STAGE2D.md` (+ JSON; NDJSON `.local/`).
- C#: `Stage2dJoinAnalyzer.cs` (nie zmienia 2A/2B/2C). Testy: `teta-stage2d.spec.ts`.
- Domknięty jakościowo przez **2D.1** (ten sam dzień).

### 2026-07-22 — Etap 2C Help semantic mapping ✅

- Help opcjonalny: `{clientDirectory}/Help/{GUID}.html` (GUID z PA). Statusy `help_*` **nie obniżają** registry/class/binding/Oracle confidence.
- Encoding: ISO-8859-2 / Windows-1250 / UTF-8(+BOM); parser strukturalny (bold dash, tabela Pole|Opis, dl, overview dictionary, akcje).
- Match deterministyczny (bez LLM): label → control → fakty 2A + 2B; target vs lookup rozdzielone.
- CLI: `pnpm --filter @teta/api run diagnose:stage2c` → `docs/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.md` (+ JSON; NDJSON `.local/`).
- Referencje OK: Typ stanowiska→`lcboTypStanowiska`→ZSTP_ID / TypyStanowisk; DicRodzajeKoncesji Kod/Nazwa/Aktualna→NT_LG_SLO_RODZAJE_KONCESJI; Zamknięcie miesiąca→`tbbZamknijMiesiac`+`parameterName` (nie kolumna danych); missing Help zachowuje graf techniczny.
- **Etap 2C zamknięty.** Następny: Etap 2D SqlJoin (zrobiony 2026-07-23). Nie startować generatora SQL / Qdrant bez prośby.
- Kod: `teta-stage2c-*.ts`; testy `teta-stage2c.spec.ts`.

### 2026-07-22 — Etap 2B bos DLL / gateway / Oracle ✅

- Wejście: BO/DF + bos z Stage 2A (nie pełny skan). C#: `BosDllResolver` + `BosGatewayAnalyzer` (IL ctory/settery/gettery TG/MTG, late-binding).
- Live: **304** bos resolved; **3237** gateway; **2065** views / **2211** packages; Oracle confirmed **5571** / missing-in-db **502** (fakt DLL zachowany).
- Łańcuchy: formDatasource→gateway **37770**; formColumn→oracle **15418**; lookup split (lcboTypStanowiska: target `KartaOpisuStanowiska.ZSTP_ID` / lookup `TypyStanowisk.ID`+`NAZWA`).
- Referencje: RodzajeKoncesjiDF→TG/MTG `RodzajeKoncesji` / `NT_LG_SLO_RODZAJE_KONCESJI` / `…_DAC` + Oracle OK; ActUsuwanie BO late-bind `FirmyUzytkownikaTG` (bosSOrganizacja) — stąd brak w IL pluginu.
- CLI: `pnpm --filter @teta/api run diagnose:stage2b` → `docs/AIA_BOS_ORACLE_MAPPING_STAGE2B.md` (+ JSON; NDJSON w `.local/`).
- **Nie ruszane:** Help, SqlJoin, generator SQL, Qdrant.

### 2026-07-22 — Etap 2A.1 semantic normalization ✅ (Etap 2A zamknięty)

- Domknięcie jakościowe przed 2B: rozdział `dataMember` / `datasetTable` / `format` / `parameterName` (bez Format w dataMember); `ParameterName` → `propertyBindings` + `control_parameter` / `control_permission_parameter`.
- Kategorie pól: `uiControls` / `dataObjects` / `businessObjectFields` / `constants` / `technicalFields` / `syntheticTargets`; `controlCount` deprecated.
- `set_Item` → `dataOperations.indexer_assignment` (bez kontrolki `Item`); DF bez auto `datasource_DF` / `relatedDf` bez dowodu IL.
- Live: **2794** form; **98379** uiControls; **0** bindingsWithMultipleDataMembers; **4616** format; **1474** parameterName; **2256** indexer ops; **17** datasource_DF / **3825** form_DF.
- Referencje OK: ListyZamknieteWidok (format `d` + KP_UPR parameterName; WalutyDF tylko form_DF), SkladnikiNarastajaco (`ROK_NUMER`+`F0`), ActUsuwanie (dataOps + kategorie m_DataSet/m_BO/FIRMY_*).
- Artefakty: `docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.md` / `.json` (sekcja Stage 2A.1); testy `teta-stage2a-bindings.spec.ts`.
- **Etap 2A definitywnie zamknięty.** Nie startować: bos-DLL deep, Oracle map, Help, SqlJoin, Qdrant / 2B bez prośby.

### 2026-07-22 — Etap 2A IL technical bindings ✅

- Reader: `TetaDllMetadataReader --stage2a` — dekoder IL + stack reconstruction (setters, DesignModeColumn/Table, BO/DF ctors); **bez** wykonywania kodu; Etap 1 nietknięty.
- Live audit (pre-2A.1): **2794** formularzy; ~**2474** z control binding; ~**70k** confirmed bindings; **2234** BO / **1472** DF / **303** bos DLL.
- Referencje OK: DicRodzajeKoncesji, StanowiskoWStrukturzeOrgWidok, ActUsuwanieWynikowObliczen (BO/Parametry confirmed).
- CLI: `pnpm --filter @teta/api run diagnose:stage2a` → `docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.md` (+ slim JSON; NDJSON w `.local/`).
- **Następstwo:** 2A.1 semantic normalization (powyżej) — Etap 2A zamknięty.

### 2026-07-21 — Etap 1 rejestr formularzy PA_WTYCZKI ✅ (kod)

- Źródło kanoniczne: Oracle **`PA_WTYCZKI`** (nie plugins.xml).
- Łańcuch: GUID → ASSEMBLY → DLL → NAZWA_KLASY → `Help/{GUID}.html`.
- Merge deskryptorów: PA > DLL meta > XML > infer; infer tylko bez wpisu PA.
- `confidence=confirmed` tylko przy pełnym łańcuchu + istniejącym helpie.
- Form identity: `guid:className` / pole `guid:className:control`.
- CLI: `pnpm --filter @teta/api run diagnose:pa-wtyczki` → `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.md`.
- **Live 2026-07-21 wieczór:** VM `172.22.240.145` timeout (NJS-510), `A:` *Brak dostępu* — metryki live = 0; unit 16 OK. Po `net use` + VM ponowić diagnose + integration spec.
- **Nie ruszane:** bindingi kolumn, SqlJoin, Qdrant retrieval, generator SQL.

### 2026-07-21 — Etap 0 diagnostyki plugins.xml ✅

- **Root cause A:** brak `plugins.xml` pod `{clientDirectory}/Plugins/plugins.xml`.
- `clientDirectory` = `A:\TETA Aplikacja klienta - 33.5` (istnieje, z SQLite); skan w client+server (depth 4) = 0× `plugins.xml`.
- Skutek: 425/425 DLL → infer; 0 GUID → help nie mapowany mimo **2064** plików `Help/*.html`.
- Artefakty: `docs/AIA_PLUGIN_XML_DIAGNOSTIC.md` + `.json`; CLI `pnpm --filter @teta/api run diagnose:plugins-xml`.
- Kod read-only: `teta-plugin-xml-diagnostic.ts`, `teta-plugin-assembly-match.util.ts` (+ testy); **bez** zmian importu / SQLite write / Qdrant.
- **Następstwo:** Etap 1 przeszedł na kanoniczne **PA_WTYCZKI** (plugins.xml opcjonalny).

### 2026-07-20 — skan wtyczek = 0 DLL

- Przyczyna: dysk `A:` mapowany na **`\\172.26.228.145\teta`** → stan **Brak dostępu** po zmianie IP VM.
- Ścieżki w SQLite: `A:\TETA Aplikacja klienta - 33.5` / `A:\TETA Serwer Aplikacji - 33.5` — katalog `Plugins` nieosiągalny → skan zwraca [].
- Fix: `net use A: /delete` → `net use A: \\172.22.240.145\teta /user:WIN-PDDJCBNU8LI\Administrator <hasło> /persistent:yes`

### 2026-07-17 — wdrożenie pipeline (help→DLL→widoki→tabele→pakiety→RAG)

**Kod:**
- `teta-plugin-candidate-probe.ts` — zbiera kandydatów (widoki przed tabelami), buduje SQL per obiekt, stop przy pierwszym wyniku z wierszami
- `oracle-agent.service.ts` — pętla probe zamiast jednego SELECT; przy 0 wierszach **nie** kończy odpowiedzią „brak wierszy”, tylko następny kandydat / pakiety / LLM
- `forceOutputTable` + link `PRAC_ID` (KDR) obok `IPRA_ID`
- KDR stanowisko: `JOIN NT_KP_SLO_STANOWISKA` → kolumna `STANOWISKO` (nazwa)
- Hints: doładowanie DLL z rankingu help (`supplementBundlesFromHelp`)
- Gateway hints: `relatedPackages`

**Smoke Oracle (Beata Styś, ID 1033):**
1. `IMP_UMOWY_UC` → 0
2. `IMP_STANOWISKA` → 0
3. `KDR_STANOWISKA` → 3 wiersze, aktualne: **SPECJALISTA DS. KADR** (`DATA_DO` null)

**Testy:** `teta-plugin-candidate-probe.spec.ts` + dotychczasowe resolver — OK.

### 2026-07-17 — standard pipeline asystenta (Oracle / dane z Tety)

**Ustalona kolejność (obowiązujący standard):**

1. **Dopasuj wtyczkę (DLL)** do pytania — RAG Help (`teta_plugin` /help) → kontekst formularza/pola → konkretna DLL.
2. **W DLL** znajdź bindingi kolumn (etykiety UI ↔ Oracle) → widok / tabela / pakiet.
3. **Wykonaj SELECT** na wyselekcjonowanych obiektach: **najpierw widoki, potem tabele**. Pierwszy wynik z wierszami = **stop** i pokaż użytkownikowi (max kilka kandydatów, w budżecie timeoutu).
4. Jeśli pkt 3 puste — sprawdź **powiązane pakiety** (`_DAC` / `_AGL` / `_LEP` / funkcje) pod kątem pobrania danych.
5. Nadal brak — **stara ścieżka**: agent LLM + RAG (schema / docs / plugin), jak dziś.

**Reguły:**
- Kandydaci tylko z kontekstu pytania (help + mapowania DLL), nie pełny katalog Oracle.
- Preferuj kolumnę tekstową (`NAZWA` / `STANOWISKO`) przed samym `*_ID`.
- Przy 0 wierszach **nie** kończ od razu komunikatem „brak w źródłach” — dopiero po wyczerpaniu 1–4.
- Pytania o *znaczenie pola* (nie o dane) nadal mogą kończyć się na helpie (`application_help`) bez SQL.

**Stan kodu dziś:** szybka ścieżka = jeden `buildDirectPluginSelect` + jeden obiekt; przy 0 wierszach często skok do docs/RAG zamiast kolejnych widoków/pakietów.

### 2026-07-11 — metadane wtyczek / RAG (plan od nowa)

- Cofnięto eksperymentalny import JSON plugin-metadata z TCHelper — startujemy od zera **w TetaAIAssistant**.
- **TCHelper** = tylko wzorzec algorytmów (`Program.cs`, przykładowy `plgDaneOsobowe.json`).
- **Bez pośredniego importu JSON** — funkcjonalność wbudowana w aplikację.
- **Wszystkie nowe funkcje (odkrywanie powiązań wtyczka↔Oracle, baza wiedzy RAG) — tylko tryb VENDOR:**
  - build: `TETA_APP_MODE=vendor` / paczka vendor MSI
  - runtime: `VendorAccessGuard` + tryb pracy **Vendor** przy logowaniu (nagłówek work-mode)
  - wzorzec jak: `VendorRagController`, `VendorSchemaLearningController`, ingest wideo
- Klienci (instalacja client) **nie** dostają tych endpointów ani UI.
- **Ustawienia → Aplikacja Teta** (vendor): ścieżki `clientDirectory` + `serverDirectory` w SQLite (`app_settings`); API `GET/PUT /api/vendor/teta-app/paths`.
- **Sidebar → Wtyczki Teta** (vendor only, nad AI Doctor): `TetaPluginsView` — moduł metadanych wtyczek. **RAG bulk/delete (2026-07-14):** usuń RAG jednej DLL, usuń cały RAG (`USUN_WSZYSTKIE_RAG_WTYCZEK`), import zbiorczy z postępem `Importuję N/M`.

**Spec UI / danych (2026-07-11, ustalenia):**

| Reguła | Wartość |
|--------|---------|
| Źródło | `{clientDirectory}/Plugins/**` |
| Jednostka | **każdy plik `.dll`** w podkatalogach |
| Wykluczenia | segmenty ścieżki `en` / `hu` **gdziekolwiek** w drzewie |
| Zaimportowany | cała wtyczka (DLL) ma chunki w RAG (`teta_global`, jak Oracle metadata) |
| Grid główny | kafelek = **nazwa DLL** + status importu; nagłówek **X / Y** (w RAG / wszystkie DLL); filtry: **Kategoria**, **Status RAG** (wszystkie / w RAG / bez importu), **Szukaj** (nazwa, ścieżka, kategoria); przycisk Importuj ze spinnerem w trakcie |
| Klik (zaimportowany) | panel szczegółów: chunki RAG, obiekty Oracle (widoki/tabele/pakiety), gatewaye z **SELECT/INSERT/UPDATE/DELETE**, kolumny UI |
| Źródło deskryptora | **plugins.xml opcjonalny** — jeśli brak pliku/wpisu, inferencja z DLL (stringi), katalog serwera, opcjonalnie źródła `.cs` |
| Wzorzec algorytmów | TCHelper `Program.cs` — bez importu JSON |

**Kolejność implementacji:** (1) skan DLL + API status ✅, (2) grid UI ✅, (3) ekstrakcja metadanych + import RAG ✅, (4) widok szczegółów (częściowo — podsumowanie w modalu).
- API: `GET /api/vendor/teta-plugins/status`, `POST /api/vendor/teta-plugins/import`, `GET /api/vendor/teta-plugins/import/detail?dllPath=…`
- Ekstrakcja: **bez TCHelper w runtime** — TCHelper tylko wzorzec algorytmów (nie budować, nie wywoływać przy imporcie). Inferencja natywna z DLL BO na serwerze (`BusinessObjects/`): gatewaye MTG/TG, metadane Oracle, kolumny UI z zasobów w DLL wtyczki
- **Pakiety Oracle:** `_DAC` (starsze moduły), `_AGL` (uniwersalne CRUD — SELECT/INSERT/UPDATE/DELETE), `_LEP` (custom od twórcy). W panelu szczegółów importu pokazywać **wszystkie** odkryte obiekty: widoki, tabele, pakiety DAC/AGL/LEP, datasety, aliasy
- **Kolejność SQL (natywnie w API, bez TCHelper.exe):** (1) SELECT z widoku + alias + kolumny z Oracle gdy są 4 pola buildera; (2) INSERT/UPDATE/DELETE z pakietów `_DAC` / `_AGL` / `_LEP`; (3) fallback `SELECT` ze wszystkimi kolumnami tabeli/widoku (`ALL_TAB_COLUMNS`). TCHelper `Program.cs` = tylko wzorzec algorytmów, nie runtime.
- `missing_metadata` = brak 4 pól buildera (widok, alias, pakiet, tabela DataSet) — uzupełniane heurystyką z katalogu stringów w DLL BO
- Źródła `.cs`: `TETA_PLUGIN_SOURCE_ROOT` → katalog serwera → katalog klienta
- RAG: `source_type=teta_plugin`, prefiks `teta-plugins/{relativePath}/…`, kolekcja `teta_global`, merge + replace chunków po źródłach
- SQLite: `teta_plugin_imports.metadata_json` — snapshot metadanych po imporcie

**Oracle agent + wtyczki (2026-07-11):**
- Tryb czatu **Baza Oracle** (`source=oracle`) przed pętlą agenta robi RAG po `source_type=teta_plugin`
- Trafienia → `metadata_json` (SQLite) → widok, alias, sugerowany `Direct.Select`
- Wstrzykiwane do promptu agenta (`TetaPluginHintsService`, `oracle-agent.service.ts`)
- Agent wykonuje SELECT przez istniejący `OracleQueryService` → `oracle_report` w UI (tabela)
- Wymaga: import wtyczki + **Analizuj bazę** (graf schematu) + Oracle real
- **Mapowanie kolumn UI → Oracle (2026-07-11):** etykieta / nazwa z SELECT gatewaya (DLL) → dopasowanie do `schema_columns` (exact, fuzzy, komentarz). Fast path używa **widoku** z gatewaya (`NT_KP_PRC_PRACOWNICY`), nie `T_PRAC`. Gdy brak dopasowania w grafie — brak szybkiej ścieżki, agent + `describe_table`.
- **Weryfikacja obiektów Oracle przy imporcie wtyczki (2026-07-11):** przed zapisem do RAG (`validatePluginBundleAgainstOracle`) każdy kandydat z DLL/gatewayów jest sprawdzany w `ALL_OBJECTS`: `TABLE`, `VIEW`, `PACKAGE`. Fałszywe tabele (`T_01`, `T_FAX`), widoki i pakiety są odrzucane; referencje w gatewayach (`ViewName`, `BaseTableName`, `PackageName`, `RelatedPackages`) też. Wymaga Oracle real; bez połączenia — heurystyka bez zmian. **Ponowny import** wtyczki po zmianie.
- **RAG bez hardcodingu etykiet (2026-07-11):** chunk gatewaya + pole `Sql.LabeledSelect` w metadanych importu — `SELECT` z aliasami `AS "etykieta grida"`. Mapowanie: kolumny z `<SqlColumns>` + etykiety z DLL/resx (wszystkie formularze wtyczki) + opcjonalnie komentarze Oracle ze schematu. UI pokazuje **LabeledSelect** zamiast surowego `Direct.Select` (inferencja z ALL_TAB_COLUMNS). **Ponowny import** `plgPracownik` po tej zmianie.
- **Follow-up w wątku Oracle (2026-07-11):** pytania typu *„adres zameldowania tego pracownika”* bez nr ewidencyjnego — szybka ścieżka bierze wartość filtra i kolumnę `WHERE` z historii (poprzednie pytanie / `[SQL: …]`). Kolumny wyniku (np. `S_ULICA`, `S_MIEJSCOWOSC`) muszą być w `columnMappings` z importu (etykiety grida lub komentarze Oracle — kolumny `S_*` często bez grida w DLL).
- **Poprawki RAG po audycie (2026-07-13):** chunki `fields/{gridColumn}` z pełnym łańcuchem formularz→kontrolka→Oracle; heurystyka `dgcLSZKLataStaz`→`LATA_STAZU`; `RAG_PLUGIN_TOP_K=8`; prompt Oracle z mapowaniami całego gatewaya (`resolveMappingsForPrompt`); tryb docs dla pytań o pola formularza filtruje `teta_plugin`. **Ponowny import wtyczek** po wdrożeniu.
- **Fix szybkiej ścieżki SQL (2026-07-13):** pytanie *„imię i nazwisko pracownika o numerze ewidencyjnym 00122”* nie może budować SELECT z 70+ kolumn (błąd `MPK nie istnieje` → fallback LLM ~90 s). `resolveColumnMappingsForSql` + ścisłe dopasowanie (`queryStrictlyMentionsLink`, bez nazw `dgc*` i stemów „pracownik”); max 8 kolumn OUTPUT; filtrowanie kolumn względem schematu. Oczekiwany SQL: `SELECT IMIE, NAZWISKO FROM … WHERE NR_EWD = '00122'` (~1–2 s). Restart API (`pnpm dev` watch) i ponowny test w UI.
- **Wiek pracownika (2026-07-13):** follow-up *„ile ma lat / wiek tego pracownika”* — brak kolumny WIEK; szybka ścieżka: `TRUNC(MONTHS_BETWEEN(SYSDATE, DATA_URODZENIA)/12) AS WIEK` + WHERE z historii (nr ewidencyjny). Bez kontekstu pracownika → dopytanie zamiast SELECT wszystkich. Słowo „lat” nie może trafiać w `LATA_STAZU`.
- **Computed intents + filtry bez hardcodu (2026-07-13):** formuły SQL (np. wiek) w `apps/api/config/teta-computed-intents.json`; język zapytań (przyimki filtra, grupy imiennych) w `apps/api/config/teta-query-language.json`. Ekstrakcja jawna: etykiety/synonimy z mapowań wtyczki. **Filtr implicite:** np. *„Podaj wiek pracownika Kowalski Janusz”* → `WHERE (NAZWISKO='Kowalski' AND IMIE='Janusz') OR (…odwrotna kolejność…)` — role z tokenów etykiet (`nazwisko`, `imie`) powiązane z kolumnami z metadanych; bez zgadywania kolejności w jednym SQL. Jedno nazwisko: `WHERE NAZWISKO='Kowalski'`. **Fix zapętlenia ~90 s (2026-07-13):** przy filtrze implicite nie wykluczać kolumny OUTPUT na podstawie `resolveFilterMappingFromQuery` (błędnie wiązało `DATA_URODZENIA` ze słowem „urodzenia” w pytaniu → pusty SELECT → fallback LLM). Dodatkowo: `queryNoiseTokens` + `ma`, pomijanie tokenów etykiet mapowań w literałach, `date`↔`data` (prefiks 3 znaki), case-insensitive `UPPER()` w WHERE. **Wiek teoretyczny + thinking:** lata w kontekście daty (np. lipiec 2026, styczeń 1998) nie są filtrem pracownika; pytanie bez rekordu → LLM. Agent Oracle: `TETA_ORACLE_AGENT_THINK=true` domyślnie, `num_predict` 4096. **Follow-up „Ok, a teraz powiedz…” (2026-07-13):** tokeny `ok`/`teraz`/`powiedz` w `queryNoiseTokens` + fallback `selectPersonNameLiterals` — inaczej 5 literałów → brak filtra imiennego → pętla LLM ~100 s. Orchestrator streamuje pierwszą próbę na żywo (`createNdjsonResponseTee`), nie buforuje do końca.

### 2026-07-14 — limity czasu agenta Oracle

- **Problem:** pętla agenta (do 10 kroków × timeout Ollama 10 min) → wiszenie ~900 s bez odpowiedzi.
- **Fix (2026-07-14):** osobne limity w `.env` — **zastąpione 2026-07-17** jednym budżetem (patrz niżej).

### 2026-07-17 — jeden timeout całego zapytania (180 s)

- **Problem:** „Beata Styś ile ma lat?” — timeout po ~60 s (`TETA_ORACLE_AGENT_LLM_TIMEOUT_MS` na pojedynczy krok LLM).
- **Fix:** jeden budżet czasu dla całego zapytania (orchestrator + Oracle + docs + doprecyzowanie + kroki LLM). Domyślnie **180 s**.
- **Konfiguracja:** **Ustawienia → Asystent AI** (SQLite `chat.query_timeout_ms`) lub `TETA_CHAT_QUERY_TIMEOUT_MS=180000` w `apps/api/.env`. Przeglądarka: +15 s (`clientStreamTimeoutMs` z `/api/chat/runtime`).
- **Stare zmienne** (`TETA_ORACLE_AGENT_TOTAL_TIMEOUT_MS`, `TETA_ORACLE_AGENT_LLM_TIMEOUT_MS`, `TETA_CHAT_ORCHESTRATOR_TIMEOUT_MS`) — ignorowane przez kod; można usunąć z `.env`.
- **Pliki:** `chat-query-timeout.service.ts`, `ChatAssistantSettingsPanel`, `chat-orchestrator.service.ts`, `oracle-agent.service.ts` (`remainingMs(agentDeadline)` zamiast stałego 60 s/krok).

### 2026-07-17 — historia: „Nowa rozmowa · 0 wiad.”

- **Bug:** przy starcie / „Nowa rozmowa” od razu `POST` pustego rekordu → w historii „Nowa rozmowa · 0 wiad.”; potem po odpowiedzi aktualizacja.
- **Fix:** szkic tylko lokalnie (`crypto.randomUUID`); zapis na serwer przy pierwszej wiadomości (PUT upsert); lista historii usuwa/filtruje puste; `saveChatConversation` nie zapisuje `messages: []`.


- **Problem:** „A jakie ma Beata Styś aktualne stanowisko?” → timeout 180 s. Log: szybka ścieżka budowała `SELECT UP_TO_DATE…` albo w ogóle nie budowała SQL → LLM.
- **Przyczyny:** (1) etykieta „Aktualne” / substring „akt”⊂„aktualne”; (2) RAG bez mapowań Stanowisko; (3) `UCP_UMOWY` bez linku IPRA_ID; (4) literał „aktualne” brany jako imię po „Styś”; (5) API padło na `EADDRINUSE` — stary proces na :3000.
- **Fix:** matcher OUTPUT, doładowanie mapowań z rejestru DLL, link UMOW→IPRA_ID, preferencja wielkich liter w imionach, restart API.
- **Oczekiwany SQL:** `SELECT STANOWISKO, SSTN_ID FROM …NT_KP_IMP_UMOWY_UC WHERE IPRA_ID IN (SELECT ID FROM …PRACOWNICY WHERE Beata/Styś)`.
- **Uwaga:** źródło to umowy cywilnoprawne (`IMP_UMOWY_UC`) — przy etacie bez UC wynik może być pusty; docelowo pipeline ma próbować kolejne widoki (np. `KDR_STANOWISKA` / `IMP_STANOWISKA`) zanim RAG.

### 2026-07-15 — help kontekstowy Teta (Etap 1)

- **Źródło helpu:** `{clientDirectory}/Help/{GUID-formularza}.html` (ISO-8859-2). GUID z `plugins.xml` / metadanych importu wtyczki.
- **Import wtyczki:** po walidacji `enrichBundleWithHelp()` — parser HTML → `applicationObjects` w `metadata_json` + tabela SQLite `teta_app_objects` + chunki RAG `/help/overview`, `/help/fields/{label}`.
- **Czat (pytanie o znaczenie pola):** trasa `application_help` → RAG `teta_plugin` → `tryResolveHelpAnswer()` (deterministyczna odpowiedź z helpu + binding Oracle); fallback LLM z sekcją `helpPromptSection`.
- **Przykład testowy:** *„Do czego służy pole Staż na formularzu Wykształcenie?”* → help + `LATA_STAZU` / gateway `SzkolyTG`.
- **Wymaga ponownego importu** wtyczek (stary import bez `applicationObjects`). W Ustawieniach → Aplikacja Teta musi być ustawiony `clientDirectory` z katalogiem `Help/`.
- **Pliki:** `teta-help-*.ts`, `teta-application-object.*`, `teta-plugin-help-resolver.ts`, `oracle-agent.service.ts` (`streamApplicationHelpAnswer`).

### 2026-07-16 — timeout na „jaki ma staż ten pracownik”

- **Przyczyna:** brak szybkiej ścieżki + prompt ~100+ kolumn gateway + `think=true` → wiszenie/timeout.
- **Fix:** mały prompt (tylko pola z pytania, max 24); `preferredTable` z outputu; nie filtruj mapowań cross-table; dopytanie bez LLM gdy brak pracownika w kontekście; `SELECT LATA_STAZU … WHERE IPRA_ID IN (SELECT ID …)` gdy jest filtr; `think=false` na krótkich follow-upach.
- **Błąd „Kolumna STAŻ nie istnieje… describe_table”:** LLM wstawiał etykietę UI zamiast `LATA_STAZU`. **Fix:** `rewriteSqlLabelsUsingPluginMappings` przed `executeSelect` + komunikaty użytkownika bez żargonu narzędzi (`formatUserFacingSqlColumnError`).
- **Follow-up „ten pracownik” gubi imię/nazwisko:** UI przy `oracleThreadContext` **nie doklejało** `[SQL: …]` do historii → ginął WHERE. Fix w `ChatView` + reuse pełnego WHERE / implicite imię+nazwisko z historii (`rawWhereSql`).
- **ORA-00904 LATA_STAZU:** SELECT szedł z widoku pracowników (brak kolumny). Rewrite retargetuje na `NT_KP_IMP_SZKOLY` + `IPRA_ID IN (…)`; preferencja IMP_SZKOL vs słownik SLO_*.

---

- Użytkownik pracował na drugim PC; historia czatów Cursor się nie synchronizuje — ten plik + git mają to zastąpić.
- Reguła: na starcie sesji czytać `docs/session-context.md` + `git log`.
- API padało z `Cannot find module dist/main` — wtedy `pnpm --filter @teta/api run build` i restart `pnpm dev`.

---

## Jak aktualizować ten plik

Agent (lub Ty) dopisuje sekcję po ustaleniach:

- **data**, krótki temat
- co ustalono, jakie wartości (IP, SID, flagi env)
- co jeszcze otwarte

Commituj razem ze zmianami kodu, żeby drugi komputer miał pełny obraz.
