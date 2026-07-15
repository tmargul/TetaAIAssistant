# Kontekst rozmów — Teta AI Assistant

> **Plik żywy** — uzupełniany po ważnych ustaleniach w czacie. Synchronizuje się przez git między komputerami.
> Ostatnia aktualizacja: **2026-07-15** (help kontekstowy Teta — Etap 1)

---

## Środowisko dev (ten projekt)

| Element | Wartość |
|---------|---------|
| Dev | `pnpm dev` — API `:3000`, web `:5173` |
| VM Oracle | `WIN-PDDJCBNU8LI` (Hyper-V **Default Switch**) |
| IP VM | **`172.26.228.145`** — **statyczne** (maska `/20`, brama `172.26.224.1`); stary z paczki `172.20.23.182` — inna sieć, nie używać |
| Port / SID | `1521` / **`TETAHR`** |
| Firewall VM | Reguła TCP 1521 z podsieci hosta (`172.26.224.0/20`) |
| Teta na VM (share) | `\\172.26.228.145\teta` — wymaga `net use` z `WIN-PDDJCBNU8LI\Administrator` (mapowany dysk na hoście, np. `T:` lub `X:`) |
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
4. Stara konfiguracja fake (`192.168.1.10`, SID `TETA`) w SQLite powodowała timeout — aktualnie w paczce: `172.20.23.182` / `TETAHR`. NJS-510 = VM nieosiągalna (brak trasy / VM wyłączona), nie błąd aplikacji.
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

## Otwarte / do sprawdzenia

- [ ] **RAG smoke test:** `_temp/zu1/zu1.jsonl` rozpakowany (44 chunki, `trainings/zu1.mp4`) — import + chat po uruchomieniu Qdrant
- [x] VM Oracle: Default Switch, statyczne IP `172.26.228.145`, port 1521 OK
- [x] Ścieżki Teta (vendor): share VM + mapowanie dysku na hoście — **Ustawienia → Aplikacja Teta** zapisuje poprawnie
- [ ] Admin zarejestrowany na real Oracle (nie fake `teta_admin`)
- [ ] Produkcyjne `TETA_ADMIN_CHECK_SQL` od zespołu Teta
- [ ] **Oracle agent + wtyczki:** przetestować w czacie (źródło „Baza Oracle”) pytanie o dane z formularza np. wykształcenie → tabela w wyniku

---

## Notatki sesji

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
- **Fix:** konfigurowalne limity w `.env`: `TETA_ORACLE_AGENT_TOTAL_TIMEOUT_MS=180000` (3 min), `TETA_ORACLE_AGENT_LLM_TIMEOUT_MS=60000` (1 min/krok), `TETA_ORACLE_AGENT_MAX_STEPS=5`, `TETA_CHAT_ORCHESTRATOR_TIMEOUT_MS=240000`. Przy przekroczeniu — event `error` z komunikatem PL + wskazówka `.env`. UI: bezpiecznik 270 s w `chat-stream.ts`.

### 2026-07-15 — help kontekstowy Teta (Etap 1)

- **Źródło helpu:** `{clientDirectory}/Help/{GUID-formularza}.html` (ISO-8859-2). GUID z `plugins.xml` / metadanych importu wtyczki.
- **Import wtyczki:** po walidacji `enrichBundleWithHelp()` — parser HTML → `applicationObjects` w `metadata_json` + tabela SQLite `teta_app_objects` + chunki RAG `/help/overview`, `/help/fields/{label}`.
- **Czat (pytanie o znaczenie pola):** trasa `application_help` → RAG `teta_plugin` → `tryResolveHelpAnswer()` (deterministyczna odpowiedź z helpu + binding Oracle); fallback LLM z sekcją `helpPromptSection`.
- **Przykład testowy:** *„Do czego służy pole Staż na formularzu Wykształcenie?”* → help + `LATA_STAZU` / gateway `SzkolyTG`.
- **Wymaga ponownego importu** wtyczek (stary import bez `applicationObjects`). W Ustawieniach → Aplikacja Teta musi być ustawiony `clientDirectory` z katalogiem `Help/`.
- **Pliki:** `teta-help-*.ts`, `teta-application-object.*`, `teta-plugin-help-resolver.ts`, `oracle-agent.service.ts` (`streamApplicationHelpAnswer`).

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
