[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ProjectDirectory,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [string]$ModsDirectory,

    [string]$ProfileDirectory,

    [string]$BuildConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $InputObject) {
        return $null
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-RootedPath {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$ProjectRoot
    )

    if ([System.IO.Path]::IsPathFullyQualified($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Value))
}

function Get-NonEmptyArray {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) {
        return @()
    }
    return @($Value) | Where-Object { $null -ne $_ }
}

function Get-DistributionSummary {
    param([Parameter(Mandatory)][System.Collections.Generic.List[long]]$Values)

    if ($Values.Count -eq 0) {
        return [ordered]@{
            minimum = 0
            median = 0
            p95 = 0
            maximum = 0
            mean = 0.0
        }
    }

    $sorted = @($Values | Sort-Object)
    [long]$sum = 0
    foreach ($value in $sorted) {
        $sum += [long]$value
    }

    $medianIndex = [Math]::Max(0, [Math]::Ceiling(0.50 * $sorted.Count) - 1)
    $p95Index = [Math]::Max(0, [Math]::Ceiling(0.95 * $sorted.Count) - 1)
    return [ordered]@{
        minimum = [long]$sorted[0]
        median = [long]$sorted[$medianIndex]
        p95 = [long]$sorted[$p95Index]
        maximum = [long]$sorted[-1]
        mean = [Math]::Round($sum / [double]$sorted.Count, 3)
    }
}

function Read-ProfileShape {
    param([Parameter(Mandatory)][string]$Directory)

    $shape = [ordered]@{
        hasModList = $false
        hasPluginList = $false
        hasLoadOrder = $false
        modOrderEntries = 0L
        enabledModEntries = 0L
        disabledModEntries = 0L
        otherModEntries = 0L
        pluginEntries = 0L
        enabledPluginEntries = 0L
        disabledPluginEntries = 0L
        loadOrderEntries = 0L
    }

    $modList = Join-Path $Directory 'modlist.txt'
    if (Test-Path -LiteralPath $modList -PathType Leaf) {
        $shape.hasModList = $true
        foreach ($line in [System.IO.File]::ReadLines($modList)) {
            $trimmed = $line.Trim()
            if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#', [System.StringComparison]::Ordinal)) {
                continue
            }
            $shape.modOrderEntries++
            if ($trimmed[0] -eq '+') {
                $shape.enabledModEntries++
            }
            elseif ($trimmed[0] -eq '-') {
                $shape.disabledModEntries++
            }
            else {
                $shape.otherModEntries++
            }
        }
    }

    $pluginList = Join-Path $Directory 'plugins.txt'
    if (Test-Path -LiteralPath $pluginList -PathType Leaf) {
        $shape.hasPluginList = $true
        foreach ($line in [System.IO.File]::ReadLines($pluginList)) {
            $trimmed = $line.Trim()
            if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#', [System.StringComparison]::Ordinal)) {
                continue
            }
            $shape.pluginEntries++
            if ($trimmed[0] -eq '*') {
                $shape.enabledPluginEntries++
            }
            else {
                $shape.disabledPluginEntries++
            }
        }
    }

    $loadOrder = Join-Path $Directory 'loadorder.txt'
    if (Test-Path -LiteralPath $loadOrder -PathType Leaf) {
        $shape.hasLoadOrder = $true
        foreach ($line in [System.IO.File]::ReadLines($loadOrder)) {
            $trimmed = $line.Trim()
            if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#', [System.StringComparison]::Ordinal)) {
                continue
            }
            $shape.loadOrderEntries++
        }
    }

    return $shape
}

function Add-Count {
    param(
        [Parameter(Mandatory)][object]$Dictionary,
        [Parameter(Mandatory)]$Key,
        [long]$Increment = 1
    )

    if ($Dictionary.ContainsKey($Key)) {
        $Dictionary[$Key] += $Increment
    }
    else {
        $Dictionary.Add($Key, $Increment)
    }
}

function Write-AtomicUtf8File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )

    $parent = Split-Path -Parent $Path
    if ([string]::IsNullOrWhiteSpace($parent)) {
        $parent = [System.Environment]::CurrentDirectory
    }
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null

    $token = [Guid]::NewGuid().ToString('N')
    $temporary = Join-Path $parent ('.structural-statistics-' + $token + '.tmp')
    $backup = Join-Path $parent ('.structural-statistics-' + $token + '.bak')
    try {
        $stream = [System.IO.FileStream]::new(
            $temporary,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None,
            4096,
            [System.IO.FileOptions]::WriteThrough)
        try {
            $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false), 4096, $true)
            try {
                $writer.Write($Content)
                $writer.Flush()
                $stream.Flush($true)
            }
            finally {
                $writer.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }

        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [System.IO.File]::Replace($temporary, $Path, $backup, $true)
            [System.IO.File]::Delete($backup)
        }
        else {
            [System.IO.File]::Move($temporary, $Path)
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporary -PathType Leaf) {
            Remove-Item -LiteralPath $temporary -Force
        }
        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            Remove-Item -LiteralPath $backup -Force
        }
    }
}

$projectRoot = [System.IO.Path]::GetFullPath($ProjectDirectory)
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    throw 'ProjectDirectory must identify an existing directory.'
}

$buildConfigPath = if ([string]::IsNullOrWhiteSpace($BuildConfigPath)) {
    Join-Path $projectRoot 'build.json'
}
else {
    Get-RootedPath -Value $BuildConfigPath -ProjectRoot $projectRoot
}
if (-not (Test-Path -LiteralPath $buildConfigPath -PathType Leaf)) {
    throw 'The resolved build configuration does not exist.'
}

try {
    $buildConfig = Get-Content -LiteralPath $buildConfigPath -Raw | ConvertFrom-Json -Depth 64
}
catch {
    throw 'build.json is not valid JSON.'
}

$output = [System.IO.Path]::GetFullPath($OutputPath)
$projectPrefix = $projectRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (
    [string]::Equals($output, $projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
    throw 'OutputPath must be outside ProjectDirectory so capture cannot overwrite source data.'
}
$pathSettings = Get-PropertyValue -InputObject $buildConfig -Name 'paths'

$configuredModsDirectory = Get-PropertyValue -InputObject $pathSettings -Name 'modsDirectory'
if ([string]::IsNullOrWhiteSpace([string]$configuredModsDirectory)) {
    $configuredModsDirectory = 'mods'
}
$modsRoot = if ([string]::IsNullOrWhiteSpace($ModsDirectory)) {
    Get-RootedPath -Value ([string]$configuredModsDirectory) -ProjectRoot $projectRoot
}
else {
    Get-RootedPath -Value $ModsDirectory -ProjectRoot $projectRoot
}
if (-not (Test-Path -LiteralPath $modsRoot -PathType Container)) {
    throw 'The resolved mods directory does not exist.'
}

$configuredProfilesDirectory = Get-PropertyValue -InputObject $pathSettings -Name 'profilesDirectory'
if ([string]::IsNullOrWhiteSpace([string]$configuredProfilesDirectory)) {
    $configuredProfilesDirectory = 'profiles'
}
$profilesRoot = Get-RootedPath -Value ([string]$configuredProfilesDirectory) -ProjectRoot $projectRoot

$selectedProfile = $null
if (-not [string]::IsNullOrWhiteSpace($ProfileDirectory)) {
    $selectedProfile = Get-RootedPath -Value $ProfileDirectory -ProjectRoot $projectRoot
    if (-not (Test-Path -LiteralPath $selectedProfile -PathType Container)) {
        throw 'The resolved profile directory does not exist.'
    }
}
else {
    $defaultProfile = [string](Get-PropertyValue -InputObject $buildConfig -Name 'defaultProfile')
    if (-not [string]::IsNullOrWhiteSpace($defaultProfile)) {
        $selectedProfile = [System.IO.Path]::GetFullPath((Join-Path $profilesRoot $defaultProfile))
    }
}

$topLevelOptions = [System.IO.EnumerationOptions]::new()
$topLevelOptions.RecurseSubdirectories = $false
$topLevelOptions.IgnoreInaccessible = $false
$topLevelOptions.AttributesToSkip = [System.IO.FileAttributes]::ReparsePoint
$topLevelOptions.ReturnSpecialDirectories = $false

$recursiveOptions = [System.IO.EnumerationOptions]::new()
$recursiveOptions.RecurseSubdirectories = $true
$recursiveOptions.IgnoreInaccessible = $false
$recursiveOptions.AttributesToSkip = [System.IO.FileAttributes]::ReparsePoint
$recursiveOptions.ReturnSpecialDirectories = $false

$modDirectories = @([System.IO.Directory]::EnumerateDirectories($modsRoot, '*', $topLevelOptions))
$profileDirectories = @()
if (-not [string]::IsNullOrWhiteSpace($ProfileDirectory)) {
    $profileDirectories = @($selectedProfile)
}
elseif (Test-Path -LiteralPath $profilesRoot -PathType Container) {
    $profileDirectories = @([System.IO.Directory]::EnumerateDirectories($profilesRoot, '*', $topLevelOptions))
}

if ($null -eq $selectedProfile -and $profileDirectories.Count -eq 1) {
    $selectedProfile = $profileDirectories[0]
}

$pluginExtensions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($extensionValue in (Get-NonEmptyArray (Get-PropertyValue -InputObject $buildConfig -Name 'pluginExtensions'))) {
    $extension = [string]$extensionValue
    if (-not [string]::IsNullOrWhiteSpace($extension)) {
        [void]$pluginExtensions.Add($extension)
    }
}
if ($pluginExtensions.Count -eq 0) {
    foreach ($extension in @('.esm', '.esp', '.esl')) {
        [void]$pluginExtensions.Add($extension)
    }
}

$archiveExtensions = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase)
foreach ($extension in @('.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.fomod')) {
    [void]$archiveExtensions.Add($extension)
}
$relativePathProviders = [System.Collections.Generic.Dictionary[string, int]]::new(
    [System.StringComparer]::OrdinalIgnoreCase)
$depthCounts = [System.Collections.Generic.Dictionary[int, long]]::new()
$contentFilesPerMod = [System.Collections.Generic.List[long]]::new()
$contentDirectoriesPerMod = [System.Collections.Generic.List[long]]::new()

[long]$totalFiles = 0
[long]$contentFiles = 0
[long]$contentDirectories = 0
[long]$metadataFiles = 0
[long]$totalBytes = 0
[long]$contentBytes = 0
[long]$metadataBytes = 0
[long]$pluginFileCount = 0
[long]$modArchiveFileCount = 0
[long]$modArchiveBytes = 0
[long]$manifestCount = 0
[long]$validManifestCount = 0
[long]$invalidManifestCount = 0
[long]$modsWithManifest = 0

foreach ($modDirectory in $modDirectories) {
    [long]$modContentFiles = 0
    [long]$modContentDirectories = 0
    $hasManifest = $false
    foreach ($directory in [System.IO.Directory]::EnumerateDirectories(
            $modDirectory,
            '*',
            $recursiveOptions)) {
        $relativeDirectory = [System.IO.Path]::GetRelativePath($modDirectory, $directory)
        $directorySegments = @($relativeDirectory -split '[\\/]')
        if ($directorySegments.Count -gt 0 -and $directorySegments[0] -ieq '.flow') {
            continue
        }
        $contentDirectories++
        $modContentDirectories++
    }
    foreach ($file in [System.IO.Directory]::EnumerateFiles($modDirectory, '*', $recursiveOptions)) {
        $absoluteFile = [System.IO.Path]::GetFullPath($file)
        if ([string]::Equals($absoluteFile, $output, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $relative = [System.IO.Path]::GetRelativePath($modDirectory, $absoluteFile)
        $segments = @($relative -split '[\\/]')
        $isMetadata = $segments.Count -gt 1 -and $segments[0] -ieq '.flow'
        $length = [System.IO.FileInfo]::new($absoluteFile).Length
        $totalFiles++
        $totalBytes += $length

        if ($isMetadata) {
            $metadataFiles++
            $metadataBytes += $length
            if ($segments.Count -eq 2 -and $segments[1] -ieq 'manifest.json') {
                $manifestCount++
                $hasManifest = $true
                try {
                    $null = Get-Content -LiteralPath $absoluteFile -Raw | ConvertFrom-Json -Depth 64
                    $validManifestCount++
                }
                catch {
                    $invalidManifestCount++
                }
            }
            continue
        }

        $contentFiles++
        $modContentFiles++
        $contentBytes += $length
        $depth = [Math]::Max(0, $segments.Count - 1)
        Add-Count -Dictionary $depthCounts -Key $depth

        $normalizedRelative = $relative.Replace('/', '\')
        Add-Count -Dictionary $relativePathProviders -Key $normalizedRelative

        $extension = [System.IO.Path]::GetExtension($absoluteFile)
        if ($pluginExtensions.Contains($extension)) {
            $pluginFileCount++
        }
        if ($archiveExtensions.Contains($extension)) {
            $modArchiveFileCount++
            $modArchiveBytes += $length
        }
    }
    if ($hasManifest) {
        $modsWithManifest++
    }
    $contentFilesPerMod.Add($modContentFiles)
    $contentDirectoriesPerMod.Add($modContentDirectories)
}

[long]$conflictingRelativePathCount = 0
[long]$conflictingProviderOccurrences = 0
[long]$maximumProviders = 0
$providerDistribution = [System.Collections.Generic.Dictionary[int, long]]::new()
foreach ($providerCount in $relativePathProviders.Values) {
    if ($providerCount -le 1) {
        continue
    }
    $conflictingRelativePathCount++
    $conflictingProviderOccurrences += $providerCount
    $maximumProviders = [Math]::Max($maximumProviders, $providerCount)
    Add-Count -Dictionary $providerDistribution -Key $providerCount
}

$depthDistribution = @(
    $depthCounts.GetEnumerator() |
        Sort-Object Key |
        ForEach-Object { [ordered]@{ depth = [int]$_.Key; fileCount = [long]$_.Value } }
)
$conflictDistribution = @(
    $providerDistribution.GetEnumerator() |
        Sort-Object Key |
        ForEach-Object { [ordered]@{ providerCount = [int]$_.Key; relativePathCount = [long]$_.Value } }
)

[long]$downloadFileCount = 0
[long]$downloadArchiveFileCount = 0
[long]$downloadArchiveBytes = 0
$downloadsSetting = [string](Get-PropertyValue -InputObject $pathSettings -Name 'downloadsDirectory')
if ([string]::IsNullOrWhiteSpace($downloadsSetting)) {
    $downloadsSetting = 'downloads'
}
$downloadsRoot = Get-RootedPath -Value $downloadsSetting -ProjectRoot $projectRoot
if (Test-Path -LiteralPath $downloadsRoot -PathType Container) {
    foreach ($file in [System.IO.Directory]::EnumerateFiles($downloadsRoot, '*', $recursiveOptions)) {
        $absoluteFile = [System.IO.Path]::GetFullPath($file)
        if ([string]::Equals($absoluteFile, $output, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        $downloadFileCount++
        $extension = [System.IO.Path]::GetExtension($absoluteFile)
        if ($archiveExtensions.Contains($extension)) {
            $downloadArchiveFileCount++
            $downloadArchiveBytes += [System.IO.FileInfo]::new($absoluteFile).Length
        }
    }
}

$aggregateProfile = [ordered]@{
    profilesWithModList = 0L
    profilesWithPluginList = 0L
    profilesWithLoadOrder = 0L
    modOrderEntries = 0L
    enabledModEntries = 0L
    disabledModEntries = 0L
    otherModEntries = 0L
    pluginEntries = 0L
    enabledPluginEntries = 0L
    disabledPluginEntries = 0L
    loadOrderEntries = 0L
}
$selectedProfileShape = $null
foreach ($directory in $profileDirectories) {
    $shape = Read-ProfileShape -Directory $directory
    if ($shape.hasModList) { $aggregateProfile.profilesWithModList++ }
    if ($shape.hasPluginList) { $aggregateProfile.profilesWithPluginList++ }
    if ($shape.hasLoadOrder) { $aggregateProfile.profilesWithLoadOrder++ }
    foreach ($field in @(
        'modOrderEntries', 'enabledModEntries', 'disabledModEntries', 'otherModEntries',
        'pluginEntries', 'enabledPluginEntries', 'disabledPluginEntries', 'loadOrderEntries')) {
        $aggregateProfile[$field] += [long]$shape[$field]
    }
    if ($null -ne $selectedProfile -and
        [string]::Equals(
            [System.IO.Path]::GetFullPath($directory),
            [System.IO.Path]::GetFullPath($selectedProfile),
            [System.StringComparison]::OrdinalIgnoreCase)) {
        $selectedProfileShape = $shape
    }
}

$selectedProfilePresent = $null -ne $selectedProfileShape
if (-not $selectedProfilePresent) {
    $selectedProfileShape = [ordered]@{
        hasModList = $false
        hasPluginList = $false
        hasLoadOrder = $false
        modOrderEntries = 0L
        enabledModEntries = 0L
        disabledModEntries = 0L
        otherModEntries = 0L
        pluginEntries = 0L
        enabledPluginEntries = 0L
        disabledPluginEntries = 0L
        loadOrderEntries = 0L
    }
}

$gamePathSetting = [string](Get-PropertyValue -InputObject $buildConfig -Name 'gamePath')
if ([string]::IsNullOrWhiteSpace($gamePathSetting)) {
    $gamePathSetting = [string](Get-PropertyValue -InputObject $pathSettings -Name 'gameDirectory')
}
$gameRoot = $null
if (-not [string]::IsNullOrWhiteSpace($gamePathSetting)) {
    $gameRoot = Get-RootedPath -Value $gamePathSetting -ProjectRoot $projectRoot
}

$executables = @(Get-NonEmptyArray (Get-PropertyValue -InputObject $buildConfig -Name 'launchExecutables'))
[long]$executablesWithArguments = 0
[long]$executablesWithWorkingDirectory = 0
[long]$existingExecutables = 0
foreach ($executable in $executables) {
    $arguments = [string](Get-PropertyValue -InputObject $executable -Name 'arguments')
    $workingDirectory = [string](Get-PropertyValue -InputObject $executable -Name 'workingDirectory')
    if (-not [string]::IsNullOrWhiteSpace($arguments)) { $executablesWithArguments++ }
    if (-not [string]::IsNullOrWhiteSpace($workingDirectory)) { $executablesWithWorkingDirectory++ }

    $executablePath = [string](Get-PropertyValue -InputObject $executable -Name 'executablePath')
    if ([string]::IsNullOrWhiteSpace($executablePath)) {
        $executablePath = [string](Get-PropertyValue -InputObject $executable -Name 'path')
    }
    if ([string]::IsNullOrWhiteSpace($executablePath)) {
        continue
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ([System.IO.Path]::IsPathFullyQualified($executablePath)) {
        $candidates.Add([System.IO.Path]::GetFullPath($executablePath))
    }
    else {
        if ($null -ne $gameRoot) {
            $candidates.Add([System.IO.Path]::GetFullPath((Join-Path $gameRoot $executablePath)))
        }
        $candidates.Add([System.IO.Path]::GetFullPath((Join-Path $projectRoot $executablePath)))
    }
    if ($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1) {
        $existingExecutables++
    }
}

$basePlugins = @(Get-NonEmptyArray (Get-PropertyValue -InputObject $buildConfig -Name 'basePlugins'))
$buildTopLevelPropertyCount = @($buildConfig.PSObject.Properties).Count
$pathSettingCount = if ($null -eq $pathSettings) { 0 } else { @($pathSettings.PSObject.Properties).Count }

$document = [ordered]@{
    schemaVersion = 2
    generator = 'FluxoraStructuralStatistics'
    generatedUtc = [DateTime]::UtcNow.ToString('O')
    privacy = [ordered]@{
        structuralStatisticsOnly = $true
        containsSourcePaths = $false
        containsModNames = $false
        containsProfileNames = $false
        containsFileNames = $false
        containsRawExtensions = $false
        containsFileContents = $false
        containsPrivateNameHashes = $false
        containsPathOrNameDerivedIdentifiers = $false
    }
    mods = [ordered]@{
        directoryCount = [long]$modDirectories.Count
        selectedProfileOrderEntryCount = [long]$selectedProfileShape.modOrderEntries
        selectedProfileEnabledCount = [long]$selectedProfileShape.enabledModEntries
        selectedProfileDisabledCount = [long]$selectedProfileShape.disabledModEntries
        selectedProfileOtherEntryCount = [long]$selectedProfileShape.otherModEntries
    }
    files = [ordered]@{
        totalFileCount = $totalFiles
        contentFileCount = $contentFiles
        metadataFileCount = $metadataFiles
        totalBytes = $totalBytes
        contentBytes = $contentBytes
        metadataBytes = $metadataBytes
        contentFilesPerMod = Get-DistributionSummary -Values $contentFilesPerMod
        contentFileDepthDistribution = $depthDistribution
    }
    directories = [ordered]@{
        contentDirectoryCount = $contentDirectories
        contentDirectoriesPerMod = Get-DistributionSummary -Values $contentDirectoriesPerMod
    }
    conflicts = [ordered]@{
        uniqueRelativeContentPathCount = [long]$relativePathProviders.Count
        conflictingRelativePathCount = $conflictingRelativePathCount
        providerOccurrencesOnConflictingPaths = $conflictingProviderOccurrences
        maximumProvidersForOnePath = $maximumProviders
        providersPerConflictingPathDistribution = $conflictDistribution
    }
    plugins = [ordered]@{
        configuredExtensionClassifierCount = [long]$pluginExtensions.Count
        configuredBasePluginCount = [long]$basePlugins.Count
        modContentPluginFileCount = $pluginFileCount
        selectedProfileEntryCount = [long]$selectedProfileShape.pluginEntries
        selectedProfileEnabledCount = [long]$selectedProfileShape.enabledPluginEntries
        selectedProfileDisabledCount = [long]$selectedProfileShape.disabledPluginEntries
    }
    archives = [ordered]@{
        archiveClassifierCount = [long]$archiveExtensions.Count
        modContentArchiveFileCount = $modArchiveFileCount
        modContentArchiveBytes = $modArchiveBytes
        downloadFileCount = $downloadFileCount
        downloadArchiveFileCount = $downloadArchiveFileCount
        downloadArchiveBytes = $downloadArchiveBytes
    }
    metadata = [ordered]@{
        buildConfigurationTopLevelFieldCount = [long]$buildTopLevelPropertyCount
        buildPathSettingCount = [long]$pathSettingCount
        manifestCount = $manifestCount
        validManifestCount = $validManifestCount
        invalidManifestCount = $invalidManifestCount
        modsWithManifestCount = $modsWithManifest
        modsWithoutManifestCount = [long]($modDirectories.Count - $modsWithManifest)
    }
    executables = [ordered]@{
        configuredCount = [long]$executables.Count
        existingFileCount = $existingExecutables
        missingFileCount = [long]($executables.Count - $existingExecutables)
        withArgumentsCount = $executablesWithArguments
        withWorkingDirectoryCount = $executablesWithWorkingDirectory
    }
    profiles = [ordered]@{
        discoveredDirectoryCount = [long]$profileDirectories.Count
        selectedProfilePresent = $selectedProfilePresent
        profilesWithModList = [long]$aggregateProfile.profilesWithModList
        profilesWithPluginList = [long]$aggregateProfile.profilesWithPluginList
        profilesWithLoadOrder = [long]$aggregateProfile.profilesWithLoadOrder
        aggregateModOrderEntryCount = [long]$aggregateProfile.modOrderEntries
        aggregateEnabledModEntryCount = [long]$aggregateProfile.enabledModEntries
        aggregateDisabledModEntryCount = [long]$aggregateProfile.disabledModEntries
        aggregateOtherModEntryCount = [long]$aggregateProfile.otherModEntries
        aggregatePluginEntryCount = [long]$aggregateProfile.pluginEntries
        aggregateEnabledPluginEntryCount = [long]$aggregateProfile.enabledPluginEntries
        aggregateDisabledPluginEntryCount = [long]$aggregateProfile.disabledPluginEntries
        aggregateLoadOrderEntryCount = [long]$aggregateProfile.loadOrderEntries
    }
}

$json = ($document | ConvertTo-Json -Depth 16 -Compress) + "`n"
Write-AtomicUtf8File -Path $output -Content $json
Write-Output 'Wrote privacy-safe Fluxora structural statistics.'
