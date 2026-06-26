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

    [string]$InstallRoot = "",

    [string]$RepoRoot = "",

    [switch]$Offline,

    [string]$BundlePath = "",

    [switch]$NoStart,

    [switch]$NonInteractive,

    [switch]$Interactive,

    [switch]$UpgradeQdrant
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

if ($RepoRoot) {
    $script:RepoRoot = (Resolve-Path $RepoRoot).Path
}

$InstallRoot = Resolve-InstallRoot -InstallRoot $InstallRoot -RepoRoot $script:RepoRoot

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

$setupLogPath = Join-Path $InstallRoot "setup-log.txt"
$script:SetupTranscriptStarted = $false
if (Test-SetupNonInteractive -NonInteractive:$NonInteractive -Interactive:$Interactive) {
    $env:TETA_SETUP_NONINTERACTIVE = '1'
    try {
        Start-Transcript -Path $setupLogPath -Append -Force | Out-Null
        $script:SetupTranscriptStarted = $true
        Write-Host "Log instalacji: $setupLogPath" -ForegroundColor DarkGray
        Write-Host "Postep (plik): $(Join-Path $InstallRoot 'setup-progress.txt')" -ForegroundColor DarkGray
        Write-Host "Pierwsza instalacja online moze trwac 20-40 min (pnpm, modele Ollama ~5-6 GB)." -ForegroundColor Yellow
    } catch {
        Write-Host "  Nie udalo sie utworzyc logu instalacji: $_" -ForegroundColor Yellow
    }
}

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

$isVendor = $Mode -eq "vendor"
$progressSteps = [System.Collections.Generic.List[string]]::new()
$progressSteps.AddRange(@(
    'Node.js 22 LTS',
    'pnpm',
    'Ollama (instalacja / sciezki)',
    'Zaleznosci projektu (pnpm install)',
    'Qdrant',
    'NSSM (uslugi Windows)',
    'Konfiguracja srodowiska (.env)',
    'Ollama — gotowosc API'
))
if ($isVendor) {
    $progressSteps.Add('Model AI: nomic-embed-text')
    $progressSteps.Add('Model AI: qwen3')
    $progressSteps.Add('Narzedzia ingest wideo')
} elseif ($Offline) {
    $progressSteps.Add('Modele AI z paczki offline')
} else {
    $progressSteps.Add('Model AI: nomic-embed-text')
    $progressSteps.Add('Model AI: qwen3')
}
$progressSteps.AddRange(@(
    'Usluga Windows: Qdrant',
    'Usluga Windows: API',
    'Weryfikacja uslug'
))
if (-not $isVendor -and $Offline) {
    $progressSteps.Add('Import globalnego RAG')
}

Initialize-SetupProgress -InstallRoot $InstallRoot -Steps $progressSteps.ToArray()

Advance-SetupProgress 'Node.js 22 LTS'
Ensure-Node
Advance-SetupProgress 'pnpm'
Ensure-Pnpm
Advance-SetupProgress 'Ollama (instalacja / sciezki)'
Ensure-Ollama -InstallRoot $InstallRoot
Advance-SetupProgress 'Zaleznosci projektu (pnpm install)'
Install-ProjectDependencies

Advance-SetupProgress 'Qdrant'
$qdrantExe = Ensure-Qdrant $InstallRoot -Upgrade:$UpgradeQdrant
Advance-SetupProgress 'NSSM (uslugi Windows)'
$nssmExe = Ensure-Nssm $InstallRoot

Advance-SetupProgress 'Konfiguracja srodowiska (.env)'
Write-EnvFile -AppMode $Mode -IncludeVendorSecret $isVendor -InstallRoot $InstallRoot

Ensure-Ollama -InstallRoot $InstallRoot
Advance-SetupProgress 'Ollama — gotowosc API'
Wait-OllamaReady

if ($isVendor) {
    Advance-SetupProgress 'Model AI: nomic-embed-text'
    Install-OllamaModels -Models @("nomic-embed-text") -InstallRoot $InstallRoot
    Advance-SetupProgress 'Model AI: qwen3'
    Install-OllamaModels -Models @("qwen3") -InstallRoot $InstallRoot
    if (-not $Offline) {
        Invoke-OptionalDeepseekInstall -Interactive:$Interactive
    }
    Advance-SetupProgress 'Narzedzia ingest wideo'
    Ensure-VideoIngestTools -InstallRoot $InstallRoot
} elseif ($Offline) {
    Advance-SetupProgress 'Modele AI z paczki offline'
    Install-OllamaModels -Models @("nomic-embed-text", "qwen3") -InstallRoot $InstallRoot
    Write-Host ""
    Write-Host "Modele offline: skopiowano z paczki (deepseek-r1 tylko jesli byl w paczce IT)." -ForegroundColor DarkGray
} else {
    Advance-SetupProgress 'Model AI: nomic-embed-text'
    Install-OllamaModels -Models @("nomic-embed-text") -InstallRoot $InstallRoot
    Advance-SetupProgress 'Model AI: qwen3'
    Install-OllamaModels -Models @("qwen3") -InstallRoot $InstallRoot
    Invoke-OptionalDeepseekInstall -Interactive:$Interactive
}

Advance-SetupProgress 'Usluga Windows: Qdrant'
Register-QdrantService -NssmExe $nssmExe -QdrantExe $qdrantExe
Wait-QdrantReady -InstallRoot $InstallRoot

if (-not $isVendor -and $Offline) {
    Advance-SetupProgress 'Import globalnego RAG'
    Import-GlobalRagFromBundle
}

Advance-SetupProgress 'Usluga Windows: API'
Write-StartAppScript -InstallRoot $InstallRoot
Register-ApiService -NssmExe $nssmExe -InstallRoot $InstallRoot
Write-InstallManifest -InstallRoot $InstallRoot -RepoRoot $script:RepoRoot

Advance-SetupProgress 'Weryfikacja uslug'
Write-Host "========================================" -ForegroundColor Green
Write-Host " Instalacja zakończona ($Mode)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Katalog instalacji (aplikacja + usługi):"
Write-Host "  $InstallRoot"
Write-Host ""
Write-Host "Usługi:"
Write-Host "  Qdrant  - usługa Windows: TetaAI-Qdrant (autostart)"
Write-Host "  API     - usługa Windows: TetaAI-API (autostart, bez terminala)"
Write-Host "  Ollama  - $InstallRoot\ollama (modele: $InstallRoot\ollama\models)"
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
Test-ServicesHealth -InstallRoot $InstallRoot | Out-Null
Complete-SetupProgress

$shouldAutoStart = -not $NoStart -and (Test-ProductionLayout -or ((-not $isVendor) -and $Offline))
$openBrowserInSetup = -not (Test-SetupNonInteractive -NonInteractive:$NonInteractive -Interactive:$Interactive)

if ($shouldAutoStart) {
    Start-Application $InstallRoot -OpenBrowser:$openBrowserInSetup
    Write-Host ""
    Write-Host "Aplikacja uruchomiona:" -ForegroundColor Green
    if (Test-ProductionLayout) {
        Write-Host "  http://localhost:3000"
        if (-not $openBrowserInSetup) {
            Write-Host "  (przegladarka otworzy sie po zakonczeniu instalatora lub uruchom Start-App.bat)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  http://localhost:5173"
    }
    Write-Host "  http://localhost:3000/api/health"
    if (-not $isVendor -and -not $Offline) {
        Write-Host ""
        Write-Host "Pamietaj: zaimportuj RAG — Aktualizuj-RAG.bat lub pnpm rag:global:import" -ForegroundColor Yellow
    }
}

if (Test-SetupNonInteractive -NonInteractive:$NonInteractive -Interactive:$Interactive) {
    if ($script:SetupTranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
    exit 0
}
