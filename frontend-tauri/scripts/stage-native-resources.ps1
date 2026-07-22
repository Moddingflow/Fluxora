$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path -LiteralPath (Join-Path $projectRoot '..')
$backendBuild = Join-Path $repoRoot 'build\backend'
$resourcesDir = Join-Path $projectRoot 'src-tauri\resources\native'
$tauriRustRoot = Join-Path $projectRoot 'src-tauri'
$cpuCargoTarget = Join-Path $repoRoot 'build\cpu'
$vulkanCargoTarget = Join-Path $repoRoot 'build\vk'
$configuration = if ($env:FLUXORA_NATIVE_CONFIGURATION) { $env:FLUXORA_NATIVE_CONFIGURATION } else { 'Release' }
$requiredArtifacts = @('FluxoraBridgeHost.exe', 'FluxoraCore.dll')
$isWindows = [string]::Equals($env:OS, 'Windows_NT', [System.StringComparison]::OrdinalIgnoreCase)
$optionalArtifacts = @()
$aiHostCargoName = if ($isWindows) { 'fluxora_ai_host.exe' } else { 'fluxora_ai_host' }
$aiHostResourceName = if ($isWindows) { 'FluxoraAIHost.exe' } else { 'FluxoraAIHost' }
$speechHostCargoName = if ($isWindows) { 'fluxora_speech_host.exe' } else { 'fluxora_speech_host' }
$speechHostResourceName = if ($isWindows) { 'FluxoraSpeechHost.exe' } else { 'FluxoraSpeechHost' }
$vulkanSpeechHostCargoName = if ($isWindows) { 'fluxora_speech_host_vulkan.exe' } else { 'fluxora_speech_host_vulkan' }
$vulkanSpeechHostResourceName = if ($isWindows) { 'FluxoraSpeechHostVulkan.exe' } else { 'FluxoraSpeechHostVulkan' }

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
& (Join-Path $scriptRoot 'ensure-libclang.ps1')
& (Join-Path $scriptRoot 'stage-speech-resources.ps1')

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
    & cargo build --release --bin fluxora_ai_host
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build --release for the Fluxora AI host failed with exit code $LASTEXITCODE."
    }
    $previousCargoTarget = $env:CARGO_TARGET_DIR
    $previousCFlags = $env:CMAKE_C_FLAGS_RELEASE
    $previousCxxFlags = $env:CMAKE_CXX_FLAGS_RELEASE
    try {
        $env:CARGO_TARGET_DIR = $cpuCargoTarget
        $env:CMAKE_C_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG'
        $env:CMAKE_CXX_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG /utf-8'
        & cargo build --release --bin fluxora_speech_host
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build --release for the Fluxora CPU speech host failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        if ($null -eq $previousCargoTarget) { Remove-Item -LiteralPath 'Env:CARGO_TARGET_DIR' -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTarget }
        if ($null -eq $previousCFlags) { Remove-Item -LiteralPath 'Env:CMAKE_C_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_C_FLAGS_RELEASE = $previousCFlags }
        if ($null -eq $previousCxxFlags) { Remove-Item -LiteralPath 'Env:CMAKE_CXX_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_CXX_FLAGS_RELEASE = $previousCxxFlags }
    }

    if ($isWindows) {
        & (Join-Path $scriptRoot 'ensure-vulkan-sdk.ps1')
        $previousCargoTarget = $env:CARGO_TARGET_DIR
        try {
            $env:CARGO_TARGET_DIR = $vulkanCargoTarget
            $previousCFlags = $env:CMAKE_C_FLAGS_RELEASE
            $previousCxxFlags = $env:CMAKE_CXX_FLAGS_RELEASE
            $env:CMAKE_C_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG'
            $env:CMAKE_CXX_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG /utf-8'
            & cargo build --release --features speech-vulkan --bin fluxora_speech_host_vulkan
            if ($LASTEXITCODE -ne 0) {
                throw "cargo build --release for the Fluxora Vulkan speech host failed with exit code $LASTEXITCODE."
            }
        }
        finally {
            if ($null -eq $previousCargoTarget) {
                Remove-Item -LiteralPath 'Env:CARGO_TARGET_DIR' -ErrorAction SilentlyContinue
            }
            else {
                $env:CARGO_TARGET_DIR = $previousCargoTarget
            }
            if ($null -eq $previousCFlags) { Remove-Item -LiteralPath 'Env:CMAKE_C_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_C_FLAGS_RELEASE = $previousCFlags }
            if ($null -eq $previousCxxFlags) { Remove-Item -LiteralPath 'Env:CMAKE_CXX_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_CXX_FLAGS_RELEASE = $previousCxxFlags }
        }
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

$speechHostSource = Join-Path $cpuCargoTarget (Join-Path 'release' $speechHostCargoName)
if (-not (Test-Path -LiteralPath $speechHostSource -PathType Leaf)) {
    throw "Fluxora speech host binary was not found at '$speechHostSource'."
}
Copy-Item -LiteralPath $speechHostSource -Destination (Join-Path $resourcesDir $speechHostResourceName) -Force

if ($isWindows) {
    $vulkanSpeechHostSource = Join-Path $vulkanCargoTarget (Join-Path 'release' $vulkanSpeechHostCargoName)
    if (-not (Test-Path -LiteralPath $vulkanSpeechHostSource -PathType Leaf)) {
        throw "Fluxora Vulkan speech host binary was not found at '$vulkanSpeechHostSource'."
    }
    Copy-Item -LiteralPath $vulkanSpeechHostSource -Destination (Join-Path $resourcesDir $vulkanSpeechHostResourceName) -Force
}

Write-Host "Staged native resources in $resourcesDir"
