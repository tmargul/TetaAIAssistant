# Import paczki offline-bundle (Qdrant, Ollama, modele) — wymaga zainstalowanej aplikacji Teta AI.
param(
    [Parameter(Mandatory = $true)][string]$BundlePath,
    [ValidateSet("vendor", "client")]
    [string]$Mode = "client",
    [string]$InstallRoot = "",
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

$setupScript = Join-Path $PSScriptRoot "Setup.ps1"
if (-not (Test-Path $setupScript)) {
    throw "Brak Setup.ps1 obok tego skryptu."
}

$appRoot = Find-TetaApplicationRoot -HintPath $InstallRoot
if (-not $appRoot) {
    throw @"
Nie wykryto instalacji Teta AI Assistant.
Najpierw zainstaluj aplikacje (Instaluj-*.bat lub instalator .exe), potem uruchom aktualizacje silnika.
Opcjonalnie podaj sciezke: -InstallRoot D:\sciezka\do\TetaAIAssistant
"@
}

Write-Host "Aktualizacja silnika offline w katalogu: $appRoot" -ForegroundColor Green

& $setupScript -Mode $Mode -Offline -BundlePath $BundlePath -InstallRoot $appRoot -RepoRoot $appRoot -NoStart -NonInteractive
if ($LASTEXITCODE -ne 0) {
    throw "Instalacja silnika offline nie powiodla sie."
}
exit 0
