# Aktualizacja kodu aplikacji (bez Ollama/Qdrant/RAG).
param(
    [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Setup-Common.ps1")
$script:RepoRoot = (Resolve-Path $AppRoot).Path
Set-Location $script:RepoRoot

Write-Host "Aktualizacja aplikacji Teta AI w: $AppRoot" -ForegroundColor Green

Ensure-Node
Ensure-Pnpm

$offlineExit = Invoke-Pnpm install --offline
if ($offlineExit -ne 0) {
    Write-Host "Probuje standardowy pnpm install..." -ForegroundColor Yellow
    $installExit = Invoke-Pnpm install
    if ($installExit -ne 0) {
        throw "Aktualizacja zaleznosci nie powiodla sie."
    }
}

Assert-PnpmNativeDependencies

$startBat = "C:\TetaAI\Start-App.bat"
if (Test-Path $startBat) {
    Write-Host "Uruchamianie aplikacji..." -ForegroundColor Green
    Start-Process $startBat
} else {
    Write-Host "Brak C:\TetaAI\Start-App.bat — uruchom aplikacje recznie." -ForegroundColor Yellow
}

Write-Host "Aktualizacja zakonczona." -ForegroundColor Green
