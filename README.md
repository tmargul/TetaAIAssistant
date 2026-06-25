# Teta AI Assistant

Intranetowy asystent AI dla serwerów klientów — bez wyjścia poza sieć klienta.

## Stack

| Warstwa | Technologia |
|---------|-------------|
| Frontend | React (Vite) |
| Backend | NestJS |
| Baza | SQLite |
| LLM | Ollama (Qwen3, DeepSeek-R1) |
| Wektory (RAG) | Qdrant |
| Auth | JWT (planowane) |

## Tryby: vendor vs client

| Tryb | Kto | Cel |
|------|-----|-----|
| **vendor** | Teta — budowa wiedzy | Globalny RAG z `sources/global/` |
| **client** | Klient intranetowy | Import paczki RAG + dokumenty lokalne |

W `.env`: `TETA_APP_MODE=vendor` lub `client`.

## Globalny RAG — workflow

### Stanowisko kolegi (vendor)

1. Wygeneruj paczkę: **Ustawienia → Paczki → Instalacja vendor (Teta)**.
2. Kolega rozpakowuje ZIP → **`Instaluj-Vendor.bat`** (Administrator).
3. Uruchamia **`Start-App.bat`** w katalogu instalacji → otwiera przeglądarkę pod **http://localhost:3000** (backend jako usługa Windows, bez terminala). Qdrant, Ollama i logi są w tym samym katalogu (`qdrant\`, `ollama\`, `logs\`).
4. Instrukcja w paczce: `INSTALACJA-VENDOR.txt` oraz `sources/global/README.md`.
5. W UI: wrzuca pliki do `sources/global/` **lub** importuje `knowledge-chunks.jsonl` (pipeline wideo) → **Zbuduj indeks RAG** / eksport → **Pobierz paczkę RAG**.

Szczegóły formatów RAG i pipeline wideo: **`docs/rag-pipeline-formats.md`**.

### Co wrzucić do repozytorium git

| Tak | Nie |
|-----|-----|
| `sources/global/*.md`, `*.txt` | `data/`, `global-rag-*.zip`, katalog Qdrant `storage/` |

Źródła w git — wektory generujesz przy eksporcie paczki dla klientów.

### U klienta

Paczka **Instalacja klienta (pełna)** importuje globalny RAG automatycznie. Aktualizacja: `Aktualizuj-RAG.bat` + nowy `global-rag-X.zip`.

## Struktura monorepo

```
TetaAIAssistant/
├── apps/
│   ├── api/          # NestJS (@teta/api)
│   └── web/          # React (@teta/web)
├── packages/
│   └── shared/       # Wspólne typy (@teta/shared)
├── sources/
│   └── global/       # Źródła globalnego RAG (vendor) + README.md
└── pnpm-workspace.yaml
```

## Wymagania

- Node.js ≥ 20
- pnpm ≥ 9
- **Ollama** — natywna instalacja na serwerze klienta ([ollama.com](https://ollama.com))
- **Qdrant** — natywna instalacja na serwerze klienta (bez Dockera, patrz niżej)

## Szybki start

```powershell
cd c:\Projects\TetaAIAssistant
pnpm install

copy apps\api\.env.example apps\api\.env

pnpm dev
```

- Frontend: http://localhost:5173  
- API: http://localhost:3000/api  
- Health: http://localhost:3000/api/health  

## Qdrant bez Dockera

Na serwerze intranetowym klienta uruchamiasz **binarną instalację Qdrant** (usługa Windows lub proces w tle). Aplikacja łączy się wyłącznie przez HTTP — domyślnie `http://127.0.0.1:6333`.

1. Pobierz release dla Windows z [GitHub Qdrant](https://github.com/qdrant/qdrant/releases) lub użyj instalatora z [dokumentacji](https://qdrant.tech/documentation/guides/installation/).
2. Uruchom `qdrant.exe` (lub zarejestruj jako usługę Windows na produkcji).
3. Panel (opcjonalnie): http://localhost:6333/dashboard  
4. W `apps/api/.env` ustaw `QDRANT_URL` na adres serwera Qdrant w sieci klienta (np. `http://192.168.1.10:6333`, jeśli Qdrant stoi na innym hoście).

Katalog danych wektorowych konfigurujesz w pliku `config.yaml` Qdrant po stronie serwera — nie w repozytorium aplikacji.

## Skrypty

| Komenda | Opis |
|---------|------|
| `pnpm dev` | API + web w trybie dev |
| `pnpm dev:api` | Tylko NestJS |
| `pnpm dev:web` | Tylko React |
| `pnpm build` | Build wszystkich pakietów |
| `pnpm setup:vendor` | Instalacja lokalna trybu vendor (PowerShell Admin) |
| `pnpm rag:global:ingest` | Indeksacja `sources/global/` → Qdrant |
| `pnpm rag:global:export` | Eksport paczki `global-rag-X.zip` |

## Kolejne kroki (MVP)

1. Moduł auth (JWT + użytkownicy w SQLite)
2. Integracja Ollama (chat + wybór modelu)
3. RAG: ingest dokumentów → Qdrant → kontekst w promptcie
4. UI czatu i upload plików

## Konfiguracja

Zmienne środowiskowe: `.env.example` (root) oraz `apps/api/.env.example`.

Ollama i modele (`qwen3`, `deepseek-r1`) konfigurujesz na maszynie klienta — aplikacja łączy się tylko z lokalnym adresem `OLLAMA_BASE_URL`.

## GitHub

Repozytorium lokalne jest gotowe (gałąź `main`). Aby opublikować na swoim koncie GitHub:

```powershell
# 1. Jednorazowe logowanie (otworzy przeglądarkę)
gh auth login

# 2. Utworzenie repozytorium i push (domyślnie prywatne: TetaAIAssistant)
cd c:\Projects\TetaAIAssistant
.\scripts\publish-to-github.ps1

# Opcjonalnie: inna nazwa lub repozytorium publiczne
.\scripts\publish-to-github.ps1 MojaNazwaRepo public
```

Ręcznie (bez skryptu):

```powershell
gh repo create TetaAIAssistant --private --source=. --remote=origin --push
```
