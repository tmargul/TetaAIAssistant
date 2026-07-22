<#
.SYNOPSIS
  Host PC: remap drive A: to Teta share on VM and test Oracle :1521.

.DESCRIPTION
  1) Remove stale A: mapping (old Default Switch IP).
  2) Map A: -> \\<VmIp>\teta as WIN-PDDJCBNU8LI\Administrator.
  3) Test TCP 1521 and Teta client/server folders.
  4) Optionally update host in apps/api/data/teta.sqlite (oracle_connection).

.EXAMPLE
  .\Connect-TetaHost.ps1 -VmIp 172.27.16.145
.EXAMPLE
  .\Connect-TetaHost.ps1 -VmIp 172.27.16.145 -DriveLetter 'A' -UpdateSqlite
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $VmIp,

  [string] $DriveLetter = 'A',
  [string] $ShareName = 'teta',
  [string] $User = 'WIN-PDDJCBNU8LI\Administrator',
  [string] $ClientFolder = 'TETA Aplikacja klienta - 33.5',
  [string] $ServerFolder = 'TETA Serwer Aplikacji - 33.5',
  [switch] $UpdateSqlite,
  [string] $SqlitePath = '',
  [switch] $SkipOraclePortTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ($VmIp -match '^\d{1,3}(\.\d{1,3}){3}$')) {
  throw ("Invalid -VmIp: {0}" -f $VmIp)
}

$drive = $DriveLetter.TrimEnd(':').ToUpperInvariant()
$unc = ('\\{0}\{1}' -f $VmIp, $ShareName)
$local = ('{0}:' -f $drive)

Write-Host ("VM IP : {0}" -f $VmIp) -ForegroundColor Cyan
Write-Host ("UNC   : {0} -> {1}" -f $unc, $local) -ForegroundColor Cyan
Write-Host ("User  : {0}" -f $User) -ForegroundColor Cyan

Write-Host '1/5 TCP 1521...' -ForegroundColor Cyan
if (-not $SkipOraclePortTest) {
  $tcp = [System.Net.Sockets.TcpClient]::new()
  try {
    $iar = $tcp.BeginConnect($VmIp, 1521, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(5000, $false)
    if (-not ($ok -and $tcp.Connected)) {
      Write-Host ("WARN: port 1521 not open on {0} (Oracle down or wrong IP)." -f $VmIp) -ForegroundColor Yellow
    } else {
      Write-Host ("TCP 1521 OK on {0}" -f $VmIp) -ForegroundColor Green
    }
  } catch {
    Write-Host ("WARN: 1521 test: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  } finally {
    $tcp.Close()
  }
}

Write-Host ("2/5 Removing old mapping {0} ..." -f $local) -ForegroundColor Cyan
# Redirect inside cmd so missing mappings do not abort the script.
cmd.exe /c "net use $local /delete /y >nul 2>&1" | Out-Null
cmd.exe /c "net use `"$unc`" /delete /y >nul 2>&1" | Out-Null

Write-Host '3/5 VM Administrator password:' -ForegroundColor Cyan
$secure = Read-Host -AsSecureString 'Password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
}

Write-Host ("4/5 Mapping {0} -> {1} ..." -f $local, $unc) -ForegroundColor Cyan
$map = cmd /c ("net use {0} `"{1}`" /user:{2} `"{3}`" /persistent:yes" -f $local, $unc, $User, $plain)
$plain = $null
if ($LASTEXITCODE -ne 0) {
  throw ("net use failed (code {0}). Check IP, share '{1}' and password.`n{2}" -f $LASTEXITCODE, $ShareName, $map)
}
Write-Host 'Mapping OK.' -ForegroundColor Green

$clientPath = Join-Path $local $ClientFolder
$serverPath = Join-Path $local $ServerFolder
Write-Host '5/5 Checking Teta folders...' -ForegroundColor Cyan
$clientOk = Test-Path -LiteralPath $clientPath
$serverOk = Test-Path -LiteralPath $serverPath
$pluginsOk = Test-Path -LiteralPath (Join-Path $clientPath 'Plugins')
$helpOk = Test-Path -LiteralPath (Join-Path $clientPath 'Help')

Write-Host ("  {0}  {1}" -f $(if ($clientOk) { 'OK' } else { 'MISSING' }), $clientPath)
Write-Host ("  {0}  {1}" -f $(if ($serverOk) { 'OK' } else { 'MISSING' }), $serverPath)
Write-Host ("  {0}  Plugins" -f $(if ($pluginsOk) { 'OK' } else { 'MISSING' }))
Write-Host ("  {0}  Help" -f $(if ($helpOk) { 'OK' } else { 'MISSING' }))

if ($UpdateSqlite) {
  if (-not $SqlitePath) {
    $repoApi = Join-Path $PSScriptRoot '..\..\apps\api\data\teta.sqlite'
    $SqlitePath = [IO.Path]::GetFullPath($repoApi)
  }
  if (-not (Test-Path -LiteralPath $SqlitePath)) {
    Write-Host ("SQLite not found: {0} - skip UpdateSqlite." -f $SqlitePath) -ForegroundColor Yellow
  } else {
    Write-Host ("Updating oracle_connection.host -> {0} in {1}" -f $VmIp, $SqlitePath) -ForegroundColor Cyan
    $code = @'
const Database = require('better-sqlite3');
const db = new Database(process.argv[1]);
const info = db.prepare('UPDATE oracle_connection SET host = ?, updated_at = ? WHERE id = 1').run(process.argv[2], new Date().toISOString());
const row = db.prepare('SELECT host, port, identifier, username FROM oracle_connection WHERE id = 1').get();
db.close();
console.log(JSON.stringify({ changes: info.changes, row }, null, 2));
'@
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Write-Host 'node not in PATH - set Oracle host manually in UI (Settings -> Oracle).' -ForegroundColor Yellow
    } else {
      Push-Location (Join-Path $PSScriptRoot '..\..\apps\api')
      try {
        node -e $code -- $SqlitePath $VmIp
      } finally {
        Pop-Location
      }
      Write-Host 'SQLite host updated. Password unchanged.' -ForegroundColor Green
    }
  }
} else {
  Write-Host ''
  Write-Host ('App Oracle host: Settings -> Oracle -> Host = {0}' -f $VmIp) -ForegroundColor Yellow
  Write-Host ('Or: .\Connect-TetaHost.ps1 -VmIp {0} -UpdateSqlite' -f $VmIp) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Green
Write-Host ("net use: {0} -> {1}" -f $local, $unc)
Write-Host ("clientDirectory (UI): {0}" -f $clientPath)
Write-Host ("serverDirectory (UI): {0}" -f $serverPath)
Write-Host ("Oracle host: {0}  port 1521  SID TETAHR" -f $VmIp)
Write-Host ''
Write-Host 'Next (when Oracle OK):' -ForegroundColor Cyan
Write-Host '  pnpm --filter @teta/api run diagnose:pa-wtyczki'
Write-Host ''
