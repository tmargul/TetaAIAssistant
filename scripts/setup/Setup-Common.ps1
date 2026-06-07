# Wspólne funkcje dla Setup.ps1

$ErrorActionPreference = "Stop"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:QdrantServiceName = "TetaAI-Qdrant"
$script:OfflineMode = $false
$script:OfflineBundlePath = $null

function Find-DefaultOfflineBundlePath {
    $repo = $script:RepoRoot
    $zipCandidates = @(
        (Join-Path $repo "offline-bundle.zip")
    )
    $zipCandidates += @(Get-ChildItem $repo -Filter "teta-offline-bundle*.zip" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { $_.FullName })

    foreach ($candidate in $zipCandidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    $dirCandidate = Join-Path $repo "offline-bundle"
    if (Test-Path $dirCandidate) {
        return $dirCandidate
    }

    return $dirCandidate
}

function Get-OfflineBundleRoot([string]$Path) {
    $manifestPath = Join-Path $Path "manifest.json"
    if (Test-Path $manifestPath) {
        return $Path
    }

    $subdirs = Get-ChildItem $Path -Directory -ErrorAction SilentlyContinue
    if ($subdirs.Count -eq 1) {
        $nested = Join-Path $subdirs[0].FullName "manifest.json"
        if (Test-Path $nested) {
            return $subdirs[0].FullName
        }
    }

    throw "Brak manifest.json w paczce offline: $Path"
}

function Resolve-OfflineBundlePath {
    param(
        [Parameter(Mandatory = $true)][string]$BundlePath,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    if (-not (Test-Path $BundlePath)) {
        throw "Nie znaleziono paczki offline: $BundlePath"
    }

    $resolved = (Resolve-Path $BundlePath).Path
    $item = Get-Item -LiteralPath $resolved

    if ($item.PSIsContainer) {
        return Get-OfflineBundleRoot $resolved
    }

    if ($resolved -notmatch '\.zip$') {
        throw "Paczka offline musi byc katalogiem lub plikiem .zip: $resolved"
    }

    Write-Host "  Rozpakowywanie paczki ZIP: $resolved" -ForegroundColor Yellow
    $extractDir = Join-Path $InstallRoot "offline-bundle"
    if (Test-Path $extractDir) {
        Remove-Item $extractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -LiteralPath $resolved -DestinationPath $extractDir -Force

    return Get-OfflineBundleRoot $extractDir
}

function Initialize-OfflineMode([string]$BundlePath) {
    $script:OfflineBundlePath = (Resolve-Path $BundlePath).Path
    $manifestPath = Join-Path $script:OfflineBundlePath "manifest.json"
    if (-not (Test-Path $manifestPath)) {
        throw "Brak manifest.json w paczce offline: $script:OfflineBundlePath"
    }
    $script:OfflineMode = $true
    Write-Host "  Tryb OFFLINE - paczka: $script:OfflineBundlePath" -ForegroundColor Yellow
    return Get-Content $manifestPath -Raw | ConvertFrom-Json
}

function Get-BundleItem([string]$RelativePath) {
    if (-not $script:OfflineBundlePath) {
        throw "Paczka offline nie jest zainicjalizowana."
    }
    return Join-Path $script:OfflineBundlePath $RelativePath
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Administrator {
    $current = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Uruchom PowerShell jako Administrator (wymagane do rejestracji usługi Windows)."
    }
}

function Install-NodeFromBundle {
    $installersDir = Get-BundleItem "installers"
    $msi = Get-ChildItem $installersDir -Filter "node-*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $msi) {
        throw "Brak instalatora Node.js w paczce offline (installers\node-*.msi). Zainstaluj Node recznie lub dolacz MSI do paczki."
    }
    Write-Host "  Instalacja Node.js z paczki: $($msi.Name)"
    Start-Process msiexec.exe -ArgumentList "/i `"$($msi.FullName)`" /qn /norestart" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-OllamaFromBundle {
    $installersDir = Get-BundleItem "installers"
    $setup = Get-ChildItem $installersDir -Filter "OllamaSetup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $setup) {
        throw "Brak OllamaSetup.exe w paczce offline (installers\). Zainstaluj Ollama recznie lub dolacz instalator do paczki."
    }
    Write-Host "  Instalacja Ollama z paczki: $($setup.Name)"
    Start-Process $setup.FullName -ArgumentList "/S" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Ensure-Node {
    Write-Step "Sprawdzanie Node.js (>= 20)"
    if (Test-Command node) {
        Write-Host "  Node.js: $(node -v)"
        return
    }

    if ($script:OfflineMode) {
        Install-NodeFromBundle
        if (-not (Test-Command node)) {
            throw "Node.js nie jest dostepny po instalacji z paczki offline."
        }
        Write-Host "  Node.js: $(node -v)"
        return
    }

    if (Test-Command winget) {
        Write-Host "  Instalacja Node.js LTS przez winget..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    if (-not (Test-Command node)) {
        throw "Zainstaluj Node.js >= 20: https://nodejs.org/"
    }
}

function Ensure-Pnpm {
    Write-Step "Sprawdzanie pnpm"
    if (Test-Command pnpm) {
        Write-Host "  pnpm: $(pnpm -v)"
        return
    }

    Write-Host "  Instalacja pnpm globalnie..."
    npm install -g pnpm
}

function Install-ProjectDependencies {
    Write-Step "Instalacja zaleznosci projektu (pnpm install)"
    Set-Location $script:RepoRoot

    if ($script:OfflineMode) {
        $bundleStore = Get-BundleItem "pnpm-store"
        if (Test-Path $bundleStore) {
            $env:PNPM_STORE_DIR = $bundleStore
            Write-Host "  pnpm install --offline (store z paczki)"
            pnpm install --offline
            return
        }
        Write-Host "  Brak pnpm-store w paczce - probuje zwyklego pnpm install" -ForegroundColor Yellow
    }

    pnpm install
}

function Ensure-Ollama {
    Write-Step "Sprawdzanie Ollama"

    if (Test-Command ollama) {
        Write-Host "  Ollama: $(ollama -v 2>&1 | Select-Object -First 1)"
        return
    }

    if ($script:OfflineMode) {
        Install-OllamaFromBundle
        if (-not (Test-Command ollama)) {
            throw "Ollama nie jest dostepna po instalacji z paczki offline."
        }
        Write-Host "  Ollama: $(ollama -v 2>&1 | Select-Object -First 1)"
        return
    }

    if (Test-Command winget) {
        Write-Host "  Instalacja Ollama przez winget..."
        winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    if (-not (Test-Command ollama)) {
        throw "Ollama nie jest zainstalowana. Pobierz: https://ollama.com/download"
    }
}

function Wait-OllamaReady {
    Write-Step "Oczekiwanie na uruchomienie Ollama"
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        try {
            $res = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
            Write-Host "  Ollama odpowiada (modele: $($res.models.Count))"
            return
        } catch {
            Start-Sleep -Seconds 3
        }
    }
    throw "Ollama nie odpowiada na http://127.0.0.1:11434 - uruchom Ollama z menu Start i ponów setup."
}

function Install-OllamaModels([string[]]$Models) {
    if ($script:OfflineMode) {
        Write-Step "Kopiowanie modeli Ollama z paczki offline"
        $source = Get-BundleItem "ollama-models"
        if (-not (Test-Path $source)) {
            throw "Brak katalogu ollama-models w paczce offline."
        }
        $target = Join-Path $env:USERPROFILE ".ollama\models"
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $source $target -Recurse -Force
        Write-Host "  Modele skopiowane do $target"
        return
    }

    Write-Step "Pobieranie modeli Ollama"
    foreach ($model in $Models) {
        Write-Host "  ollama pull $model"
        ollama pull $model
    }
}

function Get-QdrantInstallDir([string]$InstallRoot) {
    return Join-Path $InstallRoot "qdrant"
}

function Ensure-Qdrant([string]$InstallRoot) {
    Write-Step "Sprawdzanie Qdrant"
    $qdrantDir = Get-QdrantInstallDir $InstallRoot
    $qdrantExe = Join-Path $qdrantDir "qdrant.exe"

    if (Test-Path $qdrantExe) {
        Write-Host "  Qdrant: $qdrantExe"
        return $qdrantExe
    }

    if ($script:OfflineMode) {
        $bundleQdrant = Get-BundleItem "tools\qdrant"
        if (-not (Test-Path (Join-Path $bundleQdrant "qdrant.exe"))) {
            throw "Brak qdrant.exe w paczce offline (tools\qdrant)."
        }
        Write-Host "  Kopiowanie Qdrant z paczki offline..."
        Copy-Item "$bundleQdrant\*" (Get-QdrantInstallDir $InstallRoot) -Recurse -Force
        if (-not (Test-Path $qdrantExe)) {
            throw "Nie udalo sie skopiowac Qdrant do $qdrantDir"
        }
        Write-Host "  Qdrant: $qdrantExe"
        return $qdrantExe
    }

    Write-Host "  Pobieranie Qdrant (Windows) z GitHub releases..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/qdrant/qdrant/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -match "x86_64-pc-windows-msvc\.zip$" } | Select-Object -First 1

    if (-not $asset) {
        throw "Nie znaleziono paczki Windows w release Qdrant: https://github.com/qdrant/qdrant/releases"
    }

    New-Item -ItemType Directory -Force -Path $qdrantDir | Out-Null
    $zipPath = Join-Path $env:TEMP "qdrant-$($release.tag_name).zip"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $qdrantDir -Force
    Remove-Item $zipPath -Force

    if (-not (Test-Path $qdrantExe)) {
        throw "Po rozpakowaniu brak qdrant.exe w $qdrantDir"
    }

    Write-Host "  Qdrant zainstalowany: $qdrantExe"
    return $qdrantExe
}

function Ensure-Nssm([string]$InstallRoot) {
    Write-Step "Sprawdzanie NSSM (wrapper usługi Windows)"
    $toolsDir = Join-Path $InstallRoot "tools"
    $nssmExe = Join-Path $toolsDir "nssm.exe"

    if (Test-Path $nssmExe) {
        Write-Host "  NSSM: $nssmExe"
        return $nssmExe
    }

    if ($script:OfflineMode) {
        $bundleNssm = Get-BundleItem "tools\nssm.exe"
        if (-not (Test-Path $bundleNssm)) {
            throw "Brak tools\nssm.exe w paczce offline."
        }
        New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
        Copy-Item $bundleNssm $nssmExe -Force
        Write-Host "  NSSM: $nssmExe"
        return $nssmExe
    }

    if (Test-Command winget) {
        Write-Host "  Instalacja NSSM przez winget..."
        winget install NSSM.NSSM -e --accept-package-agreements --accept-source-agreements 2>$null
        $wingetNssm = Get-Command nssm -ErrorAction SilentlyContinue
        if ($wingetNssm) {
            New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
            Copy-Item $wingetNssm.Source $nssmExe -Force
            Write-Host "  NSSM: $nssmExe"
            return $nssmExe
        }
    }

    Write-Host "  Pobieranie NSSM 2.24..."
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath (Join-Path $env:TEMP "nssm-2.24") -Force
    Copy-Item (Join-Path $env:TEMP "nssm-2.24\nssm-2.24\win64\nssm.exe") $nssmExe -Force
    Remove-Item $zipPath -Force

    if (-not (Test-Path $nssmExe)) {
        throw "Nie udało się przygotować NSSM."
    }

    Write-Host "  NSSM: $nssmExe"
    return $nssmExe
}

function Invoke-Nssm {
    param(
        [Parameter(Mandatory = $true)][string]$NssmExe,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    if (-not (Test-Path -LiteralPath $NssmExe)) {
        throw "NSSM nie istnieje: $NssmExe"
    }

    $process = Start-Process -FilePath $NssmExe -ArgumentList $Arguments -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "NSSM zakonczyl sie kodem $($process.ExitCode): $($Arguments -join ' ')"
    }
}

function Register-QdrantService([string]$NssmExe, [string]$QdrantExe) {
    Write-Step "Rejestracja uslugi Windows: $script:QdrantServiceName"
    $qdrantDir = Split-Path $QdrantExe -Parent
    $existing = Get-Service $script:QdrantServiceName -ErrorAction SilentlyContinue

    if ($existing) {
        Write-Host "  Usuwanie poprzedniej konfiguracji uslugi..."
        if ($existing.Status -eq "Running") {
            Stop-Service $script:QdrantServiceName -Force
        }
        Invoke-Nssm -NssmExe $NssmExe -Arguments @('remove', $script:QdrantServiceName, 'confirm')
        Start-Sleep -Seconds 2
    }

    Invoke-Nssm -NssmExe $NssmExe -Arguments @('install', $script:QdrantServiceName, $QdrantExe)
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'AppDirectory', $qdrantDir)
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'DisplayName', 'Teta AI Qdrant')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'Description', 'Baza wektorowa RAG Teta AI Assistant')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'Start', 'SERVICE_AUTO_START')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'AppStdout', (Join-Path $qdrantDir 'qdrant-service.log'))
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:QdrantServiceName, 'AppStderr', (Join-Path $qdrantDir 'qdrant-service-error.log'))

    Start-Service $script:QdrantServiceName
    Write-Host "  Usluga $script:QdrantServiceName uruchomiona (autostart po restarcie Windows)." -ForegroundColor Green
}

function Wait-QdrantReady([string]$InstallRoot) {
    Write-Step "Oczekiwanie na uruchomienie Qdrant"
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:6333/collections" -TimeoutSec 3 | Out-Null
            Write-Host "  Qdrant odpowiada na http://127.0.0.1:6333"
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    $logPath = Join-Path (Get-QdrantInstallDir $InstallRoot) "qdrant-service-error.log"
    throw "Qdrant nie odpowiada. Sprawdź log: $logPath"
}

function New-RandomSecret([int]$ByteLength = 48) {
    $bytes = New-Object byte[] $ByteLength
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Write-EnvFile([string]$AppMode, [bool]$IncludeVendorSecret) {
    Write-Step "Tworzenie apps/api/.env"
    $examplePath = Join-Path $script:RepoRoot "apps\api\.env.example"
    $envPath = Join-Path $script:RepoRoot "apps\api\.env"

    if (-not (Test-Path $examplePath)) {
        throw "Brak pliku $examplePath"
    }

    $content = Get-Content $examplePath -Raw
    $content = $content -replace "(?m)^TETA_APP_MODE=.*$", "TETA_APP_MODE=$AppMode"
    $content = $content -replace "(?m)^JWT_SECRET=.*$", "JWT_SECRET=$(New-RandomSecret)"

    if ($IncludeVendorSecret) {
        if ($content -match "(?m)^#\s*TETA_VENDOR_SECRET=") {
            $content = $content -replace "(?m)^#\s*TETA_VENDOR_SECRET=.*$", "TETA_VENDOR_SECRET=$(New-RandomSecret)"
        } else {
            $content += "`nTETA_VENDOR_SECRET=$(New-RandomSecret)`n"
        }
    } else {
        $content = $content -replace "(?m)^TETA_VENDOR_SECRET=.*$", "# TETA_VENDOR_SECRET="
        if ($content -notmatch "TETA_VENDOR_SECRET") {
            $content += "`n# TETA_VENDOR_SECRET=`n"
        }
    }

    Set-Content -Path $envPath -Value $content -Encoding UTF8
    Write-Host "  Zapisano: $envPath"
}

function Write-StartAppScript([string]$InstallRoot) {
    Write-Step "Tworzenie skryptu startowego aplikacji"
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

    $startApp = @"
@echo off
title Teta AI Assistant
cd /d "$script:RepoRoot"
call pnpm dev
"@

    $path = Join-Path $InstallRoot "Start-App.bat"
    Set-Content $path $startApp -Encoding ASCII
    Write-Host "  $path"
}

function Import-GlobalRagFromBundle {
    Write-Step "Import globalnego RAG do Qdrant"
    $ragDir = Get-BundleItem "rag"
    if (-not (Test-Path $ragDir)) {
        Write-Host "  Brak katalogu rag w paczce offline — pominięto import RAG." -ForegroundColor Yellow
        return
    }

    $ragFile = Get-ChildItem $ragDir -Filter "global-rag-*.zip" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $ragFile) {
        Write-Host "  Brak pliku global-rag-*.zip — pominięto import RAG." -ForegroundColor Yellow
        return
    }

    Set-Location $script:RepoRoot
    Write-Host "  Import: $($ragFile.Name)"
    pnpm rag:global:import --file "$($ragFile.FullName)"
    if ($LASTEXITCODE -ne 0) {
        throw "Import globalnego RAG nie powiódł się."
    }
    Write-Host "  RAG zaimportowany pomyślnie." -ForegroundColor Green
}

function Wait-ApplicationReady {
    Write-Step "Oczekiwanie na uruchomienie aplikacji"
    $deadline = (Get-Date).AddMinutes(4)
    $apiOk = $false
    $webOk = $false

    while ((Get-Date) -lt $deadline) {
        if (-not $apiOk) {
            try {
                Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 4 | Out-Null
                Write-Host "  API: OK (http://127.0.0.1:3000)" -ForegroundColor Green
                $apiOk = $true
            } catch { }
        }
        if (-not $webOk) {
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:5173" -TimeoutSec 4 -UseBasicParsing | Out-Null
                Write-Host "  Web: OK (http://127.0.0.1:5173)" -ForegroundColor Green
                $webOk = $true
            } catch { }
        }
        if ($apiOk -and $webOk) {
            return
        }
        Start-Sleep -Seconds 4
    }

    Write-Host "  Aplikacja może jeszcze się uruchamiać — sprawdź http://localhost:5173" -ForegroundColor Yellow
}

function Start-Application([string]$InstallRoot) {
    Write-Step "Uruchamianie aplikacji Teta AI"
    $batPath = Join-Path $InstallRoot "Start-App.bat"
    if (-not (Test-Path $batPath)) {
        throw "Brak skryptu startowego: $batPath"
    }

    Start-Process -FilePath $batPath -WorkingDirectory $InstallRoot
    Wait-ApplicationReady
}

function Test-ServicesHealth {
    Write-Step "Sprawdzanie usług"
    $ok = $true

    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 | Out-Null
        Write-Host "  Ollama: OK" -ForegroundColor Green
    } catch {
        Write-Host "  Ollama: niedostępna - uruchom z menu Start" -ForegroundColor Yellow
        $ok = $false
    }

    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:6333/collections" -TimeoutSec 5 | Out-Null
        Write-Host "  Qdrant: OK (usługa $script:QdrantServiceName)" -ForegroundColor Green
    } catch {
        Write-Host "  Qdrant: niedostępna - sprawdź usługę $script:QdrantServiceName" -ForegroundColor Yellow
        $ok = $false
    }

    return $ok
}
