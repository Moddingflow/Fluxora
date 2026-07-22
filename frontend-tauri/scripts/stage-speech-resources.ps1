$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$sourceRoot = Join-Path $projectRoot 'speech'
$manifestSource = Join-Path $sourceRoot 'manifest.v1.json'
$manifest = Get-Content -LiteralPath $manifestSource -Raw | ConvertFrom-Json
$cacheRoot = Join-Path $repoRoot 'build\model-cache\speech'
$resourcesRoot = Join-Path $projectRoot 'src-tauri\resources\speech'
$modelsRoot = Join-Path $resourcesRoot 'models'

if (-not [string]::Equals($env:OS, 'Windows_NT', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Local voice input v1 packaging currently supports Windows only.'
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
New-Item -ItemType Directory -Force -Path $modelsRoot | Out-Null
if (-not (Get-Command 'curl.exe' -ErrorAction SilentlyContinue)) {
    throw 'curl.exe is required to download pinned speech assets during the Windows build.'
}

function Test-AssetHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }
    return [string]::Equals(
        (Get-Sha256Hex -Path $Path),
        $ExpectedSha256,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Get-VerifiedAsset {
    param([Parameter(Mandatory = $true)]$Asset)

    $cachedPath = Join-Path $cacheRoot $Asset.fileName
    $partialPath = "$cachedPath.partial"
    if ((Test-Path -LiteralPath $partialPath -PathType Leaf) -and (Test-AssetHash -Path $partialPath -ExpectedSha256 $Asset.sha256)) {
        Move-Item -LiteralPath $partialPath -Destination $cachedPath -Force
    }
    if (-not (Test-AssetHash -Path $cachedPath -ExpectedSha256 $Asset.sha256)) {
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        Write-Host "Downloading pinned speech asset $($Asset.fileName) at revision $($Asset.revision)..."
        & curl.exe --fail --location --retry 3 --retry-delay 2 --output $partialPath $Asset.sourceUrl
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            throw "Speech asset download failed for $($Asset.fileName) with exit code $LASTEXITCODE."
        }
        $actual = Get-Sha256Hex -Path $partialPath
        if (-not [string]::Equals($actual, $Asset.sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            throw "Speech asset hash mismatch for $($Asset.fileName). Expected $($Asset.sha256), received $actual."
        }
        if (($Asset.PSObject.Properties.Name -contains 'sizeBytes') -and (Get-Item -LiteralPath $partialPath).Length -ne [long]$Asset.sizeBytes) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            throw "Speech asset size mismatch for $($Asset.fileName)."
        }
        Move-Item -LiteralPath $partialPath -Destination $cachedPath -Force
    }
    return $cachedPath
}

$modelPath = Get-VerifiedAsset -Asset $manifest.model
$vadPath = Get-VerifiedAsset -Asset $manifest.vad
Copy-Item -LiteralPath $modelPath -Destination (Join-Path $modelsRoot $manifest.model.fileName) -Force
Copy-Item -LiteralPath $vadPath -Destination (Join-Path $modelsRoot $manifest.vad.fileName) -Force
Copy-Item -LiteralPath $manifestSource -Destination (Join-Path $resourcesRoot 'manifest.json') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot $manifest.glossary.fileName) -Destination (Join-Path $resourcesRoot $manifest.glossary.fileName) -Force

$licenseSource = Join-Path $sourceRoot 'licenses'
$licenseTarget = Join-Path $resourcesRoot 'licenses'
New-Item -ItemType Directory -Force -Path $licenseTarget | Out-Null
Get-ChildItem -LiteralPath $licenseSource -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $licenseTarget -Force
}

Write-Host "Verified and staged offline speech resources in $resourcesRoot"
