# AIA — audyt gotowości bazy wiedzy i RAG

**Data:** 2026-07-13  
**Zakres:** wyłącznie ścieżka **import wiedzy → Qdrant/SQLite → retrieval → kontekst modelu** (bez pełnego audytu projektu).  
**Metoda:** analiza kodu źródłowego (bez modyfikacji, bez uruchamiania Qdrant na żywo).

---

## Werdykt końcowy

### **B — wiedza istnieje, ale retrieval i budowanie kontekstu nie dostarczają jej poprawnie modelowi**

(z istotnymi lukami typu **C** — patrz sekcja „Luki w powiązaniach”)

**Uzasadnienie jednym zdaniem:** po imporcie wtyczki pełne metadane (formularze, gatewaye, SELECT, mapowania etykiet) są w **SQLite `metadata_json`**, a do Qdrant trafiają **rozproszone chunki**; agent Oracle **nie wkłada surowego tekstu chunków do promptu**, tylko przefiltrowane hinty — przy `top_k=2`, progu 0,55 i filtrze `queryMentionsLink` model często **nie dostaje jednoznacznego łańcucha** etykieta → kolumna → tabela, mimo że dane są w systemie.

**Nie A:** prompty są już restrykcyjne („nie zgaduj kolumn”), ale bez dostarczenia mapowania model i tak błądzi (np. `NR_EWD`).  
**Nie D:** przepływ jest czytelny w kodzie.  
**Elementy C:** brak jawnego pola *binding*, heurystyka grid→Oracle zawodzi dla części pól (np. Staż→`LATA_STAZU`), chunki kolumn UI nie zawierają kolumn Oracle.

---

## 1. Źródła wiedzy obecnie importowane

| Źródło | `source_type` | Gdzie import | Co jest wyciągane |
|--------|---------------|--------------|-------------------|
| **Wtyczki DLL** | `teta_plugin` | `TetaPluginImportService` | Formularze, gatewaye MTG/TG, SELECT/INSERT/UPDATE/DELETE, etykiety z DLL/resx, synonimy, widoki/tabele/pakiety Oracle, `columnMappings`, `LabeledSelect` |
| **Metadane Oracle (katalog)** | `other` / `oracle_package` | `OracleMetadataImportPipelineService` | Tabele, widoki, pakiety, procedury — **domyślnie bez Qdrant** (`TETA_ORACLE_ANALYZE_SKIP_QDRANT=true`) |
| **Graf schematu (SQLite)** | — (nie Qdrant) | `SchemaCrawlService` | Tabele, kolumny, relacje FK — używane przez `describe_table`, walidator SQL |
| **Schema entity learning** | `schema_entity` | `SchemaEntityLearningService` | Tag → obiekt Oracle (uczenie z feedbacku) |
| **Wideo szkoleniowe MP4** | `training_video` | `VideoIngestPipelineService` | Transkrypcja, ramki czasowe |
| **Dokumenty globalne** (txt, md, pdf, **docx**, xlsx, html, pptx, vtt) | **brak** (`source_type` nie ustawiane) | `GlobalRagIngestService` | Sam tekst po chunkingu |
| **Dokumenty klienta** | **brak** | `ClientRagIngestService` | j.w. → kolekcja `teta_client` |
| **JSONL `knowledge-chunks.jsonl`** | z pliku | `GlobalRagChunksImportService` | uniwersalny importer |

**Dowód — typy źródeł:** `packages/shared/src/rag.ts` → `KNOWLEDGE_SOURCE_TYPES`, `RagChunkPayload`.

**Dowód — import wtyczki:** `apps/api/src/teta-plugins/teta-plugin-import.service.ts` → `extractMetadataBundle()` łączy skan DLL, resx, źródła `.cs`, BO na serwerze, walidację Oracle, `buildColumnMappingsFromBundle`, `buildTetaPluginKnowledgeChunks`.

**Czego NIE ma w modelu metadanych:**

- jawnych **bindingów** kontrolka→pole DataSet (tylko `GridColumnName` + heurystyka do kolumny Oracle),
- **relacji FK** między formularzami w chunkach wtyczek,
- pola **pewności mapowania** w Qdrant (confidence jest dopiero w runtime hintach, nie w payloadzie chunka).

---

## 2. Format rekordu/chunka w Qdrant

### Punkt Qdrant

`apps/api/src/rag/qdrant.service.ts` — `QdrantPoint`: `{ id, vector[768], payload }`.

### Payload (`RagChunkPayload`)

`packages/shared/src/rag.ts`:

| Pole | Obecność w chunkach wtyczek | Uwagi |
|------|----------------------------|--------|
| `text` | ✅ wymagane | Treść semantyczna dla embeddingu |
| `source` | ✅ | Np. `teta-plugins/Kadry/plgDaneOsobowe/forms/{guid}/gateways/SzkolyTG` |
| `chunkIndex` | ✅ | Indeks w obrębie źródła |
| `source_type` | ✅ `teta_plugin` | Filtr w retrieval |
| `summary` | ✅ | Doklejane do tekstu embeddingu (`buildKnowledgeEmbeddingText`) |
| `plugin_names` | ✅ | Nazwa DLL bez rozszerzenia |
| `tables`, `keywords` | ✅ gateway | Obiekty Oracle, etykiety |
| `form_names` | ❌ nie ustawiane | Pole istnieje w typie, chunk builder go nie wypełnia |
| **formularz ID** | pośrednio | GUID w ścieżce `source`, nie w payload |
| **etykieta / kontrolka / binding / kolumna** | tylko w `text` | Brak osobnych pól strukturalnych |
| **poziom pewności** | ❌ | Nie ma w Qdrant |

**Dowód — builder chunków wtyczki:** `apps/api/src/teta-plugins/teta-plugin-chunk.builder.ts`.

Typy chunków wtyczki:

1. **overview** — statystyki formularza, GUID, ARL, liczba gatewayów/kolumn.
2. **gateway** — widok, tabela bazowa, alias, **mapowanie etykiet→Oracle** (linie tekstowe), `LabeledSelect`.
3. **columns** (batche po 30) — lista `etykieta [GridColumnName] (hint)` — **bez kolumn Oracle**.

ID punktu: `randomUUID()` per chunk (wtyczki) lub deterministyczne `buildRagPointId(source, chunkIndex)` (`apps/api/src/rag/rag-point-id.ts`).

### Równoległy magazyn: SQLite `metadata_json`

Pełny `TetaPluginMetadataBundle` po imporcie — `apps/api/src/teta-plugins/teta-plugin-metadata.types.ts`:

- `forms[]` → `Plugin`, `Columns[]`, `Gateways[]`, `Synonyms`
- `columnMappings[]` → `label`, `gridColumnName`, `oracleColumnName`, `resolvedColumnName`, `targetObject`, `gatewayClassName`

**To jest bogatsze niż Qdrant** — agent Oracle ładuje bundle z SQLite po trafieniu RAG, nie z samego tekstu chunka.

---

## 3. Czy da się odtworzyć łańcuch formularz → … → kolumna?

### Model docelowy (pytanie audytu)

```
formularz → etykieta → kontrolka → binding → tabela/widok → kolumna
```

### Co system faktycznie przechowuje

| Ogniwo łańcucha | Gdzie | Kompletność |
|-----------------|-------|-------------|
| Formularz | `TetaPluginFormMetadata.Plugin.Languages[].Name`, chunk `overview` | ✅ |
| Etykieta | `Columns[].Labels.PL`, chunk `columns` | ✅ |
| Kontrolka | `Columns[].GridColumnName` | ✅ w metadanych; w chunku `columns` jako `[dgc…]` |
| Binding | **brak jawnego pola** | ⚠️ heurystyka `scoreGridColumnForOracle` (`teta-plugin-grid-column-mapper.ts`) |
| Tabela/widok | `gateway.ViewName`, `BaseTableName` | ✅ w chunku `gateway` |
| Kolumna Oracle | `gateway.Sql` `<SqlColumns>`, `columnMappings` | ✅ jeśli heurystyka połączy grid z kolumną SELECT |

### Gdzie są powiązania

- **Nie w jednym rekordzie Qdrant** — rozdzielone na `overview`, `gateway`, `columns` (do kilku batchy).
- **Wspólny klucz:** prefiks `source` (`teta-plugins/{ścieżka}/forms/{guid}/…`) + `plugin_names` + pełny bundle w SQLite po `dllPath`.
- **Chunk `columns` nie ma pewnego połączenia z Oracle** — tylko etykiety i hinty PL.

### Przykład krytyczny: Staż na Wykształcenie

Z metadanych TCHelper (`plgDaneOsobowe.json`):

- Formularz: **Wykształcenie** (`WyksztalcenieWidok`)
- Etykieta: **Staż**, kontrolka: `dgcLSZKLataStaz`, hint: *„Ilość lat liczonych do stażu”*
- Kolumna Oracle: **`ISZK.LATA_STAZU`** w gateway **`SzkolyTG`**, widok **`NT_KP_IMP_SZKOLY`**

Heurystyka `dgcLSZKLataStaz` → `LATA_STAZU`:

- `gridColumnOracleCandidates` daje m.in. `LSZK_LATA_STAZ` (nie `LATA_STAZU`),
- **dopasowanie może nie powstać** (`scoreGridColumnForOracle` wymaga zgodności kluczy znormalizowanych).

**Wniosek:** łańcuch **nie jest gwarantowany** nawet po imporcie — zależy od heurystyki, nie od twardego bindingu z DLL.

### Przykład: numer ewidencyjny pracownika

Z gateway pracownika (widok `NT_KP_PRC_PRACOWNICY`, `BaseTableName: T_PRAC`):

- Etykieta UI: **Numer ewidencyjny** (`dgcNrEwidencyjny`)
- Kolumna w SELECT wtyczki: **`NR_EWIDENCYJNY`** (nie `NR_EW`)
- Po `matchPluginColumnToSchema`: możliwe **`resolvedColumnName: NR_EWD`** (`schema-column-matcher.util.spec.ts`)

**Oczekiwany łańcuch audytu `T_PRAC.NR_EW` — nie występuje w metadanych.** System ma:

```
Numer ewidencyjny → NR_EWIDENCYJNY (wtyczka) → NR_EWD lub NR_EWIDENCYJNY (schemat, zależnie od widoku/tabeli)
```

Źródło danych w hintach: preferowany **widok** `NT_KP_PRC_PRACOWNICY`, niekoniecznie `T_PRAC`.

---

## 4. Jak działa wyszukiwanie RAG

### `RagRetrievalService.retrieve`

`apps/api/src/rag/rag-retrieval.service.ts`:

| Parametr | Env / domyślna | Wartość |
|----------|----------------|---------|
| Kolekcje | — | `teta_global`, opcjonalnie `teta_client` |
| `searchLimit` | `RAG_CHAT_SEARCH_LIMIT` | **16** kandydatów / kolekcja |
| `top_k` | `RAG_CHAT_TOP_K` | **2** po merge |
| `minScore` | `RAG_CHAT_MIN_SCORE` | **0.55** (cosine) |
| Reranking | `rerankChunksByQuery` | heurystyki słów kluczowych (+0,18…+0,38), **nie** cross-encoder |
| Deduplikacja | `mergeResults` | klucz `collection:source:chunkIndex` |
| Filtry Qdrant | `buildQdrantFilter` | `source_type`, `module`, `topic`, `plugin_names` |

### Tryb Oracle — wtyczki

`TetaPluginHintsService.findHintsForQuery` (`teta-plugin-hints.service.ts`):

```typescript
filter: { sourceType: 'teta_plugin' }
includeGlobal: true, includeClient: false
```

Następnie:

1. Bierze **pierwsze 8** trafień RAG (nie wszystkie 2 — ale i tak mało).
2. Dla każdego hitu ładuje **`metadata_json` z SQLite** (`resolveBundleFromHit`).
3. **Filtruje `columnMappings`** — tylko gdzie `queryMentionsLink(query, mapping)` (słowa z pytania muszą pasować do etykiety/synonimu).
4. Gateway hints: max **5**, column hints: max **12**, confidence = relevance + `ragScore * 0.25`.

**Nie ma:** dwuetapowego „najpierw formularz, potem pole”. Jeden embedding na całe pytanie, potem scoring gatewayów tokenowy (`scoreGateway` w `teta-plugin-query-resolver.ts`).

### Tryb dokumentacji (Baza wiedzy)

`ChatService.prepareChat` — RAG **bez** filtra `teta_plugin` (chyba że użytkownik ustawi `ragFilter`), `top_k=2`, kontekst **[1]** do 1400 znaków (`RAG_CHAT_CONTEXT_CHARS`).

**Ważne:** tryb docs **nie** ładuje `metadata_json` — model widzi **tylko tekst chunków** z Qdrant.

---

## 5. Kontekst modelu — pytanie 1

### „Do czego służy kolumna Staż na formularzu Wykształcenie?”

**Prawdopodobny tryb czatu:** dokumentacja (`source !== 'oracle'`), bo pytanie o **znaczenie pola**, nie o wiersze z bazy.

#### Co trafi do Qdrant retrieval

Embedding całego pytania → max **2** chunki z `teta_global` (i ewentualnie wideo/dokumenty — **konkurencja semantyczna**).

Najbardziej trafne chunki wtyczki (konstrukcja z kodu):

**[1] `…/forms/{guid}/columns` (batch zawierający Staż):**

```
Wtyczka plgDaneOsobowe.dll, formularz Wykształcenie — etykiety pól UI:
…; Staż [dgcLSZKLataStaz] (Ilość lat liczonych do stażu); …
```

**[2] `…/gateways/SzkolyTG` (jeśli trafi do top 2):**

```
Wtyczka plgDaneOsobowe.dll, formularz Wykształcenie — gateway SzkolyTG (TG).
Widok Oracle: NT_KP_IMP_SZKOLY.
…
Mapowanie etykiet grida → kolumny Oracle:
„Staż” → LATA_STAZU [grid: dgcLSZKLataStaz]   ← TYLKO jeśli heurystyka zadziałała przy imporcie
SELECT z aliasami…
```

#### Przykładowy prompt (skrót) — `buildChatSystemPrompt`

`apps/api/src/chat/chat-system-prompt.ts`:

```
Jesteś asystentem Teta AI…
Metodyka:
1. Przeczytaj [1] (i ewentualnie [2]). To jedyna dozwolona wiedza.
…
Zakazy: bez domysłów…

Kontekst RAG:
[1] teta-plugins/Kadry/plgDaneOsobowe/forms/…/columns
Wtyczka plgDaneOsobowe.dll, formularz Wykształcenie — etykiety pól UI: … Staż [dgcLSZKLataStaz] (Ilość lat liczonych do stażu) …
```

**Co model może odpowiedzieć poprawnie:** że Staż to „ilość lat liczonych do stażu” (z hintu w [1]).

**Czego model NIE dostaje pewnie:**

- `NT_KP_IMP_SZKOLY.LATA_STAZU` (gdy heurystyka zawiedzie lub chunk gateway nie trafi do top 2),
- jawnego bindingu `dgcLSZKLataStaz` → `:inout_Szkoly.LATA_STAZU` z INSERT DAC.

---

## 6. Kontekst modelu — pytanie 2

### „Jakie jest imię i nazwisko pracownika o numerze ewidencyjnym 00122?”

**Tryb:** Oracle (`source=oracle'`) → `OracleAgentService.streamComplete`.

#### Ścieżka A — szybka (bez LLM)

`buildDirectEmployeeSelect` (`teta-plugin-column-resolver.ts`) + warunek w `oracle-agent.service.ts` (linie ~161–191).

Warunki: `columnMappings` z hintów, wartość `00122` w pytaniu lub historii, rozwiązane mapowania SELECT i WHERE.

Przykładowy SQL (z testów, widok kadrowy):

```sql
SELECT IMIE, NAZWISKO
FROM TETA_ADMIN.NT_KP_PRC_PRACOWNICY
WHERE NR_EWD = '00122'
-- lub NR_EWIDENCYJNY zależnie od resolvedColumnName / historii WHERE
```

#### Ścieżka B — agent LLM (gdy fast path = null)

**`pluginContext` w system prompt** (`formatPluginOracleHintsForPrompt`):

```
Metadane wtyczek Teta (RAG — preferuj te widoki i SELECT…):

- 1. Wtyczka **plgPracownik.dll**, formularz **…**, gateway **PracownikMTG** (MTG).
   Obiekty: widok TETA_ADMIN.NT_KP_PRC_PRACOWNICY; tabela bazowa TETA_ADMIN.T_PRAC; alias PRAC.
   Sugerowany SELECT (z metadanych wtyczki…):
   SELECT PRAC.IMIE AS "Imię", PRAC.NAZWISKO AS "Nazwisko", PRAC.NR_EWIDENCYJNY AS "Numer ewidencyjny" …
   FROM NT_KP_PRC_PRACOWNICY PRAC

Mapowanie etykiet grida / synonimów → kolumny Oracle:
- etykieta „Imię” → **IMIE** w NT_KP_PRC_PRACOWNICY (plgPracownik.dll)
- etykieta „Nazwisko” → **NAZWISKO** …
- etykieta „Numer ewidencyjny” → **NR_EWD** w NT_KP_PRC_PRACOWNICY (kolumna wtyczki: NR_EWIDENCYJNY)
  W pytaniach typu «podaj X o Y wartość»: X → SELECT, Y → WHERE.
```

**Uwaga:** do promptu trafiają **tylko** mapowania wymienione w pytaniu (`queryMentionsLink`). Przy samym „imię i nazwisko o nr 00122” — zwykle IMIE, NAZWISKO, Numer ewidencyjny.

#### Czy w kontekście jest `numer ewidencyjny → T_PRAC.NR_EW`?

| Twierdzenie | Prawda w kodzie/metadanych |
|-------------|---------------------------|
| Etykieta „Numer ewidencyjny” jest w mapowaniu | ✅ `columnMappings` / chunk gateway |
| Kolumna to `NR_EW` | ❌ **nie** — wtyczka: `NR_EWIDENCYJNY`; schemat może mapować na `NR_EWD` |
| Tabela to `T_PRAC` | ⚠️ częściowo — `BaseTableName: T_PRAC`, ale **SELECT idzie z widoku** `NT_KP_PRC_PRACOWNICY` |
| Pełny łańcuch w jednym chunku Qdrant | ❌ rozproszony |

**Dowód mapowania NR_EWD:** `apps/api/src/schema/schema-column-matcher.util.spec.ts` — `NR_EWIDENCYJNY` + etykieta → `NR_EWD`.

**Dowód zakazu zgadywania:** `oracle-agent.service.ts` `buildSystemPrompt` — „NIGDY nie wymyślaj… NR_EWD zamiast NR_EWIDENCYJNY” + `SqlValidatorService`.

---

## 7. Zachowanie przy brakach i konfliktach

| Sytuacja | Dokumentacja (`chat-system-prompt`) | Oracle (`oracle-agent.service`) |
|----------|-------------------------------------|----------------------------------|
| RAG nic nie znalazł | „Kontekst RAG: brak” → odpowiedź o braku w bazie | Pusty `pluginSection` → `search_tables` / `describe_table` / `clarify` |
| Kilka sprzecznych wyników | Brak jawnej resolucji; top 1–3 chunki | Wyższy `confidence` wygrywa w `Map` (gateway/column hints) |
| Binding niepotwierdzony | Model widzi tylko tekst chunka | `resolvedColumnName` null → fallback `pluginColumnName`; prompt każe `describe_table` |
| Tabela/kolumna nieznana | Brak informacji | `clarify` lub błąd SQL + retry; walidator odrzuca nieznane kolumny |
| Wiedza modelu | **Zakazana** — tylko [1]/[2] | **Zakazana** dla struktury DB; dane tylko z SQL |

**Dowód — dokumentacja:** `chat-system-prompt.ts` — „To jedyna dozwolona wiedza”, „Nie mam tej informacji w bazie wiedzy Teta.”

**Dowód — Oracle:** `buildSystemPrompt` — „Odpowiadasz WYŁĄCZNIE na podstawie narzędzi schematu i wyników SQL”.

---

## 8. Tabela dowodów (kluczowe pliki)

| Wniosek | Plik | Funkcja / fragment |
|---------|------|-------------------|
| Chunki wtyczki bez bindingu w kolumnach UI | `teta-plugin-chunk.builder.ts` | `buildColumnChunks` — tylko etykiety |
| Mapowanie etykieta→Oracle w chunku gateway | `teta-plugin-chunk.builder.ts` | `buildGatewayChunk` + `formatColumnMappingLines` |
| Heurystyka grid→Oracle | `teta-plugin-grid-column-mapper.ts` | `scoreGridColumnForOracle`, `buildGridOracleColumnLinks` |
| Pełne mapowania w SQLite | `teta-plugin-metadata.types.ts` | `TetaPluginColumnMapping`, `columnMappings` |
| top_k=2, próg 0.55 | `rag.constants.ts`, `rag-retrieval.service.ts` | `chatTopK: 2`, `chatMinScore: 0.55` |
| Oracle: RAG jako router do SQLite | `teta-plugin-hints.service.ts` | `resolveBundleFromHit`, `queryMentionsLink` filter |
| Prompt Oracle z mapowaniami | `teta-plugin-query-resolver.ts` | `formatPluginOracleHintsForPrompt` |
| Fast path SQL | `teta-plugin-column-resolver.ts`, `oracle-agent.service.ts` | `buildDirectEmployeeSelect` |
| NR_EWD vs NR_EWIDENCYJNY | `schema-column-matcher.util.ts` | `matchPluginColumnToSchema` |
| Docs: tylko tekst RAG | `chat.service.ts` | `prepareChat` — brak `TetaPluginHintsService` |

---

## 9. Co jest kompletne / czego brakuje

### Już kompletne (po imporcie wtyczki + analizie bazy)

- Nazwy formularzy, GUID, ARL, profile
- Gatewaye z widokami, aliasami, pakietami DAC
- SELECT z listą kolumn Oracle (w metadanych i często w chunku gateway)
- Etykiety i hinty PL z grida (chunki `columns`)
- `LabeledSelect` z aliasami AS „etykieta”
- `columnMappings[]` w SQLite (gdy heurystyka + schemat zadziałały)
- Walidacja SQL względem grafu schematu

### Braki / słabe ogniwa

1. **Jawny binding** kontrolka → pole DataSet → kolumna Oracle (tylko heurystyka nazw).
2. **Chunk `columns`** bez kolumn Oracle — wymaga drugiego chunka lub SQLite.
3. **`top_k=2`** — ryzyko utraty chunka gateway przy pytaniach wielowyrazowych.
4. **Filtr `queryMentionsLink`** — mapowania nieobecne w słowach pytania nie trafiają do promptu (follow-up „adres tego pracownika”).
5. **`form_names` w payload** niewykorzystane — słabsze filtrowanie po formularzu.
6. **Oracle metadata w Qdrant** domyślnie wyłączone — semantyczne szukanie tabel/kolumn tylko przez graf + `describe_table`.
7. **Staż → `LATA_STAZU`** — przykład niepewnego mapowania (prefiks `LSZK` w gridzie).
8. **Oczekiwane `T_PRAC.NR_EW`** — niezgodne z metadanymi wtyczki (`NR_EWIDENCYJNY` / `NR_EWD`).

---

## 10. Czy można już skupić się wyłącznie na analizie rozmowy?

**Nie w pełni.**

| Scenariusz | Gotowość |
|------------|----------|
| Pytania dokumentacyjne o sens pola (Staż + hint w chunku) | **Częściowo** — jeśli RAG trafi w chunk `columns` |
| SQL: imię/nazwisko po nr ewidencyjnym | **Częściowo** — fast path + mapowania działają po imporcie `plgPracownik` / `plgDaneOsobowe`, ale kolumna to nie `NR_EW` |
| SQL: follow-up bez powtórzenia filtra | **Nie** — wymaga historii (niedawno dodane w kodzie, zależy od testów E2E) |
| Jednoznaczny łańcuch w promptcie bez `describe_table` | **Nie** — za mało kontekstu przy `top_k=2` i filtrach |
| Pola bez etykiet grida (`S_*` adres) | **Słabo** — tylko komentarze Oracle przy imporcie |

**Skupienie na rozmowie / QueryPlan / walidacji SQL ma sens dopiero po:**

1. dostarczeniu **pełnego mapowania** dla pól z pytania (nie tylko `queryMentionsLink`),
2. podniesieniu **top_k** lub dedykowanym retrievalu „formularz → gateway → pole”,
3. twardym **zapisie bindingów** (nie tylko heurystyka camelCase).

---

## 11. Trzy najważniejsze następne kroki

1. **Jeden rekord wiedzy per pole UI** (lub per mapowanie): formularz, `GridColumnName`, etykieta, hint, gateway, widok, kolumna Oracle, `resolvedColumnName`, confidence — jako chunk RAG **i** element `columnMappings`, bez polegania na heurystyce `LSZK_*` → `LATA_*`.

2. **Retrieval pod Oracle:** po trafieniu DLL ładuj do promptu **wszystkie** `columnMappings` dla wybranego gatewaya/formularza (lub top N wg relevance), nie tylko wymienione w pytaniu; rozważ `top_k ≥ 5` dla `source_type=teta_plugin` lub pomijanie Qdrant na rzecz bezpośredniego lookupu SQLite po słowach kluczowych.

3. **Test akceptacyjny E2E** (bez „Qdrant działa”): dla pytań audytu zweryfikować **treść `pluginContext`** / `ragContext` w logach — czy zawiera dokładnie:
   - Staż → `LATA_STAZU` → `NT_KP_IMP_SZKOLY` → Wykształcenie,
   - Numer ewidencyjny → `NR_EWIDENCYJNY`/`NR_EWD` → `NT_KP_PRC_PRACOWNICY` (nie `T_PRAC.NR_EW`).

---

## Odpowiedź na pytanie audytu

> Czy problem jest w wiedzy, retrievalu czy w samym agencie?

| Warstwa | Ocena |
|---------|--------|
| **Wiedza (import)** | ~70% — dane są, łańcuch porozrywany, bindingi heurystyczne |
| **Retrieval + kontekst** | **~główny problem** — `top_k=2`, brak rehydracji w trybie docs, agresywny filtr mapowań |
| **Agent / prompty** | ~poprawne zasady, ale LLM wchodzi gdy fast path zawiedzie; prompty nie naprawią brakującego mapowania |

**Werdykt:** **B** (z elementami **C** dla pól bez pewnego bindingu).

---

*Raport wygenerowany na podstawie analizy kodu w `apps/api/src/{teta-plugins,rag,schema,chat}/`, `packages/shared/src/rag.ts` oraz metadanych referencyjnych `TCHelper/meta-data/plgDaneOsobowe.json`.*
