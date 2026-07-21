# AIA plugins.xml diagnostic (Etap 0)

Wygenerowano: **2026-07-21** (read-only CLI `diagnose:plugins-xml`)

## Root cause: **A**

**`plugins.xml` nie istnieje pod wyliczoną ścieżką.**

Łańcuch skutków:

1. Brak `plugins.xml` → `resolvePluginDescriptors` zawsze pada na `inferPluginDescriptorsFromDll`
2. Inferencja nie dostarcza GUID → brak `form_guid` w `teta_app_objects`
3. Help enrichment (`Help/{GUID}.html`) jest pomijany → `help_field_text` puste

Nie jest to B (katalog klienta istnieje i jest poprawnie odczytany z SQLite), ani C/D (nie ma XML do dopasowania Assembly).

---

## Konfiguracja

| Pole | Wartość |
|------|---------|
| SQLite (read-only) | `apps/api/data/teta.sqlite` → `teta_app.client_directory` |
| `clientDirectory` | `A:\TETA Aplikacja klienta - 33.5` |
| Katalog istnieje | **tak** |
| Wyliczona ścieżka XML | `A:\TETA Aplikacja klienta - 33.5\Plugins\plugins.xml` |
| `plugins.xml` istnieje | **nie** |
| `Help/` | `A:\TETA Aplikacja klienta - 33.5\Help` — **istnieje** |
| Pliki `Help/*.html` na dysku | **2064** (osobny count; bez GUID z XML import ich nie mapuje) |
| Szukanie `plugins.xml` (client + server, depth ≤4) | **0 plików** |

## Podsumowanie skanu

| Metryka | Wartość |
|---------|---------|
| DLL zeskanowane | 425 |
| Wpisy Plugin w XML | 0 |
| Formularze z GUID (XML) | 0 |
| Produkcja użyłaby XML | 0 |
| Produkcja użyłaby infer | **425** |
| Help istniejący (po GUID z XML) | 0 (brak GUID do sprawdzenia) |
| DLL bez exact XML | 425 |
| DLL z >1 exact match | 0 |
| Exact fail, relaxed Assembly OK | 0 |
| Exact fail, ClassName hint | 0 |

## Znaczenie liter root cause

| Kod | Znaczenie |
|-----|-----------|
| **A** | plugins.xml nie istnieje pod wyliczoną ścieżką ← **ten przypadek** |
| B | zły / pusty / nieistniejący `clientDirectory` |
| C | XML OK, ale Assembly nie pasuje do nazw DLL |
| D | XML pokrywa tylko część DLL |
| E | inny problem |

## Jak ponowić

```bash
pnpm --filter @teta/api run diagnose:plugins-xml -- --out "Z:\Projekty\TetaAIAssistant\docs"
```

Pełny wynik maszynowy (wszystkie DLL, Assembly, ścieżki): [`AIA_PLUGIN_XML_DIAGNOSTIC.json`](./AIA_PLUGIN_XML_DIAGNOSTIC.json)

## Odblokowanie Etapu 1

Skopiować / przywrócić prawdziwy `plugins.xml` do `{clientDirectory}/Plugins/plugins.xml`, ponowić diagnostykę (oczekiwane root cause C/D lub sukces z GUID), dopiero potem implementować merge XML+infer.
