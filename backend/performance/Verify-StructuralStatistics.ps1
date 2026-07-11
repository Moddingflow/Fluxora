[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$FixtureBuilderPath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ProbePath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$HarnessPath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [string]$FixtureDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Equal {
    param(
        [Parameter(Mandatory)]$Actual,
        [Parameter(Mandatory)]$Expected,
        [Parameter(Mandatory)][string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', found '$Actual'."
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory)][bool]$Condition,
        [Parameter(Mandatory)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-OnlySafeStringValues {
    param([AllowNull()]$Value)

    if ($null -eq $Value) {
        return
    }
    if ($Value -is [string]) {
        if ($Value -eq 'FluxoraStructuralStatistics') {
            return
        }
        $parsedTimestamp = [DateTimeOffset]::MinValue
        if ([DateTimeOffset]::TryParse(
                $Value,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind,
                [ref]$parsedTimestamp)) {
            return
        }
        throw 'Structural statistics contain an unexpected string value.'
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [pscustomobject]) {
        foreach ($item in $Value) {
            Assert-OnlySafeStringValues -Value $item
        }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
            Assert-OnlySafeStringValues -Value $property.Value
        }
    }
}

$builder = (Resolve-Path -LiteralPath $FixtureBuilderPath).Path
$probe = (Resolve-Path -LiteralPath $ProbePath).Path
$capture = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Capture-FluxoraModlistStructure.ps1')).Path
$harness = (Resolve-Path -LiteralPath $HarnessPath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$outputParent = Split-Path -Parent $output
if ([string]::IsNullOrWhiteSpace($outputParent)) {
    $outputParent = [System.Environment]::CurrentDirectory
}
[System.IO.Directory]::CreateDirectory($outputParent) | Out-Null

if ([string]::IsNullOrWhiteSpace($FixtureDirectory)) {
    $fixtureName = [System.IO.Path]::GetFileNameWithoutExtension($output) + '-fixture'
    $fixture = [System.IO.Path]::GetFullPath((Join-Path $outputParent $fixtureName))
}
else {
    $fixture = [System.IO.Path]::GetFullPath($FixtureDirectory)
}

& $builder `
    --output $fixture `
    --probe $probe `
    --mods 8 `
    --files-per-mod 6 `
    --plugins 3 `
    --disabled-percent 25 `
    --conflict-files 2 `
    --directory-depth 2 `
    --seed 0xF10C0A
if ($LASTEXITCODE -ne 0) {
    throw "Synthetic fixture builder exited with code $LASTEXITCODE."
}

# Add privacy sentinels in every input category whose labels must never be emitted.
$privateProfile = Join-Path $fixture 'profiles\PRIVATE_PROFILE_LEAK_SENTINEL'
[System.IO.Directory]::CreateDirectory($privateProfile) | Out-Null
[System.IO.File]::WriteAllText(
    (Join-Path $privateProfile 'modlist.txt'),
    "+PRIVATE_MOD_LEAK_SENTINEL`n-PRIVATE_DISABLED_MOD_LEAK_SENTINEL`n",
    [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText(
    (Join-Path $privateProfile 'plugins.txt'),
    "*PRIVATE_PLUGIN_LEAK_SENTINEL.esp`n",
    [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText(
    (Join-Path $privateProfile 'loadorder.txt'),
    "PRIVATE_PLUGIN_LEAK_SENTINEL.esp`n",
    [System.Text.UTF8Encoding]::new($false))

$privateDownload = Join-Path $fixture 'downloads\PRIVATE_ARCHIVE_LEAK_SENTINEL.zip'
[System.IO.File]::WriteAllBytes($privateDownload, [byte[]]@(1, 2, 3, 4))
$firstMod = Get-ChildItem -LiteralPath (Join-Path $fixture 'mods') -Directory | Select-Object -First 1
if ($null -eq $firstMod) {
    throw 'Synthetic fixture did not create mod directories.'
}
$privateModArchive = Join-Path $firstMod.FullName 'Data\PRIVATE_MOD_ARCHIVE_LEAK_SENTINEL.7z'
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $privateModArchive)) | Out-Null
[System.IO.File]::WriteAllBytes($privateModArchive, [byte[]]@(5, 6, 7))
$privateContent = Join-Path $firstMod.FullName 'Data\PRIVATE_FILE_LEAK_SENTINEL.bin'
[System.IO.File]::WriteAllText(
    $privateContent,
    'PRIVATE_CONTENT_LEAK_SENTINEL',
    [System.Text.UTF8Encoding]::new($false))

# Exercise the existing-destination branch of the atomic writer.
[System.IO.File]::WriteAllText(
    $output,
    '{"sentinel":"PRIVATE_ATOMIC_REPLACEMENT_SENTINEL"}',
    [System.Text.UTF8Encoding]::new($false))

& $capture -ProjectDirectory $fixture -OutputPath $output
if ($LASTEXITCODE -ne 0) {
    throw "Structural-statistics capture exited with code $LASTEXITCODE."
}

$raw = Get-Content -LiteralPath $output -Raw
$statistics = $raw | ConvertFrom-Json -Depth 64

Assert-Equal $statistics.schemaVersion 2 'Unexpected structural-statistics schema version.'
Assert-Equal $statistics.generator 'FluxoraStructuralStatistics' 'Unexpected structural-statistics generator.'
Assert-True ([bool]$statistics.privacy.structuralStatisticsOnly) 'Privacy declaration must identify aggregate-only output.'
foreach ($flag in @(
    'containsSourcePaths',
    'containsModNames',
    'containsProfileNames',
    'containsFileNames',
    'containsRawExtensions',
    'containsFileContents',
    'containsPrivateNameHashes',
    'containsPathOrNameDerivedIdentifiers')) {
    Assert-True (-not [bool]$statistics.privacy.$flag) "Privacy flag '$flag' must be false."
}

Assert-OnlySafeStringValues -Value $statistics

$normalizedRaw = $raw.Replace('\\', '\')
$leakSentinels = @(
    $fixture,
    [System.IO.Path]::GetFileName($fixture),
    'Synthetic Mod',
    'SyntheticPlugin',
    'PRIVATE_PROFILE_LEAK_SENTINEL',
    'PRIVATE_MOD_LEAK_SENTINEL',
    'PRIVATE_DISABLED_MOD_LEAK_SENTINEL',
    'PRIVATE_PLUGIN_LEAK_SENTINEL',
    'PRIVATE_ARCHIVE_LEAK_SENTINEL',
    'PRIVATE_MOD_ARCHIVE_LEAK_SENTINEL',
    'PRIVATE_FILE_LEAK_SENTINEL',
    'PRIVATE_CONTENT_LEAK_SENTINEL',
    'PRIVATE_ATOMIC_REPLACEMENT_SENTINEL',
    'Default',
    'Skyrim',
    'overlay-sentinel',
    'manifest.json',
    'build.json',
    'modlist.txt',
    '.esm',
    '.esp',
    '.esl',
    '.zip',
    '.7z'
)
foreach ($sentinel in $leakSentinels) {
    if (-not [string]::IsNullOrEmpty($sentinel) -and
        $normalizedRaw.IndexOf($sentinel, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'Structural statistics leaked a private path, name, extension, or content sentinel.'
    }
}

Assert-Equal $statistics.mods.directoryCount 8 'Unexpected mod-directory count.'
Assert-Equal $statistics.mods.selectedProfileOrderEntryCount 8 'Unexpected selected-profile mod-order count.'
Assert-Equal (
    $statistics.mods.selectedProfileEnabledCount +
        $statistics.mods.selectedProfileDisabledCount +
        $statistics.mods.selectedProfileOtherEntryCount) 8 'Selected-profile mod-order categories do not balance.'
Assert-True ($statistics.mods.selectedProfileEnabledCount -gt 0) 'Expected at least one enabled mod.'
Assert-True ($statistics.mods.selectedProfileDisabledCount -gt 0) 'Expected at least one disabled mod.'

Assert-Equal $statistics.metadata.manifestCount 8 'Unexpected manifest count.'
Assert-Equal $statistics.metadata.validManifestCount 8 'Unexpected valid-manifest count.'
Assert-Equal $statistics.metadata.invalidManifestCount 0 'Unexpected invalid-manifest count.'
Assert-Equal $statistics.metadata.modsWithoutManifestCount 0 'Every synthetic mod should have metadata.'
Assert-Equal $statistics.files.metadataFileCount 8 'Unexpected metadata-file count.'
$classifiedFileCount = $statistics.files.contentFileCount + $statistics.files.metadataFileCount
Assert-Equal `
    $classifiedFileCount `
    $statistics.files.totalFileCount `
    'Content and metadata file counts do not balance.'
Assert-True ($statistics.files.contentFileCount -ge 53) 'Synthetic content-file count is too small.'
Assert-True ($statistics.files.contentFilesPerMod.minimum -ge 6) 'Per-mod file minimum is invalid.'
Assert-True ($statistics.files.contentFilesPerMod.maximum -ge 8) 'Privacy sentinel files were not counted.'
Assert-True ($statistics.directories.contentDirectoryCount -gt 0) 'Content directories were not counted.'
Assert-True (
    $statistics.directories.contentDirectoriesPerMod.mean -gt 0
) 'Per-mod directory shape is invalid.'

$depthFileCount = 0L
foreach ($bucket in $statistics.files.contentFileDepthDistribution) {
    Assert-True ($bucket.depth -ge 0) 'File-depth distribution contains a negative depth.'
    $depthFileCount += [long]$bucket.fileCount
}
Assert-Equal $depthFileCount $statistics.files.contentFileCount 'File-depth distribution does not cover every content file.'

Assert-True ($statistics.conflicts.conflictingRelativePathCount -ge 4) 'Expected modeled conflict paths.'
Assert-True ($statistics.conflicts.providerOccurrencesOnConflictingPaths -ge 16) 'Expected modeled conflict providers.'
Assert-Equal $statistics.conflicts.maximumProvidersForOnePath 4 'Unexpected maximum conflict provider count.'
Assert-Equal $statistics.plugins.modContentPluginFileCount 3 'Unexpected plugin-file count.'
Assert-Equal $statistics.plugins.configuredBasePluginCount 1 'Unexpected base-plugin count.'

Assert-Equal $statistics.archives.modContentArchiveFileCount 1 'Mod-content archive aggregation failed.'
Assert-Equal $statistics.archives.downloadArchiveFileCount 1 'Download archive aggregation failed.'
Assert-Equal $statistics.archives.downloadFileCount 1 'Download file aggregation failed.'
Assert-Equal $statistics.executables.configuredCount 2 'Unexpected executable count.'
Assert-Equal $statistics.executables.existingFileCount 2 'Synthetic launch probes should resolve.'
Assert-Equal $statistics.executables.missingFileCount 0 'Synthetic launch probe should not be missing.'
Assert-Equal $statistics.profiles.discoveredDirectoryCount 3 'Unexpected profile-directory count.'
Assert-True ([bool]$statistics.profiles.selectedProfilePresent) 'Default profile was not selected.'
Assert-Equal $statistics.profiles.aggregateModOrderEntryCount 18 'Aggregate profile order count is invalid.'
Assert-Equal $statistics.profiles.aggregatePluginEntryCount (
    2 * $statistics.plugins.selectedProfileEntryCount + 1) 'Aggregate profile plugin count is invalid.'

$temporaryArtifacts = @(
    Get-ChildItem -LiteralPath $outputParent -File -Filter '.structural-statistics-*.tmp' -ErrorAction Stop
)
Assert-Equal $temporaryArtifacts.Count 0 'Atomic output left a temporary artifact behind.'

$engine = (Get-Process -Id $PID).Path
$importOutput = & $engine -NoProfile -File $harness `
    -HostPath unused `
    -FixtureBuilderPath unused `
    -ProbePath unused `
    -ResultPath unused `
    -StructuralStatisticsPath $output `
    -ValidateParametersOnly 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Harness structural import failed: $($importOutput -join [Environment]::NewLine)"
}
$imported = ($importOutput -join [Environment]::NewLine) | ConvertFrom-Json
Assert-Equal @($imported.modCounts).Count 1 'Imported structure should select one representative scale.'
Assert-Equal @($imported.modCounts)[0] 8 'Imported mod count is invalid.'
Assert-Equal $imported.pluginCount 3 'Imported plugin count is invalid.'
$expectedDisabledPercent = [int][Math]::Round(
    100.0 * $statistics.mods.selectedProfileDisabledCount /
        $statistics.mods.selectedProfileOrderEntryCount)
Assert-Equal $imported.disabledPercent $expectedDisabledPercent 'Imported disabled percentage is invalid.'
Assert-True ($imported.filesPerMod -ge 6) 'Imported files-per-mod shape is invalid.'
Assert-True ($imported.conflictFilesPerMod -ge 1) 'Imported conflict shape is invalid.'
Assert-True ($imported.directoryDepth -ge 1) 'Imported directory-depth shape is invalid.'
Assert-True ($imported.directoriesPerMod -ge 1) 'Imported directories-per-mod shape is invalid.'

Write-Output 'Fluxora privacy-safe structural-statistics verification passed.'
