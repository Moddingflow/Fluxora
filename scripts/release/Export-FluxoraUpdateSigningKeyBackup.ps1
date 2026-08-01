[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $OutputPath,

    [string] $ProtectedKeyPath = (Join-Path (
        [Environment]::GetFolderPath('LocalApplicationData')) (
        'Fluxora\release-signing\update-manifest-p256-private.dpapi')),

    [AllowNull()]
    [Security.SecureString] $Password,

    [AllowNull()]
    [Security.SecureString] $ConfirmPassword,

    [switch] $AllowNonAclFileSystem
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Fluxora signing-key backup export requires PowerShell 7 or newer.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modulePath = Join-Path $PSScriptRoot 'Fluxora.Release.psm1'
$publicKeyPath = Join-Path $projectRoot (
    'frontend-tauri\src-tauri\resources\update\stable-public-key.der')
Import-Module $modulePath -Force

$ownsPassword = $false
$ownsConfirmation = $false
if ($null -eq $Password) {
    if ($null -ne $ConfirmPassword) {
        throw '-ConfirmPassword cannot be supplied without -Password.'
    }
    $Password = Read-Host (
        'Enter a unique backup password (minimum 20 characters; 32+ random characters recommended)') `
        -AsSecureString
    $ownsPassword = $true
}
if ($null -eq $ConfirmPassword) {
    $ConfirmPassword = Read-Host 'Enter the same backup password again' -AsSecureString
    $ownsConfirmation = $true
}

try {
    $result = Export-FluxoraUpdateSigningKeyBackup `
        -ProtectedKeyPath $ProtectedKeyPath `
        -PublicKeyPath $publicKeyPath `
        -BackupPath $OutputPath `
        -Password $Password `
        -PasswordConfirmation $ConfirmPassword `
        -AllowNonAclFileSystem:$AllowNonAclFileSystem

    Write-Host 'Fluxora update signing-key backup is ready.'
    Write-Host "  Backup: $($result.backupPath)"
    Write-Host "  SHA-256 public-key fingerprint: $($result.fingerprint)"
    Write-Host "  Format: $($result.format)"
    Write-Host "  Encryption: $($result.encryption), $($result.iterations) PBKDF2 iterations"
    Write-Warning (
        'Keep at least two encrypted offline copies. Store the password separately, ' +
        'never in the repository, Supabase, build logs, or next to the backup.')
    $result
}
finally {
    if ($ownsPassword -and $null -ne $Password) {
        $Password.Dispose()
    }
    if ($ownsConfirmation -and $null -ne $ConfirmPassword) {
        $ConfirmPassword.Dispose()
    }
    $Password = $null
    $ConfirmPassword = $null
}
