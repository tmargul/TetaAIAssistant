# Jednorazowe utworzenie certyfikatu deweloperskiego (self-signed) do podpisywania MSI lokalnie.
# NIE zastępuje certyfikatu OV/EV od CA — u klienta z SAC nadal potrzebny komercyjny certyfikat.

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$certDir = Join-Path $repoRoot '.local\certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$pfxPath = Join-Path $certDir 'teta-dev-codesign.pfx'
$cerPath = Join-Path $certDir 'teta-dev-codesign.cer'
$infoPath = Join-Path $certDir 'cert-info.json'

if (Test-Path $pfxPath) {
    Write-Host "Certyfikat juz istnieje: $pfxPath" -ForegroundColor Yellow
    if (Test-Path $infoPath) {
        $existing = Get-Content $infoPath -Raw | ConvertFrom-Json
        Write-Output "PFX=$($existing.PfxPath)"
        Write-Output "THUMB=$($existing.Thumbprint)"
        exit 0
    }
}

$pwdPlain = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$pwd = ConvertTo-SecureString -String $pwdPlain -Force -AsPlainText

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=Teta AI Dev Code Signing' `
    -FriendlyName 'Teta AI Dev Code Signing' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(5)

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\TrustedPublisher' | Out-Null

@{
    PfxPath    = $pfxPath
    CerPath    = $cerPath
    Password   = $pwdPlain
    Thumbprint = $cert.Thumbprint
    CreatedAt  = (Get-Date).ToString('o')
    Note       = 'Self-signed dev only — not for production client deployment'
} | ConvertTo-Json | Set-Content $infoPath

Write-Host "Utworzono certyfikat deweloperski:" -ForegroundColor Green
Write-Host "  PFX: $pfxPath"
Write-Host "  Haslo zapisane w: $infoPath"
Write-Output "PFX=$pfxPath"
Write-Output "THUMB=$($cert.Thumbprint)"
