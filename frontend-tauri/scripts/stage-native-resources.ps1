$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$backendBuild = Join-Path $repoRoot 'build\backend'
$resourcesDir = Join-Path $projectRoot 'src-tauri\resources\native'
$tauriRustRoot = Join-Path $projectRoot 'src-tauri'
$configuration = if ($env:FLUXORA_NATIVE_CONFIGURATION) { $env:FLUXORA_NATIVE_CONFIGURATION } else { 'Release' }
$requiredArtifacts = @('FluxoraBridgeHost.exe', 'FluxoraCore.dll')
$isWindows = [string]::Equals($env:OS, 'Windows_NT', [System.StringComparison]::OrdinalIgnoreCase)
$optionalArtifacts = @()
$aiHostCargoName = if ($isWindows) { 'fluxora-ai-host.exe' } else { 'fluxora-ai-host' }
$aiHostResourceName = if ($isWindows) { 'FluxoraAIHost.exe' } else { 'FluxoraAIHost' }

if ($isWindows) {
    $requiredArtifacts += 'FluxoraVfs.dll'
}

function Resolve-NativeArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $candidates = @(
        (Join-Path $backendBuild (Join-Path $configuration $Name)),
        (Join-Path $backendBuild $Name),
        (Join-Path $backendBuild (Join-Path 'Release' $Name)),
        (Join-Path $backendBuild (Join-Path 'Debug' $Name)),
        (Join-Path $backendBuild (Join-Path 'RelWithDebInfo' $Name))
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null

$cmakeCache = Join-Path $backendBuild 'CMakeCache.txt'
if ($isWindows -and (Test-Path -LiteralPath $cmakeCache -PathType Leaf)) {
    $cacheText = Get-Content -LiteralPath $cmakeCache -Raw
    if ($cacheText -match '(?m)^FLUXORA_ENABLE_VFS:BOOL=OFF$') {
        throw "The C++ backend is configured with FLUXORA_ENABLE_VFS=OFF. Reconfigure with '.\Build.ps1' or 'cmake -S backend -B build\backend -DFLUXORA_ENABLE_VFS=ON' before staging native resources."
    }
}

foreach ($artifact in $requiredArtifacts) {
    $source = Resolve-NativeArtifact -Name $artifact
    if (-not $source) {
        throw "$artifact was not found under '$backendBuild'. Build the C++ backend first."
    }

    Copy-Item -LiteralPath $source -Destination (Join-Path $resourcesDir $artifact) -Force
}

foreach ($artifact in $optionalArtifacts) {
    $source = Resolve-NativeArtifact -Name $artifact
    if ($source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $resourcesDir $artifact) -Force
    }
}

Push-Location $tauriRustRoot
try {
    & cargo build --release --bin fluxora-ai-host
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build --release --bin fluxora-ai-host failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

$aiHostSource = Join-Path $tauriRustRoot (Join-Path 'target\release' $aiHostCargoName)
if (-not (Test-Path -LiteralPath $aiHostSource -PathType Leaf)) {
    throw "Fluxora AI host binary was not found at '$aiHostSource'."
}

Copy-Item -LiteralPath $aiHostSource -Destination (Join-Path $resourcesDir $aiHostResourceName) -Force

Write-Host "Staged native resources in $resourcesDir"
