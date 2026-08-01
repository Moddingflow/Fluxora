[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $PayloadDirectory,

    [Parameter(Mandatory = $true)]
    [string] $ArtifactDirectory,

    [Parameter(Mandatory = $true)]
    [string] $Version,

    [string] $ProtectedSigningKeyPath = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fluxora\release-signing\update-manifest-p256-private.dpapi'),

    [Parameter(Mandatory = $true)]
    [string] $PublicKeyPath,

    [string] $PreviousManifestPath,

    [string] $PreviousSignaturePath,

    [ValidateSet('win-x64')]
    [string] $Target = 'win-x64',

    [string] $ApplicationExecutable = 'Fluxora.exe',

    [string] $Repository = 'Moddingflow/Fluxora',

    [AllowNull()]
    [System.Security.Cryptography.ECDsa] $SigningKey
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$signingSecretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64'
[byte[]]$capturedSigningKeyBytes = $null
$capturedSigningKeyBase64 = [Environment]::GetEnvironmentVariable($signingSecretName, 'Process')
[Environment]::SetEnvironmentVariable($signingSecretName, $null, 'Process')
try {
    if (-not [string]::IsNullOrWhiteSpace($capturedSigningKeyBase64)) {
        try {
            $capturedSigningKeyBytes = [Convert]::FromBase64String($capturedSigningKeyBase64.Trim())
        }
        catch {
            throw "$signingSecretName is not valid base64."
        }
    }
}
finally {
    $capturedSigningKeyBase64 = $null
}
trap {
    if ($null -ne $capturedSigningKeyBytes) {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($capturedSigningKeyBytes)
    }
    throw $_
}
if ($null -ne $SigningKey -and $null -ne $capturedSigningKeyBytes) {
    throw 'Provide the update signing key as an ECDsa object or through the process environment, not both.'
}

$modulePath = Join-Path $PSScriptRoot 'Fluxora.Release.psm1'
Import-Module $modulePath -Force

$payloadRoot = [IO.Path]::GetFullPath($PayloadDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$artifactRoot = [IO.Path]::GetFullPath($ArtifactDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $payloadRoot -PathType Container)) {
    throw "Update payload directory does not exist: '$payloadRoot'."
}
if (Test-Path -LiteralPath $artifactRoot) {
    throw "Update artifact directory already exists; refusing to mix release state: '$artifactRoot'."
}
$payloadPrefix = $payloadRoot + [IO.Path]::DirectorySeparatorChar
$artifactPrefix = $artifactRoot + [IO.Path]::DirectorySeparatorChar
if ($artifactRoot.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $payloadRoot.StartsWith($artifactPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Update payload and artifact directories must not contain one another.'
}
if ($Repository -cne 'Moddingflow/Fluxora') {
    throw "Unsupported update repository '$Repository'."
}
if ([string]::IsNullOrWhiteSpace($PreviousManifestPath) -xor [string]::IsNullOrWhiteSpace($PreviousSignaturePath)) {
    throw 'Previous manifest and detached signature must be supplied together.'
}

$artifactParent = Split-Path -Parent $artifactRoot
New-Item -ItemType Directory -Path $artifactParent -Force | Out-Null
$stagingRoot = Join-Path $artifactParent ((Split-Path -Leaf $artifactRoot) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

try {
    $files = @(Get-FluxoraUpdateFileManifest -PayloadRoot $payloadRoot)
    $targetDigest = Get-FluxoraUpdateFileManifestSha256 -Files $files
    $releaseBaseUrl = "https://github.com/$Repository/releases/download/v$Version"
    $fullName = "Fluxora-$Version-$Target-full.flxupd"
    $fullPackage = Write-FluxoraUpdatePackage `
        -Kind Full `
        -SourceDirectory $payloadRoot `
        -Entries $files `
        -TargetVersion $Version `
        -Target $Target `
        -TargetFileManifestSha256 $targetDigest `
        -PackagePath (Join-Path $stagingRoot $fullName)

    $assets = [System.Collections.Generic.List[object]]::new()
    $assets.Add([pscustomobject][ordered]@{
        kind = 'full'
        fromVersion = $null
        url = "$releaseBaseUrl/$fullName"
        size = [uint64]$fullPackage.size
        sha256 = [string]$fullPackage.sha256
        targetFileManifestSha256 = $targetDigest
        baseFileManifestSha256 = $null
    })

    if (-not [string]::IsNullOrWhiteSpace($PreviousManifestPath)) {
        $previous = Read-FluxoraSignedUpdateManifest `
            -ManifestPath $PreviousManifestPath `
            -SignaturePath $PreviousSignaturePath `
            -PublicKeyPath $PublicKeyPath
        if ([string]$previous.target -cne $Target) {
            throw "Previous update target '$($previous.target)' cannot seed '$Target'."
        }
        if ([string]$previous.version -ceq $Version) {
            throw 'Previous and target update versions must differ.'
        }
        $previousVersion = [version]([string]$previous.version)
        $targetVersion = [version]$Version
        if ($previousVersion -ge $targetVersion) {
            throw "Previous update version '$previousVersion' must be older than '$targetVersion'."
        }

        $deltaPlan = Compare-FluxoraFileManifests -BaseFiles @($previous.files) -TargetFiles $files
        $deltaName = "Fluxora-$($previous.version)-to-$Version-$Target-delta.flxupd"
        $deltaPackage = Write-FluxoraUpdatePackage `
            -Kind Delta `
            -SourceDirectory $payloadRoot `
            -Entries @($deltaPlan.changed) `
            -DeletedPaths @($deltaPlan.deleted) `
            -FromVersion ([string]$previous.version) `
            -TargetVersion $Version `
            -Target $Target `
            -BaseFileManifestSha256 ([string]$previous.fileManifestSha256) `
            -TargetFileManifestSha256 $targetDigest `
            -PackagePath (Join-Path $stagingRoot $deltaName)
        $assets.Add([pscustomobject][ordered]@{
            kind = 'delta'
            fromVersion = [string]$previous.version
            url = "$releaseBaseUrl/$deltaName"
            size = [uint64]$deltaPackage.size
            sha256 = [string]$deltaPackage.sha256
            targetFileManifestSha256 = $targetDigest
            baseFileManifestSha256 = [string]$previous.fileManifestSha256
        })
    }

    $manifestBytes = ConvertTo-FluxoraUpdateManifestBytes `
        -Version $Version `
        -Target $Target `
        -ApplicationExecutable $ApplicationExecutable `
        -Files $files `
        -Assets $assets.ToArray()

    $ownsSigningKey = $false
    $activeSigningKey = $SigningKey
    if ($null -eq $activeSigningKey) {
        $activeSigningKey = Open-FluxoraUpdateSigningKey `
            -ProtectedKeyPath $ProtectedSigningKeyPath `
            -PrivateKeyPkcs8Bytes $capturedSigningKeyBytes
        $ownsSigningKey = $true
    }
    try {
        $signature = New-FluxoraDetachedSignature `
            -ManifestBytes $manifestBytes `
            -SigningKey $activeSigningKey `
            -KeyId 'stable-2026'
    }
    finally {
        if ($ownsSigningKey) {
            $activeSigningKey.Dispose()
        }
    }

    $publicKeyBytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($PublicKeyPath))
    if (-not (Test-FluxoraDetachedSignature -ManifestBytes $manifestBytes -Signature $signature -PublicKeyDer $publicKeyBytes)) {
        throw 'Generated update manifest does not verify against the embedded public key.'
    }

    $manifestStagingPath = Join-Path $stagingRoot 'fluxora-update-manifest.json'
    $signatureStagingPath = Join-Path $stagingRoot 'fluxora-update-manifest.sig'
    [IO.File]::WriteAllBytes($manifestStagingPath, $manifestBytes)
    [IO.File]::WriteAllText($signatureStagingPath, $signature + "`n", [Text.Encoding]::ASCII)
    [void](Read-FluxoraSignedUpdateManifest `
        -ManifestPath $manifestStagingPath `
        -SignaturePath $signatureStagingPath `
        -PublicKeyPath $PublicKeyPath)

    [IO.Directory]::Move($stagingRoot, $artifactRoot)
    return [pscustomobject]@{
        version = $Version
        target = $Target
        fileManifestSha256 = $targetDigest
        artifactDirectory = $artifactRoot
        manifestPath = Join-Path $artifactRoot 'fluxora-update-manifest.json'
        signaturePath = Join-Path $artifactRoot 'fluxora-update-manifest.sig'
        assetPaths = @($assets | ForEach-Object { Join-Path $artifactRoot ([IO.Path]::GetFileName(([Uri]$_.url).AbsolutePath)) })
    }
}
catch {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    throw
}
finally {
    if ($null -ne $capturedSigningKeyBytes) {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($capturedSigningKeyBytes)
        $capturedSigningKeyBytes = $null
    }
}
