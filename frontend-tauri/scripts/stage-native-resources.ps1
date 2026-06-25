$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$backendBuild = Join-Path $repoRoot 'build\backend'
$resourcesDir = Join-Path $projectRoot 'src-tauri\resources\native'
$configuration = if ($env:FLUXORA_NATIVE_CONFIGURATION) { $env:FLUXORA_NATIVE_CONFIGURATION } else { 'Release' }
$requiredArtifacts = @('FluxoraBridgeHost.exe', 'FluxoraCore.dll')
$optionalArtifacts = @('FluxoraVfs.dll')

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

Write-Host "Staged native resources in $resourcesDir"
