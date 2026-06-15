# Baza wiedzy Tety — globalny RAG (tryb vendor)

Ten katalog służy do budowy **globalnego RAG** (`teta_global` w Qdrant). Materiały stąd trafiają do asystenta AI u wszystkich klientów (po eksporcie paczki).

## Twoja rola

1. Zbierasz dokumenty szkoleniowe, FAQ, procedury, opisy modułów Tety.
2. Wrzucasz je tutaj w aplikacji (**Źródła globalne**) lub w tym folderze — obsługiwane formaty jak w RAG klienta (txt, md, pdf, doc, docx, csv, xls, xlsx, html).
3. W aplikacji budujesz indeks i pobierasz paczkę dla klientów.

**Nie musisz znać programowania** — wszystko robisz w przeglądarce i w tym folderze.

## Co wrzucać tutaj

Obsługiwane formaty (takie same jak w RAG klienta):

**`.txt` · `.md` · `.pdf` · `.doc` · `.docx` · `.csv` · `.xls` · `.xlsx` · `.html` · `.htm`**

| Tak | Nie (na razie) |
|-----|----------------|
| Dokumenty i arkusze w formatach powyżej | Filmy `.mp4` — użyj pipeline → **`knowledge-chunks.jsonl`** (patrz `docs/rag-pipeline-formats.md`) |
| Eksport FAQ/procedur z Excela (`.xlsx`, `.csv`) | Surowe dumpy bazy Oracle |
| Zapisane strony szkoleniowe (`.html`) | Prezentacje `.pptx` (na razie — zapisz jako PDF) |
| FAQ, procedury, słownik pojęć Tety | Surowe dumpy bazy Oracle |

**Wskazówka:** jeden temat = jeden plik.

## Krok po kroku w aplikacji

Po instalacji otwórz **http://localhost:3000**

- **Online (z internetem):** `Instaluj-Vendor-Online.bat` — setup pobiera Ollamę, Qdrant i modele (~5–6 GB).
- **Offline (bez internetu):** `Instaluj-Vendor.bat` — wszystko jest już w paczce (~7 GB).

1. Skonfiguruj Oracle (symulator fake) i zarejestruj admina: `teta_admin` / `admin`
2. Wejdź w **Źródła globalne** — dodaj pliki (txt, md, pdf, doc, docx, csv, xls, xlsx, html)
3. Wejdź w **Ustawienia → Paczki**
4. Kliknij **„Zbuduj indeks RAG”**
5. Podaj wersję (np. `1.0.0`) i kliknij **„Pobierz paczkę RAG”**

### Pipeline wideo (Whisper + Qwen)

Zamiast ręcznego `.txt` z transkryptu — plik **`knowledge-chunks.jsonl`** (format `teta-knowledge-chunk-v1`).

```powershell
pnpm rag:global:import-chunks -- --input D:\pipeline\knowledge-chunks.jsonl
pnpm rag:global:export -- --version 2025.06.1 --out dist\global-rag-2025.06.1.zip
```

Pełna specyfikacja: **`docs/rag-pipeline-formats.md`**.

Paczka `global-rag-1.0.0.zip` trafia do klientów.

## Po zakończeniu pracy

1. Przekaż zespółowi IT pliki z `sources\global\` do repozytorium (git).
2. Przekaż paczkę `global-rag-X.zip` do wdrożeń u klientów.

W repozytorium zostają **pliki tekstowe**, nie paczka zip ani baza Qdrant.

## Wersjonowanie (opcjonalnie)

Na końcu pliku możesz dopisać sekcję:

```markdown
## Wersja 1.0.0 (2025-06-09)
- faq-teta.md — logowanie, serwery
```

## Pomoc

- Instalacja online: `INSTALACJA-VENDOR-ONLINE.txt` · offline: `INSTALACJA-VENDOR-OFFLINE.txt`
- Panel Qdrant: http://localhost:6333/dashboard
