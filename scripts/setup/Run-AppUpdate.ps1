# Aktualizacja kodu aplikacji (bez Ollama/Qdrant/RAG).
param(
    [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = "Stop"
Set-Location $AppRoot

Write-Host "Aktualizacja aplikacji Teta AI w: $AppRoot" -ForegroundColor Green

pnpm install --offline
if ($LASTEXITCODE -ne 0) {
    Write-Host "Probuje standardowy pnpm install..." -ForegroundColor Yellow
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        throw "Aktualizacja zaleznosci nie powiodla sie."
    }
}

$startBat = "C:\TetaAI\Start-App.bat"
if (Test-Path $startBat) {
    Write-Host "Uruchamianie aplikacji..." -ForegroundColor Green
    Start-Process $startBat
} else {
    Write-Host "Brak C:\TetaAI\Start-App.bat — uruchom aplikacje recznie." -ForegroundColor Yellow
}

Write-Host "Aktualizacja zakonczona." -ForegroundColor Green
