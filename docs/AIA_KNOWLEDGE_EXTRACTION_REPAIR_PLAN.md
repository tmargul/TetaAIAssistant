# AIA — plan naprawy warstwy ekstrakcji i modelu wiedzy

**Data:** 2026-07-21  
**Wejście:** [AIA_APPLICATION_DB_MAPPING_AUDIT.md](./AIA_APPLICATION_DB_MAPPING_AUDIT.md)  
**Zakres:** tylko ekstrakcja + model faktów (bez promptów agenta, bez optymalizacji Qdrant retrieval).  
**Status:** plan — **bez implementacji**.

---

## 0. Cel docelowy

AIA musi przechowywać **potwierdzone, jednoznaczne, strukturalne** mapowanie:

```
DLL → formularz → GUID → sekcja → kontrolka → etykieta → help
  → binding → gateway/dataset → alias SQL → tabela|widok → kolumna|wyrażenie
  → SqlJoin → pakiet|funkcja Oracle
```

Do generowania SQL wolno używać wyłącznie mapowań **`confirmed`** (oraz **`probable`** po osobnej walidacji schematu).  
Mapowania `inferred` / `conflicting` / `rejected` pozostają w magazynie jako dowody / raport, nie jako źródło SELECT.

---

## 1. Źródło GUID formularzy

### 1.1 Skąd GUID powinien pochodzić

| Źródło | Plik | Funkcja | Pole |
|--------|------|---------|------|
| **Kanoniczne** | `{clientDirectory}/Plugins/plugins.xml` | `readPluginsXml` → kolumna `GUID` w `Common.Column` | `TetaPluginDescriptorMeta.Guid` |
| Ścieżka XML | `teta-plugin-xml.reader.ts` | `resolvePluginsXmlPath(clientDirectory)` → `…/Plugins/plugins.xml` | — |
| Help HTML | `{clientDirectory}/Help/{guid}.html` | `helpHtmlPath` / `normalizeHelpGuid` | nazwa pliku = GUID bez `{}` |

GUID **nie** jest odtwarzalny z DLL w obecnym `inferPluginDescriptorsFromDll` (brak pola `Guid` w wynikowym deskryptorze).

### 1.2 Dlaczego lokalnie `form_guid` jest pusty dla wszystkich rekordów

Łańcuch (potwierdzony kodem + dump SQLite z audytu):

1. `TetaPluginImportService.resolvePluginDescriptors` (`teta-plugin-import.service.ts` ~L582–636):
   - jeśli XML istnieje **i** `filterPluginsByAssembly(xml, dllName).length > 0` → zwraca deskryptory **z GUID**;
   - w przeciwnym razie → `inferPluginDescriptorsFromDll` (**bez GUID**).
2. `TetaHelpEnrichmentService.enrichBundleWithHelp` (`teta-help-enrichment.service.ts` L31–33):  
   `if (!normalizeHelpGuid(form.Plugin.Guid)) continue;` — **pomija help**.
3. `buildApplicationObjectsForForm` (`teta-application-object.builder.ts` L76, L132–158):  
   przy braku help tworzy obiekty tylko z `columnMappings` z `formGuid: guid` (= null) i `confidence: 'inferred'`, `help_field_text: null`.

**Przyczyna lokalna (najbardziej prawdopodobna, do potwierdzenia w Etapie 0 diagnostycznym):**  
dla zaimportowanych DLL `filterPluginsByAssembly` zwracało `[]` (brak dopasowania `Assembly` do nazwy DLL **albo** brak `plugins.xml` w skonfigurowanym `clientDirectory`) → **cały import poszedł ścieżką infer**.  
Dump: `plgSkladnikiPlac` ma `form_guid: null`, `className: PotraceniaWierzycieleWidok` — typowy wynik inferencji, nie XML.

### 1.3 Czy `plugins.xml` jest odnajdywany i parsowany

| Warunek | Zachowanie |
|---------|------------|
| Plik istnieje + wpisy dla assembly | `readPluginsXml` + filtr → GUID zachowany |
| Plik istnieje, brak wpisu assembly | warn + **infer bez GUID** |
| Brak pliku | log + **infer bez GUID** |

`filterPluginsByAssembly` porównuje `normalizeAssemblyName(plugin.Assembly)` z `dllName` (case-insensitive, dokłada `.dll`).  
**Ryzyko mismatch:** `Assembly` w XML bez ścieżki vs nazwa pliku; inna lokalizacja XML niż `Plugins/plugins.xml` — **UNKNOWN** bez sprawdzenia konkretnej instalacji.

### 1.4 Fallback `inferPluginDescriptorsFromDll`

**Plik:** `teta-plugin-descriptor.infer.ts`  
**Wejście:** stringi DLL + locator `.cs`  
**Wyjście:** `ClassName`, Languages.Name (często z nazwy klasy), **bez Guid**  
**Kiedy:** brak XML lub pusty filtr assembly.

### 1.5 Czy fallback można później powiązać z `plugins.xml`

**Tak — planowany mechanizm „GUID reconcile”:**

1. Zawsze wczytać **pełny** `plugins.xml` (indeks po `Assembly` i po `ClassName` / FQN).
2. Po inferencji:  
   - match `Assembly == dllName` → przepisz `Guid`, Languages, Profile;  
   - else match `ClassName` (simple name) do wpisu XML → przepisz `Guid`;  
   - else match partial FQN.
3. Jeśli nadal brak GUID: oznacz formularz `guidStatus: 'missing'` i **nie** generuj chunków help; nie ustawiaj `confidence=confirmed` dla pól.

### 1.6 Zmiana, aby GUID dotrwał do `teta_app_objects`

| Krok | Plik / funkcja |
|------|----------------|
| Nie gubić XML przy częściowym dopasowaniu | `resolvePluginDescriptors` — merge XML∪infer zamiast XOR |
| Reconcile GUID | nowa `reconcilePluginDescriptorsWithXml(descriptors, xmlAll)` |
| Propagacja | już jest: `buildApplicationObjectsForForm` → `formGuid: guid` → `TetaAppObjectRegistryService.replaceForDll` (`form_guid`) |
| Kryterium | po re-importcie `COUNT(*) WHERE form_guid IS NULL` dla DLL z wpisem XML = 0 |

---

## 2. Help kontekstowy

### 2.1 Dlaczego `help_field_text` nie jest zapisywany

**Nie jest to osobny bug w parserze HTML** przy obecnym stanie danych — `help_field_text` ustawiane jest **tylko** w pętli `input.help.fields` (`teta-application-object.builder.ts` L100–128).  
Bez GUID → `enrichBundleWithHelp` nie ładuje snapshotu → `help === null` → wykonywana jest wyłącznie pętla mappings (L132–158) z `help_field_text: null`.

Lokalnie: **0** rekordów z niepustym `help_field_text` — spójne z **0** GUID.

### 2.2 Czy przyczyna to wyłącznie brak GUID?

| Przyczyna | Status |
|-----------|--------|
| Brak GUID → brak ścieżki Help | **Potwierdzona główna** |
| Brak katalogu `Help/` | możliwa (warn w kodzie) — sprawdzić w Etapie 0 |
| Brak pliku `{guid}.html` mimo GUID | możliwa (`readTetaHelpHtmlFile` → null) |
| Parser nie wyciąga pól z HTML | możliwa dla nietypowego HTML — **UNKNOWN** do czasu testu z realnym plikiem |

### 2.3 Ścieżka `Help/{GUID}.html`

| Funkcja | Wynik |
|---------|--------|
| `resolveHelpDirectory(client)` | `{client}/Help` |
| `normalizeHelpGuid` | lower, bez `{}` |
| `helpHtmlPath` | `{Help}/{guid}.html` |

Zgodne z ustaleniami sesji / audytu. **Poprawność zależy od `clientDirectory` w SQLite ustawień Teta.**

### 2.4 Rola `TchelperRunnerService`

| Fakt | Dowód |
|------|-------|
| Potrafi odpalić TCHelper.exe → JSON formularzy (gateway SQL, kolumny builder) | `tchelper-runner.service.ts` `tryExtractMetadata` |
| Merge po GUID/ClassName | `mergeTchelperMetadata` w tym samym pliku |
| **Nie jest wywoływany** z `TetaPluginImportService.importPlugin` | audyt / grep |

**Docelowa rola w planie:** opcjonalne **wzbogacenie SQL/gateway** (BuilderText z żywym SqlJoin), **nie** zastępstwo GUID z `plugins.xml`.  
Włączanie do runtime: **Etap 4 (opcjonalny)** — za flagą `TETA_TCHELPER_ENABLED`, po naprawie GUID/XML. Nie blokuje Etapów 1–3.

### 2.5 Potwierdzenie help ↔ formularz ↔ kontrolka

Wymagane dowody dla `confirmed` help:

1. `form.Plugin.Guid` = nazwa pliku HTML (po normalizacji).  
2. `help.title` / sekcje z HTML.  
3. Pole help: etykieta z parsera (`<b>…</b>`) + `description`.  
4. Binding: `gridColumnName` z mappings **oraz** (preferowane) kolumna z `<SqlColumns>` gatewaya tej samej formy.  
5. `object_id` stabilny: `{dllStem}:{formGuid}:{gridColumnName|helpLabelKey}`.

### 2.6 Test integracyjny help (jeden realny formularz)

**Setup:** `clientDirectory` z istniejącym `plugins.xml` + `Help/{guid}.html` dla formularza pracowników / wykształcenia.

**Kroki:**

1. Zaimportować jedną DLL (np. `plgPracownik.dll` lub `plgDaneOsobowe.dll`).  
2. Assert: `form_guid IS NOT NULL`.  
3. Assert: istnieje plik `Help/{form_guid}.html`.  
4. Assert: ≥1 `teta_app_objects` z `help_field_text IS NOT NULL` i `confidence='confirmed'`.  
5. Assert: `field_label` z help odpowiada etykiecie w HTML; `binding.oracleColumnName` należy do `<SqlColumns>` gatewaya formularza (po parse).

---

## 3. Binding kontrolka → Oracle

### 3.1 Przepływ obecny

```
parseGatewaySelect(gateway)           → lista kolumn Oracle z SELECT / <SqlColumns>
  → buildGridOracleColumnLinks        → dla KAŻDEJ kolumny Oracle znajdź „najlepszą” kolumnę grida
    → findGridLinkForOracleColumn
      → scoreGridColumnForOracle      → heurystyka nazw
  → buildColumnMappingsFromBundle     → 1 mapping na (gateway × link)
  → findBestMapping (help)            → score etykiet ≥ 0.6
```

**Kluczowa inwersja:** iteracja idzie **Oracle → UI**, nie **UI → Oracle**. Jedna etykieta/grid może wygrać dla wielu kolumn Oracle (`IMIE`, `IMIE_OJCA`, …).

### 3.2 Heurystyki w `scoreGridColumnForOracle` (`teta-plugin-grid-column-mapper.ts`)

| Mechanizm | Wejście | Wynik | Problem |
|-----------|---------|-------|---------|
| Label == oracle (score 100) | `Labels.PL`, nazwa kolumny | exact | rzadkie |
| `gridColumnMatchesOracleColumn` (80) | `dgcAbsencjaImie` → kandydaci snake/compact | `IMIE` match | też `IMIE_OJCA` via endsWith/token |
| Kandydaci z `gridColumnOracleCandidates` (75/65) | camelCase→SNAKE, endsWith | słabe dopasowania | **Nr ewidencyjny / ID** |
| `oracleTokensOverlapGrid` | tokeny `IMIE`∩`Imie` | score > 0 dla wszystkich `IMIE_*` | **Imię → IMIE_OJCA** |
| `findSchemaCommentLabel` | komentarz ALL_COL_COMMENTS | link bez grid | szum |
| Brak minimum score przy emitowaniu wielu linków | — | każdy oracle z score>0 może dostać ten sam grid | duplikaty |

### 3.3 Dlaczego konkretne błędy (z audytu)

| Objaw | Mechanizm |
|-------|-----------|
| `Nr ewidencyjny` → `ID` **i** `NR_EWIDENCYJNY` | SELECT zawiera obie kolumny; grid `dgc*NrEwidencyjny` wygrywa też dla `ID` (słaby overlap / kolejność); **dwa linki** → dwa mappings |
| `Imię` → `IMIE_OJCA` / `IMIE_MATKI` | token `IMIE` wspólny; brak reguły „preferuj exact stem bez sufiksu” |
| `Kwota wypłacona` → `ID` | `dgcAmountPaid` nie mapuje się semantycznie do kwoty; wygrywa przypadkowa kolumna z listy SELECT (często `ID` na początku / overlap) |

### 3.4 Bardziej bezpośrednie źródła bindingu (do wykorzystania)

| Źródło | Gdzie | Jakość |
|--------|-------|--------|
| **Kolejność / alias w builder SQL** | `<SqlColumns>PRAC.IMIE, …` + etykiety grida w tej samej kolejności (jeśli Teta/TCHelper je koreluje) | wysoka gdy 1:1 |
| **LabeledSelect / AS "etykieta"** | `enrichGatewaysWithLabeledSelect` | średnia–wysoka |
| **Resources: GridColumnName ↔ DisplayedName** | już mamy etykietę | nie daje Oracle |
| **TCHelper JSON** | pełniejszy Sql + czasem lepsze powiązania | opcjonalnie |
| **Komentarz Oracle** | słabe | tylko wspomagająco |
| Porównanie samych nazw etykieta↔kolumna | obecne | **niewystarczające** — zakazane jako jedyny dowód |

### 3.5 Model oceny mapowania

```typescript
type BindingConfidence =
  | 'confirmed'
  | 'probable'
  | 'inferred'
  | 'conflicting'
  | 'rejected';
```

| Poziom | Wymagane dowody (wszystkie punkty) | Użycie w SQL |
|--------|-------------------------------------|--------------|
| **confirmed** | (1) kolumna występuje w `<SqlColumns>` / parsed SELECT **tego** gatewaya; (2) istnieje `gridColumnName`; (3) etykieta z resources/help dla tej kontrolki; (4) brak konkurenta z równym/wyższym score dla tej kontrolki; (5) kolumna istnieje w schemacie obiektu (po Etapie widoków); (6) reguły anty-kolizji (patrz niżej) | **TAK** |
| **probable** | confirmed bez (5) **lub** confirmed z jedną luką (np. brak help, ale exact grid↔kolumna snake) | TAK **tylko** po walidacji `schema_columns` / ALL_TAB_COLUMNS w runtime |
| **inferred** | wyłącznie heurystyka nazw / overlap tokenów | **NIE** |
| **conflicting** | ≥2 różne `oracleColumnName` dla tego samego `(dll, formGuid, gridColumnName)` spełniają próg | **NIE** (obie w `conflicts[]`) |
| **rejected** | złamane reguły (np. etykieta „Nr ewidencyjny” → `ID`; etykieta „Imię” → `IMIE_*` z sufiksem; PK/`ID` gdy etykieta sugeruje NR_EW*) | **NIE** |

**Reguły anty-kolizji (deterministyczne, nie similarity-only):**

1. Jeśli etykieta/synonim zawiera `ewidencyj` / `nr ew` → kolumna musi matchować `/NR_.*EWID|NR_EW(D)?$/i`, nigdy samotne `ID`.  
2. Jeśli etykieta = „Imię” (bez „ojca/matki/…”) → tylko `IMIE` (nie `IMIE_*`).  
3. Jedna kontrolka (`gridColumnName`) → **co najwyżej jedna** kolumna `confirmed`.  
4. Preferuj exact snake z `dgcFooBar` → `FOO_BAR` nad token-overlap.  
5. Preferuj kolumnę, której pełna nazwa = kandydat z grid, nad sufiks/prefix.

### 3.6 Przebudowa algorytmu (kierunek)

1. Iteruj **kontrolki UI** (unikalne `GridColumnName` + label).  
2. Dla każdej kontrolki zbierz kandydatów kolumn z **tego samego** gateway SELECT.  
3. Oceń dowody → confidence.  
4. Emituj jeden primary + lista `conflicts` / `rejected`.  
5. `buildColumnMappingsFromBundle` czyta tylko primary `confirmed|probable`.

Pliki: `teta-plugin-grid-column-mapper.ts`, `teta-plugin-column-mapping.ts`, nowe `teta-plugin-binding-confidence.ts` (+ spec).

---

## 4. SqlJoin i SQL gatewaya

### 4.1 Gdzie SqlJoin jest wydobywany / tracony

| Etap | Plik | Zachowanie |
|------|------|------------|
| Źródło | Builder SQL w gateway (`BuilderText.Select` / Sumo) — tagi Teta | Obecny w stringu SQL |
| Parse | `parseTetaBuilderSelect` → najpierw `stripTetaBuilderMarkers` | **usuwa** `<SqlJoin>…</SqlJoin>`, także Where/Order/Hint |
| Powód strip | uproszczenie do listy kolumn + `<SqlTables>` | komentarz w kodzie brak; efekt = utrata JOIN |

Przykład składni (TCHelper `meta-data/plgDaneOsobowe.json`):

```text
SELECT <SqlQueryHint></SqlQueryHint>
<SqlColumns>ISZK.IPRA_ID, ISZK.LATA_STAZU, …</SqlColumns>
FROM <SqlTables> NT_KP_IMP_SZKOLY ISZK </SqlTables>
<SqlJoin></SqlJoin>
<SqlWhereCondition></SqlWhereCondition>
<SqlOrderBy></SqlOrderBy>
```

`<SqlJoin>` bywa **pusty**; gdy wypełniony — typowo klauzule `JOIN … ON …` (do potwierdzenia na żywym builderze — Etap 4 sample).

### 4.2 Jak zachować SqlJoin jako strukturę

1. **Przed** strip: wyekstrahować raw:

```typescript
type TetaBuilderSqlParts = {
  queryHint: string | null;
  columns: Array<{ raw: string; alias: string | null; column: string }>; // PRAC.IMIE
  tables: Array<{ objectName: string; alias: string | null }>; // z SqlTables
  joins: string | null;      // zawartość SqlJoin (trim)
  where: string | null;
  orderBy: string | null;
  rawSelect: string;
};
```

2. Zapisać w `TetaPluginGatewaySqlSnapshot`:

```typescript
BuilderParts?: TetaBuilderSqlParts | null;
SqlJoin?: string | null; // denormalizacja
```

3. `stripTetaBuilderMarkers` używać **tylko** do wyliczenia listy kolumn, nie jako jedyna kopia SQL.

### 4.3 Powiązanie z gateway / alias / tabele

| Pole | Źródło |
|------|--------|
| gateway | `ClassName` |
| dataset | `DatasetTableName` |
| primary object | `ViewName` / pierwszy element `SqlTables` |
| alias | `TableAlias` / drugi token `SqlTables` |
| joins | `BuilderParts.joins` → krawędzie w przyszłym `schema_edges` source=`teta_sql_join` (poza tym planem agentowym — tylko zapis faktu) |
| packages | `PackageName`, `RelatedPackages` |

### 4.4 Co obecnie ginie w chunkach

| Element | W JSON bundle | W Qdrant gateway chunk |
|---------|---------------|------------------------|
| LabeledSelect | tak | tak |
| mapping lines | tak | tak |
| FlatQuery / Direct / BuilderText pełny | w Sql.* | **nie** (`formatSqlBlock` nieużywany) |
| SqlJoin | usunięty przy parse | nie |

**Plan chunków (późniejszy pod-etap faktów):** dodać do gateway chunka skrót: View + Alias + SqlJoin (do N znaków) + lista kolumn — **bez** zmiany retrieval policy w tym dokumencie.

### 4.5 Proponowana struktura danych gateway

```typescript
type GatewayDataSourceFact = {
  gatewayClassName: string;
  gatewayKind?: string;
  datasetTableName?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  tableAlias?: string | null;
  packageName?: string | null;
  relatedPackages?: { dac?: string | null; agl?: string | null; lep?: string | null };
  builderParts?: TetaBuilderSqlParts | null;
  labeledSelect?: string | null;
  selectColumnNames: string[]; // znormalizowane
};
```

---

## 5. Kolumny widoków

### 5.1 Dlaczego `schema_columns` ma tabele, nie widoki

`OracleMetadataCatalogService`:

1. `attachColumns` — `ALL_TAB_COLUMNS`, ale filtr `allowed` = **tylko** klucze z listy **tabel**.  
2. `fetchViews` — osobno, obiekty bez `columns[]`.  
3. `SchemaGraphService.buildFromCatalog` — dla views tylko `registerNode(..., 'view')`, **bez** `insertColumn`.

Oracle: `ALL_TAB_COLUMNS` zawiera też widoki — problemem jest **filtr aplikacji**, nie brak danych w Oracle.

### 5.2 Rozszerzenie crawlera

1. Po `fetchViews`: wywołać `attachColumns(connection, viewsAsTables, owners)` **lub** rozszerzyć `allowed` o view names.  
2. Typ wyniku: `OracleNamedObjectMeta & { columns: OracleColumnMeta[] }` albo wspólny typ.  
3. W `buildFromCatalog`: pętla insertColumn dla views jak dla tables.  
4. Walidacja SQL: rozróżniać `node_type` table|view, ale **ta sama** reguła „kolumna musi istnieć”.

### 5.3 Przebudowa katalogu bez pełnego re-importu pluginów

| Akcja | Zakres |
|-------|--------|
| Re-run „Analizuj bazę” / metadata crawl + `SchemaGraphService.buildFromCatalog` | **tylko** graf Oracle |
| Plugin `metadata_json` / Qdrant plugin chunks | **bez zmian** na tym etapie |
| Po naprawie bindingów | osobny re-import DLL (Etap 7) |

Kryterium: `NT_KP_PRC_PRACOWNICY` ma `cols > 0` w join `schema_nodes`/`schema_columns`.

---

## 6. Docelowy rekord `ApplicationObjectBinding`

Jeden rekord = **jedno pole / obiekt aplikacyjny** (preferowane ziarno: kontrolka grida; fallback: etykieta help).

```typescript
type ApplicationObjectBinding = {
  objectId: string; // stabilny: `${dllStem}:${formGuid}:${gridColumnName|fieldKey}`
  dllName: string;
  dllPath: string;
  formName: string;
  formGuid: string | null;
  formGuidStatus: 'from_xml' | 'reconciled' | 'missing';
  section: string | null; // z help h2/h3; UI section UNKNOWN na start
  controlId: string | null; // UNKNOWN do czasu parsera designer — null OK
  gridColumnName: string | null;
  label: string;
  help: {
    title: string | null;
    summary: string | null;
    fieldText: string | null;
    section: string | null;
    sourcePath: string | null;
  };
  binding: {
    oracleColumnName: string | null;
    oracleExpression: string | null; // gdy nie czysta kolumna
    targetObject: string | null;
    targetObjectType: 'table' | 'view' | 'unknown' | null;
    tableAlias: string | null;
  };
  gateway: {
    className: string | null;
    datasetTableName: string | null;
    packageName: string | null;
    relatedPackages?: { dac?: string | null; agl?: string | null; lep?: string | null };
  };
  sqlJoin: string | null;
  packagesAndFunctions: string[]; // nazwy z RelatedPackages + odkryte
  evidence: Array<{
    kind:
      | 'plugins_xml_guid'
      | 'help_html'
      | 'sql_columns'
      | 'grid_resource'
      | 'schema_column'
      | 'sql_join'
      | 'heuristic_name';
    detail: string;
    weight: number;
  }>;
  confidence: 'confirmed' | 'probable' | 'inferred' | 'conflicting' | 'rejected';
  conflicts: Array<{
    oracleColumnName: string;
    targetObject: string | null;
    reason: string;
  }>;
  tetaVersion: string | null;
  importedAt: string;
  // Rozdział faktów:
  confirmedFields: string[]; // lista kluczy wypełnionych dowodem confirmed
  inferredFields: string[];
};
```

**Przechowywanie:**

| Warstwa | Propozycja |
|---------|------------|
| SQLite | Nowa tabela `teta_application_bindings` (lub rozbudowa `teta_app_objects` + JSON `evidence_json`, `conflicts_json`, `confidence` rozszerzone CHECK) |
| Bundle | `metadata_json.applicationBindings: ApplicationObjectBinding[]` (źródło prawdy per DLL) |
| Qdrant | chunk per binding `confirmed|probable` z deterministycznym `id` (Etap 7) — **bez** zmiany scoringu retrieval w tym planie |

Stare `teta_app_objects` z samym `inferred` → archiwum / wipe przy migracji.

---

## 7. Konflikty i deduplikacja

### 7.1 Proces deterministyczny

```
1. Group key = (dllPath, formGuid|formName, gridColumnName)
   fallback key = (dllPath, formGuid, normalize(label)) gdy brak grid
2. Zbierz wszystkie kandydaty kolumn Oracle dla grupy
3. Zastosuj reguły anty-kolizji → rejected
4. Policz evidence score (suma wag kinds, nie string similarity jako jedyny sygnał)
5. Jeśli dokładnie 1 kandydat przechodzi próg confirmed → primary
6. Jeśli 0 confirmed i 1 probable → primary probable
7. Jeśli ≥2 z podobnym score → confidence=conflicting, primary=null, conflicts=[…]
8. SQL generator (później) czyta TYLKO primary.confidence ∈ {confirmed} ∪ {probable+schemaOk}
```

### 7.2 Raport braków

Eksport / endpoint vendor (później):  
`bindings_missing_guid`, `bindings_conflicting`, `bindings_rejected`, `help_without_file`.

---

## 8. Migracja i ponowny import

### 8.1 SQLite

| Zmiana | Opis |
|--------|------|
| `teta_app_objects` | rozszerzyć CHECK confidence **lub** nowa `teta_application_bindings` |
| Kolumny | `evidence_json`, `conflicts_json`, `form_guid_status`, `sql_join`, `target_object_type`, `grid_column_name` (osobno), `imported_at` |
| `teta_plugin_imports.metadata_json` | nowe pole `applicationBindings` + `BuilderParts` w gateway Sql |
| Graf | bez migracji DDL poza ewentualnym backfill kolumn widoków |

### 8.2 Czyszczenie błędnych danych

1. `DELETE FROM teta_app_objects;` (lub per dll przy re-import).  
2. Qdrant: `deletePointsBySourceType('teta_plugin')` **lub** per-prefix `teta-plugins/{rel}/` przy każdym DLL.  
3. Re-import wszystkich DLL z bulk import **po** Etapach 1–5.  
4. Osobno: rebuild grafu Oracle z kolumnami widoków.

### 8.3 Stabilne ID chunków

Zamiast `randomUUID()`:

```text
id = uuid5(NAMESPACE, `${source}|${knowledge_version}|${sha1(text).slice(0,12)}`)
```

lub Qdrant point id = hash `source` (1 chunk = 1 source path dla field bindings).  
Re-import → upsert po tym samym id + delete prefix = brak stale UUID orphans.

---

## 9. Test referencyjny — formularz pracowników

**DLL:** `plgPracownik.dll` (lub `plgDaneOsobowe.dll`, jeśli to kanoniczny widok pracowników w danej instalacji).  
**Warunek wstępny:** `plugins.xml` zawiera assembly + GUID; istnieje `Help/{guid}.html`.

### Pola wymagane

| Etykieta | Oczekiwania |
|----------|-------------|
| Nr ewidencyjny | `gridColumnName` dgc*NrEwid*, kolumna `NR_EWIDENCYJNY` lub `NR_EW`/`NR_EWD` (ta z `<SqlColumns>`), **nie** `ID`, `confidence=confirmed` |
| Imię | kolumna `IMIE` tylko, nie `IMIE_*` |
| Nazwisko | kolumna `NAZWISKO` |

### Asserty

1. `form_guid` nie null, zgodny z XML.  
2. ≥3 kontrolki z powyższymi etykietami.  
3. `help_field_text` nie null **jeśli** HTML zawiera te pola; inaczej skip help assert z oznaczeniem UNKNOWN HTML.  
4. Wspólny gateway (np. `PracownicyMTG` / `PracownikBaseMTG`) z `ViewName` w `{NT_KP_PRC_PRACOWNICY, …}`.  
5. Kolumny ∈ parsed `<SqlColumns>`.  
6. `sql_join` zapisany (może być pusty string ≠ „stripped unknown”).  
7. Brak drugiego `confirmed` dla tej samej kontrolki.  
8. Po filtrze SQL-eligible: 0 conflicting.

Plik testu (plan): `apps/api/src/teta-plugins/teta-plugin-binding-golden.spec.ts` + opcjonalny test integracyjny za flagą `TETA_GOLDEN_DLL_PATH`.

---

## 10. Kolejność prac (etapy)

### Etap 0 — Diagnostyka instalacji (½–1 dzień)

| | |
|--|--|
| **Cel** | Potwierdzić, czy `plugins.xml` jest czytany; ile DLL ma GUID; czy Help/ istnieje |
| **Pliki** | skrypt diagnostyczny (tymczasowy) / logi importu — bez zmiany produkcyjnej logiki |
| **Interfejsy** | brak |
| **Migracje** | brak |
| **Testy** | ręczny raport: % DLL z GUID, % form z help file |
| **Akceptacja** | znany root cause pustego GUID (XML path vs filter vs infer) |
| **Zależności** | — |

### Etap 1 — GUID: merge XML + reconcile

| | |
|--|--|
| **Cel** | GUID z `plugins.xml` zawsze trafia do bundle i `teta_app_objects` |
| **Pliki** | `teta-plugin-import.service.ts` (`resolvePluginDescriptors`), `teta-plugin-xml.reader.ts`, nowy `teta-plugin-descriptor-reconcile.ts` (+ spec), `teta-plugin-descriptor.infer.ts` (oznacz brak Guid) |
| **Interfejsy** | `TetaPluginDescriptorMeta` + `guidStatus?`; opcjonalnie na form |
| **Migracje** | brak DDL; wymaga re-import |
| **Testy jednostkowe** | XML+infer merge; ClassName reconcile; brak XML → `guidStatus=missing` |
| **Test integracyjny** | 1 DLL z XML → `form_guid` not null |
| **Akceptacja** | dla DLL obecnych w XML: 0 form bez GUID po imporcie |
| **Zależności** | Etap 0 |

### Etap 2 — Help po GUID

| | |
|--|--|
| **Cel** | Niezerowe `help_field_text` gdy HTML istnieje |
| **Pliki** | `teta-help-enrichment.service.ts`, `teta-help-html.parser.ts` (+ spec na realnym fragmencie HTML), `teta-application-object.builder.ts` (object_id oparty o guid) |
| **Interfejsy** | bez zmian typu Help snapshot; builder używa guid w `objectId` |
| **Migracje** | brak |
| **Testy** | parser fixture; enrichment z mock GUID+HTML |
| **Integracja** | §2.6 |
| **Akceptacja** | `COUNT(help_field_text NOT NULL) > 0` dla DLL z Help; log `Help Teta: k/n formularzy` z k>0 |
| **Zależności** | Etap 1 |

### Etap 3 — Kolumny widoków w grafie

| | |
|--|--|
| **Cel** | `schema_columns` dla VIEW; walidacja kolumn działa na `NT_*` |
| **Pliki** | `oracle-metadata-catalog.service.ts` (`attachColumns` / views), typy katalogu, `schema-graph.service.ts`, `sql-column-validation.util.ts` (jeśli trzeba) |
| **Interfejsy** | views z `columns[]` |
| **Migracje** | brak SQLite DDL; rebuild grafu |
| **Testy** | unit na filtrze allowed; opcjonalnie fake catalog |
| **Integracja** | po crawl: `NT_KP_PRC_PRACOWNICY` cols > 0 |
| **Akceptacja** | jak wyżej |
| **Zależności** | niezależny od 1–2, ale przed golden binding validation |

### Etap 4 — SqlJoin / BuilderParts

| | |
|--|--|
| **Cel** | Nie tracić SqlJoin; strukturalny parse builder SQL |
| **Pliki** | `teta-plugin-gateway-sql.util.ts`, `teta-plugin-metadata.types.ts`, infer SQL path, chunk builder (dopisać SqlJoin do tekstu gateway — minimum faktów) |
| **Interfejsy** | `TetaBuilderSqlParts`, `Sql.BuilderParts` |
| **Migracje** | brak |
| **Testy** | parse fixture z `plgDaneOsobowe.json` (SqlColumns/Tables/Join) |
| **Integracja** | gateway w metadata_json ma `BuilderParts` lub `SqlJoin` key |
| **Akceptacja** | strip nie jest jedyną kopią; Join zachowany nawet gdy pusty |
| **Zależności** | — (może równolegle z 1–3) |
| **Opcja** | włączenie `TchelperRunnerService` za flagą — **nie wymagane** do akceptacji Etapu 4 |

### Etap 5 — Binding confidence + anty-kolizje

| | |
|--|--|
| **Cel** | Jednoznaczne mapowania; SQL-eligible tylko confirmed/(probable+schema) |
| **Pliki** | `teta-plugin-grid-column-mapper.ts`, `teta-plugin-column-mapping.ts`, nowy `teta-plugin-binding-confidence.ts` (+ duże spec), builder app objects |
| **Interfejsy** | `ApplicationObjectBinding`, rozszerzony `TetaPluginColumnMapping.confidence` |
| **Migracje** | DDL `teta_application_bindings` **lub** ALTER `teta_app_objects` |
| **Testy** | cases: Nr ewidencyjny≠ID; Imię≠IMIE_OJCA; Kwota≠ID; conflicting detection |
| **Integracja** | golden §9 |
| **Akceptacja** | golden green; brak confirmed conflicting dla 3 pól |
| **Zależności** | Etap 1, 3 (schema), 4 (SqlColumns jako dowód) |

### Etap 6 — Konflikty, dedup, raport

| | |
|--|--|
| **Cel** | Proces grupowania + przechowywanie conflicts + raport braków |
| **Pliki** | nowy `teta-plugin-binding-dedupe.ts`, registry, opcjonalnie endpoint vendor read-only |
| **Interfejsy** | `conflicts[]` na rekordzie |
| **Migracje** | jak Etap 5 |
| **Testy** | dwie kolumny dla jednego grid → conflicting |
| **Akceptacja** | conflicting nie trafia do listy SQL-eligible |
| **Zależności** | Etap 5 |

### Etap 7 — Migracja danych + stabilne chunk ID + re-import

| | |
|--|--|
| **Cel** | Czysta baza faktów; brak UUID orphans |
| **Pliki** | `teta-plugin-chunk.builder.ts` (deterministic id), `global-rag-chunks-import.service.ts` (upsert by id), bulk import, wipe helpers |
| **Interfejsy** | chunk `id` deterministyczny |
| **Migracje** | wipe `teta_app_objects` / nowa tabela; Qdrant delete `teta_plugin`; full plugin re-import; Oracle graph rebuild jeśli nie zrobiony |
| **Testy** | ten sam source → ten sam point id przy 2. imporcie |
| **Akceptacja** | golden §9 na czystej bazie; `form_guid` / help / confirmed OK |
| **Zależności** | Etapy 1–6 |

### Etap 8 — (Poza zakresem tego dokumentu)

Podłączenie SQL generatora wyłącznie do `confirmed|probable` — **osobny plan** (agent/prompty wykluczone tu świadomie).

---

## 11. Poza zakresem (świadomie)

- Zmiany promptów Oracle agent / chat.  
- Optymalizacja retrieval Qdrant (form-first search).  
- Nowa architektura rozmów.  
- Pełny parser WinForms control id / sekcji designera (oznaczone UNKNOWN; pole `controlId` null do czasu osobnego researchu).

---

## 12. Kryterium sukcesu całego programu naprawy

Po Etapie 7:

1. Lokalnie (lub CI golden): GUID + help + 3 pola pracowników `confirmed`.  
2. Zero `Nr ewidencyjny→ID` w SQL-eligible.  
3. Widoki mają kolumny w grafie.  
4. SqlJoin nie jest wyrzucany przed zapisem.  
5. Re-import pluginu nie mnoży losowych UUID chunków.

Dopiero wtedy wolno ruszać warstwę agenta / retrieval.

---

*Koniec planu. Plik: `docs/AIA_KNOWLEDGE_EXTRACTION_REPAIR_PLAN.md`.*
