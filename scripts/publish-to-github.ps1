# Publikacja projektu na GitHub (jednorazowo: gh auth login)
# Uruchom w PowerShell z katalogu głównego monorepo.

$ErrorActionPreference = "Stop"
$git = "C:\Program Files\Git\bin\git.exe"
$gh = "C:\Program Files\GitHub CLI\gh.exe"

if (-not (Test-Path $gh)) {
    $gh = "gh"
}

$repoName = if ($args[0]) { $args[0] } else { "TetaAIAssistant" }
$visibility = if ($args[1] -eq "public") { "--public" } else { "--private" }

Write-Host "Sprawdzanie logowania GitHub..."
& $gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nie jesteś zalogowany. Uruchom: gh auth login"
    Write-Host "Następnie ponów ten skrypt."
    exit 1
}

Set-Location $PSScriptRoot\..

if (-not (Test-Path ".git")) {
    Write-Error "Brak repozytorium git w $(Get-Location)"
}

$hasOrigin = & $git remote 2>$null | Select-String -Pattern "^origin$" -Quiet
if ($hasOrigin) {
    Write-Host "Remote 'origin' już istnieje. Wypycham na main..."
    & $git push -u origin main
    exit $LASTEXITCODE
}

Write-Host "Tworzenie repozytorium GitHub: $repoName ($visibility)..."
& $gh repo create $repoName $visibility --source=. --remote=origin --description "Teta AI Assistant - intranetowy asystent AI (React, NestJS, Ollama, Qdrant)" --push

if ($LASTEXITCODE -eq 0) {
    $url = & $gh repo view --json url -q .url
    Write-Host "Gotowe: $url"
}
