# Import paczki offline-bundle (Qdrant, Ollama, modele) — wymaga zainstalowanej aplikacji Teta AI.
param(
    [Parameter(Mandatory = $true)][string]$BundlePath,
    [ValidateSet("vendor", "client")]
    [string]$Mode = "client",
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$setupScript = Join-Path $PSScriptRoot "Setup.ps1"
if (-not (Test-Path $setupScript)) {
    throw "Brak Setup.ps1 obok tego skryptu."
}

& $setupScript -Mode $Mode -Offline -BundlePath $BundlePath -NoStart -NonInteractive
if ($LASTEXITCODE -ne 0) {
    throw "Instalacja silnika offline nie powiodla sie."
}
exit 0
