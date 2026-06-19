# Import modeli Ollama z paczki models-update (katalog ollama-models + manifest).
param(
    [Parameter(Mandatory = $true)][string]$ModelsDir
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

$manifestPath = Join-Path $ModelsDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "Brak manifest.json w paczce modeli: $ModelsDir"
}

$modelsSource = Join-Path $ModelsDir "ollama-models"
if (-not (Test-Path $modelsSource)) {
    throw "Brak katalogu ollama-models w paczce."
}

Write-Host "Import modeli Ollama z: $ModelsDir" -ForegroundColor Green
Ensure-Ollama
Wait-OllamaReady

$ollamaModels = Join-Path $env:USERPROFILE ".ollama\models"
New-Item -ItemType Directory -Force -Path $ollamaModels | Out-Null

Get-ChildItem $modelsSource -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($modelsSource.Length).TrimStart('\')
    $target = Join-Path $ollamaModels $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item $_.FullName $target -Force
}

Write-Host "Modele skopiowane do $ollamaModels" -ForegroundColor Green
Write-Host "Import modeli zakonczony. Uruchom ponownie Ollama jesli modele nie sa widoczne." -ForegroundColor Yellow
