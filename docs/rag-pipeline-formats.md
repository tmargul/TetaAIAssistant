# RAG — formaty, pipeline wideo, odpowiedzi dla zespołu

Dokument dla osoby budującej pipeline szkoleń (MP4 → Whisper → enrichment) oraz dla decyzji produktowych w **Teta AI Assistant**.

---

## Odpowiedź skrócona dla kolegi (stan + rekomendacje)

### 1. Format wejściowy engine RAG

| Format | Rola | Status |
|--------|------|--------|
| **Pliki dokumentów** (txt, md, pdf, …) | Źródła w `sources/global/` → chunk + embed w aplikacji | ✅ dziś |
| **`knowledge-chunks.jsonl`** | Wynik pipeline wideo / enrichment — import vendor | ✅ **nowy** |
| **`ragpack` ZIP** (`global-rag-X.zip`) | Dystrybucja u klientów (wektory + manifest) | ✅ dziś |
| SQLite / PostgreSQL jako wejście | — | ❌ nie planujemy jako primary input |
| Surowy JSONL bez schematu | — | ❌ tylko przez `teta-knowledge-chunk-v1` |

**Rekomendacja:** pipeline kończy się plikiem **`knowledge-chunks.jsonl`** (metadane + `text`). Vendor importuje go do Qdrant, potem eksportuje **`global-rag-X.zip`** do klientów.

### 2. Rekord wiedzy

Przyjmujemy schemat **`teta-knowledge-chunk-v1`** (patrz niżej). Pola kolegi (`source_type`, `start`/`end`, `summary`, `plugin_names`, `frames`, …) są **obsługiwane w payload Qdrant**. Minimum do importu: **`source` + `text`**.

Do embeddingu używamy: `text`, a jeśli jest — także `summary` (lepiej trafia w wyszukiwanie semantyczne).

### 3. Gdzie liczyć embeddingi?

| Wariant | Kiedy |
|---------|--------|
| **W aplikacji przy imporcie** | ✅ **domyślnie** — prostsze, jeden model, mniej ryzyka rozjazdu |
| W pipeline (przed importem) | Tylko jeśli ten sam model co aplikacja → eksport `ragpack` z wektorami |

**Rekomendacja na start:** enrichment Qwen3 **w pipeline**, embedding **`nomic-embed-text` w aplikacji** przy imporcie JSONL.

### 4. Model embeddingu offline

| Parametr | Wartość |
|----------|---------|
| Model | **`nomic-embed-text`** (Ollama) |
| Wymiar | **768** |
| Alternatywy (bge-m3, qwen-embed) | Tylko po globalnej decyzji + przebudowie wszystkich indeksów |

### 5. Baza wektorowa

**Qdrant** (lokalnie). Nie Chroma / FAISS / sqlite-vss.

### 6. Screeny / klatki

| Faza | Rozwiązanie |
|------|-------------|
| **Teraz** | `frames[]` = **ścieżki względne** względem katalogu paczki wiedzy (np. `frames/zu1/04105.jpg`); klatki w `sources/global/assets/` |
| **UI** | Podgląd klatek w czacie (`GET /api/rag/assets/…`) |

Pipeline powinien trzymać klatki obok JSONL w znanej strukturze; ścieżki zapisuje w `frames`.

### 7. Osobne indeksy

| Kolekcja Qdrant | Zawartość |
|-----------------|-----------|
| **`teta_global`** | Szkolenia, dokumentacja Tety, Oracle/pakiety (od Tety) |
| **`teta_client`** | Regulaminy i dokumenty u klienta |

**Jeden wspólny indeks z metadanymi** wewnątrz `teta_global` — tak, z polem **`source_type`**. Osobne kolekcje per moduł — dopiero gdy filtry w czacie będą niewystarczające.

### 8. Filtrowanie po metadanych

| Faza | Zakres |
|------|--------|
| **Teraz** | Metadane w Qdrant; filtry w retrieval (`ragFilter` w czacie) |
| **UI** | Panel „Filtry RAG” w czacie: typ źródła, moduł, temat, plugin |

Qdrant filtry obsługuje — aplikacja dołoży je warstwowo.

### 9. Wersjonowanie

| Poziom | Pole / mechanizm |
|--------|------------------|
| Paczka u klienta | `manifest.version` w `global-rag-X.zip` (np. `2025.06.1`) |
| Chunk | opcjonalnie `knowledge_version`, `teta_version`, `training_date` w JSONL |
| Instancja klienta | tylko **`teta_client`** (osobna kolekcja), nie w globalu |

### 10. Enrichment Qwen3

**Przed importem, w pipeline** (poza aplikacją). Aplikacja **nie** odpala Qwen3 przy indeksacji — tylko chunkuje (dla dokumentów) lub bierze gotowy `text` z JSONL.

---

## Schemat `teta-knowledge-chunk-v1` (JSONL)

Jeden rekord = jedna linia JSON. Plik: `knowledge-chunks.jsonl`.

```json
{
  "id": "optional-uuid-or-stable-id",
  "source": "trainings/zu1.mp4",
  "source_type": "training_video",
  "start": 4104.62,
  "end": 4123.76,
  "text": "Transkrypt lub treść segmentu…",
  "summary": "Krótkie streszczenie segmentu…",
  "keywords": ["dataset", "administracja"],
  "concepts": ["Dataset"],
  "plugin_names": ["Kartoteka użytkowników"],
  "form_names": [],
  "business_objects": [],
  "datasets": ["Użytkownicy"],
  "tables": [],
  "packages": [],
  "shortcuts": [],
  "module": "Administracja",
  "topic": "Dataset",
  "teta_version": "25.1",
  "training_date": "2025-03-15",
  "knowledge_version": "2025.06.1",
  "frames": ["assets/zu1/frame-04105.jpg"]
}
```

### Pola wymagane

- `source` — identyfikator źródła (nazwa pliku wideo, ścieżka logiczna)
- `text` — treść do wyszukiwania (transkrypt segmentu)

### Pola zalecane dla wideo

- `source_type`: `"training_video"`
- `start`, `end` — sekundy
- `summary`, `keywords`, `plugin_names`, `module`, `topic`
- `frames` — ścieżki względne do JPG/PNG

### Wartości `source_type`

`training_video` · `documentation` · `faq` · `oracle_package` · `client_document` · `other`

---

## Workflow kolegi (docelowy)

```
MP4
 → Whisper (JSON/transkrypt)
 → segmentacja + klatki (JPG)
 → enrichment Qwen3 (offline) → knowledge-chunks.jsonl
 → [vendor] import JSONL → Qdrant (embed nomic-embed-text)
 → [vendor] export global-rag-X.zip
 → [klient] import paczki w panelu Aktualizacje
```

### Import u vendora

**CLI:**

```powershell
pnpm rag:global:import-chunks -- --input D:\pipeline\out\knowledge-chunks.jsonl
pnpm rag:global:import-chunks -- --input D:\pipeline\out\more-chunks.jsonl --merge
pnpm rag:validate-chunks -- --input D:\pipeline\out\knowledge-chunks.jsonl
```

**API (vendor):** `POST /api/vendor/rag/ingest/chunks` — upload pliku `.jsonl` (opcjonalnie `?merge=true`)

### Ingest MP4 (Etap 1 — CLI)

Transkrypcja wideo bezpośrednio w repozytorium: **ffmpeg** + **faster-whisper** → `knowledge-chunks.jsonl` → opcjonalnie Qdrant.

**Wymagania:**

```powershell
pip install -r scripts/rag/requirements-video.txt
# ffmpeg i ffprobe w PATH
```

**CLI:**

```powershell
# Tylko transkrypcja + walidacja JSONL (bez Qdrant)
pnpm rag:video:ingest -- --input D:\szkolenia\zu1.mp4 --no-index

# Pełny pipeline: transkrypcja → klatki w sources/global/assets/ → import Qdrant
# Wymaga: TETA_APP_MODE=vendor, TETA_VENDOR_SECRET, Ollama, Qdrant
pnpm rag:video:ingest -- --input D:\szkolenia\zu1.mp4 --merge
```

Zmienne w `apps/api/.env`: `TETA_VIDEO_CHUNK_SECONDS` (domyślnie 180), `TETA_WHISPER_MODEL` (`large-v3-turbo`), `TETA_WHISPER_LANGUAGE` (`pl`), `TETA_FFMPEG_PATH`, `TETA_PYTHON`.

Wynik roboczy trafia do `_temp/video-ingest/<timestamp>/`; klatki kopiowane są do `sources/global/assets/<film_key>/`.

### API + UI (Etap 2–3)

| Endpoint | Rola |
|----------|------|
| `POST /api/vendor/rag/ingest/video` | upload `.mp4`, start joba (`?merge=true`) |
| `GET /api/vendor/rag/ingest/video` | lista zadań |
| `GET /api/vendor/rag/ingest/video/:id` | status zadania |
| `GET /api/vendor/rag/ingest/video/:id/events` | strumień NDJSON postępu |

UI: **Źródła globalne** — osobna strefa uploadu MP4 + tabela zadań.

### Offline bundle (Etap 4)

`Setup.ps1 -Mode vendor` sprawdza ffmpeg, Python i instaluje `faster-whisper`.  
`Prepare-OfflineBundle.ps1` dodaje `tools/ffmpeg/README.txt` z instrukcją.

Potem jak dotychczas: **Zbuduj / eksport paczki RAG** albo `pnpm rag:global:export`.

---

## Plan rozbudowy formatów (roadmap)

### Faza A — ✅ (ten release)

- [x] Schemat `teta-knowledge-chunk-v1`
- [x] Import `knowledge-chunks.jsonl` (vendor CLI + API)
- [x] Rozszerzony payload w Qdrant (metadane obok `text`)
- [x] Dokumentacja pipeline

### Faza B — dokumenty i media ✅

- [x] `.pptx` → tekst (jak PDF)
- [x] `.vtt` / `.srt` — napisy jako źródło
- [x] Import wielu plików JSONL + merge bez pełnego recreate (przyrostowy) — flaga `--merge` / `?merge=true`

### Faza C — retrieval i UI ✅

- [x] Filtry metadanych w `RagRetrievalService` (`source_type`, `module`, `topic`, `plugin_names`)
- [x] Cytowanie w czacie: źródło wideo + timestamp + podgląd klatki
- [x] Serwowanie `sources/global/assets/` — `GET /api/rag/assets/*`

### Faza D — dystrybucja ✅

- [x] `ragpack` v2 — manifest ze `schemaVersion: 2`, `sourceTypeCounts`, `modules`, `topics`, `trainingVideoChunks`
- [x] Walidator JSONL: `pnpm rag:validate-chunks -- --input plik.jsonl`

---

## Format `ragpack`

Paczka dla klienta:

```
global-rag-1.0.0.zip
├── manifest.json
├── vectors.jsonl.gz
└── checksum.sha256
```

`manifest.format` = `"ragpack"`. Od wersji 2 manifest zawiera `schemaVersion: 2` oraz statystyki metadanych (`sourceTypeCounts`, `modules`, `topics`, `trainingVideoChunks`). Payload punktów może zawierać rozszerzone metadane — import/export zachowuje je.

---

## SQLite w aplikacji

SQLite służy **metadanym aplikacji** (użytkownicy, dokumenty klienta, historia buildów RAG), **nie** jako silnik wektorowy.
