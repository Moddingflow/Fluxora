[CmdletBinding()]
param(
    [ValidateSet('Local', 'Production')]
    [string]$Mode,

    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Configuration = 'Release',

    [string]$Runtime = 'win-x64',

    [ValidateSet('Dev', 'Release')]
    [string]$Target = 'Release',

    [switch]$IncludeSymbols,

    [switch]$NoClean,

    [Alias('ProductionVersion')]
    [string]$Version,

    [switch]$PublishCurrentChanges
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$BuildSigningSecretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64'
[byte[]]$BuildCapturedSigningKeyBytes = $null
$buildSigningKeyBase64 = [Environment]::GetEnvironmentVariable($BuildSigningSecretName, 'Process')
[Environment]::SetEnvironmentVariable($BuildSigningSecretName, $null, 'Process')
try {
    if (-not [string]::IsNullOrWhiteSpace($buildSigningKeyBase64)) {
        try {
            $BuildCapturedSigningKeyBytes = [Convert]::FromBase64String($buildSigningKeyBase64.Trim())
        }
        catch {
            throw "$BuildSigningSecretName is not valid base64."
        }
    }
}
finally {
    $buildSigningKeyBase64 = $null
}
trap {
    if ($null -ne $BuildCapturedSigningKeyBytes) {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($BuildCapturedSigningKeyBytes)
    }
    throw $_
}

$ProjectRoot = $PSScriptRoot
$ReleaseModulePath = Join-Path $ProjectRoot 'scripts\release\Fluxora.Release.psm1'
$NativeArtifactValidationModulePath = Join-Path $ProjectRoot 'scripts\release\Fluxora.NativeArtifactValidation.psm1'
$ProductionReleaseScript = Join-Path $ProjectRoot 'scripts\release\Invoke-FluxoraProductionRelease.ps1'
Import-Module $ReleaseModulePath -Force
Import-Module $NativeArtifactValidationModulePath -Force

$hasExplicitBuildArguments = @(
    $PSBoundParameters.Keys | Where-Object { $_ -notin @('Mode') }
).Count -gt 0
$resolvedBuildMode = Resolve-FluxoraBuildMode `
    -Mode $Mode `
    -HasExplicitBuildArguments $hasExplicitBuildArguments

if ($resolvedBuildMode -eq 'Production') {
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw 'Production releases require PowerShell 7 (pwsh) for cryptographic and UTF-8 guarantees.'
    }
    if ($NoClean) {
        throw 'Production releases cannot use -NoClean.'
    }
    if ($Configuration -ne 'Release' -or $Runtime -ne 'win-x64' -or $Target -ne 'Release') {
        throw 'Production releases require -Configuration Release -Runtime win-x64 -Target Release.'
    }
    $releaseArguments = @{
        Configuration = 'Release'
        Runtime = 'win-x64'
        Target = 'Release'
        IncludeSymbols = $IncludeSymbols
    }
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        $releaseArguments['Version'] = $Version
    }
    if ($PublishCurrentChanges) {
        $releaseArguments['PublishCurrentChanges'] = $true
    }
    if ($null -ne $BuildCapturedSigningKeyBytes) {
        $releaseArguments['SigningKeyPkcs8Bytes'] = $BuildCapturedSigningKeyBytes
    }
    try {
        & $ProductionReleaseScript @releaseArguments
    }
    finally {
        if ($null -ne $BuildCapturedSigningKeyBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($BuildCapturedSigningKeyBytes)
            $BuildCapturedSigningKeyBytes = $null
        }
    }
    return
}

if ($null -ne $BuildCapturedSigningKeyBytes) {
    [Security.Cryptography.CryptographicOperations]::ZeroMemory($BuildCapturedSigningKeyBytes)
    $BuildCapturedSigningKeyBytes = $null
}
$BackendSource = Join-Path $ProjectRoot 'backend'
$BackendBuild = Join-Path $ProjectRoot 'build\backend'
$TauriProject = Join-Path $ProjectRoot 'frontend-tauri'
$TauriUpdaterConfigPath = Join-Path $TauriProject 'src-tauri\updater\tauri.conf.json'
$TauriSetupConfigPath = Join-Path $TauriProject 'src-tauri\setup\tauri.conf.json'
$TauriCargoManifestPath = Join-Path $TauriProject 'src-tauri\Cargo.toml'
if (-not [string]::IsNullOrWhiteSpace($Version)) {
    Set-FluxoraProductVersion -ProjectRoot $ProjectRoot -Version $Version
}
$FluxoraProductVersion = Get-FluxoraProductVersion -ProjectRoot $ProjectRoot
Write-Host "Build mode: Local (product version: $FluxoraProductVersion)."
$TauriUsesPnpm = Test-Path -LiteralPath (Join-Path $TauriProject 'pnpm-lock.yaml')
$TauriPackageManager = if ($TauriUsesPnpm) { 'pnpm' } else { 'npm' }
$TauriInstallArguments = if ($TauriUsesPnpm) {
    @('install', '--frozen-lockfile')
}
else {
    @('install', '--no-fund')
}
$TauriNativeResourcesRoot = Join-Path $ProjectRoot 'build\tauri-native'
$TauriNativeResourcesDir = Join-Path $TauriProject 'src-tauri\resources\native'
$TauriSpeechResourcesDir = Join-Path $TauriProject 'src-tauri\resources\speech'
$TauriExecutableName = 'Fluxora.exe'
$TauriUpdaterExecutableName = 'FluxoraUpdater.exe'
$TauriSetupExecutableName = 'FluxoraSetup.exe'
$TauriCargoProfileName = if ($Configuration -eq 'Debug') { 'debug' } else { 'release' }
$TauriCargoProfileArguments = if ($Configuration -eq 'Debug') { @() } else { @('--release') }
$TauriCargoOutputDir = Join-Path $TauriProject (Join-Path 'src-tauri\target' $TauriCargoProfileName)
$UpdaterExecutablePath = Join-Path $TauriCargoOutputDir $TauriUpdaterExecutableName
$SetupExecutablePath = Join-Path $TauriCargoOutputDir $TauriSetupExecutableName
$FluxoraSkillsSourceDir = Join-Path $ProjectRoot 'FLUXORASKILLS\skills'
$FluxoraAiDirectoryName = 'Fluxora AI'
$FluxoraAiSkillsRelativeDir = Join-Path $FluxoraAiDirectoryName 'Skills'
$OutputDir = Join-Path $ProjectRoot 'output'
$OutputDownloadsDir = Join-Path $OutputDir 'Downloads'
$FluxoraAiSkillsOutputDir = Join-Path $OutputDir $FluxoraAiSkillsRelativeDir
$SymbolsOutputDir = Join-Path $ProjectRoot 'output-symbols'
$InstallerOutputDir = Join-Path $ProjectRoot 'output-installer'
$BuildCacheDir = Join-Path $ProjectRoot 'build\installer-cache'
$InstallerPayloadPath = Join-Path $BuildCacheDir 'FluxoraPayload.flxpkg.gz'
$WebView2BootstrapperPath = Join-Path $ProjectRoot 'third_party\webview2\MicrosoftEdgeWebview2Setup.exe'
$WebView2BootstrapperMetadataPath = Join-Path $ProjectRoot 'third_party\webview2\source.json'
$DesktopComplianceScriptPath = Join-Path $ProjectRoot 'scripts\release\Test-DesktopLegalAndAssetCompliance.ps1'
$CMakeDependencyEvidencePath = Join-Path $BackendBuild 'fluxora-cmake-dependencies.json'
$PreservedDownloadsStagingDir = Join-Path $BuildCacheDir 'preserved-output-downloads'
$PayloadManifestPath = Join-Path $BuildCacheDir 'payload.manifest.json'
$InstallerManifestPath = Join-Path $BuildCacheDir 'installer.manifest.json'
$BuildManifestVersion = 1
$PayloadPackageFormatVersion = 2

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Command '$Name' was not found. Install it and make sure it is available in PATH."
    }
}

function Assert-FluxoraWebView2Bootstrapper {
    if (-not (Test-Path -LiteralPath $WebView2BootstrapperPath -PathType Leaf)) {
        throw "The pinned Microsoft WebView2 Evergreen bootstrapper is missing: '$WebView2BootstrapperPath'."
    }
    if (-not (Test-Path -LiteralPath $WebView2BootstrapperMetadataPath -PathType Leaf)) {
        throw "The WebView2 bootstrapper provenance metadata is missing: '$WebView2BootstrapperMetadataPath'."
    }

    $metadata = Get-Content -LiteralPath $WebView2BootstrapperMetadataPath -Raw | ConvertFrom-Json
    if ([int]$metadata.schemaVersion -ne 1 -or
        [string]$metadata.fileName -cne 'MicrosoftEdgeWebview2Setup.exe' -or
        [string]::IsNullOrWhiteSpace([string]$metadata.sha256) -or
        [string]::IsNullOrWhiteSpace([string]$metadata.authenticodeSignerThumbprint)) {
        throw 'The WebView2 bootstrapper provenance metadata is incomplete or unsupported.'
    }

    $file = Get-Item -LiteralPath $WebView2BootstrapperPath
    if ([uint64]$file.Length -ne [uint64]$metadata.size) {
        throw "The WebView2 bootstrapper size does not match pinned provenance metadata."
    }
    $actualHash = Get-FileSha256Hex -Path $WebView2BootstrapperPath
    if (-not [string]::Equals(
        $actualHash,
        [string]$metadata.sha256,
        [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'The WebView2 bootstrapper SHA-256 does not match pinned provenance metadata.'
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $WebView2BootstrapperPath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        -not [string]::Equals(
            [string]$signature.SignerCertificate.Thumbprint,
            [string]$metadata.authenticodeSignerThumbprint,
            [System.StringComparison]::OrdinalIgnoreCase) -or
        [string]$signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
        throw 'The WebView2 bootstrapper does not have the pinned valid Microsoft Authenticode identity.'
    }

    Assert-FluxoraNativePeImage `
        -Path $WebView2BootstrapperPath `
        -AllowedMachineTypes @([uint16]0x014c)
    return $metadata
}

function Invoke-BuildStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Title"
    & $Action
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($exitCode -ne 0) {
        $commandLine = ($Arguments | ForEach-Object { "'$_'" }) -join ' '
        throw "Command '$FilePath $commandLine' failed with exit code $exitCode."
    }
}

function Get-NativeCorePath {
    $knownPaths = @(
        (Join-Path $BackendBuild "$Configuration\FluxoraCore.dll"),
        (Join-Path $BackendBuild 'FluxoraCore.dll')
    )

    foreach ($path in $knownPaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    $latestDll = Get-ChildItem -LiteralPath $BackendBuild -Recurse -Filter 'FluxoraCore.dll' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestDll) {
        return $latestDll.FullName
    }

    throw "FluxoraCore.dll was not found under '$BackendBuild'."
}

function Get-NativeVfsPath {
    $knownPaths = @(
        (Join-Path $BackendBuild "$Configuration\FluxoraVfs.dll"),
        (Join-Path $BackendBuild 'FluxoraVfs.dll')
    )

    foreach ($path in $knownPaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    $latestDll = Get-ChildItem -LiteralPath $BackendBuild -Recurse -Filter 'FluxoraVfs.dll' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestDll) {
        return $latestDll.FullName
    }

    return $null
}

function Get-NativeBridgeHostPath {
    $executableName = if ($Runtime -like 'win-*') { 'FluxoraBridgeHost.exe' } else { 'FluxoraBridgeHost' }
    $knownPaths = @(
        (Join-Path $BackendBuild "$Configuration\$executableName"),
        (Join-Path $BackendBuild $executableName)
    )

    foreach ($path in $knownPaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    $latestHost = Get-ChildItem -LiteralPath $BackendBuild -Recurse -Filter $executableName -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestHost) {
        return $latestHost.FullName
    }

    throw "$executableName was not found under '$BackendBuild'."
}

function Get-TauriAiHostResourceName {
    if ($Runtime -like 'win-*') {
        return 'FluxoraAIHost.exe'
    }

    return 'FluxoraAIHost'
}

function Get-TauriAiHostCargoOutputName {
    if ($Runtime -like 'win-*') {
        return 'fluxora_ai_host.exe'
    }

    return 'fluxora_ai_host'
}

function Get-TauriSpeechHostResourceName {
    if ($Runtime -like 'win-*') {
        return 'FluxoraSpeechHost.exe'
    }

    return 'FluxoraSpeechHost'
}

function Get-TauriSpeechHostCargoOutputName {
    if ($Runtime -like 'win-*') {
        return 'fluxora_speech_host.exe'
    }

    return 'fluxora_speech_host'
}

function Get-TauriVulkanSpeechHostResourceName {
    if ($Runtime -like 'win-*') {
        return 'FluxoraSpeechHostVulkan.exe'
    }

    return 'FluxoraSpeechHostVulkan'
}

function Get-TauriVulkanSpeechHostCargoOutputName {
    if ($Runtime -like 'win-*') {
        return 'fluxora_speech_host_vulkan.exe'
    }

    return 'fluxora_speech_host_vulkan'
}

function Build-TauriAiHost {
    $tauriRustRoot = Join-Path $TauriProject 'src-tauri'
    $cpuCargoTarget = Join-Path $ProjectRoot 'build\cpu'
    $vulkanCargoTarget = Join-Path $ProjectRoot 'build\vk'
    & (Join-Path $TauriProject 'scripts\ensure-libclang.ps1')
    Push-Location $tauriRustRoot
    try {
        Invoke-CheckedCommand -FilePath 'cargo' -Arguments @(
            'build', '--release', '--locked',
            '--bin', 'fluxora_ai_host'
        )
        $previousCargoTarget = $env:CARGO_TARGET_DIR
        $previousCFlags = $env:CMAKE_C_FLAGS_RELEASE
        $previousCxxFlags = $env:CMAKE_CXX_FLAGS_RELEASE
        try {
            $env:CARGO_TARGET_DIR = $cpuCargoTarget
            $env:CMAKE_C_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG'
            $env:CMAKE_CXX_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG /utf-8'
            Invoke-CheckedCommand -FilePath 'cargo' -Arguments @(
                'build', '--release', '--locked',
                '--bin', 'fluxora_speech_host'
            )
        }
        finally {
            if ($null -eq $previousCargoTarget) { Remove-Item -LiteralPath 'Env:CARGO_TARGET_DIR' -ErrorAction SilentlyContinue } else { $env:CARGO_TARGET_DIR = $previousCargoTarget }
            if ($null -eq $previousCFlags) { Remove-Item -LiteralPath 'Env:CMAKE_C_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_C_FLAGS_RELEASE = $previousCFlags }
            if ($null -eq $previousCxxFlags) { Remove-Item -LiteralPath 'Env:CMAKE_CXX_FLAGS_RELEASE' -ErrorAction SilentlyContinue } else { $env:CMAKE_CXX_FLAGS_RELEASE = $previousCxxFlags }
        }

        & (Join-Path $TauriProject 'scripts\ensure-vulkan-sdk.ps1')
        $previousCargoTarget = $env:CARGO_TARGET_DIR
        try {
            $env:CARGO_TARGET_DIR = $vulkanCargoTarget
            $previousCFlags = $env:CMAKE_C_FLAGS_RELEASE
            $previousCxxFlags = $env:CMAKE_CXX_FLAGS_RELEASE
            $env:CMAKE_C_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG'
            $env:CMAKE_CXX_FLAGS_RELEASE = '/O2 /Ob2 /DNDEBUG /utf-8'
            Invoke-CheckedCommand -FilePath 'cargo' -Arguments @(
                'build', '--release', '--locked',
                '--features', 'speech-vulkan',
                '--bin', 'fluxora_speech_host_vulkan'
            )
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
    finally {
        Pop-Location
    }

    $hostPath = Join-Path $tauriRustRoot (Join-Path 'target\release' (Get-TauriAiHostCargoOutputName))
    if (Test-Path -LiteralPath $hostPath -PathType Leaf) {
        return $hostPath
    }

    throw "Fluxora AI host build completed, but the binary was not found at '$hostPath'."
}

function Get-TauriSpeechHostPath {
    $hostPath = Join-Path $ProjectRoot (Join-Path 'build\cpu\release' (Get-TauriSpeechHostCargoOutputName))
    if (Test-Path -LiteralPath $hostPath -PathType Leaf) {
        return $hostPath
    }

    throw "Fluxora speech host build completed, but the binary was not found at '$hostPath'."
}

function Get-TauriVulkanSpeechHostPath {
    $hostPath = Join-Path $ProjectRoot (Join-Path 'build\vk\release' (Get-TauriVulkanSpeechHostCargoOutputName))
    if (Test-Path -LiteralPath $hostPath -PathType Leaf) {
        return $hostPath
    }

    throw "Fluxora Vulkan speech host build completed, but the binary was not found at '$hostPath'."
}

function Get-TauriPackageTarget {
    if ($Runtime -eq 'win-x64') {
        return [pscustomobject]@{ Platform = 'win32'; Arch = 'x64' }
    }

    throw "Build.ps1 assembles the Windows FluxoraSetup.exe installer. Tauri installer payload builds currently support -Runtime win-x64."
}

function Get-TauriBuiltExecutablePath {
    $knownExePath = Join-Path $TauriCargoOutputDir $TauriExecutableName
    if (Test-Path -LiteralPath $knownExePath -PathType Leaf) {
        return $knownExePath
    }

    $latestExe = Get-ChildItem -LiteralPath $TauriCargoOutputDir -Recurse -Filter $TauriExecutableName -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestExe) {
        return $latestExe.FullName
    }

    throw "Tauri build output containing '$TauriExecutableName' was not found under '$TauriCargoOutputDir'."
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        throw "Source directory '$SourceDirectory' does not exist."
    }

    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    Get-ChildItem -LiteralPath $SourceDirectory -Force |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $DestinationDirectory -Recurse -Force
        }
}

function Get-NativeInstallerCoreLibraryPath {
    $knownPaths = @(
        (Join-Path $BackendBuild "$Configuration\FluxoraInstallerCore.lib"),
        (Join-Path $BackendBuild 'FluxoraInstallerCore.lib')
    )

    foreach ($path in $knownPaths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            return $path
        }
    }

    $latestLibrary = Get-ChildItem -LiteralPath $BackendBuild -Recurse -Filter 'FluxoraInstallerCore.lib' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestLibrary) {
        return $latestLibrary.FullName
    }

    throw "The static FluxoraInstallerCore.lib was not found under '$BackendBuild'."
}

function Assert-ChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ParentPath
    )

    $parentFullPath = [System.IO.Path]::GetFullPath($ParentPath)
    $childFullPath = [System.IO.Path]::GetFullPath($Path)

    if (-not $childFullPath.StartsWith($parentFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path '$childFullPath' is outside the project root '$parentFullPath'."
    }
}

function Get-PortableRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $rootFullPath = [System.IO.Path]::GetFullPath($Root)
    $pathFullPath = [System.IO.Path]::GetFullPath($Path)
    $trimChars = @([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)

    if ([string]::Equals($rootFullPath.TrimEnd($trimChars), $pathFullPath.TrimEnd($trimChars), [System.StringComparison]::OrdinalIgnoreCase)) {
        return '.'
    }

    if (-not $rootFullPath.EndsWith([System.IO.Path]::DirectorySeparatorChar) -and
        -not $rootFullPath.EndsWith([System.IO.Path]::AltDirectorySeparatorChar)) {
        $rootFullPath += [System.IO.Path]::DirectorySeparatorChar
    }

    $rootUri = [System.Uri]::new($rootFullPath)
    $pathUri = [System.Uri]::new($pathFullPath)
    $relative = [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString())

    if ([string]::IsNullOrEmpty($relative)) {
        return '.'
    }

    return $relative.Replace('\', '/')
}

function ConvertTo-HexString {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]]$Bytes
    )

    return [System.BitConverter]::ToString($Bytes).Replace('-', '').ToLowerInvariant()
}

function Get-StringSha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ConvertTo-HexString -Bytes $sha256.ComputeHash($bytes)
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-FileSha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            return ConvertTo-HexString -Bytes $sha256.ComputeHash($stream)
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $sha256.Dispose()
    }
}

function Test-IsPayloadFileExcluded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    return (Test-IsPayloadPathExcluded -RelativePath $RelativePath) -or
        ($RelativePath -like 'logs/*.log') -or
        ($RelativePath -like '*.pdb')
}

function Test-IsPayloadPathExcluded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalized = $RelativePath.Replace('\', '/').Trim('/')
    return [string]::Equals($normalized, 'Downloads', [System.StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith('Downloads/', [System.StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($normalized, 'logs', [System.StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith('logs/', [System.StringComparison]::OrdinalIgnoreCase)
}

function New-FluxoraPayloadManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        throw "Application payload staging directory '$SourceDirectory' does not exist."
    }

    $sourceFullPath = [System.IO.Path]::GetFullPath($SourceDirectory)
    $directories = @(
        Get-ChildItem -LiteralPath $sourceFullPath -Directory -Recurse -Force |
            ForEach-Object {
                [pscustomobject]@{
                    Relative = Get-PortableRelativePath -Root $sourceFullPath -Path $_.FullName
                }
            } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_.Relative) -and $_.Relative -ne '.' } |
            Where-Object { -not (Test-IsPayloadPathExcluded -RelativePath $_.Relative) } |
            Sort-Object Relative
    )

    $files = @(
        Get-ChildItem -LiteralPath $sourceFullPath -File -Recurse -Force |
            ForEach-Object {
                $relative = Get-PortableRelativePath -Root $sourceFullPath -Path $_.FullName
                if (-not (Test-IsPayloadFileExcluded -RelativePath $relative)) {
                    [pscustomobject]@{
                        Relative = $relative
                        Length = [UInt64]$_.Length
                        LastWriteTimeUtcTicks = [Int64]$_.LastWriteTimeUtc.Ticks
                        Sha256 = Get-FileSha256Hex -Path $_.FullName
                    }
                }
            } |
            Sort-Object Relative
    )

    $totalBytes = [UInt64]0
    $hashInput = [System.Text.StringBuilder]::new()
    [void]$hashInput.AppendLine("FluxoraPayloadManifest|$BuildManifestVersion|$PayloadPackageFormatVersion")

    foreach ($directory in $directories) {
        [void]$hashInput.AppendLine("D|$($directory.Relative)")
    }

    foreach ($file in $files) {
        $totalBytes += [UInt64]$file.Length
        [void]$hashInput.AppendLine("F|$($file.Relative)|$($file.Length)|$($file.LastWriteTimeUtcTicks)|$($file.Sha256)")
    }

    return [pscustomobject]@{
        Version = $BuildManifestVersion
        Kind = 'FluxoraPayload'
        PackageFormatVersion = $PayloadPackageFormatVersion
        SourceDirectory = $sourceFullPath
        DirectoryCount = [UInt64]$directories.Count
        FileCount = [UInt64]$files.Count
        TotalBytes = $totalBytes
        Directories = $directories
        Files = $files
        ManifestHash = Get-StringSha256Hex -Value $hashInput.ToString()
        PackageSha256 = $null
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('O')
    }
}

function New-FluxoraFileManifestEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $file = Get-Item -LiteralPath $Path
    return [pscustomobject]@{
        Relative = Get-PortableRelativePath -Root $ProjectRoot -Path $file.FullName
        Length = [UInt64]$file.Length
        LastWriteTimeUtcTicks = [Int64]$file.LastWriteTimeUtc.Ticks
        Sha256 = Get-FileSha256Hex -Path $file.FullName
    }
}

function Add-FluxoraInstallerInputPath {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$Paths,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $Paths.Add([System.IO.Path]::GetFullPath($Path))
    }
}

function Copy-FluxoraSymbolFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $Path -Destination $DestinationDirectory -Force
    return $true
}

function Copy-FluxoraPublishedSymbols {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        return 0
    }

    $symbols = @(
        Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.pdb' -File -Recurse -ErrorAction SilentlyContinue
    )

    foreach ($symbol in $symbols) {
        $relative = Get-PortableRelativePath -Root $SourceDirectory -Path $symbol.FullName
        $destinationPath = Join-Path $DestinationDirectory $relative
        New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destinationPath)) -Force | Out-Null
        Copy-Item -LiteralPath $symbol.FullName -Destination $destinationPath -Force
    }

    return $symbols.Count
}

function Remove-FluxoraPayloadSymbols {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        return 0
    }

    $symbols = @(
        Get-ChildItem -LiteralPath $SourceDirectory -Filter '*.pdb' -File -Recurse -ErrorAction SilentlyContinue
    )

    foreach ($symbol in $symbols) {
        Remove-Item -LiteralPath $symbol.FullName -Force
    }

    return $symbols.Count
}

function New-FluxoraSetupManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PayloadSha256,

        [Parameter(Mandatory = $true)]
        [UInt64]$PayloadExpandedBytes,

        [Parameter(Mandatory = $true)]
        [string]$NativeInstallerCoreLibraryPath,

        [Parameter(Mandatory = $true)]
        [string[]]$BuildArgs
    )

    $candidatePaths = [System.Collections.Generic.List[string]]::new()

    Get-ChildItem -LiteralPath $TauriProject -File -Recurse -Force |
        Where-Object {
            $relative = Get-PortableRelativePath -Root $TauriProject -Path $_.FullName
            (-not ($relative -like 'node_modules/*')) -and
                (-not ($relative -like 'dist/*')) -and
                (-not ($relative -like 'src-tauri/target/*')) -and
                (-not ($relative -like 'src-tauri/resources/native/*')) -and
                (-not ($relative -like 'src-tauri/resources/speech/*'))
        } |
        ForEach-Object { $candidatePaths.Add($_.FullName) }

    foreach ($linkedRoot in @(
        (Join-Path $ProjectRoot 'Icons'),
        (Join-Path $ProjectRoot 'legal\desktop'),
        (Join-Path $ProjectRoot 'third_party\webview2'))) {
        if (Test-Path -LiteralPath $linkedRoot -PathType Container) {
            Get-ChildItem -LiteralPath $linkedRoot -File -Recurse -Force |
                ForEach-Object { $candidatePaths.Add($_.FullName) }
        }
    }

    Add-FluxoraInstallerInputPath -Paths $candidatePaths -Path $NativeInstallerCoreLibraryPath

    $seenPaths = @{}
    $fileEntries = @(
        foreach ($path in $candidatePaths) {
            $fullPath = [System.IO.Path]::GetFullPath($path)
            $key = $fullPath.ToLowerInvariant()
            if (-not $seenPaths.ContainsKey($key)) {
                $seenPaths[$key] = $true
                New-FluxoraFileManifestEntry -Path $fullPath
            }
        }
    ) | Sort-Object Relative

    $cargoVersion = (& cargo --version) -join ''
    $rustcVersion = (& rustc --version) -join ''
    $packageManagerVersion = (& $TauriPackageManager --version) -join ''
    $hashInput = [System.Text.StringBuilder]::new()
    [void]$hashInput.AppendLine("FluxoraTauriSetupManifest|$BuildManifestVersion")
    [void]$hashInput.AppendLine("Payload|$PayloadSha256")
    [void]$hashInput.AppendLine("PayloadExpandedBytes|$PayloadExpandedBytes")
    [void]$hashInput.AppendLine("Configuration|$Configuration")
    [void]$hashInput.AppendLine("Runtime|$Runtime")
    [void]$hashInput.AppendLine("Cargo|$cargoVersion")
    [void]$hashInput.AppendLine("Rustc|$rustcVersion")
    [void]$hashInput.AppendLine("PackageManager|$TauriPackageManager|$packageManagerVersion")
    foreach ($arg in $BuildArgs) {
        [void]$hashInput.AppendLine("Arg|$arg")
    }

    foreach ($file in $fileEntries) {
        [void]$hashInput.AppendLine("F|$($file.Relative)|$($file.Length)|$($file.LastWriteTimeUtcTicks)|$($file.Sha256)")
    }

    return [pscustomobject]@{
        Version = $BuildManifestVersion
        Kind = 'FluxoraTauriSetup'
        PayloadSha256 = $PayloadSha256
        PayloadExpandedBytes = $PayloadExpandedBytes
        Configuration = $Configuration
        Runtime = $Runtime
        CargoVersion = $cargoVersion
        RustcVersion = $rustcVersion
        PackageManager = $TauriPackageManager
        PackageManagerVersion = $packageManagerVersion
        BuildArgs = @($BuildArgs)
        Files = $fileEntries
        ManifestHash = Get-StringSha256Hex -Value $hashInput.ToString()
        SetupSha256 = $null
        GeneratedAtUtc = [DateTime]::UtcNow.ToString('O')
    }
}

function Save-FluxoraManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Manifest
    )

    New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($Path)) -Force | Out-Null
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Read-FluxoraManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch {
        Write-Warning "Ignoring unreadable build manifest '$Path': $($_.Exception.Message)"
        return $null
    }
}

function Get-FluxoraManifestPropertyValue {
    param(
        [AllowNull()]
        [object]$Manifest,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Manifest) {
        return $null
    }

    $property = $Manifest.PSObject.Properties.Match($Name) | Select-Object -First 1
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Test-FluxoraManifestHashMatches {
    param(
        [AllowNull()]
        [object]$SavedManifest,

        [Parameter(Mandatory = $true)]
        [object]$CurrentManifest
    )

    $savedHash = Get-FluxoraManifestPropertyValue -Manifest $SavedManifest -Name 'ManifestHash'
    if ([string]::IsNullOrWhiteSpace($savedHash)) {
        return $false
    }

    return [string]::Equals([string]$savedHash, [string]$CurrentManifest.ManifestHash, [System.StringComparison]::OrdinalIgnoreCase)
}

function Write-FluxoraPayloadPackage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string]$PackagePath
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory)) {
        throw "Application payload staging directory '$SourceDirectory' does not exist."
    }

    $sourceFullPath = [System.IO.Path]::GetFullPath($SourceDirectory)
    $directories = Get-ChildItem -LiteralPath $sourceFullPath -Directory -Recurse -Force |
        Where-Object {
            $relative = Get-PortableRelativePath -Root $sourceFullPath -Path $_.FullName
            -not (Test-IsPayloadPathExcluded -RelativePath $relative)
        } |
        Sort-Object FullName
    $files = Get-ChildItem -LiteralPath $sourceFullPath -File -Recurse -Force |
        Where-Object {
            $relative = Get-PortableRelativePath -Root $sourceFullPath -Path $_.FullName
            -not (Test-IsPayloadFileExcluded -RelativePath $relative)
        } |
        Sort-Object FullName

    $fileEntries = [System.Collections.Generic.List[object]]::new()
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $totalBytes = [UInt64]0
    try {
        foreach ($file in $files) {
            $relative = Get-PortableRelativePath -Root $sourceFullPath -Path $file.FullName
            $input = [System.IO.File]::OpenRead($file.FullName)
            try {
                $hash = $sha256.ComputeHash($input)
            }
            finally {
                $input.Dispose()
            }

            $fileEntries.Add([pscustomobject]@{
                File = $file
                Relative = $relative
                Hash = $hash
            })
            $totalBytes += [UInt64]$file.Length
        }
    }
    finally {
        $sha256.Dispose()
    }

    $entryCount = [UInt64]($directories.Count + $fileEntries.Count)
    New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($PackagePath)) -Force | Out-Null

    $stream = [System.IO.File]::Open($PackagePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
        $gzip = [System.IO.Compression.GZipStream]::new($stream, [System.IO.Compression.CompressionLevel]::Optimal, $true)
        try {
            $writer = [System.IO.BinaryWriter]::new($gzip, [System.Text.Encoding]::UTF8, $true)
            try {
                $writer.Write([byte[]](0x46, 0x4C, 0x58, 0x50, 0x4B, 0x47, 0x31, 0x00))
                $writer.Write([UInt32]2)
                $writer.Write($entryCount)
                $writer.Write($totalBytes)

                foreach ($directory in $directories) {
                    $relative = Get-PortableRelativePath -Root $sourceFullPath -Path $directory.FullName
                    if ([string]::IsNullOrWhiteSpace($relative) -or $relative -eq '.') {
                        continue
                    }

                    $pathBytes = [System.Text.Encoding]::UTF8.GetBytes($relative)
                    $writer.Write([byte]0)
                    $writer.Write([UInt32]$pathBytes.Length)
                    $writer.Write($pathBytes)
                    $writer.Write([UInt64]0)
                }

                $buffer = [byte[]]::new(1024 * 256)
                foreach ($fileEntry in $fileEntries) {
                    $file = $fileEntry.File
                    $pathBytes = [System.Text.Encoding]::UTF8.GetBytes($fileEntry.Relative)
                    $writer.Write([byte]1)
                    $writer.Write([UInt32]$pathBytes.Length)
                    $writer.Write($pathBytes)
                    $writer.Write([UInt64]$file.Length)
                    $writer.Write([byte[]]$fileEntry.Hash)

                    $input = [System.IO.File]::OpenRead($file.FullName)
                    try {
                        while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                            $writer.Write($buffer, 0, $read)
                        }
                    }
                    finally {
                        $input.Dispose()
                    }
                }
            }
            finally {
                $writer.Dispose()
            }
        }
        finally {
            $gzip.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    $package = Get-Item -LiteralPath $PackagePath
    Write-Host "Created compressed installer payload: $($package.FullName) ($([Math]::Round($package.Length / 1MB, 2)) MB compressed, $([Math]::Round($totalBytes / 1MB, 2)) MB unpacked)"
}

Assert-Command 'cmake'
Assert-Command 'ctest'
Assert-Command 'cargo'
Assert-Command 'rustc'
Assert-Command 'pwsh'
Assert-Command $TauriPackageManager
if ($Target -eq 'Release' -and [string]::IsNullOrWhiteSpace($Runtime)) {
    throw "Installer publish requires a runtime because FluxoraSetup.exe is self-contained. Example: -Runtime win-x64"
}

if (-not (Test-Path -LiteralPath (Join-Path $BackendSource 'CMakeLists.txt'))) {
    throw "Backend CMake project was not found at '$BackendSource'."
}

if (-not (Test-Path -LiteralPath (Join-Path $TauriProject 'package.json'))) {
    throw "Tauri frontend project was not found at '$TauriProject'."
}

if (-not (Test-Path -LiteralPath $TauriUpdaterConfigPath -PathType Leaf)) {
    throw "Tauri updater configuration was not found at '$TauriUpdaterConfigPath'."
}

if (-not (Test-Path -LiteralPath $TauriSetupConfigPath -PathType Leaf)) {
    throw "Tauri Setup configuration was not found at '$TauriSetupConfigPath'."
}

Assert-ChildPath -Path $OutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $OutputDownloadsDir -ParentPath $OutputDir
Assert-ChildPath -Path $SymbolsOutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerOutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerPayloadPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $PayloadManifestPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerManifestPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $TauriNativeResourcesRoot -ParentPath $ProjectRoot
Assert-ChildPath -Path $TauriNativeResourcesDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $TauriSpeechResourcesDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $FluxoraSkillsSourceDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $FluxoraAiSkillsOutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $PreservedDownloadsStagingDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $WebView2BootstrapperPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $WebView2BootstrapperMetadataPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $DesktopComplianceScriptPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $CMakeDependencyEvidencePath -ParentPath $ProjectRoot

Invoke-BuildStep "Preparing output folders" {
    New-Item -ItemType Directory -Path $BuildCacheDir -Force | Out-Null

    if (Test-Path -LiteralPath $PreservedDownloadsStagingDir) {
        if (Test-Path -LiteralPath $OutputDownloadsDir) {
            throw "Both the live and staged Downloads directories exist. Resolve '$OutputDownloadsDir' and '$PreservedDownloadsStagingDir' before building."
        }
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
        Move-Item -LiteralPath $PreservedDownloadsStagingDir -Destination $OutputDownloadsDir
        Write-Warning "Recovered Downloads preserved by an interrupted earlier build."
    }

    if ((Test-Path -LiteralPath $OutputDir) -and (-not $NoClean)) {
        $downloadsWereStaged = $false
        try {
            if (Test-Path -LiteralPath $OutputDownloadsDir) {
                $downloadsItem = Get-Item -LiteralPath $OutputDownloadsDir -Force
                if (($downloadsItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing to preserve output Downloads because it is a reparse point: '$OutputDownloadsDir'."
                }
                Move-Item -LiteralPath $OutputDownloadsDir -Destination $PreservedDownloadsStagingDir
                $downloadsWereStaged = $true
            }
            Remove-Item -LiteralPath $OutputDir -Recurse -Force
            New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
        }
        finally {
            if ($downloadsWereStaged -and (Test-Path -LiteralPath $PreservedDownloadsStagingDir)) {
                New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
                Move-Item -LiteralPath $PreservedDownloadsStagingDir -Destination $OutputDownloadsDir
            }
        }
    }

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    New-Item -ItemType Directory -Path $OutputDownloadsDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $OutputDir 'logs') -Force | Out-Null

    if ($IncludeSymbols) {
        if ((Test-Path -LiteralPath $SymbolsOutputDir) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $SymbolsOutputDir -Recurse -Force
        }

        New-Item -ItemType Directory -Path $SymbolsOutputDir -Force | Out-Null
    }

}

Invoke-BuildStep "Configuring C++ backend" {
    $backendConfigureArgs = @('-S', $BackendSource, '-B', $BackendBuild)
    $backendConfigureArgs += @(
        "-DFLUXORA_PRODUCT_VERSION=$FluxoraProductVersion",
        '-DFLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF'
    )
    if ($Runtime -like 'win-*') {
        $backendConfigureArgs += @(
            '-DFLUXORA_ENABLE_VFS=ON',
            '-DFLUXORA_ENABLE_MODDINGFLOW_AUTH_PROVIDER=ON'
        )
    }

    Invoke-CheckedCommand -FilePath 'cmake' -Arguments $backendConfigureArgs

    $cmakeCachePath = Join-Path $BackendBuild 'CMakeCache.txt'
    $cmakeCache = Get-Content -LiteralPath $cmakeCachePath -Raw
    $isMultiConfigGenerator = $cmakeCache -match '(?m)^CMAKE_CONFIGURATION_TYPES(:[A-Z]+)?='

    if (-not $isMultiConfigGenerator) {
        Invoke-CheckedCommand -FilePath 'cmake' -Arguments ($backendConfigureArgs + @("-DCMAKE_BUILD_TYPE=$Configuration"))
    }
}

Invoke-BuildStep "Building C++ backend ($Configuration)" {
    # Build every target (FluxoraCore, the FluxoraVfs hook DLL and Detours) so the
    # virtual file system ships alongside the core.
    Invoke-CheckedCommand -FilePath 'cmake' -Arguments @('--build', $BackendBuild, '--config', $Configuration)
}

if ($Runtime -like 'win-*') {
    Invoke-BuildStep "Testing FluxoraBridgeHost protocol ($Configuration)" {
        Invoke-CheckedCommand -FilePath 'ctest' -Arguments @(
            '--test-dir', $BackendBuild,
            '-C', $Configuration,
            '--output-on-failure',
            '--no-tests=error',
            '-R', '^FluxoraBridgeHostProtocol(Timeout)?$'
        )
    }
}

Invoke-BuildStep "Installing Tauri dependencies" {
    Push-Location $TauriProject
    try {
        Invoke-CheckedCommand -FilePath $TauriPackageManager -Arguments $TauriInstallArguments
    }
    finally {
        Pop-Location
    }
}

Invoke-BuildStep "Verifying desktop legal, dependency, and icon compliance" {
    Invoke-CheckedCommand -FilePath 'pwsh' -Arguments @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', $DesktopComplianceScriptPath,
        '-Release',
        '-CMakeEvidencePath', $CMakeDependencyEvidencePath
    )
}

$nativeInstallerCoreLibraryPath = $null
if ($Runtime -eq 'win-x64') {
    $nativeInstallerCoreLibraryPath = Get-NativeInstallerCoreLibraryPath
    Invoke-BuildStep "Building native Tauri updater ($Configuration/$Runtime)" {
        # Cargo resolves build scripts for the crate's dependency graph before
        # dead-code elimination, so the isolated updater target still needs the
        # pinned libclang runtime used by whisper-rs-sys/bindgen.
        & (Join-Path $TauriProject 'scripts\ensure-libclang.ps1')
        Push-Location $TauriProject
        try {
            Invoke-CheckedCommand -FilePath $TauriPackageManager -Arguments @(
                'run', 'build:updater:frontend'
            )
        }
        finally {
            Pop-Location
        }

        $previousInstallerCoreLibDir = [Environment]::GetEnvironmentVariable(
            'FLUXORA_INSTALLER_CORE_LIB_DIR',
            'Process')
        $installerRustFlagsVariable = 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS'
        $previousInstallerRustFlags = [Environment]::GetEnvironmentVariable(
            $installerRustFlagsVariable,
            'Process')
        try {
            $env:FLUXORA_INSTALLER_CORE_LIB_DIR = Split-Path -Parent $nativeInstallerCoreLibraryPath
            $staticCrtFlag = '-C target-feature=+crt-static'
            if ([string]::IsNullOrWhiteSpace($previousInstallerRustFlags)) {
                [Environment]::SetEnvironmentVariable(
                    $installerRustFlagsVariable,
                    $staticCrtFlag,
                    'Process')
            }
            elseif ($previousInstallerRustFlags -notmatch '(?:^|\s)-C\s+target-feature=\+crt-static(?:\s|$)') {
                [Environment]::SetEnvironmentVariable(
                    $installerRustFlagsVariable,
                    "$previousInstallerRustFlags $staticCrtFlag",
                    'Process')
            }
            $updaterCargoArguments = @(
                'build',
                '--manifest-path', $TauriCargoManifestPath,
                '--locked',
                '--bin', 'FluxoraUpdater',
                '--features', 'installer-native,custom-protocol'
            ) + $TauriCargoProfileArguments
            $updaterReleaseContractArguments = @(
                'test',
                '--manifest-path', $TauriCargoManifestPath,
                '--locked',
                '--release',
                '--features', 'installer-native,custom-protocol',
                '--bin', 'FluxoraUpdater'
            )
            Invoke-CheckedCommand -FilePath 'cargo' -Arguments $updaterReleaseContractArguments
            Invoke-CheckedCommand -FilePath 'cargo' -Arguments $updaterCargoArguments
        }
        finally {
            if ($null -eq $previousInstallerCoreLibDir) {
                Remove-Item Env:FLUXORA_INSTALLER_CORE_LIB_DIR -ErrorAction SilentlyContinue
            }
            else {
                $env:FLUXORA_INSTALLER_CORE_LIB_DIR = $previousInstallerCoreLibDir
            }
            if ($null -eq $previousInstallerRustFlags) {
                Remove-Item -LiteralPath "Env:$installerRustFlagsVariable" -ErrorAction SilentlyContinue
            }
            else {
                [Environment]::SetEnvironmentVariable(
                    $installerRustFlagsVariable,
                    $previousInstallerRustFlags,
                    'Process')
            }
        }

        if (-not (Test-Path -LiteralPath $UpdaterExecutablePath -PathType Leaf)) {
            throw "Updater build completed, but $TauriUpdaterExecutableName was not found at '$UpdaterExecutablePath'."
        }
        Assert-FluxoraNativePeImage `
            -Path $UpdaterExecutablePath `
            -RequireStaticMsvcRuntime
    }
}

$tauriTarget = Get-TauriPackageTarget
$tauriNativeTargetDir = Join-Path $TauriNativeResourcesRoot (Join-Path $tauriTarget.Platform $tauriTarget.Arch)
Assert-ChildPath -Path $tauriNativeTargetDir -ParentPath $ProjectRoot

Invoke-BuildStep "Preparing Tauri native resources ($($tauriTarget.Platform)/$($tauriTarget.Arch))" {
        if ((Test-Path -LiteralPath $TauriNativeResourcesRoot) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $TauriNativeResourcesRoot -Recurse -Force
        }
        if ((Test-Path -LiteralPath $TauriNativeResourcesDir) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $TauriNativeResourcesDir -Recurse -Force
        }
        if ((Test-Path -LiteralPath $TauriSpeechResourcesDir) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $TauriSpeechResourcesDir -Recurse -Force
        }

        New-Item -ItemType Directory -Path $tauriNativeTargetDir -Force | Out-Null
        New-Item -ItemType Directory -Path $TauriNativeResourcesDir -Force | Out-Null

        $nativeBridgeHostPath = Get-NativeBridgeHostPath
        $nativeCorePath = Get-NativeCorePath
        & (Join-Path $TauriProject 'scripts\stage-speech-resources.ps1')
        $aiHostPath = Build-TauriAiHost
        $aiHostResourceName = Get-TauriAiHostResourceName
        $speechHostPath = Get-TauriSpeechHostPath
        $speechHostResourceName = Get-TauriSpeechHostResourceName
        $vulkanSpeechHostPath = Get-TauriVulkanSpeechHostPath
        $vulkanSpeechHostResourceName = Get-TauriVulkanSpeechHostResourceName
        Copy-Item -LiteralPath $nativeBridgeHostPath -Destination $tauriNativeTargetDir -Force
        Copy-Item -LiteralPath $nativeCorePath -Destination $tauriNativeTargetDir -Force
        Copy-Item -LiteralPath $aiHostPath -Destination (Join-Path $tauriNativeTargetDir $aiHostResourceName) -Force
        Copy-Item -LiteralPath $speechHostPath -Destination (Join-Path $tauriNativeTargetDir $speechHostResourceName) -Force
        Copy-Item -LiteralPath $vulkanSpeechHostPath -Destination (Join-Path $tauriNativeTargetDir $vulkanSpeechHostResourceName) -Force
        Copy-Item -LiteralPath $nativeBridgeHostPath -Destination $TauriNativeResourcesDir -Force
        Copy-Item -LiteralPath $nativeCorePath -Destination $TauriNativeResourcesDir -Force
        if ($Runtime -eq 'win-x64') {
            Copy-Item -LiteralPath $UpdaterExecutablePath -Destination $tauriNativeTargetDir -Force
            Copy-Item -LiteralPath $UpdaterExecutablePath -Destination $TauriNativeResourcesDir -Force
        }
        Copy-Item -LiteralPath $aiHostPath -Destination (Join-Path $TauriNativeResourcesDir $aiHostResourceName) -Force
        Copy-Item -LiteralPath $speechHostPath -Destination (Join-Path $TauriNativeResourcesDir $speechHostResourceName) -Force
        Copy-Item -LiteralPath $vulkanSpeechHostPath -Destination (Join-Path $TauriNativeResourcesDir $vulkanSpeechHostResourceName) -Force

        $nativeBridgeHostPdbPath = [System.IO.Path]::ChangeExtension($nativeBridgeHostPath, '.pdb')
        if ($IncludeSymbols -and (Copy-FluxoraSymbolFile -Path $nativeBridgeHostPdbPath -DestinationDirectory (Join-Path $SymbolsOutputDir 'native'))) {
            Write-Host "Copied native symbol: $nativeBridgeHostPdbPath"
        }

        $nativeCorePdbPath = [System.IO.Path]::ChangeExtension($nativeCorePath, '.pdb')
        if ($IncludeSymbols -and (Copy-FluxoraSymbolFile -Path $nativeCorePdbPath -DestinationDirectory (Join-Path $SymbolsOutputDir 'native'))) {
            Write-Host "Copied native symbol: $nativeCorePdbPath"
        }

        # The injected virtual file system hook must sit next to FluxoraCore.dll so the
        # core can locate and inject it when launching a game.
        $nativeVfsPath = Get-NativeVfsPath
        if ((-not $nativeVfsPath) -and ($Runtime -like 'win-*')) {
            throw "FluxoraVfs.dll was not found; Windows Fluxora builds require the VFS hook. Reconfigure the backend with -DFLUXORA_ENABLE_VFS=ON and rebuild."
        }

        if ($nativeVfsPath) {
            Copy-Item -LiteralPath $nativeVfsPath -Destination $tauriNativeTargetDir -Force
            Copy-Item -LiteralPath $nativeVfsPath -Destination $TauriNativeResourcesDir -Force

            $nativeVfsPdbPath = [System.IO.Path]::ChangeExtension($nativeVfsPath, '.pdb')
            if ($IncludeSymbols -and (Copy-FluxoraSymbolFile -Path $nativeVfsPdbPath -DestinationDirectory (Join-Path $SymbolsOutputDir 'native'))) {
                Write-Host "Copied native symbol: $nativeVfsPdbPath"
            }
        }
        else {
            Write-Warning "FluxoraVfs.dll was not found for this non-Windows package."
        }
}

if ($Runtime -like 'win-*') {
    Invoke-BuildStep "Testing native Fluxora AI task integration ($Configuration)" {
        $tauriRustRoot = Join-Path $TauriProject 'src-tauri'
        $previousBridgeHostPath = [Environment]::GetEnvironmentVariable('FLUXORA_BRIDGE_HOST_PATH', 'Process')
        try {
            $env:FLUXORA_BRIDGE_HOST_PATH = Get-NativeBridgeHostPath
            Push-Location $tauriRustRoot
            try {
                Invoke-CheckedCommand -FilePath 'cargo' -Arguments @(
                    'test', '--release', '--locked',
                    '--features', 'native-ai-integration-fixture',
                    '--test', 'ai_task_native_integration',
                    '--', '--nocapture'
                )
            }
            finally {
                Pop-Location
            }
        }
        finally {
            if ($null -eq $previousBridgeHostPath) {
                Remove-Item Env:FLUXORA_BRIDGE_HOST_PATH -ErrorAction SilentlyContinue
            }
            else {
                $env:FLUXORA_BRIDGE_HOST_PATH = $previousBridgeHostPath
            }
        }
    }
}

Invoke-BuildStep "Packaging Tauri app ($($tauriTarget.Platform)/$($tauriTarget.Arch))" {
        Push-Location $TauriProject
        try {
            Invoke-CheckedCommand -FilePath $TauriPackageManager -Arguments @('run', 'build')
        }
        finally {
            Pop-Location
        }

        $tauriExePath = Get-TauriBuiltExecutablePath
        Copy-Item -LiteralPath $tauriExePath -Destination (Join-Path $OutputDir $TauriExecutableName) -Force
        New-Item -ItemType Directory -Path (Join-Path $OutputDir 'resources\native') -Force | Out-Null
        Copy-DirectoryContents -SourceDirectory $TauriNativeResourcesDir -DestinationDirectory (Join-Path $OutputDir 'resources\native')
        New-Item -ItemType Directory -Path (Join-Path $OutputDir 'resources\speech') -Force | Out-Null
        Copy-DirectoryContents -SourceDirectory $TauriSpeechResourcesDir -DestinationDirectory (Join-Path $OutputDir 'resources\speech')
        New-Item -ItemType Directory -Path $FluxoraAiSkillsOutputDir -Force | Out-Null
        Copy-DirectoryContents -SourceDirectory $FluxoraSkillsSourceDir -DestinationDirectory $FluxoraAiSkillsOutputDir

        $packagedBridgeHostPath = Join-Path $OutputDir 'resources\native\FluxoraBridgeHost.exe'
        $packagedAiHostPath = Join-Path $OutputDir 'resources\native\FluxoraAIHost.exe'
        $packagedSpeechHostPath = Join-Path $OutputDir 'resources\native\FluxoraSpeechHost.exe'
        $packagedVulkanSpeechHostPath = Join-Path $OutputDir 'resources\native\FluxoraSpeechHostVulkan.exe'
        $packagedCorePath = Join-Path $OutputDir 'resources\native\FluxoraCore.dll'
        $packagedVfsPath = Join-Path $OutputDir 'resources\native\FluxoraVfs.dll'
        $packagedUpdaterPath = Join-Path $OutputDir 'resources\native\FluxoraUpdater.exe'
        $packagedGeneralSkillPath = Join-Path $FluxoraAiSkillsOutputDir 'GENERAL\ConciseResponse\SKILL.MD'
        $packagedSkyrimDefaultSkillPath = Join-Path $FluxoraAiSkillsOutputDir 'SkyrimSE\DefaultRules\SKILL.MD'
        $packagedSkyrimOptimizationSkillPath = Join-Path $FluxoraAiSkillsOutputDir 'SkyrimSE\BuildOptimization\SKILL.MD'
        if (-not (Test-Path -LiteralPath $packagedBridgeHostPath -PathType Leaf)) {
            throw "Tauri package is missing bundled native bridge host at '$packagedBridgeHostPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedAiHostPath -PathType Leaf)) {
            throw "Tauri package is missing bundled AI host at '$packagedAiHostPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedSpeechHostPath -PathType Leaf)) {
            throw "Tauri package is missing bundled speech host at '$packagedSpeechHostPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedVulkanSpeechHostPath -PathType Leaf)) {
            throw "Tauri package is missing bundled Vulkan speech host at '$packagedVulkanSpeechHostPath'."
        }
        $speechManifestPath = Join-Path $OutputDir 'resources\speech\manifest.json'
        if (-not (Test-Path -LiteralPath $speechManifestPath -PathType Leaf)) {
            throw "Tauri package is missing the offline speech manifest at '$speechManifestPath'."
        }
        $speechManifest = Get-Content -LiteralPath $speechManifestPath -Raw | ConvertFrom-Json
        foreach ($speechAsset in @($speechManifest.model, $speechManifest.vad)) {
            $speechAssetPath = Join-Path $OutputDir (Join-Path 'resources\speech\models' $speechAsset.fileName)
            if (-not (Test-Path -LiteralPath $speechAssetPath -PathType Leaf)) {
                throw "Tauri package is missing offline speech asset '$speechAssetPath'."
            }
            $actualSpeechHash = Get-FileSha256Hex -Path $speechAssetPath
            if (-not [string]::Equals($actualSpeechHash, $speechAsset.sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Packaged speech asset hash mismatch for '$speechAssetPath'."
            }
        }
        if (-not (Test-Path -LiteralPath $packagedCorePath -PathType Leaf)) {
            throw "Tauri package is missing bundled native core at '$packagedCorePath'."
        }
        if ($Runtime -eq 'win-x64') {
            if (-not (Test-Path -LiteralPath $packagedUpdaterPath -PathType Leaf)) {
                throw "Tauri package is missing the external updater at '$packagedUpdaterPath'."
            }
        }
        if (($Runtime -like 'win-*') -and (-not (Test-Path -LiteralPath $packagedVfsPath -PathType Leaf))) {
            throw "Tauri package is missing bundled VFS hook at '$packagedVfsPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedGeneralSkillPath -PathType Leaf)) {
            throw "Fluxora AI skills package is missing bundled GENERAL skill at '$packagedGeneralSkillPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedSkyrimDefaultSkillPath -PathType Leaf)) {
            throw "Fluxora AI skills package is missing bundled SkyrimSE default skill at '$packagedSkyrimDefaultSkillPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedSkyrimOptimizationSkillPath -PathType Leaf)) {
            throw "Fluxora AI skills package is missing bundled SkyrimSE optimization skill at '$packagedSkyrimOptimizationSkillPath'."
        }
}

Invoke-BuildStep "Removing symbols from app payload staging" {
    $removedSymbolCount = Remove-FluxoraPayloadSymbols -SourceDirectory $OutputDir
    if ($removedSymbolCount -gt 0) {
        Write-Host "Removed $removedSymbolCount symbol file(s) from app payload staging."
    }
    else {
        Write-Host "No symbol files found in app payload staging."
    }
    if ($Runtime -like 'win-*') {
        Assert-FluxoraNativePayload -Root $OutputDir
    }
}

$payloadExecutableName = $TauriExecutableName
$appExePath = Join-Path $OutputDir $payloadExecutableName
if (-not (Test-Path -LiteralPath $appExePath)) {
    throw "Build completed, but $payloadExecutableName was not found in '$OutputDir'."
}

if ($Target -eq 'Release') {
    Invoke-BuildStep "Creating installer payload" {
        $currentPayloadManifest = New-FluxoraPayloadManifest -SourceDirectory $OutputDir
        $savedPayloadManifest = Read-FluxoraManifest -Path $PayloadManifestPath
        $payloadPackageCanSkip = $false

        if ((Test-Path -LiteralPath $InstallerPayloadPath) -and
            (Test-FluxoraManifestHashMatches -SavedManifest $savedPayloadManifest -CurrentManifest $currentPayloadManifest)) {
            $savedPackageSha256 = Get-FluxoraManifestPropertyValue -Manifest $savedPayloadManifest -Name 'PackageSha256'
            if (-not [string]::IsNullOrWhiteSpace($savedPackageSha256)) {
                $currentPackageSha256 = Get-FileSha256Hex -Path $InstallerPayloadPath
                $payloadPackageCanSkip = [string]::Equals(
                    [string]$savedPackageSha256,
                    [string]$currentPackageSha256,
                    [System.StringComparison]::OrdinalIgnoreCase)
            }
        }

        if ($payloadPackageCanSkip) {
            Write-Host "Payload inputs unchanged; skipping package: $InstallerPayloadPath"
        }
        else {
            Write-FluxoraPayloadPackage -SourceDirectory $OutputDir -PackagePath $InstallerPayloadPath
            $currentPayloadManifest.PackageSha256 = Get-FileSha256Hex -Path $InstallerPayloadPath
            Save-FluxoraManifest -Path $PayloadManifestPath -Manifest $currentPayloadManifest
        }
    }

    Invoke-BuildStep "Building Fluxora Tauri Setup ($Configuration)" {
        if (-not (Test-Path -LiteralPath $InstallerPayloadPath)) {
            throw "Installer payload '$InstallerPayloadPath' was not found."
        }

        $webView2Metadata = Assert-FluxoraWebView2Bootstrapper
        $nativeInstallerCoreLibraryPath = Get-NativeInstallerCoreLibraryPath
        Write-Host "Using statically linked installer core: $nativeInstallerCoreLibraryPath"
        Write-Host "Using pinned Microsoft WebView2 bootstrapper SHA-256: $($webView2Metadata.sha256)"

        $setupCargoArguments = @(
            'build',
            '--manifest-path', $TauriCargoManifestPath,
            '--locked',
            '--bin', 'FluxoraSetup',
            '--features', 'setup-production-assets,installer-native,custom-protocol'
        ) + $TauriCargoProfileArguments

        $setupExePath = Join-Path $InstallerOutputDir 'FluxoraSetup.exe'
        $payloadPackageSha256 = Get-FileSha256Hex -Path $InstallerPayloadPath
        $payloadBuildManifest = Read-FluxoraManifest -Path $PayloadManifestPath
        $payloadExpandedBytesValue = Get-FluxoraManifestPropertyValue `
            -Manifest $payloadBuildManifest `
            -Name 'TotalBytes'
        $payloadExpandedBytes = [UInt64]0
        if ($null -eq $payloadExpandedBytesValue -or
            -not [UInt64]::TryParse(
                [string]$payloadExpandedBytesValue,
                [Globalization.NumberStyles]::None,
                [Globalization.CultureInfo]::InvariantCulture,
                [ref]$payloadExpandedBytes) -or
            $payloadExpandedBytes -eq 0) {
            throw "Payload manifest '$PayloadManifestPath' does not contain a trusted positive TotalBytes value."
        }
        $currentInstallerManifest = New-FluxoraSetupManifest `
            -PayloadSha256 $payloadPackageSha256 `
            -PayloadExpandedBytes $payloadExpandedBytes `
            -NativeInstallerCoreLibraryPath $nativeInstallerCoreLibraryPath `
            -BuildArgs $setupCargoArguments
        $savedInstallerManifest = Read-FluxoraManifest -Path $InstallerManifestPath
        $installerCanSkip = $false

        if ((Test-Path -LiteralPath $setupExePath) -and
            (Test-FluxoraManifestHashMatches -SavedManifest $savedInstallerManifest -CurrentManifest $currentInstallerManifest)) {
            $savedSetupSha256 = Get-FluxoraManifestPropertyValue -Manifest $savedInstallerManifest -Name 'SetupSha256'
            if (-not [string]::IsNullOrWhiteSpace($savedSetupSha256)) {
                $currentSetupSha256 = Get-FileSha256Hex -Path $setupExePath
                $installerCanSkip = [string]::Equals(
                    [string]$savedSetupSha256,
                    [string]$currentSetupSha256,
                    [System.StringComparison]::OrdinalIgnoreCase)
            }
        }

        if ($installerCanSkip) {
            $existingInstallerFiles = @(
                Get-ChildItem -LiteralPath $InstallerOutputDir -File -Recurse -Force -ErrorAction SilentlyContinue
            )
            if ($existingInstallerFiles.Count -ne 1 -or
                -not [string]::Equals(
                    $existingInstallerFiles[0].FullName,
                    [System.IO.Path]::GetFullPath($setupExePath),
                    [System.StringComparison]::OrdinalIgnoreCase)) {
                $installerCanSkip = $false
            }
        }

        if ($installerCanSkip) {
            Write-Host "Setup inputs unchanged; skipping build: $setupExePath"
        }
        else {
            if ((Test-Path -LiteralPath $InstallerOutputDir) -and (-not $NoClean)) {
                Remove-Item -LiteralPath $InstallerOutputDir -Recurse -Force
            }
            New-Item -ItemType Directory -Path $InstallerOutputDir -Force | Out-Null

            Push-Location $TauriProject
            try {
                Invoke-CheckedCommand -FilePath $TauriPackageManager -Arguments @(
                    'run', 'build:setup:frontend'
                )
            }
            finally {
                Pop-Location
            }

            $previousInstallerCoreLibDir = [Environment]::GetEnvironmentVariable(
                'FLUXORA_INSTALLER_CORE_LIB_DIR',
                'Process')
            $previousSetupPayloadPath = [Environment]::GetEnvironmentVariable(
                'FLUXORA_SETUP_PAYLOAD_PATH',
                'Process')
            $previousSetupPayloadExpandedBytes = [Environment]::GetEnvironmentVariable(
                'FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES',
                'Process')
            $previousWebView2BootstrapperPath = [Environment]::GetEnvironmentVariable(
                'FLUXORA_WEBVIEW2_BOOTSTRAPPER_PATH',
                'Process')
            $installerRustFlagsVariable = 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS'
            $previousInstallerRustFlags = [Environment]::GetEnvironmentVariable(
                $installerRustFlagsVariable,
                'Process')
            try {
                $env:FLUXORA_INSTALLER_CORE_LIB_DIR = Split-Path -Parent $nativeInstallerCoreLibraryPath
                $env:FLUXORA_SETUP_PAYLOAD_PATH = [System.IO.Path]::GetFullPath($InstallerPayloadPath)
                $env:FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES = $payloadExpandedBytes.ToString(
                    [Globalization.CultureInfo]::InvariantCulture)
                $env:FLUXORA_WEBVIEW2_BOOTSTRAPPER_PATH = [System.IO.Path]::GetFullPath($WebView2BootstrapperPath)
                $staticCrtFlag = '-C target-feature=+crt-static'
                if ([string]::IsNullOrWhiteSpace($previousInstallerRustFlags)) {
                    [Environment]::SetEnvironmentVariable(
                        $installerRustFlagsVariable,
                        $staticCrtFlag,
                        'Process')
                }
                elseif ($previousInstallerRustFlags -notmatch '(?:^|\s)-C\s+target-feature=\+crt-static(?:\s|$)') {
                    [Environment]::SetEnvironmentVariable(
                        $installerRustFlagsVariable,
                        "$previousInstallerRustFlags $staticCrtFlag",
                        'Process')
                }
                $setupReleaseContractArguments = @(
                    'test',
                    '--manifest-path', $TauriCargoManifestPath,
                    '--locked',
                    '--release',
                    '--features', 'setup-production-assets,installer-native,custom-protocol',
                    '--bin', 'FluxoraSetup'
                )
                Invoke-CheckedCommand -FilePath 'cargo' -Arguments $setupReleaseContractArguments
                Invoke-CheckedCommand -FilePath 'cargo' -Arguments $setupCargoArguments
            }
            finally {
                foreach ($environmentEntry in @(
                    [pscustomobject]@{
                        Name = 'FLUXORA_INSTALLER_CORE_LIB_DIR'
                        Value = $previousInstallerCoreLibDir
                    },
                    [pscustomobject]@{
                        Name = 'FLUXORA_SETUP_PAYLOAD_PATH'
                        Value = $previousSetupPayloadPath
                    },
                    [pscustomobject]@{
                        Name = 'FLUXORA_SETUP_PAYLOAD_EXPANDED_BYTES'
                        Value = $previousSetupPayloadExpandedBytes
                    },
                    [pscustomobject]@{
                        Name = 'FLUXORA_WEBVIEW2_BOOTSTRAPPER_PATH'
                        Value = $previousWebView2BootstrapperPath
                    },
                    [pscustomobject]@{
                        Name = $installerRustFlagsVariable
                        Value = $previousInstallerRustFlags
                    })) {
                    if ($null -eq $environmentEntry.Value) {
                        Remove-Item -LiteralPath "Env:$($environmentEntry.Name)" -ErrorAction SilentlyContinue
                    }
                    else {
                        [Environment]::SetEnvironmentVariable(
                            $environmentEntry.Name,
                            [string]$environmentEntry.Value,
                            'Process')
                    }
                }
            }

            if (-not (Test-Path -LiteralPath $SetupExecutablePath -PathType Leaf)) {
                throw "Setup build completed, but $TauriSetupExecutableName was not found at '$SetupExecutablePath'."
            }
            Copy-Item -LiteralPath $SetupExecutablePath -Destination $setupExePath -Force

            $currentInstallerManifest.SetupSha256 = Get-FileSha256Hex -Path $setupExePath
            Save-FluxoraManifest -Path $InstallerManifestPath -Manifest $currentInstallerManifest
        }

        $publishedInstallerFiles = @(
            Get-ChildItem -LiteralPath $InstallerOutputDir -File -Recurse -Force -ErrorAction SilentlyContinue
        )
        if ($publishedInstallerFiles.Count -ne 1 -or
            -not [string]::Equals(
                $publishedInstallerFiles[0].FullName,
                [System.IO.Path]::GetFullPath($setupExePath),
                [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "The approved installer directory must contain only '$setupExePath'."
        }
        Assert-FluxoraNativePeImage `
            -Path $setupExePath `
            -RequireStaticMsvcRuntime
    }
}
else {
    Write-Host ""
    Write-Host "Fast dev target selected; skipping installer payload and installer publish."
}

Write-Host ""
Write-Host "Done. Project outputs are ready:"
Write-Host "  Frontend payload: Tauri"
Write-Host "  Build target: $Target"
Write-Host "  App payload staging: $OutputDir"
Write-Host "  Fluxora AI skills: $FluxoraAiSkillsOutputDir"
Write-Host "  Tauri native resources: $TauriNativeResourcesRoot"
if ($Runtime -eq 'win-x64') {
    Write-Host "  External updater: $UpdaterExecutablePath"
}
if ($IncludeSymbols) {
    Write-Host "  Symbols artifact: $SymbolsOutputDir"
}
else {
    Write-Host "  Symbols artifact: skipped (-IncludeSymbols not set)"
}
if ($Target -eq 'Release') {
    Write-Host "  Installer payload: $InstallerPayloadPath"
    Write-Host "  Installer: $InstallerOutputDir"
}
else {
    Write-Host "  Installer: skipped (-Target Dev)"
}
