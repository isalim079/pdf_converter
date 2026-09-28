#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Prepare a Hyper-V Ubuntu VM for Gotenberg-level PDF conversion on Windows Server.

.DESCRIPTION
  Enables Hyper-V if needed, creates VM "pdf-converter-ubuntu" (2 vCPU, 4 GB RAM),
  and attaches an Ubuntu 22.04 ISO when -IsoPath is provided.

  A fully unattended Ubuntu install is not reliable on Windows Server 2019 from one
  command. After the guest OS is installed, run the Linux stack inside the VM:

    sudo bash scripts/install-linux.sh
    yarn build
    yarn start

  Clients then call http://<vm-ip>:3050. Native Windows LibreOffice is not used.
#>
[CmdletBinding()]
param(
  [string]$VmName = "pdf-converter-ubuntu",
  [int]$MemoryGB = 4,
  [int]$CpuCount = 2,
  [int]$DiskGB = 40,
  [string]$IsoPath = "",
  [string]$SwitchName = "pdf-converter-switch"
)

$ErrorActionPreference = "Stop"

function Write-Ensure([string]$Message) {
  Write-Host "[hyperv] $Message"
}

function Test-HyperVEnabled {
  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
    return $feature.State -eq "Enabled"
  } catch {
    try {
      $role = Get-WindowsFeature -Name Hyper-V -ErrorAction Stop
      return [bool]$role.Installed
    } catch {
      return $false
    }
  }
}

function Enable-HyperVRole {
  try {
    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart | Out-Null
    return
  } catch {
    Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart:$false | Out-Null
  }
}

if (-not (Test-HyperVEnabled)) {
  Write-Ensure "Enabling Hyper-V. Windows may require a reboot."
  Enable-HyperVRole
  Write-Ensure "Hyper-V enable was requested. Reboot, then re-run this script."
  exit 1
}

if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  Write-Ensure "Hyper-V PowerShell module is not available. Install the Hyper-V role and reboot."
  exit 1
}

$existing = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Ensure "VM '$VmName' already exists (state: $($existing.State))."
  if ($existing.State -ne "Running") {
    Start-VM -Name $VmName
    Write-Ensure "Started '$VmName'."
  }
  Write-Ensure "Install Ubuntu if needed, clone this repo in the guest, then run scripts/install-linux.sh and yarn start inside Linux."
  exit 0
}

$switch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
if (-not $switch) {
  Write-Ensure "Creating internal virtual switch '$SwitchName'."
  New-VMSwitch -Name $SwitchName -SwitchType Internal | Out-Null
}

$vmRoot = Join-Path $env:PUBLIC "Documents\Hyper-V\$VmName"
New-Item -ItemType Directory -Force -Path $vmRoot | Out-Null
$vhdPath = Join-Path $vmRoot "$VmName.vhdx"

Write-Ensure "Creating VM '$VmName' ($CpuCount vCPU, ${MemoryGB} GB RAM, ${DiskGB} GB disk)."
New-VM -Name $VmName -Generation 2 -MemoryStartupBytes ($MemoryGB * 1GB) -NewVHDPath $vhdPath -NewVHDSizeBytes ($DiskGB * 1GB) -SwitchName $SwitchName | Out-Null
Set-VMProcessor -VMName $VmName -Count $CpuCount
Set-VMFirmware -VMName $VmName -EnableSecureBoot Off

if ($IsoPath -and (Test-Path $IsoPath)) {
  Add-VMDvdDrive -VMName $VmName -Path $IsoPath
  $dvd = Get-VMDvdDrive -VMName $VmName
  Set-VMFirmware -VMName $VmName -FirstBootDevice $dvd
  Write-Ensure "Attached ISO: $IsoPath"
} else {
  Write-Ensure "No ISO attached. Download Ubuntu 22.04 Server and re-run with -IsoPath:"
  Write-Ensure "  https://releases.ubuntu.com/22.04/ubuntu-22.04.5-live-server-amd64.iso"
  Write-Ensure "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -IsoPath C:\iso\ubuntu-22.04.5-live-server-amd64.iso"
}

Start-VM -Name $VmName
Write-Ensure "VM started. Complete Ubuntu setup in Hyper-V Manager, then inside the guest:"
Write-Ensure "  sudo bash scripts/install-linux.sh"
Write-Ensure "  yarn build && yarn start"
Write-Ensure "Publish guest port 3050. Do not convert Office files with Windows LibreOffice."
exit 0
