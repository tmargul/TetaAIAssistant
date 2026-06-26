# Wspólne funkcje dla Setup.ps1

$ErrorActionPreference = "Stop"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:InstallRoot = $null
$script:LegacyInstallRoot = "C:\TetaAI"
$script:QdrantServiceName = "TetaAI-Qdrant"
$script:ApiServiceName = "TetaAI-API"
$script:OfflineMode = $false
$script:OfflineBundlePath = $null

function Test-SetupNonInteractive {
    param(
        [switch]$NonInteractive,
        [switch]$Interactive
    )

    if ($Interactive) {
        return $false
    }
    if ($NonInteractive) {
        return $true
    }
    if ($env:TETA_SETUP_NONINTERACTIVE -eq '1') {
        return $true
    }
    # Domyślnie bez pytań w terminalu (instalatory, .bat, pnpm setup:*).
    return $true
}

function Invoke-WingetInstall {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    if (-not (Test-Command winget)) {
        throw "winget nie jest dostepny w PATH."
    }

    $wingetArgs = @('install') + $Arguments + @(
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity'
    )
    & winget @wingetArgs
}

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
    $ts = Get-Date -Format 'HH:mm:ss'
    Write-Host ""
    Write-Host "==> [$ts] $Message" -ForegroundColor Cyan
    Write-SetupProgressDetail $Message
}

$script:SetupProgress = @{
    InstallRoot = $null
    Path        = $null
    Steps       = @()
    Index       = 0
    StartedAt   = $null
}

function Initialize-SetupProgress {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string[]]$Steps
    )

    $script:SetupProgress.InstallRoot = $InstallRoot
    $script:SetupProgress.Path = Join-Path $InstallRoot 'setup-progress.txt'
    $script:SetupProgress.Steps = @($Steps)
    $script:SetupProgress.Index = 0
    $script:SetupProgress.StartedAt = Get-Date
    Update-SetupProgressFile -Headline 'Rozpoczeto instalacje' -Detail 'Przygotowanie...'
}

function Advance-SetupProgress {
    param([Parameter(Mandatory = $true)][string]$StepName)

    $script:SetupProgress.Index++
    $idx = $script:SetupProgress.Index
    $total = $script:SetupProgress.Steps.Count
    $elapsed = (Get-Date) - $script:SetupProgress.StartedAt
    $pct = if ($total -gt 0) { [Math]::Min(100, [int](($idx / $total) * 100)) } else { 0 }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host " POSTEP: [$idx/$total] ($pct%) $StepName" -ForegroundColor Magenta
    Write-Host " Czas od startu: $($elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Magenta

    Write-Progress -Activity 'Teta AI — instalacja' -Status $StepName -PercentComplete $pct
    Update-SetupProgressFile -Headline "[$idx/$total] ($pct%) $StepName" -Detail $StepName
}

function Write-SetupProgressDetail([string]$Detail) {
    if (-not $script:SetupProgress.Path) { return }
    $idx = $script:SetupProgress.Index
    $total = $script:SetupProgress.Steps.Count
    $pct = if ($total -gt 0) { [Math]::Min(100, [int](($idx / $total) * 100)) } else { 0 }
    $headline = if ($idx -gt 0) { "[$idx/$total] ($pct%)" } else { '[0/?]' }
    Update-SetupProgressFile -Headline $headline -Detail $Detail
}

function Complete-SetupProgress {
    Write-Progress -Activity 'Teta AI — instalacja' -Completed
    Update-SetupProgressFile -Headline '[GOTOWE] Instalacja zakonczona' -Detail 'Mozesz uruchomic Start-App.bat'
}

function Update-SetupProgressFile {
    param(
        [Parameter(Mandatory = $true)][string]$Headline,
        [string]$Detail = ''
    )

    $path = $script:SetupProgress.Path
    if (-not $path) { return }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $elapsed = ''
    if ($script:SetupProgress.StartedAt) {
        $elapsed = ((Get-Date) - $script:SetupProgress.StartedAt).ToString('hh\:mm\:ss')
    }

    $content = @(
        'Teta AI Assistant — postep instalacji',
        "Ostatnia aktualizacja: $ts",
        "Czas od startu: $elapsed",
        '',
        $Headline,
        $(if ($Detail) { "Szczegoly: $Detail" }),
        '',
        'Pelny log: setup-log.txt (w tym katalogu)',
        'Okno PowerShell pokazuje biezacy krok na zywo.'
    ) | Where-Object { $_ -ne $null }

    Set-Content -Path $path -Value ($content -join "`n") -Encoding UTF8
}

function Resolve-InstallRoot {
    param(
        [string]$InstallRoot = "",
        [string]$RepoRoot = ""
    )

    if (-not $RepoRoot) {
        $RepoRoot = $script:RepoRoot
    }

    if ($InstallRoot) {
        $resolved = (Resolve-Path (New-Item -ItemType Directory -Force -Path $InstallRoot)).Path
        $script:InstallRoot = $resolved
        return $resolved
    }

    $resolved = (Resolve-Path $RepoRoot).Path
    $script:InstallRoot = $resolved
    return $resolved
}

function Get-InstallManifestPath([string]$RepoRoot = "") {
    if (-not $RepoRoot) { $RepoRoot = $script:RepoRoot }
    return Join-Path $RepoRoot "install-root.json"
}

function Write-InstallManifest {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$RepoRoot = ""
    )

    if (-not $RepoRoot) { $RepoRoot = $script:RepoRoot }
    $manifest = @{
        installRoot = $InstallRoot
        repoRoot    = $RepoRoot
        createdAt   = (Get-Date).ToString("o")
    } | ConvertTo-Json -Depth 3

    $path = Get-InstallManifestPath $RepoRoot
    Set-Content -Path $path -Value $manifest -Encoding UTF8
    Write-Host "  Zapisano manifest instalacji: $path" -ForegroundColor DarkGray
}

function Read-InstallManifest([string]$StartDir = "") {
    $candidates = @()
    if ($StartDir) { $candidates += $StartDir }
    if ($script:RepoRoot) { $candidates += $script:RepoRoot }

    foreach ($dir in $candidates) {
        $path = Join-Path $dir "install-root.json"
        if (-not (Test-Path $path)) { continue }
        try {
            return Get-Content $path -Raw | ConvertFrom-Json
        } catch { }
    }
    return $null
}

function Find-TetaApplicationRoot {
    param([string]$HintPath = "")

    if ($HintPath -and (Test-Path (Join-Path $HintPath "apps\api\dist\main.js"))) {
        return (Resolve-Path $HintPath).Path
    }

    $manifest = Read-InstallManifest $HintPath
    if ($manifest -and $manifest.repoRoot -and (Test-Path (Join-Path $manifest.repoRoot "apps\api\dist\main.js"))) {
        return (Resolve-Path $manifest.repoRoot).Path
    }

    $runner = Join-Path $script:LegacyInstallRoot "run-api.cmd"
    if (Test-Path $runner) {
        $content = Get-Content $runner -Raw
        if ($content -match 'set TETA_REPO_ROOT=(.+)') {
            $legacyRoot = $Matches[1].Trim()
            if (Test-Path (Join-Path $legacyRoot "apps\api\dist\main.js")) {
                return (Resolve-Path $legacyRoot).Path
            }
        }
    }

    $uninstallKeys = @(
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($keyPath in $uninstallKeys) {
        foreach ($key in Get-ItemProperty $keyPath -ErrorAction SilentlyContinue) {
            if ($key.DisplayName -notmatch 'Teta AI') { continue }
            if (-not $key.InstallLocation) { continue }
            $loc = $key.InstallLocation.TrimEnd('\')
            if (Test-Path (Join-Path $loc "apps\api\dist\main.js")) {
                return (Resolve-Path $loc).Path
            }
        }
    }

    return $null
}

function Get-OllamaInstallDir([string]$InstallRoot) {
    return Join-Path $InstallRoot "ollama"
}

function Get-OllamaModelsDir([string]$InstallRoot) {
    return Join-Path (Get-OllamaInstallDir $InstallRoot) "models"
}

function Set-OllamaInstallEnv([string]$InstallRoot) {
    $modelsDir = Get-OllamaModelsDir $InstallRoot
    New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null
    [System.Environment]::SetEnvironmentVariable("OLLAMA_MODELS", $modelsDir, "Machine")
    $env:OLLAMA_MODELS = $modelsDir
}

function Test-OllamaInInstallRoot([string]$InstallRoot) {
    $ollamaDir = Get-OllamaInstallDir $InstallRoot
    foreach ($name in @("ollama.exe", "Ollama.exe")) {
        if (Test-Path (Join-Path $ollamaDir $name)) { return $true }
    }
    return $false
}

function Get-OllamaSetupExeFromBundle {
    $installersDir = Get-BundleItem "installers"
    return Get-ChildItem $installersDir -Filter "OllamaSetup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Install-OllamaToInstallRoot {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$SetupExePath = ""
    )

    $ollamaDir = Get-OllamaInstallDir $InstallRoot
    New-Item -ItemType Directory -Force -Path $ollamaDir | Out-Null
    Set-OllamaInstallEnv $InstallRoot

    if (Test-OllamaInInstallRoot $InstallRoot) {
        Write-Host "  Ollama w katalogu instalacji: $ollamaDir"
        return
    }

    if (-not $SetupExePath) {
        if ($script:OfflineMode) {
            $bundleSetup = Get-OllamaSetupExeFromBundle
            if (-not $bundleSetup) {
                throw "Brak OllamaSetup.exe w paczce offline (installers\)."
            }
            $SetupExePath = $bundleSetup.FullName
        } else {
            $SetupExePath = Join-Path $env:TEMP "OllamaSetup.exe"
            if (-not (Test-Path $SetupExePath)) {
                Write-Host "  Pobieranie OllamaSetup.exe..."
                Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $SetupExePath
            }
        }
    }

    Write-Host "  Instalacja Ollama w: $ollamaDir"
    Start-Process $SetupExePath -ArgumentList "/S", "/DIR=$ollamaDir" -Wait
    Refresh-ShellPath

    if (-not (Test-OllamaInInstallRoot $InstallRoot)) {
        throw "Ollama nie zostala zainstalowana w $ollamaDir"
    }
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
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $setup = Get-OllamaSetupExeFromBundle
    if (-not $setup) {
        throw "Brak OllamaSetup.exe w paczce offline (installers\). Zainstaluj Ollama recznie lub dolacz instalator do paczki."
    }
    Write-Host "  Instalacja Ollama z paczki: $($setup.Name)"
    Install-OllamaToInstallRoot -InstallRoot $InstallRoot -SetupExePath $setup.FullName
    Refresh-ShellPath
}

function Get-NodeMajorVersion {
    if (-not (Test-Command node)) { return $null }
    $version = (node -v 2>&1).ToString().Trim()
    if ($version -match '^v?(\d+)') { return [int]$Matches[1] }
    return $null
}

function Assert-NodeVersionSupported {
    $major = Get-NodeMajorVersion
    if (-not $major) {
        throw "Node.js nie jest dostepny w PATH."
    }
    if ($major -ge 24) {
        throw "Node $(node -v) nie jest wspierany. Wymagany Node 22 LTS (winget install OpenJS.NodeJS.22)."
    }
    if ($major -lt 20) {
        throw "Node $(node -v) jest za stary. Wymagany Node 22 LTS."
    }
    if ($major -ne 22) {
        Write-Host "  Ostrzezenie: zalecany Node 22 LTS, wykryto $(node -v)." -ForegroundColor Yellow
    }
}

function Ensure-Node {
    Write-Step "Sprawdzanie Node.js (22 LTS)"
    Refresh-ShellPath

    $major = Get-NodeMajorVersion
    if ($major -eq 22) {
        Write-Host "  Node.js: $(node -v) (OK)"
        return
    }

    if ($major) {
        Write-Host "  Wykryto Node $(node -v) — wymagany Node 22 LTS." -ForegroundColor Yellow
    }

    if ($script:OfflineMode) {
        Install-NodeFromBundle
        Refresh-ShellPath
        if (-not (Test-Command node)) {
            throw "Node.js nie jest dostepny po instalacji z paczki offline."
        }
        Assert-NodeVersionSupported
        Write-Host "  Node.js: $(node -v)"
        return
    }

    if (Test-Command winget) {
        Write-Host "  Instalacja Node.js 22 LTS przez winget..."
        Invoke-WingetInstall OpenJS.NodeJS.22 --force
        Refresh-ShellPath
    }

    if (-not (Test-Command node)) {
        throw "Zainstaluj Node.js 22 LTS: https://nodejs.org/ (winget install OpenJS.NodeJS.22)"
    }

    Assert-NodeVersionSupported
    Write-Host "  Node.js: $(node -v)"
}

function Ensure-Pnpm {
    Write-Step "Sprawdzanie pnpm"
    Refresh-ShellPath

    if (-not (Test-Command pnpm)) {
        Write-Host "  Instalacja pnpm globalnie..."
        npm install -g pnpm@10.28.1
        Refresh-ShellPath
    }

    if (-not (Test-Command pnpm)) {
        throw "pnpm nie jest dostepny. Uruchom: npm install -g pnpm@10.28.1"
    }

    Write-Host "  pnpm: $(pnpm -v)"
}

function Invoke-Pnpm {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & pnpm @Arguments 2>&1 | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                $msg = $_.Exception.Message
                if ($msg -match '\[WARN\]' -or $msg -match 'no longer read by pnpm') {
                    Write-Host "    $msg" -ForegroundColor Yellow
                } else {
                    Write-Host "    $msg" -ForegroundColor DarkGray
                }
            } else {
                Write-Host "    $_"
            }
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Find-BetterSqlite3NativeBinding {
    $roots = @(
        (Join-Path $script:RepoRoot "node_modules\better-sqlite3"),
        (Join-Path $script:RepoRoot "node_modules")
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $match = Get-ChildItem -Path $root -Recurse -Filter "better_sqlite3.node" -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    return $null
}

function Ensure-PnpmBuildAllowlist {
    $workspacePath = Join-Path $script:RepoRoot "pnpm-workspace.yaml"
    $required = @('better-sqlite3', 'oracledb', '@nestjs/core', 'esbuild')

    if (-not (Test-Path $workspacePath)) {
        @"
packages:
  - 'apps/api'
  - 'packages/*'
onlyBuiltDependencies:
  - better-sqlite3
  - oracledb
  - '@nestjs/core'
  - esbuild
"@ | Set-Content $workspacePath -Encoding UTF8
        Write-Host "  Utworzono pnpm-workspace.yaml (onlyBuiltDependencies)" -ForegroundColor Yellow
        return
    }

    $content = Get-Content $workspacePath -Raw
    $missing = @($required | Where-Object { $content -notmatch [regex]::Escape($_) })
    if ($missing.Count -eq 0) { return }

    if ($content -notmatch '(?m)^onlyBuiltDependencies\s*:') {
        $content = $content.TrimEnd() + "`n`nonlyBuiltDependencies:`n"
        foreach ($pkg in $required) {
            $content += "  - $pkg`n"
        }
    } else {
        foreach ($pkg in $missing) {
            $content += "  - $pkg`n"
        }
    }

    Set-Content $workspacePath -Value $content.TrimEnd() -Encoding UTF8
    Write-Host "  Uzupelniono pnpm-workspace.yaml: $($missing -join ', ')" -ForegroundColor Yellow
}

function Assert-PnpmNativeDependencies {
    Write-Step "Paczki natywne Node (better-sqlite3, oracledb)"
    Set-Location $script:RepoRoot

    if (-not (Test-Path (Join-Path $script:RepoRoot "node_modules"))) {
        throw "Brak node_modules — najpierw uruchom pnpm install."
    }

    Ensure-PnpmBuildAllowlist

    $binding = Find-BetterSqlite3NativeBinding
    if ($binding) {
        Write-Host "  better_sqlite3.node: OK (bez przebudowy)" -ForegroundColor Green
        Write-Host "    $binding" -ForegroundColor DarkGray
        return
    }

    Write-Host "  pnpm rebuild better-sqlite3..."
    $rebuildSqliteExit = Invoke-Pnpm rebuild better-sqlite3
    if ($rebuildSqliteExit -ne 0) {
        throw "pnpm rebuild better-sqlite3 nie powiodl sie (kod $rebuildSqliteExit)."
    }

    Write-Host "  pnpm rebuild oracledb..."
    $rebuildOracleExit = Invoke-Pnpm rebuild oracledb
    if ($rebuildOracleExit -ne 0) {
        throw "pnpm rebuild oracledb nie powiodl sie (kod $rebuildOracleExit)."
    }

    $binding = Find-BetterSqlite3NativeBinding
    if (-not $binding) {
        throw "Nie znaleziono better_sqlite3.node — aplikacja nie wystartuje. Sprawdz Node 22 LTS i ponow setup."
    }

    Write-Host "  better_sqlite3.node: OK" -ForegroundColor Green
    Write-Host "    $binding" -ForegroundColor DarkGray
}

function Test-ProductionLayout {
    $apiSrc = Join-Path $script:RepoRoot "apps\api\src"
    $apiDist = Join-Path $script:RepoRoot "apps\api\dist\main.js"
    return (-not (Test-Path $apiSrc)) -and (Test-Path $apiDist)
}

function Install-ProjectDependencies {
    Write-Step "Instalacja zaleznosci projektu (pnpm install)"
    Set-Location $script:RepoRoot

    $nodeModules = Join-Path $script:RepoRoot "node_modules"
    if ((Test-ProductionLayout) -and (Test-Path $nodeModules)) {
        Write-Host "  Paczka produkcyjna — zaleznosci juz w paczce, pomijam pnpm install" -ForegroundColor Green
        Assert-PnpmNativeDependencies
        return
    }

    if ((Test-ProductionLayout) -and -not (Test-Path $nodeModules)) {
        Write-Host "  Paczka produkcyjna (online) — instalacja zaleznosci (pnpm install)..."
        Write-SetupProgressDetail 'pnpm install — moze potrwac 5-15 minut'
        $installExit = Invoke-Pnpm install
        if ($installExit -ne 0) {
            throw "pnpm install nie powiodl sie. Sprawdz polaczenie z internetem i uruchom setup ponownie."
        }
        Assert-PnpmNativeDependencies
        return
    }

    if ($script:OfflineMode) {
        $bundleStore = Get-BundleItem "pnpm-store"
        if (Test-Path $bundleStore) {
            $env:PNPM_STORE_DIR = $bundleStore
            Write-Host "  pnpm install --offline (store z paczki)"
            $offlineExit = Invoke-Pnpm install --offline
            if ($offlineExit -ne 0) {
                throw "pnpm install --offline nie powiodl sie."
            }
            Assert-PnpmNativeDependencies
            return
        }
        Write-Host "  Brak pnpm-store w paczce - probuje zwyklego pnpm install" -ForegroundColor Yellow
    }

    $installExit = Invoke-Pnpm install
    if ($installExit -ne 0) {
        throw "pnpm install nie powiodl sie."
    }
    Assert-PnpmNativeDependencies
}

function Ensure-Ollama {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    Write-Step "Sprawdzanie Ollama"
    Set-OllamaInstallEnv $InstallRoot

    if (Test-OllamaInInstallRoot $InstallRoot) {
        Write-Host "  Ollama: $(Get-OllamaInstallDir $InstallRoot)"
        Write-Host "  Modele: $(Get-OllamaModelsDir $InstallRoot)"
        return
    }

    if ($script:OfflineMode) {
        Install-OllamaFromBundle -InstallRoot $InstallRoot
        if (-not (Test-OllamaInInstallRoot $InstallRoot) -and -not (Test-Command ollama)) {
            throw "Ollama nie jest dostepna po instalacji z paczki offline."
        }
        Write-Host "  Ollama: $(Get-OllamaInstallDir $InstallRoot)"
        return
    }

    Install-OllamaToInstallRoot -InstallRoot $InstallRoot

    if (Test-Command ollama) {
        Write-Host "  Ollama: $(ollama -v 2>&1 | Select-Object -First 1)"
    } else {
        Write-Host "  Ollama: $(Get-OllamaInstallDir $InstallRoot)"
    }
    Write-Host "  Modele: $(Get-OllamaModelsDir $InstallRoot)"
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

function Install-OllamaModels {
    param(
        [Parameter(Mandatory = $true)][string[]]$Models,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    if ($script:OfflineMode) {
        Write-Step "Kopiowanie modeli Ollama z paczki offline"
        $source = Get-BundleItem "ollama-models"
        if (-not (Test-Path $source)) {
            throw "Brak katalogu ollama-models w paczce offline."
        }
        $target = Get-OllamaModelsDir $InstallRoot
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $source $target -Recurse -Force
        Write-Host "  Modele skopiowane do $target"
        return
    }

    Write-Step "Pobieranie modeli Ollama (wymaga internetu)"
    $modelIndex = 0
    foreach ($model in $Models) {
        $modelIndex++
        Write-Host ""
        Write-Host "  [$modelIndex/$($Models.Count)] ollama pull $model (moze potrwac kilka-kilkanascie minut)..." -ForegroundColor Yellow
        Write-SetupProgressDetail "Pobieranie modelu Ollama: $model ($modelIndex/$($Models.Count))"
        & ollama pull $model
        if ($LASTEXITCODE -ne 0) {
            throw "ollama pull $model nie powiodl sie (kod $LASTEXITCODE)."
        }
        Write-Host "  Model $model: OK" -ForegroundColor Green
    }
}

function Invoke-OptionalDeepseekInstall {
    param([switch]$Interactive)

    Write-Host ""
    Write-Host "Opcjonalny model deepseek-r1 (~15 GB):" -ForegroundColor Yellow
    Write-Host "  - wolniejszy (szczegolnie na CPU), do trudniejszych pytan w czacie"
    Write-Host "  - wymaga internetu podczas instalacji (ollama pull)"
    Write-Host "  - w wiekszosci wdrozen wystarczy domyslny czat: qwen3"
    Write-Host ""
    if (Test-SetupNonInteractive -Interactive:$Interactive) {
        Write-Host "  Instalacja nieinteraktywna — pomijam deepseek-r1 (domyslnie: qwen3)." -ForegroundColor Green
        Write-Host "  Pozniej recznie: ollama pull deepseek-r1"
        return
    }

    $answer = Read-Host "Doinstalowac deepseek-r1 teraz? [t/N]"
    if ($answer -match '^[tTyY]') {
        Install-OllamaModels -Models @("deepseek-r1") -InstallRoot $script:InstallRoot
        return
    }

    Write-Host "  Pomijam deepseek-r1 — czat domyslny: qwen3" -ForegroundColor Green
    Write-Host "  Pozniej recznie: ollama pull deepseek-r1"
}

function Get-QdrantInstallDir([string]$InstallRoot) {
    return Join-Path $InstallRoot "qdrant"
}

function Get-LegacyQdrantInstallDir() {
    return Join-Path $script:LegacyInstallRoot "qdrant"
}

function Stop-TetaQdrantService() {
    $existing = Get-Service $script:QdrantServiceName -ErrorAction SilentlyContinue
    if (-not $existing) { return }

    Write-Host "  Zatrzymywanie uslugi $script:QdrantServiceName..."
    if ($existing.Status -eq "Running") {
        Stop-Service $script:QdrantServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

function Remove-TetaQdrantService([string]$NssmExe = "") {
    Stop-TetaQdrantService

    if ($NssmExe -and (Test-Path -LiteralPath $NssmExe)) {
        try {
            Invoke-Nssm -NssmExe $NssmExe -Arguments @('remove', $script:QdrantServiceName, 'confirm')
            Start-Sleep -Seconds 2
        } catch {
            Write-Host "  NSSM remove: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }

    $remaining = Get-Service $script:QdrantServiceName -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Host "  Usuwanie uslugi przez sc.exe..."
        & sc.exe stop $script:QdrantServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 1
        & sc.exe delete $script:QdrantServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 2
    }
}

function Remove-QdrantInstallDirs([string[]]$Dirs) {
    foreach ($dir in $Dirs) {
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        Write-Host "  Usuwanie katalogu Qdrant: $dir"
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Uninstall-TetaQdrant {
    param(
        [string]$InstallRoot = "",
        [string]$NssmExe = ""
    )

    Write-Step "Deinstalacja Qdrant (usluga + katalogi danych)"
    if (-not $InstallRoot) {
        $InstallRoot = $script:InstallRoot
    }
    if (-not $InstallRoot) {
        $appRoot = Find-TetaApplicationRoot
        if ($appRoot) { $InstallRoot = $appRoot }
    }
    if (-not $NssmExe -and $InstallRoot) {
        $candidate = Join-Path $InstallRoot "tools\nssm.exe"
        if (Test-Path -LiteralPath $candidate) { $NssmExe = $candidate }
    }

    Remove-TetaQdrantService -NssmExe $NssmExe

    $dirs = @()
    if ($InstallRoot) { $dirs += Get-QdrantInstallDir $InstallRoot }
    $dirs += Get-LegacyQdrantInstallDir
    Remove-QdrantInstallDirs -Dirs $dirs
    Write-Host "  Qdrant usuniety." -ForegroundColor Green
}

function Install-QdrantFiles([string]$InstallRoot) {
    $qdrantDir = Get-QdrantInstallDir $InstallRoot
    $qdrantExe = Join-Path $qdrantDir "qdrant.exe"
    New-Item -ItemType Directory -Force -Path $qdrantDir | Out-Null

    if ($script:OfflineMode) {
        $bundleQdrant = Get-BundleItem "tools\qdrant"
        if (-not (Test-Path (Join-Path $bundleQdrant "qdrant.exe"))) {
            throw "Brak qdrant.exe w paczce offline (tools\qdrant)."
        }
        Write-Host "  Kopiowanie Qdrant z paczki offline..."
        Copy-Item "$bundleQdrant\*" $qdrantDir -Recurse -Force
    } else {
        Write-Host "  Pobieranie Qdrant (Windows) z GitHub releases..."
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/qdrant/qdrant/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -match "x86_64-pc-windows-msvc\.zip$" } | Select-Object -First 1
        if (-not $asset) {
            throw "Nie znaleziono paczki Windows w release Qdrant: https://github.com/qdrant/qdrant/releases"
        }

        $zipPath = Join-Path $env:TEMP "qdrant-$($release.tag_name).zip"
        $extractDir = Join-Path $env:TEMP "qdrant-$($release.tag_name)-extract"
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        Copy-Item "$extractDir\*" $qdrantDir -Recurse -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $qdrantExe)) {
        throw "Po instalacji brak qdrant.exe w $qdrantDir"
    }

    return $qdrantExe
}

function Ensure-Qdrant([string]$InstallRoot, [switch]$Upgrade) {
    Write-Step "Sprawdzanie Qdrant"
    $qdrantDir = Get-QdrantInstallDir $InstallRoot
    $qdrantExe = Join-Path $qdrantDir "qdrant.exe"

    if ((Test-Path $qdrantExe) -and -not $Upgrade) {
        Write-Host "  Qdrant: $qdrantExe"
        return $qdrantExe
    }

    if ($Upgrade -and (Test-Path $qdrantExe)) {
        Write-Host "  Aktualizacja Qdrant: zatrzymanie uslugi, podmiana plikow..."
        Stop-TetaQdrantService
        $storageDir = Join-Path $qdrantDir "storage"
        $storageBackup = Join-Path $env:TEMP "teta-qdrant-storage-backup"
        if (Test-Path $storageDir) {
            if (Test-Path $storageBackup) { Remove-Item $storageBackup -Recurse -Force }
            Copy-Item $storageDir $storageBackup -Recurse -Force
        }
        Get-ChildItem $qdrantDir -Force | Where-Object { $_.Name -ne 'storage' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path (Join-Path $qdrantDir "qdrant.exe")) {
            Remove-Item (Join-Path $qdrantDir "qdrant.exe") -Force
        }
        $qdrantExe = Install-QdrantFiles $InstallRoot
        if (Test-Path $storageBackup) {
            if (Test-Path $storageDir) { Remove-Item $storageDir -Recurse -Force }
            Copy-Item $storageBackup $storageDir -Recurse -Force
            Remove-Item $storageBackup -Recurse -Force
        }
        Write-Host "  Qdrant zaktualizowany: $qdrantExe"
        return $qdrantExe
    }

    $qdrantExe = Install-QdrantFiles $InstallRoot
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
        Invoke-WingetInstall NSSM.NSSM -e 2>$null
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

function Write-ApiServiceRunnerScript([string]$InstallRoot) {
    $nodeExe = Get-NodeExecutablePath
    $runnerPath = Join-Path $InstallRoot "run-api.cmd"
    $apiDir = Join-Path $script:RepoRoot "apps\api"
    $webDist = Join-Path $script:RepoRoot "apps\web\dist"
    $ollamaModels = Get-OllamaModelsDir $InstallRoot

    $runner = @"
@echo off
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
cd /d "$apiDir"
set TETA_REPO_ROOT=$script:RepoRoot
set WEB_DIST_PATH=$webDist
set OLLAMA_MODELS=$ollamaModels
set PORT=3000
"$nodeExe" dist\main.js
"@

    Set-Content -Path $runnerPath -Value $runner -Encoding ASCII
    return $runnerPath
}

function Register-ApiService([string]$NssmExe, [string]$InstallRoot) {
    if (-not (Test-ProductionLayout)) {
        Write-Host "  Pomijam usluge API (brak buildu produkcyjnego — tryb dev)." -ForegroundColor DarkGray
        return
    }

    Write-Step "Rejestracja uslugi Windows: $script:ApiServiceName"
    $runner = Write-ApiServiceRunnerScript $InstallRoot
    $logDir = Join-Path $InstallRoot "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null

    $existing = Get-Service $script:ApiServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Usuwanie poprzedniej konfiguracji uslugi API..."
        if ($existing.Status -eq "Running") {
            Stop-Service $script:ApiServiceName -Force
        }
        Invoke-Nssm -NssmExe $NssmExe -Arguments @('remove', $script:ApiServiceName, 'confirm')
        Start-Sleep -Seconds 2
    }

    Invoke-Nssm -NssmExe $NssmExe -Arguments @('install', $script:ApiServiceName, $runner)
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'AppDirectory', $InstallRoot)
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'DisplayName', 'Teta AI Assistant API')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'Description', 'Backend NestJS + UI Teta AI Assistant (port 3000)')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'Start', 'SERVICE_AUTO_START')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'AppStdout', (Join-Path $logDir 'api-service.log'))
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'AppStderr', (Join-Path $logDir 'api-service-error.log'))
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'AppRotateFiles', '1')
    Invoke-Nssm -NssmExe $NssmExe -Arguments @('set', $script:ApiServiceName, 'AppRotateBytes', '1048576')

    Start-Service $script:ApiServiceName
    Write-Host "  Usluga $script:ApiServiceName uruchomiona (autostart, bez okna terminala)." -ForegroundColor Green
}

function Start-ApiService {
    $existing = Get-Service $script:ApiServiceName -ErrorAction SilentlyContinue
    if (-not $existing) {
        return $false
    }
    if ($existing.Status -ne "Running") {
        Start-Service $script:ApiServiceName
    }
    return $true
}

function Open-TetaApplicationInBrowser {
    $url = if (Test-ProductionLayout) { "http://localhost:3000/" } else { "http://localhost:5173/" }
    Start-Process $url | Out-Null
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

function Get-EnvExamplePath {
    $candidates = @(
        (Join-Path $script:RepoRoot "apps\api\.env.example"),
        (Join-Path $script:RepoRoot "scripts\setup\api.env.example")
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Write-EnvFile([string]$AppMode, [bool]$IncludeVendorSecret, [string]$InstallRoot = "") {
    Write-Step "Tworzenie apps/api/.env"
    $examplePath = Get-EnvExamplePath
    $envPath = Join-Path $script:RepoRoot "apps\api\.env"

    if (-not $examplePath) {
        throw "Brak pliku apps\api\.env.example ani scripts\setup\api.env.example — uzyj nowszej paczki instalacyjnej."
    }

    $content = Get-Content $examplePath -Raw
    $content = $content -replace "(?m)^TETA_APP_MODE=.*$", "TETA_APP_MODE=$AppMode"
    $content = $content -replace "(?m)^JWT_SECRET=.*$", "JWT_SECRET=$(New-RandomSecret)"

    if ($InstallRoot) {
        $modelsDir = Get-OllamaModelsDir $InstallRoot
        $line = "OLLAMA_MODELS=$($modelsDir -replace '\\','/')"
        if ($content -match "(?m)^#?\s*OLLAMA_MODELS=") {
            $content = $content -replace "(?m)^#?\s*OLLAMA_MODELS=.*$", $line
        } else {
            $content += "`n$line`n"
        }
    }

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

function Get-NodeExecutablePath {
    Refresh-ShellPath
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LocalAppData\Programs\nodejs\node.exe"
    )) {
        if (Test-Path $candidate) { return $candidate }
    }
    return "node"
}

function Write-StartAppScript([string]$InstallRoot) {
    Write-Step "Tworzenie skryptu startowego aplikacji"
    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

    if (Test-ProductionLayout) {
        $startApp = @"
@echo off
title Teta AI Assistant
REM Skrot uzytkownika: uruchamia usluge API w tle i otwiera przegladarke.
net start $script:ApiServiceName >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/"
exit /b 0
"@
    } else {
        $startApp = @"
@echo off
title Teta AI Assistant
cd /d "$script:RepoRoot"
call pnpm dev
"@
    }

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
    $importExit = Invoke-Pnpm rag:global:import --file "$($ragFile.FullName)"
    if ($importExit -ne 0) {
        throw "Import globalnego RAG nie powiódł się."
    }
    Write-Host "  RAG zaimportowany pomyślnie." -ForegroundColor Green
}

function Wait-ApplicationReady {
    Write-Step "Oczekiwanie na uruchomienie aplikacji"
    $deadline = (Get-Date).AddMinutes(4)
    $apiOk = $false
    $webOk = $false
    $production = Test-ProductionLayout

    while ((Get-Date) -lt $deadline) {
        if (-not $apiOk) {
            try {
                Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 4 | Out-Null
                Write-Host "  API: OK (http://127.0.0.1:3000)" -ForegroundColor Green
                $apiOk = $true
            } catch { }
        }
        if (-not $webOk) {
            if ($production) {
                if ($apiOk) {
                    try {
                        Invoke-WebRequest -Uri "http://127.0.0.1:3000" -TimeoutSec 4 -UseBasicParsing | Out-Null
                        Write-Host "  Aplikacja: OK (http://127.0.0.1:3000)" -ForegroundColor Green
                        $webOk = $true
                    } catch { }
                }
            } else {
                try {
                    Invoke-WebRequest -Uri "http://127.0.0.1:5173" -TimeoutSec 4 -UseBasicParsing | Out-Null
                    Write-Host "  Web: OK (http://127.0.0.1:5173)" -ForegroundColor Green
                    $webOk = $true
                } catch { }
            }
        }
        if ($apiOk -and $webOk) {
            return
        }
        Start-Sleep -Seconds 4
    }

    if ($production) {
        Write-Host "  Aplikacja może jeszcze się uruchamiać — sprawdź http://localhost:3000" -ForegroundColor Yellow
    } else {
        Write-Host "  Aplikacja może jeszcze się uruchamiać — sprawdź http://localhost:5173" -ForegroundColor Yellow
    }
}

function Start-Application([string]$InstallRoot, [switch]$OpenBrowser) {
    Write-Step "Uruchamianie aplikacji Teta AI"
    if (Test-ProductionLayout) {
        if (-not (Start-ApiService)) {
            throw "Brak uslugi $script:ApiServiceName. Uruchom setup ponownie jako Administrator."
        }
        Wait-ApplicationReady
        if ($OpenBrowser) {
            Open-TetaApplicationInBrowser
        }
        return
    }

    $batPath = Join-Path $InstallRoot "Start-App.bat"
    if (-not (Test-Path $batPath)) {
        throw "Brak skryptu startowego: $batPath"
    }

    Start-Process -FilePath $batPath -WorkingDirectory $InstallRoot
    Wait-ApplicationReady
    if (-not $OpenBrowser) {
        return
    }
}

function Test-ServicesHealth {
    param([string]$InstallRoot = "")

    if (-not $InstallRoot) { $InstallRoot = $script:InstallRoot }
    if (-not $InstallRoot) { $InstallRoot = $script:LegacyInstallRoot }

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

    $apiSvc = Get-Service $script:ApiServiceName -ErrorAction SilentlyContinue
    if ($apiSvc) {
        if ($apiSvc.Status -eq "Running") {
            Write-Host "  API: OK (usługa $script:ApiServiceName)" -ForegroundColor Green
        } else {
            Write-Host "  API: usługa $script:ApiServiceName zatrzymana" -ForegroundColor Yellow
            $ok = $false
        }
    }

    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 5 | Out-Null
        Write-Host "  Aplikacja: OK (http://localhost:3000)" -ForegroundColor Green
    } catch {
        if ($apiSvc) {
            $logDir = Join-Path $InstallRoot "logs"
            Write-Host "  Aplikacja: API nie odpowiada — sprawdź logi w $logDir" -ForegroundColor Yellow
        }
        $ok = $false
    }

    return $ok
}

function Refresh-ShellPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Get-PythonExecutable {
    if (Test-Command python) { return "python" }
    if (Test-Command py) { return "py" }
    return $null
}

function Install-PythonFromBundle {
    $installersDir = Get-BundleItem "installers"
    $installer = Get-ChildItem $installersDir -Filter "python-*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $installer) {
        throw "Brak instalatora Python w paczce offline (installers\python-*.exe). Dolacz python-3.12.x-amd64.exe z python.org."
    }
    Write-Host "  Instalacja Python z paczki: $($installer.Name)"
    $args = "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_launcher=0"
    Start-Process $installer.FullName -ArgumentList $args -Wait
    Refresh-ShellPath
}

function Install-FfmpegFromBundle([string]$InstallRoot) {
    $srcDir = Get-BundleItem "tools\ffmpeg"
    $ffmpegExe = Join-Path $srcDir "ffmpeg.exe"
    if (-not (Test-Path $ffmpegExe)) {
        return $false
    }

    $targetDir = Join-Path $InstallRoot "tools\ffmpeg"
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    Copy-Item (Join-Path $srcDir "ffmpeg.exe") $targetDir -Force
    if (Test-Path (Join-Path $srcDir "ffprobe.exe")) {
        Copy-Item (Join-Path $srcDir "ffprobe.exe") $targetDir -Force
    }

    $ffmpegPath = Join-Path $targetDir "ffmpeg.exe"
    $ffprobePath = Join-Path $targetDir "ffprobe.exe"
    Set-VideoIngestEnvPaths -FfmpegPath $ffmpegPath -FfprobePath $ffprobePath
    Write-Host "  ffmpeg: skopiowany do $targetDir" -ForegroundColor Green
    return $true
}

function Find-WingetGyanFfmpegExe {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("ffmpeg", "ffprobe")][string]$ToolName
    )

    $root = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (-not (Test-Path $root)) { return $null }

    $matches = @()
    foreach ($pkgDir in Get-ChildItem $root -Directory -Filter "Gyan.FFmpeg*" -ErrorAction SilentlyContinue) {
        foreach ($buildDir in Get-ChildItem $pkgDir.FullName -Directory -ErrorAction SilentlyContinue) {
            $exe = Join-Path (Join-Path $buildDir.FullName "bin") "$ToolName.exe"
            if (Test-Path $exe) {
                $matches += Get-Item $exe
            }
        }
    }

    if ($matches.Count -eq 0) { return $null }
    return ($matches | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Register-FfmpegEnvPaths {
    $ffmpegPath = $null
    $ffprobePath = $null

    $ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    $ffprobeCmd = Get-Command ffprobe -ErrorAction SilentlyContinue
    if ($ffmpegCmd -and $ffprobeCmd) {
        $ffmpegPath = $ffmpegCmd.Source
        $ffprobePath = $ffprobeCmd.Source
    } else {
        $ffmpegPath = Find-WingetGyanFfmpegExe -ToolName ffmpeg
        $ffprobePath = Find-WingetGyanFfmpegExe -ToolName ffprobe
    }

    if ($ffmpegPath -and $ffprobePath) {
        Set-VideoIngestEnvPaths -FfmpegPath $ffmpegPath -FfprobePath $ffprobePath
        return $true
    }
    return $false
}

function Set-VideoIngestEnvPaths {
    param(
        [string]$FfmpegPath = "",
        [string]$FfprobePath = "",
        [string]$PythonPath = ""
    )

    $envPath = Join-Path $script:RepoRoot "apps\api\.env"
    if (-not (Test-Path $envPath)) { return }

    $content = Get-Content $envPath -Raw
    if ($FfmpegPath) {
        $line = "TETA_FFMPEG_PATH=$($FfmpegPath -replace '\\','/')"
        if ($content -match "(?m)^#?\s*TETA_FFMPEG_PATH=") {
            $content = $content -replace "(?m)^#?\s*TETA_FFMPEG_PATH=.*$", $line
        } else {
            $content += "`n$line`n"
        }
    }
    if ($FfprobePath) {
        $line = "TETA_FFPROBE_PATH=$($FfprobePath -replace '\\','/')"
        if ($content -match "(?m)^#?\s*TETA_FFPROBE_PATH=") {
            $content = $content -replace "(?m)^#?\s*TETA_FFPROBE_PATH=.*$", $line
        } else {
            $content += "`n$line`n"
        }
    }
    if ($PythonPath) {
        $line = "TETA_PYTHON=$PythonPath"
        if ($content -match "(?m)^#?\s*TETA_PYTHON=") {
            $content = $content -replace "(?m)^#?\s*TETA_PYTHON=.*$", $line
        } else {
            $content += "`n$line`n"
        }
    }
    Set-Content -Path $envPath -Value $content.TrimEnd() -Encoding UTF8
}

function Install-VideoIngestPipPackages {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [string]$PythonArgs = ""
    )

    $requirements = Join-Path $script:RepoRoot "scripts\rag\requirements-video.txt"
    if (-not (Test-Path $requirements)) {
        Write-Host "  Brak requirements-video.txt — pomijam pip." -ForegroundColor Yellow
        return
    }

    Write-Host "  Instalacja faster-whisper (pip)..."
    $pipArgs = @("-m", "pip", "install", "-r", $requirements)
    if ($script:OfflineMode) {
        $wheelsDir = Get-BundleItem "python-wheels"
        if (-not (Test-Path $wheelsDir)) {
            throw "Brak katalogu python-wheels w paczce offline. Zbuduj paczke ponownie (Prepare-OfflineBundle.ps1) na maszynie z Pythonem."
        }
        $pipArgs = @("-m", "pip", "install", "--no-index", "--find-links", $wheelsDir, "-r", $requirements)
    }

    try {
        if ($PythonArgs) {
            & $PythonExe $PythonArgs @pipArgs
        } else {
            & $PythonExe @pipArgs
        }
        if ($LASTEXITCODE -ne 0) { throw "pip exit code $LASTEXITCODE" }
        Write-Host "  faster-whisper: OK" -ForegroundColor Green
    } catch {
        throw "Instalacja faster-whisper nie powiodla sie: $_"
    }
}

function Ensure-VideoIngestTools {
    param(
        [string]$InstallRoot = ""
    )

    if (-not $InstallRoot) { $InstallRoot = $script:InstallRoot }
    if (-not $InstallRoot) { $InstallRoot = $script:RepoRoot }

    Write-Step "Narzedzia ingest wideo MP4 (vendor)"
    $requirements = Join-Path $script:RepoRoot "scripts\rag\requirements-video.txt"

    if ($env:TETA_SETUP_NONINTERACTIVE -eq '1') {
        Write-Host "  Instalacja z .exe — pomijam winget (ffmpeg/Python). Doinstaluj pozniej lub uruchom Setup.bat ponownie." -ForegroundColor Yellow
        if ((Test-Command ffmpeg) -and (Test-Command ffprobe)) {
            Register-FfmpegEnvPaths | Out-Null
            Write-Host "  ffmpeg: OK (PATH)" -ForegroundColor Green
        }
        $pythonExe = Get-PythonExecutable
        if ($pythonExe) {
            Write-Host "  Python: OK ($pythonExe)" -ForegroundColor Green
        }
        return
    }

    # --- ffmpeg ---
    $ffmpegOk = Test-Command ffmpeg
    $ffprobeOk = Test-Command ffprobe
    if ($ffmpegOk -and $ffprobeOk) {
        Write-Host "  ffmpeg: OK (PATH)" -ForegroundColor Green
        Register-FfmpegEnvPaths | Out-Null
    } elseif ($script:OfflineMode) {
        if (Install-FfmpegFromBundle $InstallRoot) {
            $ffmpegOk = $true
            $ffprobeOk = $true
        } else {
            Write-Host "  ffmpeg/ffprobe: BRAK w paczce (tools\ffmpeg\ffmpeg.exe)" -ForegroundColor Yellow
        }
    } else {
        if (Test-Command winget) {
            Write-Host "  Instalacja ffmpeg przez winget..."
            Invoke-WingetInstall -e --id Gyan.FFmpeg 2>$null
            Refresh-ShellPath
            $ffmpegOk = Test-Command ffmpeg
            $ffprobeOk = Test-Command ffprobe
        }
        if (-not $ffmpegOk -or -not $ffprobeOk) {
            if (Register-FfmpegEnvPaths) {
                $ffmpegOk = $true
                $ffprobeOk = $true
                Write-Host "  ffmpeg: OK (winget, zapisano do apps\api\.env)" -ForegroundColor Green
            }
        } elseif ($ffmpegOk -and $ffprobeOk) {
            Register-FfmpegEnvPaths | Out-Null
        }
        if (-not $ffmpegOk) {
            Write-Host "  ffmpeg/ffprobe: BRAK w PATH" -ForegroundColor Yellow
            Write-Host "    https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor DarkGray
        }
    }

    # --- Python ---
    $pythonExe = Get-PythonExecutable
    if (-not $pythonExe) {
        if ($script:OfflineMode) {
            Install-PythonFromBundle
            Refresh-ShellPath
            $pythonExe = Get-PythonExecutable
            if (-not $pythonExe) {
                throw "Python nie jest dostepny po instalacji z paczki offline."
            }
        } elseif (Test-Command winget) {
            Write-Host "  Instalacja Python 3.12 przez winget..."
            Invoke-WingetInstall -e --id Python.Python.3.12 2>$null
            Refresh-ShellPath
            $pythonExe = Get-PythonExecutable
        }
    }

    if ($pythonExe) {
        $version = if ($pythonExe -eq "py") { & py -3 --version 2>&1 } else { & python --version 2>&1 }
        Write-Host "  Python: OK ($version)" -ForegroundColor Green
        if ($pythonExe -eq "python") {
            Set-VideoIngestEnvPaths -PythonPath "python"
        }

        try {
            if ($pythonExe -eq "py") {
                Install-VideoIngestPipPackages -PythonExe "py" -PythonArgs "-3"
            } else {
                Install-VideoIngestPipPackages -PythonExe "python"
            }
        } catch {
            Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
            if ($script:OfflineMode) { throw }
            Write-Host "  Uruchom recznie: pip install -r scripts/rag/requirements-video.txt" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  Python: BRAK (wymagany do ingest MP4)" -ForegroundColor Yellow
        Write-Host "    Online: winget install Python.Python.3.12" -ForegroundColor DarkGray
        Write-Host "    Offline: dolacz installers\python-3.12.x-amd64.exe do paczki" -ForegroundColor DarkGray
    }

    if ((-not $ffmpegOk) -or (-not $pythonExe)) {
        Write-Host "  Ingest MP4 w UI/CLI bedzie niedostepny do czasu instalacji ffmpeg + Python." -ForegroundColor Yellow
    }
}
