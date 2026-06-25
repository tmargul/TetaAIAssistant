# Teta AI Assistant - jeden skrypt instalacji (client lub vendor)
#
# Uruchom w PowerShell jako Administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1
#
# Lub z parametrem:
#   powershell -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1 -Mode vendor
#   powershell -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1 -Mode client
#   powershell -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1 -Mode client -Offline -BundlePath D:\media\teta-offline-bundle.zip
#   Domyślnie bez pytań w terminalu. Opcjonalnie: -Interactive (wybór trybu, deepseek-r1).

param(
    [Parameter()]
    [ValidateSet("vendor", "client")]
    [string]$Mode,

    [string]$InstallRoot = "C:\TetaAI",

    [switch]$Offline,

    [string]$BundlePath = "",

    [switch]$NoStart,

    [switch]$NonInteractive,

    [switch]$Interactive
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

if (-not $Mode) {
    if (Test-SetupNonInteractive -NonInteractive:$NonInteractive -Interactive:$Interactive) {
        throw "Parametr -Mode (vendor|client) jest wymagany. Przyklad: -Mode vendor"
    }

    Write-Host ""
    Write-Host "Teta AI Assistant - instalacja" -ForegroundColor Green
    Write-Host "  1  client  - instalacja u klienta (intranet)"
    Write-Host "  2  vendor  - instalacja u Tety (budowa globalnego RAG)"
    Write-Host ""
    $choice = Read-Host "Wybierz tryb [1/2] (domyślnie: 1)"
    $Mode = if ($choice -eq "2") { "vendor" } else { "client" }
}

Assert-Administrator

if ($Offline) {
    if (-not $BundlePath) {
        $BundlePath = Find-DefaultOfflineBundlePath
    }
    $resolvedBundle = Resolve-OfflineBundlePath -BundlePath $BundlePath -InstallRoot $InstallRoot
    Initialize-OfflineMode $resolvedBundle | Out-Null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Teta AI Assistant - setup: $Mode" -ForegroundColor Green
if ($Offline) { Write-Host " Tryb: OFFLINE (bez internetu)" -ForegroundColor Yellow }
Write-Host " Katalog: $InstallRoot" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Ensure-Node
Ensure-Pnpm
Ensure-Ollama
Install-ProjectDependencies

$qdrantExe = Ensure-Qdrant $InstallRoot
$nssmExe = Ensure-Nssm $InstallRoot

$isVendor = $Mode -eq "vendor"
Write-EnvFile -AppMode $Mode -IncludeVendorSecret $isVendor

Ensure-Ollama
Wait-OllamaReady

if ($isVendor) {
    Install-OllamaModels @("nomic-embed-text", "qwen3")
    if (-not $Offline) {
        Invoke-OptionalDeepseekInstall -Interactive:$Interactive
    }
    Ensure-VideoIngestTools -InstallRoot $InstallRoot
} elseif ($Offline) {
    Install-OllamaModels @("nomic-embed-text", "qwen3")
    Write-Host ""
    Write-Host "Modele offline: skopiowano z paczki (deepseek-r1 tylko jesli byl w paczce IT)." -ForegroundColor DarkGray
} else {
    Install-OllamaModels @("nomic-embed-text", "qwen3")
    Invoke-OptionalDeepseekInstall -Interactive:$Interactive
}

Register-QdrantService -NssmExe $nssmExe -QdrantExe $qdrantExe
Wait-QdrantReady -InstallRoot $InstallRoot

if (-not $isVendor -and $Offline) {
    Import-GlobalRagFromBundle
}

Write-StartAppScript -InstallRoot $InstallRoot
Register-ApiService -NssmExe $nssmExe -InstallRoot $InstallRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Instalacja zakończona ($Mode)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Usługi:"
Write-Host "  Qdrant  - usługa Windows: TetaAI-Qdrant (autostart)"
Write-Host "  API     - usługa Windows: TetaAI-API (autostart, bez terminala)"
Write-Host "  Ollama  - autostart przez instalator Ollama"
Write-Host ""
Write-Host "Uruchom aplikację (otwiera przeglądarkę):"
Write-Host "  $InstallRoot\Start-App.bat"
if (-not (Test-ProductionLayout)) {
    Write-Host "  lub: pnpm dev"
}
Write-Host ""
Write-Host "Adresy:"
if (Test-ProductionLayout) {
    Write-Host "  Aplikacja:  http://localhost:3000"
} else {
    Write-Host "  Aplikacja:  http://localhost:5173"
}
Write-Host "  API:        http://localhost:3000/api/health"
Write-Host "  Qdrant:     http://localhost:6333/dashboard"
Write-Host ""

if ($isVendor) {
    Write-Host "Vendor - budowa globalnego RAG:"
    Write-Host "  Pelna instrukcja: sources\global\README.md"
    Write-Host "  1. Wrzuc pliki .txt / .md do: sources\global\"
    Write-Host "  2. Lub upload MP4 w: Zrodla globalne (transkrypcja Whisper)"
    Write-Host "  3. W aplikacji: Ustawienia -> Paczki -> Zbuduj indeks RAG (dla dokumentow)"
    Write-Host "  4. Pobierz paczke RAG global (wersja np. 1.0.0)"
} else {
    Write-Host "Client - aktualizacje niezalezne (gdy system juz dziala):"
    Write-Host "  - RAG:         pnpm rag:global:import --file .\global-rag-X.zip"
    Write-Host "  - Aplikacja:   skopiuj nowe pliki + pnpm install --offline"
    Write-Host "  - Silnik:      nowa paczka offline-bundle + setup z -NoStart"
    Write-Host "  - upload dokumentow klienta przez admina (w przygotowaniu)"
}

Write-Host ""
Test-ServicesHealth | Out-Null

if (-not $NoStart) {
    if (-not $isVendor -and $Offline) {
        Start-Application $InstallRoot
        Write-Host ""
        Write-Host "Aplikacja uruchomiona:" -ForegroundColor Green
        if (Test-ProductionLayout) {
            Write-Host "  http://localhost:3000"
        } else {
            Write-Host "  http://localhost:5173"
        }
        Write-Host "  http://localhost:3000/api/health"
    } elseif (Test-ProductionLayout) {
        Start-Application $InstallRoot
        Write-Host ""
        Write-Host "Aplikacja uruchomiona:" -ForegroundColor Green
        Write-Host "  http://localhost:3000"
        if (-not $isVendor) {
            Write-Host ""
            Write-Host "Pamietaj: zaimportuj RAG — Aktualizuj-RAG.bat lub pnpm rag:global:import" -ForegroundColor Yellow
        }
    }
}

if (Test-SetupNonInteractive -NonInteractive:$NonInteractive -Interactive:$Interactive) {
    exit 0
}
