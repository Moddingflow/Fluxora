[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Configuration = 'Release',

    [string]$Runtime = 'win-x64',

    [ValidateSet('Dev', 'Release')]
    [string]$Target = 'Release',

    [switch]$IncludeSymbols,

    [switch]$NoClean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = $PSScriptRoot
$BackendSource = Join-Path $ProjectRoot 'backend'
$BackendBuild = Join-Path $ProjectRoot 'build\backend'
$ElectronProject = Join-Path $ProjectRoot 'frontend-electron'
$ElectronNativeResourcesRoot = Join-Path $ProjectRoot 'build\electron-native'
$ElectronExecutableName = 'Fluxora.exe'
$InstallerProject = Join-Path $ProjectRoot 'installer\Fluxora.Installer\Fluxora.Installer.csproj'
$OutputDir = Join-Path $ProjectRoot 'output'
$SymbolsOutputDir = Join-Path $ProjectRoot 'output-symbols'
$InstallerOutputDir = Join-Path $ProjectRoot 'output-installer'
$InstallerPayloadDir = Join-Path $ProjectRoot 'installer\Fluxora.Installer\Resources\Payload'
$InstallerPayloadPath = Join-Path $InstallerPayloadDir 'FluxoraPayload.flxpkg.gz'
$BuildCacheDir = Join-Path $ProjectRoot 'build\installer-cache'
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

function Get-ElectronPackageTarget {
    if ($Runtime -eq 'win-x64') {
        return [pscustomobject]@{ Platform = 'win32'; Arch = 'x64' }
    }

    throw "Build.ps1 assembles the Windows FluxoraSetup.exe installer. Electron installer payload builds currently support -Runtime win-x64."
}

function Get-ElectronPackagedAppDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Platform,

        [Parameter(Mandatory = $true)]
        [string]$Arch
    )

    $outDir = Join-Path $ElectronProject 'out'
    $knownPath = Join-Path $outDir "Fluxora-$Platform-$Arch"
    $knownExePath = Join-Path $knownPath $ElectronExecutableName
    if (Test-Path -LiteralPath $knownExePath -PathType Leaf) {
        return $knownPath
    }

    $latestPackage = Get-ChildItem -LiteralPath $outDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $ElectronExecutableName) -PathType Leaf } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestPackage) {
        return $latestPackage.FullName
    }

    throw "Electron package output containing '$ElectronExecutableName' was not found under '$outDir'."
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

function Get-NativeInstallerCorePath {
    $knownPaths = @(
        (Join-Path $BackendBuild "$Configuration\FluxoraInstallerCore.dll"),
        (Join-Path $BackendBuild 'FluxoraInstallerCore.dll')
    )

    foreach ($path in $knownPaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    $latestDll = Get-ChildItem -LiteralPath $BackendBuild -Recurse -Filter 'FluxoraInstallerCore.dll' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($latestDll) {
        return $latestDll.FullName
    }

    throw "FluxoraInstallerCore.dll was not found under '$BackendBuild'."
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

    return ($RelativePath -like 'logs/*.log') -or ($RelativePath -like '*.pdb')
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

function New-FluxoraInstallerManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PayloadSha256,

        [Parameter(Mandatory = $true)]
        [string]$NativeInstallerCorePath,

        [Parameter(Mandatory = $true)]
        [string[]]$PublishArgs
    )

    $installerRoot = [System.IO.Path]::GetDirectoryName($InstallerProject)
    $candidatePaths = [System.Collections.Generic.List[string]]::new()

    Get-ChildItem -LiteralPath $installerRoot -File -Recurse -Force |
        Where-Object {
            $relative = Get-PortableRelativePath -Root $installerRoot -Path $_.FullName
            (-not ($relative -like 'bin/*')) -and
                (-not ($relative -like 'obj/*')) -and
                (-not ($relative -like 'Resources/Payload/*'))
        } |
        ForEach-Object { $candidatePaths.Add($_.FullName) }

    $linkedInputPaths = @(
        (Join-Path $ProjectRoot 'Icons\Fluxora.ico'),
        (Join-Path $ProjectRoot 'Icons\Fluxora.png'),
        (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Assets\Icons.xaml'),
        (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Controls\LineIcon.cs'),
        (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Models\AppTheme.cs'),
        (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Services\ProgressUpdateCoalescer.cs'),
        (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Services\WindowChromeService.cs'),
        $NativeInstallerCorePath
    )

    foreach ($path in $linkedInputPaths) {
        Add-FluxoraInstallerInputPath -Paths $candidatePaths -Path $path
    }

    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'installer\Fluxora.Installer\Fonts') -Filter '*.ttf' -File -ErrorAction SilentlyContinue |
        ForEach-Object { $candidatePaths.Add($_.FullName) }

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

    $dotnetVersion = (& dotnet --version) -join ''
    $hashInput = [System.Text.StringBuilder]::new()
    [void]$hashInput.AppendLine("FluxoraInstallerManifest|$BuildManifestVersion")
    [void]$hashInput.AppendLine("Payload|$PayloadSha256")
    [void]$hashInput.AppendLine("Configuration|$Configuration")
    [void]$hashInput.AppendLine("Runtime|$Runtime")
    [void]$hashInput.AppendLine("DotNet|$dotnetVersion")

    foreach ($arg in $PublishArgs) {
        [void]$hashInput.AppendLine("Arg|$arg")
    }

    foreach ($file in $fileEntries) {
        [void]$hashInput.AppendLine("F|$($file.Relative)|$($file.Length)|$($file.LastWriteTimeUtcTicks)|$($file.Sha256)")
    }

    return [pscustomobject]@{
        Version = $BuildManifestVersion
        Kind = 'FluxoraInstaller'
        PayloadSha256 = $PayloadSha256
        Configuration = $Configuration
        Runtime = $Runtime
        DotNetVersion = $dotnetVersion
        PublishArgs = @($PublishArgs)
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
Assert-Command 'dotnet'
Assert-Command 'npm'

if ($Target -eq 'Release' -and [string]::IsNullOrWhiteSpace($Runtime)) {
    throw "Installer publish requires a runtime because FluxoraSetup.exe is self-contained. Example: -Runtime win-x64"
}

if (-not (Test-Path -LiteralPath (Join-Path $BackendSource 'CMakeLists.txt'))) {
    throw "Backend CMake project was not found at '$BackendSource'."
}

if (-not (Test-Path -LiteralPath (Join-Path $ElectronProject 'package.json'))) {
    throw "Electron frontend project was not found at '$ElectronProject'."
}

if (-not (Test-Path -LiteralPath $InstallerProject)) {
    throw "Installer project was not found at '$InstallerProject'."
}

Assert-ChildPath -Path $OutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $SymbolsOutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerOutputDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerPayloadPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $PayloadManifestPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $InstallerManifestPath -ParentPath $ProjectRoot
Assert-ChildPath -Path $ElectronNativeResourcesRoot -ParentPath $ProjectRoot

Invoke-BuildStep "Preparing output folders" {
    if ((Test-Path -LiteralPath $OutputDir) -and (-not $NoClean)) {
        Remove-Item -LiteralPath $OutputDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $OutputDir 'logs') -Force | Out-Null

    if ($IncludeSymbols) {
        if ((Test-Path -LiteralPath $SymbolsOutputDir) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $SymbolsOutputDir -Recurse -Force
        }

        New-Item -ItemType Directory -Path $SymbolsOutputDir -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $InstallerPayloadDir -Filter '*.flxpkg' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

Invoke-BuildStep "Configuring C++ backend" {
    Invoke-CheckedCommand -FilePath 'cmake' -Arguments @('-S', $BackendSource, '-B', $BackendBuild)

    $cmakeCachePath = Join-Path $BackendBuild 'CMakeCache.txt'
    $cmakeCache = Get-Content -LiteralPath $cmakeCachePath -Raw
    $isMultiConfigGenerator = $cmakeCache -match '(?m)^CMAKE_CONFIGURATION_TYPES(:[A-Z]+)?='

    if (-not $isMultiConfigGenerator) {
        Invoke-CheckedCommand -FilePath 'cmake' -Arguments @('-S', $BackendSource, '-B', $BackendBuild, "-DCMAKE_BUILD_TYPE=$Configuration")
    }
}

Invoke-BuildStep "Building C++ backend ($Configuration)" {
    # Build every target (FluxoraCore, the FluxoraVfs hook DLL and Detours) so the
    # virtual file system ships alongside the core.
    Invoke-CheckedCommand -FilePath 'cmake' -Arguments @('--build', $BackendBuild, '--config', $Configuration)
}

$electronTarget = Get-ElectronPackageTarget
$electronNativeTargetDir = Join-Path $ElectronNativeResourcesRoot (Join-Path $electronTarget.Platform $electronTarget.Arch)
$electronOutDir = Join-Path $ElectronProject 'out'
Assert-ChildPath -Path $electronOutDir -ParentPath $ProjectRoot
Assert-ChildPath -Path $electronNativeTargetDir -ParentPath $ProjectRoot

Invoke-BuildStep "Preparing Electron native resources ($($electronTarget.Platform)/$($electronTarget.Arch))" {
        if ((Test-Path -LiteralPath $ElectronNativeResourcesRoot) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $ElectronNativeResourcesRoot -Recurse -Force
        }

        New-Item -ItemType Directory -Path $electronNativeTargetDir -Force | Out-Null

        $nativeBridgeHostPath = Get-NativeBridgeHostPath
        $nativeCorePath = Get-NativeCorePath
        Copy-Item -LiteralPath $nativeBridgeHostPath -Destination $electronNativeTargetDir -Force
        Copy-Item -LiteralPath $nativeCorePath -Destination $electronNativeTargetDir -Force

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
        if ($nativeVfsPath) {
            Copy-Item -LiteralPath $nativeVfsPath -Destination $electronNativeTargetDir -Force

            $nativeVfsPdbPath = [System.IO.Path]::ChangeExtension($nativeVfsPath, '.pdb')
            if ($IncludeSymbols -and (Copy-FluxoraSymbolFile -Path $nativeVfsPdbPath -DestinationDirectory (Join-Path $SymbolsOutputDir 'native'))) {
                Write-Host "Copied native symbol: $nativeVfsPdbPath"
            }
        }
        else {
            Write-Warning "FluxoraVfs.dll was not found; VFS launch will stay unavailable in this Electron package."
        }
}

Invoke-BuildStep "Installing Electron dependencies" {
        Push-Location $ElectronProject
        try {
            Invoke-CheckedCommand -FilePath 'npm' -Arguments @('ci', '--no-fund')
        }
        finally {
            Pop-Location
        }
}

Invoke-BuildStep "Packaging Electron app ($($electronTarget.Platform)/$($electronTarget.Arch))" {
        if ((Test-Path -LiteralPath $electronOutDir) -and (-not $NoClean)) {
            Remove-Item -LiteralPath $electronOutDir -Recurse -Force
        }

        $previousNativeResources = $env:FLUXORA_NATIVE_RESOURCES
        Push-Location $ElectronProject
        try {
            $env:FLUXORA_NATIVE_RESOURCES = $ElectronNativeResourcesRoot
            Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'build')
        }
        finally {
            if ($null -eq $previousNativeResources) {
                Remove-Item Env:\FLUXORA_NATIVE_RESOURCES -ErrorAction SilentlyContinue
            }
            else {
                $env:FLUXORA_NATIVE_RESOURCES = $previousNativeResources
            }
            Pop-Location
        }

        $electronPackageDir = Get-ElectronPackagedAppDirectory -Platform $electronTarget.Platform -Arch $electronTarget.Arch
        Copy-DirectoryContents -SourceDirectory $electronPackageDir -DestinationDirectory $OutputDir

        $packagedBridgeHostPath = Join-Path $OutputDir 'resources\native\FluxoraBridgeHost.exe'
        $packagedCorePath = Join-Path $OutputDir 'resources\native\FluxoraCore.dll'
        if (-not (Test-Path -LiteralPath $packagedBridgeHostPath -PathType Leaf)) {
            throw "Electron package is missing bundled native bridge host at '$packagedBridgeHostPath'."
        }
        if (-not (Test-Path -LiteralPath $packagedCorePath -PathType Leaf)) {
            throw "Electron package is missing bundled native core at '$packagedCorePath'."
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
}

$payloadExecutableName = $ElectronExecutableName
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

    Invoke-BuildStep "Publishing Fluxora installer ($Configuration)" {
        if (-not (Test-Path -LiteralPath $InstallerPayloadPath)) {
            throw "Installer payload '$InstallerPayloadPath' was not found."
        }

        $nativeInstallerCorePath = Get-NativeInstallerCorePath
        Write-Host "Using native installer core: $nativeInstallerCorePath"

        $installerPublishArgs = @(
            'publish',
            $InstallerProject,
            '--configuration',
            $Configuration,
            '--output',
            $InstallerOutputDir,
            '--self-contained',
            'true',
            '-p:PublishSingleFile=true',
            '-p:IncludeNativeLibrariesForSelfExtract=true',
            '-p:DebugType=none',
            '-p:DebugSymbols=false'
        )

        if (-not [string]::IsNullOrWhiteSpace($Runtime)) {
            $installerPublishArgs += @('--runtime', $Runtime)
        }

        $setupExePath = Join-Path $InstallerOutputDir 'FluxoraSetup.exe'
        $payloadPackageSha256 = Get-FileSha256Hex -Path $InstallerPayloadPath
        $currentInstallerManifest = New-FluxoraInstallerManifest `
            -PayloadSha256 $payloadPackageSha256 `
            -NativeInstallerCorePath $nativeInstallerCorePath `
            -PublishArgs $installerPublishArgs
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
            Write-Host "Installer inputs unchanged; skipping publish: $setupExePath"
        }
        else {
            if ((Test-Path -LiteralPath $InstallerOutputDir) -and (-not $NoClean)) {
                Remove-Item -LiteralPath $InstallerOutputDir -Recurse -Force
            }

            Invoke-CheckedCommand -FilePath 'dotnet' -Arguments $installerPublishArgs

            if (-not (Test-Path -LiteralPath $setupExePath)) {
                throw "Installer publish completed, but FluxoraSetup.exe was not found in '$InstallerOutputDir'."
            }

            Get-ChildItem -LiteralPath $InstallerOutputDir -Filter '*.pdb' -File -ErrorAction SilentlyContinue |
                Remove-Item -Force

            $currentInstallerManifest.SetupSha256 = Get-FileSha256Hex -Path $setupExePath
            Save-FluxoraManifest -Path $InstallerManifestPath -Manifest $currentInstallerManifest
        }
    }
}
else {
    Write-Host ""
    Write-Host "Fast dev target selected; skipping installer payload and installer publish."
}

Write-Host ""
Write-Host "Done. Project outputs are ready:"
Write-Host "  Frontend payload: Electron"
Write-Host "  Build target: $Target"
Write-Host "  App payload staging: $OutputDir"
Write-Host "  Electron native resources: $ElectronNativeResourcesRoot"
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
