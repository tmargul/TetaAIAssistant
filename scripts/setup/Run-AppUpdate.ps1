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

$startBat = Join-Path $AppRoot "Start-App.bat"
$apiService = "TetaAI-API"
$apiSvc = Get-Service $apiService -ErrorAction SilentlyContinue
if ($apiSvc) {
    Write-Host "Restart uslugi $apiService..." -ForegroundColor Green
    Restart-Service $apiService -Force
} elseif (Test-Path $startBat) {
    Start-Process $startBat
} else {
    Write-Host "Brak uslugi $apiService i $startBat — uruchom aplikacje recznie." -ForegroundColor Yellow
}

Write-Host "Aktualizacja zakonczona." -ForegroundColor Green
exit 0
