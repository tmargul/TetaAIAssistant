# Baza wiedzy Tety — globalny RAG (tryb vendor)

Ten katalog służy do budowy **globalnego RAG** (`teta_global` w Qdrant). Materiały stąd trafiają do asystenta AI u wszystkich klientów (po eksporcie paczki).

## Twoja rola

1. Zbierasz dokumenty szkoleniowe, FAQ, procedury, opisy modułów Tety.
2. Wrzucasz je w aplikacji (**Źródła globalne**) lub w tym folderze.
3. Opcjonalnie: upload **`.mp4`** — transkrypcja Whisper + automatyczny import do Qdrant.
4. Budujesz indeks i pobierasz paczkę **`global-rag-X.zip`** dla klientów.

**Nie musisz znać programowania** — wszystko robisz w przeglądarce.

## Co wrzucać tutaj

Obsługiwane formaty:

**`.txt` · `.md` · `.pdf` · `.doc` · `.docx` · `.csv` · `.xls` · `.xlsx` · `.html` · `.htm` · `.vtt` · `.srt` · `.pptx`**

| Tak | Uwagi |
|-----|--------|
| Dokumenty i arkusze | Upload w **Źródła globalne** lub pliki w `sources/global/` |
| **Filmy `.mp4`** | Upload w sekcji **„Ingest wideo MP4”** (ffmpeg + Whisper) |
| **`knowledge-chunks.jsonl`** | Import z pipeline zewnętrznego (format `teta-knowledge-chunk-v1`) |
| FAQ, procedury, słownik pojęć Tety | Jeden temat = jeden plik |

Pełna specyfikacja JSONL: **`docs/rag-pipeline-formats.md`**

## Krok po kroku w aplikacji

Po instalacji otwórz **http://localhost:3000**

- **Online (z internetem):** `Instaluj-Vendor-Online.bat` — setup pobiera Ollamę, Qdrant, ffmpeg, Python (~5–8 GB).
- **Offline (bez internetu):** `Instaluj-Vendor.bat` — wszystko jest w paczce (~8–12 GB).

1. Skonfiguruj Oracle (symulator fake) i zarejestruj admina: **`teta_admin`** / **`admin`**
2. **Źródła globalne** — dodaj dokumenty **lub** wrzuć `.mp4` (ingest wideo)
3. **Ustawienia → Paczki** — dla samych dokumentów: **„Zbuduj indeks RAG”**
4. **„Pobierz paczkę RAG”** (np. wersja `1.0.0`)

### Ingest wideo (MP4)

1. W **Źródła globalne** → sekcja **„Ingest wideo MP4”**
2. Upuść plik `.mp4` (zaznacz **merge**, jeśli dołączasz do istniejącego indeksu)
3. Poczekaj na transkrypcję i indeksację (pierwszy raz: pobranie modelu Whisper — wymaga internetu)
4. Klatki trafiają do `sources/global/assets/<nazwa_filmu>/`

### Import JSONL (pipeline zewnętrzny)

```powershell
pnpm rag:global:import-chunks -- --input D:\pipeline\knowledge-chunks.jsonl
pnpm rag:global:export -- --version 2025.06.1 --out dist\global-rag-2025.06.1.zip
```

## Po zakończeniu pracy

1. Przekaż zespółowi IT pliki z `sources\global\` do repozytorium (git).
2. Przekaż paczkę `global-rag-X.zip` do wdrożeń u klientów.

## Pomoc

- Instalacja: `INSTALACJA-VENDOR-ONLINE.txt` · `INSTALACJA-VENDOR-OFFLINE.txt`
- Panel Qdrant: http://localhost:6333/dashboard
- Walidacja JSONL: `pnpm rag:validate-chunks -- --input plik.jsonl`
