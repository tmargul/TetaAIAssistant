# Ustawia TETA_CODESIGN_* w apps/api/.env na podstawie .local/certs/cert-info.json

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$infoPath = Join-Path $repoRoot '.local\certs\cert-info.json'
$envPath = Join-Path $repoRoot 'apps\api\.env'

if (-not (Test-Path $infoPath)) {
    throw "Brak cert-info.json - najpierw uruchom New-DevCodeSignCert.ps1"
}

$info = Get-Content $infoPath -Raw | ConvertFrom-Json
$pfx = ($info.PfxPath -replace '\\', '\\')
$password = $info.Password

$lines = @()
if (Test-Path $envPath) {
    $lines = Get-Content $envPath
    $lines = $lines | Where-Object {
        $_ -notmatch '^\s*TETA_CODESIGN_PFX=' -and
        $_ -notmatch '^\s*TETA_CODESIGN_PASSWORD=' -and
        $_ -notmatch '^\s*TETA_CODESIGN_TIMESTAMP_URL='
    }
}

$lines += ''
$lines += '# Podpis instalatora MSI (dev self-signed lub produkcyjny PFX)'
$lines += "TETA_CODESIGN_PFX=$($info.PfxPath)"
$lines += "TETA_CODESIGN_PASSWORD=$password"
$lines += 'TETA_CODESIGN_TIMESTAMP_URL=http://timestamp.digicert.com'

Set-Content -Path $envPath -Value $lines -Encoding UTF8
Write-Host "Zaktualizowano: $envPath" -ForegroundColor Green
