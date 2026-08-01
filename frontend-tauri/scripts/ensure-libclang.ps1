$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$version = '21.1.8'
$licenseExpression = 'Apache-2.0 WITH LLVM-exception'
$sourceRepository = 'https://github.com/llvm/llvm-project'
$sourceTag = 'llvmorg-21.1.8'
$packageName = "libclang.runtime.win-x64.$version.nupkg"
$expectedSha256 = '1296aa72d506a3511e3f509f4966365133af9c935d301a63ec2242bd8c3180ce'
$cacheRoot = Join-Path $repoRoot 'build\tool-cache\libclang'
$packagePath = Join-Path $cacheRoot $packageName
$extractRoot = Join-Path $cacheRoot $version
$libraryPath = Join-Path $extractRoot 'runtimes\win-x64\native\libclang.dll'
$sourceUrl = "https://api.nuget.org/v3-flatcontainer/libclang.runtime.win-x64/$version/$packageName"

if (-not [string]::Equals($env:OS, 'Windows_NT', [System.StringComparison]::OrdinalIgnoreCase)) {
    return
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

function Test-PackageHash {
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        return $false
    }
    return [string]::Equals(
        (Get-Sha256Hex -Path $packagePath),
        $expectedSha256,
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

if (-not (Test-PackageHash)) {
    $partialPath = "$packagePath.partial"
    Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri $sourceUrl -OutFile $partialPath -UseBasicParsing
    $actual = Get-Sha256Hex -Path $partialPath
    if (-not [string]::Equals($actual, $expectedSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        throw "libclang NuGet package hash mismatch. Expected $expectedSha256, received $actual."
    }
    Move-Item -LiteralPath $partialPath -Destination $packagePath -Force
}

if (-not (Test-Path -LiteralPath $libraryPath -PathType Leaf)) {
    $temporaryExtract = Join-Path $cacheRoot "$version.partial"
    if (Test-Path -LiteralPath $temporaryExtract) {
        Remove-Item -LiteralPath $temporaryExtract -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $temporaryExtract | Out-Null
    Expand-Archive -LiteralPath $packagePath -DestinationPath $temporaryExtract -Force
    if (-not (Test-Path -LiteralPath (Join-Path $temporaryExtract 'runtimes\win-x64\native\libclang.dll') -PathType Leaf)) {
        throw 'The pinned libclang package does not contain the expected Windows x64 library.'
    }
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
    Move-Item -LiteralPath $temporaryExtract -Destination $extractRoot
}

$env:LIBCLANG_PATH = Split-Path -Parent $libraryPath
Write-Host "Verified libclang $version at $libraryPath"
