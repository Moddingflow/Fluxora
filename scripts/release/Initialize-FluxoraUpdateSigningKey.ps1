[CmdletBinding()]
param(
    [string] $ProtectedKeyPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fluxora\release-signing\update-manifest-p256-private.dpapi'),
    [string] $PlaintextMigrationPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fluxora\release-signing\update-manifest-p256-private.pem'),
    [switch] $KeepPlaintextMigration
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modulePath = Join-Path $PSScriptRoot 'Fluxora.Release.psm1'
$publicKeyPath = Join-Path $projectRoot 'frontend-tauri\src-tauri\resources\update\stable-public-key.der'

Import-Module $modulePath -Force

$result = Initialize-FluxoraUpdateSigningKey `
    -ProtectedKeyPath $ProtectedKeyPath `
    -PublicKeyPath $publicKeyPath `
    -PlaintextMigrationPath $PlaintextMigrationPath `
    -RemovePlaintextMigration:(-not $KeepPlaintextMigration)

Write-Host 'Fluxora update signing identity is ready.'
Write-Host "  Public key: $($result.publicKeyPath)"
Write-Host "  SHA-256 fingerprint: $($result.fingerprint)"
Write-Host "  Protected private key: $($result.protectedKeyPath)"
Write-Warning 'Back up the signing identity securely. Losing it requires a deliberate key-rotation release signed by the current key.'
