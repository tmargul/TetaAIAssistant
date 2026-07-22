<#
.SYNOPSIS
  VM: set static IP to match current Hyper-V Default Switch subnet.

.DESCRIPTION
  1) Enable DHCP to learn current Default Switch range.
  2) Set static IP .145 (default) in the same /20 subnet.
  3) Open firewall TCP 1521 for the host subnet.
  Run in VM console as Administrator.

.EXAMPLE
  .\Set-TetaVmNetwork.ps1
.EXAMPLE
  .\Set-TetaVmNetwork.ps1 -HostId 145 -AdapterName 'Ethernet'
#>
[CmdletBinding()]
param(
  [string] $AdapterName = '',
  [int] $HostId = 145,
  [int] $DhcpWaitSeconds = 25,
  [switch] $SkipFirewall,
  [switch] $WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($id)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script as Administrator inside the VM.'
  }
}

function Get-TargetAdapter {
  param([string] $Name)
  if ($Name) {
    return (Get-NetAdapter -Name $Name -ErrorAction Stop)
  }
  $candidates = Get-NetAdapter | Where-Object {
    $_.Status -eq 'Up' -and
    $_.InterfaceDescription -notmatch 'Loopback|VirtualBox|VMware|Wi-Fi|Wireless' -and
    $_.Name -notmatch 'vEthernet|Loopback'
  }
  if (-not $candidates) {
    $candidates = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
  }
  if (-not $candidates) {
    throw 'No active network adapter found.'
  }
  return ($candidates | Select-Object -First 1)
}

function Get-NetworkPrefix([string] $Ip, [int] $PrefixLength) {
  $ipBytes = [System.Net.IPAddress]::Parse($Ip).GetAddressBytes()
  [Array]::Reverse($ipBytes)
  $ipInt = [BitConverter]::ToUInt32($ipBytes, 0)
  $mask = if ($PrefixLength -eq 0) { [uint32]0 } else { [uint32]([uint32]::MaxValue -shl (32 - $PrefixLength)) }
  $netInt = $ipInt -band $mask
  $netBytes = [BitConverter]::GetBytes($netInt)
  [Array]::Reverse($netBytes)
  return ([System.Net.IPAddress]::new($netBytes)).ToString()
}

function New-HostInSubnet([string] $NetworkIp, [int] $PrefixLength, [int] $HostPart) {
  $netBytes = [System.Net.IPAddress]::Parse($NetworkIp).GetAddressBytes()
  [Array]::Reverse($netBytes)
  $netInt = [BitConverter]::ToUInt32($netBytes, 0)
  $mask = if ($PrefixLength -eq 0) { [uint32]0 } else { [uint32]([uint32]::MaxValue -shl (32 - $PrefixLength)) }
  $hostMask = -bnot $mask
  if ($HostPart -lt 1 -or $HostPart -gt [int]($hostMask -band 0x7FFFFFFF)) {
    throw "HostId $HostPart does not fit in /$PrefixLength."
  }
  $addrInt = ($netInt -band $mask) + [uint32]$HostPart
  $addrBytes = [BitConverter]::GetBytes($addrInt)
  [Array]::Reverse($addrBytes)
  return ([System.Net.IPAddress]::new($addrBytes)).ToString()
}

Assert-Admin
$adapter = Get-TargetAdapter -Name $AdapterName
Write-Host ("Adapter: {0} ({1})" -f $adapter.Name, $adapter.InterfaceDescription) -ForegroundColor Cyan

if ($WhatIf) {
  Write-Host '[WhatIf] No changes will be applied.' -ForegroundColor Yellow
}

Write-Host '1/4 Enabling DHCP (discover Default Switch range)...' -ForegroundColor Cyan
if (-not $WhatIf) {
  Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -Dhcp Enabled -ErrorAction SilentlyContinue
  Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -ne 'WellKnown' } |
    ForEach-Object {
      Remove-NetIPAddress -InterfaceIndex $_.InterfaceIndex -IPAddress $_.IPAddress -Confirm:$false -ErrorAction SilentlyContinue
    }
  Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' -and $_.NextHop -ne '0.0.0.0' } |
    ForEach-Object {
      Remove-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix $_.DestinationPrefix -NextHop $_.NextHop -Confirm:$false -ErrorAction SilentlyContinue
    }
  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses -ErrorAction SilentlyContinue
  ipconfig /release $adapter.Name 2>$null | Out-Null
  ipconfig /renew $adapter.Name 2>$null | Out-Null
}

$deadline = (Get-Date).AddSeconds($DhcpWaitSeconds)
$dhcpIp = $null
$prefix = $null
$gateway = $null
while ((Get-Date) -lt $deadline) {
  $addr = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1
  $route = Get-NetRoute -InterfaceIndex $adapter.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric |
    Select-Object -First 1
  if ($addr -and $route -and $route.NextHop -and $route.NextHop -ne '0.0.0.0') {
    $dhcpIp = $addr.IPAddress
    $prefix = [int]$addr.PrefixLength
    $gateway = $route.NextHop
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $dhcpIp -or -not $gateway) {
  throw ("DHCP did not assign an address within {0}s. Check that the VM NIC uses Default Switch, then retry." -f $DhcpWaitSeconds)
}

Write-Host ("DHCP: {0} /{1}, gateway {2}" -f $dhcpIp, $prefix, $gateway) -ForegroundColor Green
$network = Get-NetworkPrefix -Ip $gateway -PrefixLength $prefix
$staticIp = New-HostInSubnet -NetworkIp $network -PrefixLength $prefix -HostPart $HostId

if ($staticIp -eq $gateway) {
  throw ("Computed IP {0} conflicts with gateway {1}. Use a different -HostId." -f $staticIp, $gateway)
}

Write-Host ("2/4 Setting static IP: {0} /{1}, gateway {2}" -f $staticIp, $prefix, $gateway) -ForegroundColor Cyan
if (-not $WhatIf) {
  Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -Dhcp Disabled
  Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' } |
    ForEach-Object {
      Remove-NetIPAddress -InterfaceIndex $_.InterfaceIndex -IPAddress $_.IPAddress -Confirm:$false -ErrorAction SilentlyContinue
    }
  Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } |
    ForEach-Object {
      Remove-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix $_.DestinationPrefix -NextHop $_.NextHop -Confirm:$false -ErrorAction SilentlyContinue
    }

  New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress $staticIp -PrefixLength $prefix -DefaultGateway $gateway | Out-Null
  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses @($gateway) -ErrorAction SilentlyContinue
}

if (-not $SkipFirewall) {
  Write-Host ("3/4 Firewall: allow TCP 1521 from {0}/{1}" -f $network, $prefix) -ForegroundColor Cyan
  $ruleName = 'Teta Oracle 1521 (Default Switch)'
  $remote = ('{0}/{1}' -f $network, $prefix)
  if (-not $WhatIf) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1521 -RemoteAddress $remote | Out-Null
  }
} else {
  Write-Host '3/4 Firewall skipped (-SkipFirewall)' -ForegroundColor Yellow
}

Write-Host '4/4 Done.' -ForegroundColor Green
Write-Host ''
Write-Host '=== COPY TO HOST ===' -ForegroundColor Yellow
Write-Host ("VM_IP={0}" -f $staticIp)
Write-Host ("GATEWAY={0}" -f $gateway)
Write-Host ("PREFIX=/{0}" -f $prefix)
Write-Host ("SHARE=\\{0}\teta" -f $staticIp)
Write-Host ''
Write-Host 'On your PC run:' -ForegroundColor Yellow
Write-Host ("  .\Connect-TetaHost.ps1 -VmIp {0}" -f $staticIp)
Write-Host ''
