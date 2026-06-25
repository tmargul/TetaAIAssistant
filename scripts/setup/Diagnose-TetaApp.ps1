# Diagnostyka instalacji Teta AI Assistant (Windows).
# Uruchom w PowerShell z katalogu instalacji lub podaj -InstallRoot.

param(
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Continue"
. "$PSScriptRoot\Setup-Common.ps1"

if (-not $InstallRoot) {
    $startBat = "C:\TetaAI\Start-App.bat"
    $runner = "C:\TetaAI\run-api.cmd"
    if (Test-Path $runner) {
        $content = Get-Content $runner -Raw
        if ($content -match 'set TETA_REPO_ROOT=(.+)') {
            $InstallRoot = $Matches[1].Trim()
            $script:RepoRoot = $InstallRoot
        }
    } elseif (Test-Path $startBat) {
        $content = Get-Content $startBat -Raw
        if ($content -match 'set TETA_REPO_ROOT=(.+)') {
            $InstallRoot = $Matches[1].Trim()
            $script:RepoRoot = $InstallRoot
        }
    }
}

if (-not $script:RepoRoot -or -not (Test-Path $script:RepoRoot)) {
    Write-Host "Nie wykryto katalogu instalacji. Podaj: -InstallRoot sciezka\do\TetaAIAssistant" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Diagnostyka Teta AI ===" -ForegroundColor Cyan
Write-Host "Katalog aplikacji: $script:RepoRoot"
Write-Host ""

function Test-ItemOk([string]$Label, [scriptblock]$Check) {
    try {
        if (& $Check) {
            Write-Host "  [OK]   $Label" -ForegroundColor Green
            return $true
        }
        Write-Host "  [BRAK] $Label" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [BRAK] $Label — $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

Refresh-ShellPath

Test-ItemOk "Node.js w PATH" { Test-Command node } | Out-Null
if (Test-Command node) {
    $nodeVer = (node -v 2>&1).ToString().Trim()
    Write-Host "         wersja: $nodeVer" -ForegroundColor DarkGray
    if ($nodeVer -match '^v?(\d+)' -and [int]$Matches[1] -ge 24) {
        Write-Host "         [UWAGA] Node 24+ nie jest wspierany — zainstaluj Node 22 LTS" -ForegroundColor Yellow
    } elseif ($nodeVer -notmatch '^v?22') {
        Write-Host "         [UWAGA] zalecany Node 22 LTS" -ForegroundColor Yellow
    }
}
Test-ItemOk "pnpm w PATH" { Test-Command pnpm } | Out-Null
if (Test-Command pnpm) {
    Write-Host "         wersja: $(pnpm -v 2>&1)" -ForegroundColor DarkGray
}
Test-ItemOk "better_sqlite3.node" { [bool](Find-BetterSqlite3NativeBinding) } | Out-Null
Test-ItemOk "apps\api\dist\main.js" { Test-Path (Join-Path $script:RepoRoot "apps\api\dist\main.js") } | Out-Null
Test-ItemOk "apps\web\dist\index.html" { Test-Path (Join-Path $script:RepoRoot "apps\web\dist\index.html") } | Out-Null
Test-ItemOk "apps\api\.env" { Test-Path (Join-Path $script:RepoRoot "apps\api\.env") } | Out-Null
Test-ItemOk "node_modules (pnpm install)" { Test-Path (Join-Path $script:RepoRoot "node_modules") } | Out-Null
Test-ItemOk "C:\TetaAI\Start-App.bat" { Test-Path "C:\TetaAI\Start-App.bat" } | Out-Null
$apiSvc = Get-Service "TetaAI-API" -ErrorAction SilentlyContinue
if ($apiSvc) {
    if ($apiSvc.Status -eq "Running") {
        Write-Host "  [OK]   Usluga TetaAI-API" -ForegroundColor Green
    } else {
        Write-Host "  [BRAK] Usluga TetaAI-API zatrzymana" -ForegroundColor Red
    }
} else {
    Write-Host "  [BRAK] Usluga TetaAI-API (uruchom setup jako Admin)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Usługi:" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:6333/collections" -TimeoutSec 3 | Out-Null
    Write-Host "  [OK]   Qdrant (6333)" -ForegroundColor Green
} catch {
    Write-Host "  [BRAK] Qdrant — sprawdz usluge TetaAI-Qdrant (services.msc)" -ForegroundColor Yellow
}

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
    Write-Host "  [OK]   Ollama (11434)" -ForegroundColor Green
} catch {
    Write-Host "  [BRAK] Ollama — uruchom z menu Start" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Aplikacja (port 3000):" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 3
    Write-Host "  [OK]   API dziala: $($health.status) / $($health.app)" -ForegroundColor Green
    Write-Host "         http://localhost:3000" -ForegroundColor DarkGray
} catch {
    Write-Host "  [BRAK] API nie odpowiada na http://localhost:3000" -ForegroundColor Red
    Write-Host ""
    Write-Host "Uruchom aplikacje (skrot otwiera przegladarke, backend dziala jako usluga):" -ForegroundColor Yellow
    Write-Host "  C:\TetaAI\Start-App.bat" -ForegroundColor White
    Write-Host "  lub: net start TetaAI-API" -ForegroundColor White
    Write-Host "  logi: C:\TetaAI\logs\api-service*.log" -ForegroundColor DarkGray
}

Write-Host ""
