param(
    [string]$InstallerCoreLibDir = $env:FLUXORA_INSTALLER_CORE_LIB_DIR
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')).Path
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'

if ([string]::IsNullOrWhiteSpace($InstallerCoreLibDir)) {
    throw 'FLUXORA_INSTALLER_CORE_LIB_DIR (or -InstallerCoreLibDir) is required for the installer-native Rust boundary gate.'
}

$resolvedInstallerCoreLibDir = (
    Resolve-Path -LiteralPath $InstallerCoreLibDir -ErrorAction Stop
).Path
if (-not [System.IO.Path]::IsPathRooted($resolvedInstallerCoreLibDir) -or
    -not (Test-Path -LiteralPath $resolvedInstallerCoreLibDir -PathType Container)) {
    throw "Installer core library directory must resolve to an existing absolute directory: '$InstallerCoreLibDir'."
}

$installerCoreLibrary = Join-Path $resolvedInstallerCoreLibDir 'FluxoraInstallerCore.lib'
if (-not (Test-Path -LiteralPath $installerCoreLibrary -PathType Leaf)) {
    throw "FluxoraInstallerCore.lib was not found in '$resolvedInstallerCoreLibDir'."
}

& (Join-Path $scriptRoot 'ensure-libclang.ps1')
$previousInstallerCoreLibDir = [Environment]::GetEnvironmentVariable(
    'FLUXORA_INSTALLER_CORE_LIB_DIR',
    'Process')
$rustFlagsVariable = 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS'
$previousRustFlags = [Environment]::GetEnvironmentVariable(
    $rustFlagsVariable,
    'Process')
$staticCrtFlag = '-C target-feature=+crt-static'
$env:FLUXORA_INSTALLER_CORE_LIB_DIR = $resolvedInstallerCoreLibDir
if ([string]::IsNullOrWhiteSpace($previousRustFlags)) {
    [Environment]::SetEnvironmentVariable(
        $rustFlagsVariable,
        $staticCrtFlag,
        'Process')
}
elseif ($previousRustFlags -notmatch '(?:^|\s)-C\s+target-feature=\+crt-static(?:\s|$)') {
    [Environment]::SetEnvironmentVariable(
        $rustFlagsVariable,
        "$previousRustFlags $staticCrtFlag",
        'Process')
}
Push-Location $projectRoot
try {
    foreach ($frontendTarget in @('build:setup:frontend', 'build:updater:frontend')) {
        & pnpm run $frontendTarget
        if ($LASTEXITCODE -ne 0) {
            throw "Installer frontend build '$frontendTarget' failed with exit code $LASTEXITCODE."
        }
    }

    & cargo test `
        --manifest-path $manifestPath `
        --locked `
        --features installer-native,custom-protocol `
        --bin FluxoraSetup `
        --bin FluxoraUpdater
    if ($LASTEXITCODE -ne 0) {
        throw "Installer Rust boundary tests failed with exit code $LASTEXITCODE."
    }

    & cargo build `
        --manifest-path $manifestPath `
        --locked `
        --features installer-native,custom-protocol `
        --bin FluxoraSetup `
        --bin FluxoraUpdater
    if ($LASTEXITCODE -ne 0) {
        throw "Installer Rust binary build failed with exit code $LASTEXITCODE."
    }

    $dumpbinCommand = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
    $dumpbinPath = if ($null -ne $dumpbinCommand) {
        $dumpbinCommand.Source
    }
    else {
        $vswherePath = Join-Path ${env:ProgramFiles(x86)} `
            'Microsoft Visual Studio\Installer\vswhere.exe'
        if (-not (Test-Path -LiteralPath $vswherePath -PathType Leaf)) {
            throw 'dumpbin.exe and Visual Studio vswhere.exe are unavailable; PE import verification cannot run.'
        }
        $visualStudioPath = & $vswherePath `
            -latest `
            -products '*' `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath
        if ([string]::IsNullOrWhiteSpace($visualStudioPath)) {
            throw 'A Visual Studio installation with the MSVC x64 tools is required for PE import verification.'
        }
        $msvcToolsRoot = Join-Path $visualStudioPath 'VC\Tools\MSVC'
        $latestMsvcTools = Get-ChildItem -LiteralPath $msvcToolsRoot -Directory |
            Sort-Object { [version]$_.Name } -Descending |
            Select-Object -First 1
        if ($null -eq $latestMsvcTools) {
            throw "No MSVC toolset was found below '$msvcToolsRoot'."
        }
        Join-Path $latestMsvcTools.FullName 'bin\Hostx64\x64\dumpbin.exe'
    }
    if (-not (Test-Path -LiteralPath $dumpbinPath -PathType Leaf)) {
        throw "dumpbin.exe was not found at '$dumpbinPath'."
    }

    $targetDirectory = if ([string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
        Join-Path $projectRoot 'src-tauri\target'
    }
    else {
        [System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
    }
    $forbiddenRuntimeImport = '(?i)(FluxoraInstallerCore|VCRUNTIME[^\\]*|MSVCP[^\\]*|ucrtbase|api-ms-win-crt-[^\\]*)\.dll'
    foreach ($binaryName in @('FluxoraSetup.exe', 'FluxoraUpdater.exe')) {
        $binaryPath = Join-Path (Join-Path $targetDirectory 'debug') $binaryName
        if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
            throw "Expected installer binary was not produced: '$binaryPath'."
        }
        $dependencies = (& $dumpbinPath /DEPENDENTS $binaryPath | Out-String)
        if ($LASTEXITCODE -ne 0) {
            throw "dumpbin failed for '$binaryPath' with exit code $LASTEXITCODE."
        }
        $forbiddenImports = @(
            [regex]::Matches(
                $dependencies,
                $forbiddenRuntimeImport
            ) | ForEach-Object { $_.Value } | Sort-Object -Unique
        )
        if ($forbiddenImports.Count -gt 0) {
            throw "'$binaryName' imports forbidden installer/runtime DLLs: $($forbiddenImports -join ', ')."
        }
        Write-Host "Verified static installer/CRT PE imports: $binaryPath"
    }
}
finally {
    Pop-Location
    if ($null -eq $previousInstallerCoreLibDir) {
        Remove-Item Env:FLUXORA_INSTALLER_CORE_LIB_DIR -ErrorAction SilentlyContinue
    }
    else {
        $env:FLUXORA_INSTALLER_CORE_LIB_DIR = $previousInstallerCoreLibDir
    }
    if ($null -eq $previousRustFlags) {
        Remove-Item -LiteralPath "Env:$rustFlagsVariable" -ErrorAction SilentlyContinue
    }
    else {
        [Environment]::SetEnvironmentVariable(
            $rustFlagsVariable,
            $previousRustFlags,
            'Process')
    }
}
