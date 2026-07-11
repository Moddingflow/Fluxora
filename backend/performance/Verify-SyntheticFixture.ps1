[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$FixtureBuilderPath,

    [Parameter(Mandatory)]
    [string]$ProbePath,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$builder = (Resolve-Path -LiteralPath $FixtureBuilderPath).Path
$probe = (Resolve-Path -LiteralPath $ProbePath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)

& $builder `
    --output $output `
    --probe $probe `
    --mods 12 `
    --files-per-mod 8 `
    --plugins 5 `
    --disabled-percent 10 `
    --conflict-files 2 `
    --directory-depth 2 `
    --seed 0xF10C0A
if ($LASTEXITCODE -ne 0) {
    throw "Synthetic fixture builder exited with code $LASTEXITCODE."
}

$markerPath = Join-Path $output '.fluxora-perf-fixture.json'
$ownerPath = Join-Path $output '.fluxora-perf-owner'
$configPath = Join-Path $output 'build.json'
$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$modDirectories = @(Get-ChildItem -LiteralPath (Join-Path $output 'mods') -Directory)

if (
    $marker.schemaVersion -ne 1 -or
    $marker.generator -ne 'FluxoraSyntheticModlistFixture' -or
    $marker.ownershipToken -ne 'fluxora.synthetic-performance-fixture.v1' -or
    $marker.modCount -ne 12 -or
    $marker.filesPerMod -ne 8 -or
    $marker.pluginCount -ne 5
) {
    throw 'Synthetic fixture ownership marker does not match the requested shape.'
}
if ((Get-Content -LiteralPath $ownerPath -Raw) -ne "FLUXORA_SYNTHETIC_PERFORMANCE_FIXTURE_V1`n") {
    throw 'Synthetic fixture ownership token is invalid.'
}
if ($config.templateId -ne 'skyrimse' -or $config.defaultProfile -ne 'Default') {
    throw 'Synthetic fixture build config is invalid.'
}
if (@($config.launchExecutables).Count -ne 2 -or
    @($config.launchExecutables | Where-Object { $_.id -eq 'probe-alternate' }).Count -ne 1) {
    throw 'Synthetic fixture does not expose both profile-isolation probes.'
}
if (-not (Test-Path -LiteralPath (Join-Path $output 'profiles\Alternate\modlist.txt') -PathType Leaf) -or
    [string]::IsNullOrWhiteSpace([string]$marker.alternateExpectedOverlaySentinel)) {
    throw 'Synthetic fixture does not contain an alternate profile shape.'
}
if ($modDirectories.Count -ne 12) {
    throw "Expected 12 synthetic mod directories, found $($modDirectories.Count)."
}
if (-not (Test-Path -LiteralPath (Join-Path $output 'Game\FluxoraLaunchProbe.exe') -PathType Leaf)) {
    throw 'Synthetic fixture did not stage the launch probe.'
}
$sentinelCount = @(
    Get-ChildItem -LiteralPath (Join-Path $output 'mods') -Filter 'overlay-sentinel.txt' -File -Recurse
).Count
if ($sentinelCount -ne 3) {
    throw "Expected first/winning enabled plus disabled overlay contenders; found $sentinelCount."
}
$modListLines = @(
    [System.IO.File]::ReadAllLines((Join-Path $output 'profiles\Default\modlist.txt')) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
if ($modListLines.Count -ne 12 -or -not $modListLines[-1].StartsWith('-')) {
    throw 'The highest-priority synthetic mod must be a disabled overlay contender.'
}
$profilePluginLines = @(
    [System.IO.File]::ReadAllLines((Join-Path $output 'profiles\Default\plugins.txt')) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$enabledSyntheticPluginCount = @(
    $profilePluginLines | Where-Object { $_ -like '*SyntheticPlugin*.esp' }
).Count
if ([int]$marker.basePluginCount -ne 5 -or
    [int]$marker.expectedPluginCount -ne ([int]$marker.basePluginCount + $enabledSyntheticPluginCount)) {
    throw "Fixture expectedPluginCount $($marker.expectedPluginCount) does not match its base and enabled synthetic plugin shape."
}

$directReadPath = Join-Path $output 'Game\Data\probe-direct.txt'
$directResultPath = Join-Path $output 'probe-direct-result.json'
[System.IO.File]::WriteAllText($directReadPath, 'direct-probe-ok', [System.Text.UTF8Encoding]::new($false))
$previousConfig = [Environment]::GetEnvironmentVariable('FLUXORA_VFS_CONFIG', 'Process')
try {
    [Environment]::SetEnvironmentVariable('FLUXORA_VFS_CONFIG', $configPath, 'Process')
    & $probe `
        --result $directResultPath `
        --vfs-read $directReadPath `
        --expect 'direct-probe-ok' `
        --hold-ms 0
    if ($LASTEXITCODE -ne 0) {
        throw "Launch probe exited with code $LASTEXITCODE."
    }
}
finally {
    [Environment]::SetEnvironmentVariable('FLUXORA_VFS_CONFIG', $previousConfig, 'Process')
}

$probeResult = Get-Content -LiteralPath $directResultPath -Raw | ConvertFrom-Json
if (-not $probeResult.ok -or -not $probeResult.isX64 -or -not $probeResult.vfsDescriptorExists) {
    throw 'Launch probe correctness smoke failed.'
}
if (
    $probeResult.creationToEntryMs -lt 0 -or
    $probeResult.creationToValidatedReadyMs -lt $probeResult.creationToEntryMs
) {
    throw 'Launch probe entry/validated-ready timing is invalid.'
}

function Assert-RefusesUnsafeReplacement {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Owner
    )

    $unsafeOutput = "$output-$Name"
    [System.IO.Directory]::CreateDirectory($unsafeOutput) | Out-Null
    $sentinel = Join-Path $unsafeOutput 'must-survive.txt'
    [System.IO.File]::WriteAllText($sentinel, 'preserve', [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText(
        (Join-Path $unsafeOutput '.fluxora-perf-fixture.json'),
        $Marker,
        [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText(
        (Join-Path $unsafeOutput '.fluxora-perf-owner'),
        $Owner,
        [System.Text.UTF8Encoding]::new($false))

    & $builder --output $unsafeOutput --probe $probe --mods 1 --files-per-mod 1 --plugins 0 2>$null
    if ($LASTEXITCODE -eq 0) {
        throw "Fixture builder replaced unsafe directory '$Name'."
    }
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
        throw "Fixture builder removed data from unsafe directory '$Name'."
    }
}

$validOwner = "FLUXORA_SYNTHETIC_PERFORMANCE_FIXTURE_V1`n"
Assert-RefusesUnsafeReplacement `
    -Name 'malformed-marker' `
    -Marker '{not-json' `
    -Owner $validOwner
Assert-RefusesUnsafeReplacement `
    -Name 'wrong-generator' `
    -Marker '{"schemaVersion":1,"generator":"OtherTool","ownershipToken":"fluxora.synthetic-performance-fixture.v1"}' `
    -Owner $validOwner
Assert-RefusesUnsafeReplacement `
    -Name 'wrong-owner' `
    -Marker '{"schemaVersion":1,"generator":"FluxoraSyntheticModlistFixture","ownershipToken":"fluxora.synthetic-performance-fixture.v1"}' `
    -Owner 'not-owned'

Write-Output 'Fluxora synthetic fixture and x64 launch probe smoke passed.'
