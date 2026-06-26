# Teta AI Assistant — Linux vs Windows

## Krotko

| Scenariusz | Linux | Windows |
|------------|-------|---------|
| Development (`pnpm dev`) | Tak | Tak |
| Budowa paczki MSI (`TetaAI-Setup.msi`) | **Nie** | **Tak** |
| Instalacja u klienta (MSI) | **Nie** | **Tak** |
| Produkcja u klienta (uslugi NSSM, Ollama) | Nie (obecna architektura) | Tak |

Paczka MSI to instalator **Windows Installer** — buduje sie i uruchamia tylko na Windows.

---

## Serwer Linux — development / testy

```bash
# Wymagania: Node 22, pnpm, Ollama, Qdrant (Docker lub natywnie)
pnpm install
pnpm dev
```

Aplikacja web + API dziala. Brak panelu „Pobierz paczke MSI” z tego samego hosta — generowanie paczek wymaga Windows.

---

## Serwer Linux — produkcja u klienta

Obecny instalator zaklada:

- Windows Server / Windows 10–11
- uslugi Windows (NSSM: TetaAI-API, TetaAI-Qdrant)
- PowerShell `Setup.ps1`
- plik `TetaAI-Setup.msi`

**Na Linuxie u klienta nie ma dzis wsparcia „jednego pliku setup”.**

Mozliwy kierunek na przyszlosc (osobny projekt):

- Docker Compose (API + web + Qdrant + Ollama)
- systemd zamiast NSSM
- skrypt `install-linux.sh`

To nie jest jeszcze zaimplementowane.

---

## Gdzie budowac MSI (CI)

Jesli API/vendor dziala na Linuxie, paczki MSI buduj na:

1. **Stacja Windows** (dev) z `dotnet tool install --global wix`
2. **GitHub Actions** / Azure DevOps — runner `windows-latest`:

```yaml
- name: Install WiX 5
  run: |
    dotnet tool install --global wix
    wix extension add -g WixToolset.UI.wixext
    wix extension add -g WixToolset.Util.wixext
```

Nastepnie wywolaj eksport paczki z API na Windows lub uruchom `Build-MsiInstaller.ps1` w pipeline.

---

## Instalacja WiX 5 (Windows, bez .NET 3.5)

```powershell
dotnet tool install --global wix
wix extension add -g WixToolset.UI.wixext
wix extension add -g WixToolset.Util.wixext
```

Weryfikacja:

```powershell
wix --version
dotnet build scripts\setup\wix\TetaInstaller.wixproj -p:PayloadDir=.
```
