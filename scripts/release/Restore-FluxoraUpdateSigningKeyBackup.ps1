[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $InputPath,

    [string] $ProtectedKeyPath = (Join-Path (
        [Environment]::GetFolderPath('LocalApplicationData')) (
        'Fluxora\release-signing\update-manifest-p256-private.dpapi')),

    [AllowNull()]
    [Security.SecureString] $Password
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Fluxora signing-key backup restore requires PowerShell 7 or newer.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modulePath = Join-Path $PSScriptRoot 'Fluxora.Release.psm1'
$publicKeyPath = Join-Path $projectRoot (
    'frontend-tauri\src-tauri\resources\update\stable-public-key.der')
Import-Module $modulePath -Force

$ownsPassword = $false
if ($null -eq $Password) {
    $Password = Read-Host 'Enter the Fluxora signing-key backup password' -AsSecureString
    $ownsPassword = $true
}

try {
    $result = Restore-FluxoraUpdateSigningKeyBackup `
        -BackupPath $InputPath `
        -ProtectedKeyPath $ProtectedKeyPath `
        -PublicKeyPath $publicKeyPath `
        -Password $Password

    if ($result.restored) {
        Write-Host 'Fluxora update signing identity was restored into the current Windows user DPAPI store.'
    }
    else {
        Write-Host 'The matching Fluxora update signing identity is already present; no file was rewritten.'
    }
    Write-Host "  Protected key: $($result.protectedKeyPath)"
    Write-Host "  SHA-256 public-key fingerprint: $($result.fingerprint)"
    $result
}
finally {
    if ($ownsPassword -and $null -ne $Password) {
        $Password.Dispose()
    }
    $Password = $null
}
