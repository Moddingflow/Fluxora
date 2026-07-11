[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$HostPath,

    [Parameter(Mandatory)]
    [string]$FixtureBuilderPath,

    [Parameter(Mandatory)]
    [string]$ProbePath,

    [Parameter(Mandatory)]
    [string]$ResultPath,

    [string]$CorePath = '',

    [string]$VfsPath = '',

    [string]$WorkRoot = '',

    [string]$StructuralStatisticsPath = '',

    [string[]]$ModCounts = @('610', '1500', '3000'),

    [ValidateRange(1, 10000)]
    [int]$FilesPerMod = 96,

    [ValidateRange(0, 10000)]
    [int]$PluginCount = 350,

    [ValidateRange(0, 100)]
    [int]$DisabledPercent = 8,

    [ValidateRange(0, 10000)]
    [int]$ConflictFilesPerMod = 16,

    [ValidateRange(0, 12)]
    [int]$DirectoryDepth = 4,

    [ValidateRange(1, 10000)]
    [int]$DirectoriesPerMod = 20,

    [ValidateRange(1, 100)]
    [int]$Runs = 5,

    [ValidateRange(0, 20)]
    [int]$Warmups = 1,

    [ValidateRange(1, 20)]
    [int]$ColdRuns = 1,

    [ValidateRange(1, 1000000000)]
    [long]$MaximumModeledFiles = 2000000,

    [switch]$AllowLargeFixture,

    [ValidateRange(1000, 600000)]
    [int]$RequestTimeoutMilliseconds = 120000,

    [switch]$SkipLaunch,

    [switch]$ValidateParametersOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'PerformanceParameters.ps1')
$importedStructure = $null
if (-not [string]::IsNullOrWhiteSpace($StructuralStatisticsPath)) {
    $importedStructure = Import-FluxoraStructuralStatistics -Path $StructuralStatisticsPath
    if (-not $PSBoundParameters.ContainsKey('ModCounts')) {
        $ModCounts = @([string]$importedStructure.modCount)
    }
    if (-not $PSBoundParameters.ContainsKey('FilesPerMod')) {
        $FilesPerMod = $importedStructure.filesPerMod
    }
    if (-not $PSBoundParameters.ContainsKey('PluginCount')) {
        $PluginCount = $importedStructure.pluginCount
    }
    if (-not $PSBoundParameters.ContainsKey('DisabledPercent')) {
        $DisabledPercent = $importedStructure.disabledPercent
    }
    if (-not $PSBoundParameters.ContainsKey('ConflictFilesPerMod')) {
        $ConflictFilesPerMod = $importedStructure.conflictFilesPerMod
    }
    if (-not $PSBoundParameters.ContainsKey('DirectoryDepth')) {
        $DirectoryDepth = $importedStructure.directoryDepth
    }
    if (-not $PSBoundParameters.ContainsKey('DirectoriesPerMod')) {
        $DirectoriesPerMod = $importedStructure.directoriesPerMod
    }
}
[int[]]$resolvedModCounts = @(ConvertTo-FluxoraModCounts -Values $ModCounts)

if ($ValidateParametersOnly) {
    [pscustomobject]@{
        modCounts = $resolvedModCounts
        filesPerMod = $FilesPerMod
        pluginCount = $PluginCount
        disabledPercent = $DisabledPercent
        conflictFilesPerMod = $ConflictFilesPerMod
        directoryDepth = $DirectoryDepth
        directoriesPerMod = $DirectoriesPerMod
    } | ConvertTo-Json -Compress
    return
}

function Resolve-RequiredFile {
    param([Parameter(Mandatory)][string]$Path)

    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "Required file does not exist: $Path"
    }
    return $resolved.Path
}

function Enter-PerformanceWorkRootLock {
    param([Parameter(Mandatory)][string]$ResolvedWorkRoot)

    $lockPath = Join-Path $ResolvedWorkRoot '.fluxora-performance.lock'
    try {
        return [System.IO.File]::Open(
            $lockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None)
    }
    catch [System.IO.IOException] {
        $message = "WorkRoot is already in use by another performance run: '$ResolvedWorkRoot'. The exclusive lock '$lockPath' could not be acquired."
        throw [System.IO.IOException]::new($message, $_.Exception)
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Get-StringSha256 {
    param([Parameter(Mandatory)][string]$Value)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-PluginStateProjection {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Plugins)

    [object[]]$projection = @($Plugins | ForEach-Object {
        [ordered]@{
            id = [string]$_.id
            order = [int]$_.order
            isEnabled = [bool]$_.isEnabled
        }
    })
    $json = ConvertTo-Json -InputObject $projection -Depth 3 -Compress
    return [pscustomobject]@{
        json = $json
        sha256 = Get-StringSha256 $json
    }
}

function Stop-OwnedProcess {
    param(
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [int]$TimeoutMilliseconds = 10000
    )

    if ($Process.HasExited) {
        return
    }
    try {
        $Process.StandardInput.Close()
    }
    catch {
    }
    if ($Process.WaitForExit($TimeoutMilliseconds)) {
        return
    }
    $Process.Kill()
    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        throw "Owned process $($Process.Id) did not stop."
    }
}

function Start-BridgeHost {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string]$LogDirectory
    )

    [System.IO.Directory]::CreateDirectory($LogDirectory) | Out-Null
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment['FLUXORA_LOG_DIR'] = $LogDirectory
    $startInfo.Environment['FLUXORA_OPERATION_CANCEL_DIR'] = Join-Path $LogDirectory 'operation-cancel'

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'Failed to start FluxoraBridgeHost.'
    }
    $input = [System.IO.StreamWriter]::new(
        $process.StandardInput.BaseStream,
        [System.Text.UTF8Encoding]::new($false))
    $input.AutoFlush = $true

    return [pscustomobject]@{
        Process = $process
        Input = $input
        StderrTask = $process.StandardError.ReadToEndAsync()
        Sequence = 0
    }
}

function Stop-BridgeHost {
    param([Parameter(Mandatory)]$Bridge)

    try {
        $Bridge.Input.Close()
        Stop-OwnedProcess -Process $Bridge.Process
        return $Bridge.StderrTask.GetAwaiter().GetResult()
    }
    finally {
        $Bridge.Process.Dispose()
    }
}

function Invoke-BridgeRequest {
    param(
        [Parameter(Mandatory)]$Bridge,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][hashtable]$Params,
        [Parameter(Mandatory)][string]$Scope
    )

    $Bridge.Sequence++
    $operationId = "perf_{0}_{1}" -f $Scope, $Bridge.Sequence
    $request = @{
        jsonrpc = '2.0'
        id = $operationId
        method = $Method
        params = $Params
        meta = @{
            protocolVersion = '1.0'
            operationId = $operationId
            requestSource = 'fluxora-performance-suite'
            appVersion = '0.0.0-performance'
            platform = 'win32'
            arch = 'x64'
            locale = 'en-US'
        }
    }

    $requestJson = $request | ConvertTo-Json -Depth 16 -Compress
    Write-Verbose "Bridge request: $requestJson"
    $responseTask = $Bridge.Process.StandardOutput.ReadLineAsync()
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $Bridge.Input.WriteLine($requestJson)
    $Bridge.Input.Flush()
    if (-not $responseTask.Wait($RequestTimeoutMilliseconds)) {
        throw "$Method timed out after $RequestTimeoutMilliseconds ms."
    }
    $line = $responseTask.GetAwaiter().GetResult()
    $stopwatch.Stop()
    if ([string]::IsNullOrWhiteSpace($line)) {
        throw "$Method returned no response."
    }

    $response = $line | ConvertFrom-Json
    if ($null -ne $response.error) {
        throw "$Method failed: $($response.error | ConvertTo-Json -Depth 12 -Compress)"
    }

    $nativeDurationMs = if ($null -ne $response.meta.durationMs) {
        [double]$response.meta.durationMs
    }
    else {
        [double]$stopwatch.Elapsed.TotalMilliseconds
    }
    return [pscustomobject]@{
        operationId = $operationId
        elapsedMs = [double]$stopwatch.Elapsed.TotalMilliseconds
        nativeDurationMs = $nativeDurationMs
        data = $response.result.data
    }
}

function Get-Statistics {
    param([Parameter(Mandatory)][object[]]$Values)

    $numbers = @($Values | ForEach-Object { [double]$_ } | Sort-Object)
    if ($numbers.Count -eq 0) {
        return $null
    }
    $median = if (($numbers.Count % 2) -eq 1) {
        $numbers[[math]::Floor($numbers.Count / 2)]
    }
    else {
        ($numbers[$numbers.Count / 2 - 1] + $numbers[$numbers.Count / 2]) / 2.0
    }
    $p95Index = [math]::Max(0, [math]::Ceiling(0.95 * $numbers.Count) - 1)
    return [pscustomobject]@{
        runs = $numbers.Count
        minMs = [math]::Round($numbers[0], 3)
        medianMs = [math]::Round($median, 3)
        p95Ms = [math]::Round($numbers[$p95Index], 3)
        maxMs = [math]::Round($numbers[-1], 3)
    }
}

function Get-ProfileFileState {
    param([Parameter(Mandatory)][string]$FixtureRoot)

    $files = foreach ($name in @('modlist.txt', 'plugins.txt', 'loadorder.txt')) {
        $path = Join-Path $FixtureRoot ("profiles\Default\$name")
        $item = Get-Item -LiteralPath $path
        [pscustomobject]@{
            name = $name
            length = $item.Length
            lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
            sha256 = Get-Sha256 $path
        }
    }
    return [pscustomobject]@{
        contentSignature = (@($files | ForEach-Object { "$($_.name):$($_.length):$($_.sha256)" }) -join '|')
        timestampSignature = (@($files | ForEach-Object { "$($_.name):$($_.lastWriteTimeUtc)" }) -join '|')
        files = @($files)
    }
}

function Invoke-OpenFlow {
    param(
        [Parameter(Mandatory)]$Bridge,
        [Parameter(Mandatory)][string]$FixtureRoot,
        [Parameter(Mandatory)][int]$ExpectedModCount,
        [Parameter(Mandatory)][int]$ExpectedPluginCount,
        [Parameter(Mandatory)][string]$Scope
    )

    $configPath = Join-Path $FixtureRoot 'build.json'
    $openConfig = Invoke-BridgeRequest $Bridge 'projects.openConfig' @{ configPath = $configPath } "$Scope`_open"
    $persistedWorkspace = Invoke-BridgeRequest $Bridge 'mods.getPersistedWorkspace' @{
        projectDirectory = $FixtureRoot
        profileName = 'Default'
    } "$Scope`_mods"
    $persistedInstalledCount = @($persistedWorkspace.data.installedMods).Count
    $persistedOrderCount = @($persistedWorkspace.data.modOrder).Count
    $interactiveFallback = $null
    $workspace = $persistedWorkspace
    if ($persistedInstalledCount -eq 0 -or $persistedOrderCount -eq 0) {
        $interactiveFallback = Invoke-BridgeRequest $Bridge 'mods.getWorkspace' @{
            projectDirectory = $FixtureRoot
            profileName = 'Default'
        } "$Scope`_mods_interactive_fallback"
        $workspace = $interactiveFallback
    }
    $plugins = Invoke-BridgeRequest $Bridge 'plugins.listPersisted' @{
        projectDirectory = $FixtureRoot
        templateId = 'skyrimse'
        profileName = 'Default'
    } "$Scope`_plugins_persisted"
    $profiles = Invoke-BridgeRequest $Bridge 'profiles.list' @{
        projectDirectory = $FixtureRoot
        defaultProfileName = 'Default'
    } "$Scope`_profiles"
    $executables = Invoke-BridgeRequest $Bridge 'executables.list' @{ configPath = $configPath } "$Scope`_executables"
    $downloads = Invoke-BridgeRequest $Bridge 'downloads.list' @{ projectDirectory = $FixtureRoot } "$Scope`_downloads"
    $reconciliation = $null
    $exactWorkspace = $interactiveFallback
    if ($null -eq $exactWorkspace) {
        $reconciliation = Invoke-BridgeRequest $Bridge 'mods.getWorkspace' @{
            projectDirectory = $FixtureRoot
            profileName = 'Default'
        } "$Scope`_mods_reconcile"
        $exactWorkspace = $reconciliation
    }
    $exactPlugins = Invoke-BridgeRequest $Bridge 'plugins.list' @{
        projectDirectory = $FixtureRoot
        templateId = 'skyrimse'
        profileName = 'Default'
    } "$Scope`_plugins_exact"

    $installedCount = @($workspace.data.installedMods).Count
    $orderCount = @($workspace.data.modOrder).Count
    if ($installedCount -ne $ExpectedModCount) {
        throw "Expected $ExpectedModCount installed mods, received $installedCount."
    }
    if ($orderCount -lt $ExpectedModCount) {
        throw "Expected at least $ExpectedModCount profile rows, received $orderCount."
    }
    if (@($profiles.data).Count -lt 1) {
        throw 'Profile list was empty.'
    }
    if (@($executables.data | Where-Object { $_.id -eq 'probe' }).Count -ne 1) {
        throw 'Synthetic launch probe executable was not returned.'
    }
    if (@($downloads.data).Count -ne 0) {
        throw 'Synthetic fixture unexpectedly contains downloads.'
    }
    if (@($exactWorkspace.data.installedMods).Count -ne $ExpectedModCount -or
        @($exactWorkspace.data.modOrder).Count -lt $ExpectedModCount) {
        throw 'Exact workspace materialization changed the synthetic workspace structure.'
    }
    $pluginCount = @($plugins.data).Count
    $exactPluginCount = @($exactPlugins.data).Count
    if ($pluginCount -ne $ExpectedPluginCount -or $exactPluginCount -ne $ExpectedPluginCount) {
        throw "Expected $ExpectedPluginCount fixture plugins; persisted returned $pluginCount and exact returned $exactPluginCount."
    }
    $persistedPluginProjection = Get-PluginStateProjection @($plugins.data)
    $exactPluginProjection = Get-PluginStateProjection @($exactPlugins.data)
    if ($persistedPluginProjection.json -cne $exactPluginProjection.json) {
        throw 'Persisted and exact plugin identity/order/enabled projections differ.'
    }

    $interactiveFallbackMs = if ($null -eq $interactiveFallback) {
        0.0
    }
    else {
        [double]$interactiveFallback.elapsedMs
    }
    $reconciliationMs = if ($null -eq $reconciliation) {
        0.0
    }
    else {
        [double]$reconciliation.elapsedMs
    }
    $nativeOpenRpcTotal = $openConfig.elapsedMs + $persistedWorkspace.elapsedMs + $plugins.elapsedMs +
        $profiles.elapsedMs + $executables.elapsedMs + $interactiveFallbackMs
    $backgroundTotal = $downloads.elapsedMs + $reconciliationMs + $exactPlugins.elapsedMs
    return [pscustomobject]@{
        nativeOpenRpcTotalMs = [math]::Round($nativeOpenRpcTotal, 3)
        openConfigMs = [math]::Round($openConfig.elapsedMs, 3)
        modsWorkspaceMs = [math]::Round($persistedWorkspace.elapsedMs, 3)
        interactiveFallbackMs = [math]::Round($interactiveFallbackMs, 3)
        pluginsMs = [math]::Round($plugins.elapsedMs, 3)
        profilesMs = [math]::Round($profiles.elapsedMs, 3)
        executablesMs = [math]::Round($executables.elapsedMs, 3)
        downloadsMs = [math]::Round($downloads.elapsedMs, 3)
        reconciliationMs = [math]::Round($reconciliationMs, 3)
        exactPluginsMs = [math]::Round($exactPlugins.elapsedMs, 3)
        backgroundTotalMs = [math]::Round($backgroundTotal, 3)
        installedCount = $installedCount
        orderCount = $orderCount
        persistedInstalledCount = $persistedInstalledCount
        persistedOrderCount = $persistedOrderCount
        pluginCount = $pluginCount
        exactPluginCount = $exactPluginCount
        expectedPluginCount = $ExpectedPluginCount
        persistedPluginProjectionSha256 = $persistedPluginProjection.sha256
        exactPluginProjectionSha256 = $exactPluginProjection.sha256
    }
}

function Get-OpenSummary {
    param([Parameter(Mandatory)][object[]]$Samples)

    return [pscustomobject]@{
        nativeOpenRpcTotal = (Get-Statistics -Values @($Samples.nativeOpenRpcTotalMs))
        openConfig = (Get-Statistics -Values @($Samples.openConfigMs))
        modsWorkspace = (Get-Statistics -Values @($Samples.modsWorkspaceMs))
        interactiveFallback = (Get-Statistics -Values @($Samples.interactiveFallbackMs))
        plugins = (Get-Statistics -Values @($Samples.pluginsMs))
        profiles = (Get-Statistics -Values @($Samples.profilesMs))
        executables = (Get-Statistics -Values @($Samples.executablesMs))
        downloads = (Get-Statistics -Values @($Samples.downloadsMs))
        reconciliation = (Get-Statistics -Values @($Samples.reconciliationMs))
        exactPlugins = (Get-Statistics -Values @($Samples.exactPluginsMs))
        backgroundTotal = (Get-Statistics -Values @($Samples.backgroundTotalMs))
    }
}

function Wait-ForProbeResult {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][System.Diagnostics.Stopwatch]$Stopwatch,
        [int]$TimeoutMilliseconds = 15000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Launch probe did not publish $Path within $TimeoutMilliseconds ms."
        }
        Start-Sleep -Milliseconds 10
    }
    return [pscustomobject]@{
        readyMs = [double]$Stopwatch.Elapsed.TotalMilliseconds
        result = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
}

function Wait-ForOwnedPidExit {
    param([Parameter(Mandatory)][int]$ProcessId)

    try {
        $process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
    }
    catch {
        return
    }
    try {
        if (-not $process.WaitForExit(10000)) {
            throw "Launch probe process $ProcessId did not exit within 10 seconds."
        }
    }
    finally {
        $process.Dispose()
    }
}

function Invoke-LaunchSample {
    param(
        [Parameter(Mandatory)]$Bridge,
        [Parameter(Mandatory)][string]$FixtureRoot,
        [Parameter(Mandatory)][string]$Scope,
        [string]$ProfileName = 'Default',
        [string]$ExecutableId = 'probe'
    )

    $configPath = Join-Path $FixtureRoot 'build.json'
    $resultPath = Join-Path $FixtureRoot 'probe-result.json'
    if (Test-Path -LiteralPath $resultPath) {
        Remove-Item -LiteralPath $resultPath -Force
    }
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $launch = Invoke-BridgeRequest $Bridge 'executables.launch' @{
        configPath = $configPath
        executableId = $ExecutableId
        profileName = $ProfileName
    } $Scope
    $requestCompletedMs = [double]$stopwatch.Elapsed.TotalMilliseconds
    $probe = Wait-ForProbeResult -Path $resultPath -Stopwatch $stopwatch
    $stopwatch.Stop()

    if (-not $probe.result.ok -or -not $probe.result.isX64) {
        throw "Launch probe validation failed: $($probe.result | ConvertTo-Json -Depth 8 -Compress)"
    }
    if ([int]$launch.data.processId -ne [int]$probe.result.pid) {
        throw 'Launch response and probe marker returned different process ids.'
    }
    Wait-ForOwnedPidExit -ProcessId ([int]$launch.data.processId)

    return [pscustomobject]@{
        bridgeLaunchMs = [math]::Round($launch.elapsedMs, 3)
        requestStartToReadyMs = [math]::Round($probe.readyMs, 3)
        responseToReadyMs = [math]::Round($probe.readyMs - $requestCompletedMs, 3)
        processCreationToProbeEntryMs = [double]$probe.result.creationToEntryMs
        processCreationToValidatedReadyMs = [double]$probe.result.creationToValidatedReadyMs
        descriptorPath = [string]$probe.result.vfsDescriptorPath
        processId = [int]$probe.result.pid
        overlayCorrect = [bool]$probe.result.ok
        managerEnvironmentUnchanged = [bool]$launch.data.managerEnvironmentUnchanged
        profileName = $ProfileName
        executableId = $ExecutableId
    }
}

function Get-LaunchSummary {
    param([Parameter(Mandatory)][object[]]$Samples)

    if ($Samples.Count -eq 0) {
        return $null
    }
    return [pscustomobject]@{
        bridgeLaunch = (Get-Statistics -Values @($Samples.bridgeLaunchMs))
        requestStartToReady = (Get-Statistics -Values @($Samples.requestStartToReadyMs))
        responseToReady = (Get-Statistics -Values @($Samples.responseToReadyMs))
        processCreationToProbeEntry = (Get-Statistics -Values @($Samples.processCreationToProbeEntryMs))
        processCreationToValidatedReady = (Get-Statistics -Values @($Samples.processCreationToValidatedReadyMs))
    }
}

function Prepare-AlternateProfileIsolationOrder {
    param(
        [Parameter(Mandatory)]$Bridge,
        [Parameter(Mandatory)][string]$FixtureRoot
    )

    $workspace = Invoke-BridgeRequest $Bridge 'mods.getWorkspace' @{
        projectDirectory = $FixtureRoot
        profileName = 'Alternate'
    } 'profile_isolation_prepare'
    $order = @($workspace.data.modOrder)
    $firstEnabled = $order |
        Where-Object { $_.kind -eq 'mod' -and $_.isEnabled -and -not [string]::IsNullOrWhiteSpace($_.orderId) } |
        Select-Object -First 1
    if ($null -eq $firstEnabled) {
        throw 'Alternate profile does not contain an enabled mod to move.'
    }
    $null = Invoke-BridgeRequest $Bridge 'mods.moveOrderItem' @{
        projectDirectory = $FixtureRoot
        profileName = 'Alternate'
        orderItemId = [string]$firstEnabled.orderId
        targetIndex = [Math]::Max(0, $order.Count - 1)
    } 'profile_isolation_move'
}

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
    $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $WorkRoot = Join-Path $repositoryRoot 'benchmarks\work'
}
$resolvedWorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
[System.IO.Directory]::CreateDirectory($resolvedWorkRoot) | Out-Null
$workRootLock = Enter-PerformanceWorkRootLock $resolvedWorkRoot

try {
$resolvedHost = Resolve-RequiredFile $HostPath
$hostDirectory = [System.IO.Path]::GetDirectoryName($resolvedHost)
$resolvedCore = Resolve-RequiredFile $(
    if ([string]::IsNullOrWhiteSpace($CorePath)) {
        Join-Path $hostDirectory 'FluxoraCore.dll'
    }
    else {
        $CorePath
    }
)
$resolvedVfs = Resolve-RequiredFile $(
    if ([string]::IsNullOrWhiteSpace($VfsPath)) {
        Join-Path $hostDirectory 'FluxoraVfs.dll'
    }
    else {
        $VfsPath
    }
)
$resolvedBuilder = Resolve-RequiredFile $FixtureBuilderPath
$resolvedProbe = Resolve-RequiredFile $ProbePath
$resolvedResultPath = [System.IO.Path]::GetFullPath($ResultPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolvedResultPath)) | Out-Null

$gitCommit = (& git -C (Join-Path $PSScriptRoot '..\..') rev-parse HEAD 2>$null | Select-Object -First 1)
$gitDirty = @(& git -C (Join-Path $PSScriptRoot '..\..') status --porcelain 2>$null).Count -gt 0
$result = [ordered]@{
    schemaVersion = 5
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    environment = [ordered]@{
        os = [Environment]::OSVersion.VersionString
        processor = $env:PROCESSOR_IDENTIFIER
        processorCount = [Environment]::ProcessorCount
        configuration = 'Release'
        architecture = 'x64'
        gitCommit = $gitCommit
        gitDirty = $gitDirty
        hostSha256 = Get-Sha256 $resolvedHost
        coreSha256 = Get-Sha256 $resolvedCore
        vfsSha256 = Get-Sha256 $resolvedVfs
        fixtureBuilderSha256 = Get-Sha256 $resolvedBuilder
        probeSha256 = Get-Sha256 $resolvedProbe
    }
    cacheSemantics = [ordered]@{
        nativeOpenRpcProxy = 'sum of production BridgeHost RPC elapsed times only; it excludes Tauri watcher installation, renderer scheduling, React commit, and the next interactive frame and therefore is not UI T0-to-T3'
        metadataCold = 'instance.db absent; an empty persisted mod snapshot falls back to exact mods.getWorkspace inside nativeOpenRpcTotalMs; raw persisted counts and fallback timing remain explicit; operating-system file cache is uncontrolled'
        processColdMetadataWarm = 'new BridgeHost process with persisted instance.db; nativeOpenRpcTotalMs excludes downloads and exact mod/plugin reconciliation'
        processWarm = 'same BridgeHost process after explicit warm-up runs; nativeOpenRpcTotalMs excludes deferred exact mod/plugin work'
        interactivePlugins = 'plugins.listPersisted reads persisted profile plugin state and is recorded as pluginsMs inside nativeOpenRpcTotalMs'
        interactiveFallback = 'empty persisted installed/order rows trigger exact mods.getWorkspace as interactiveFallbackMs; only packaged UI logs can establish whether this lies inside UI T0-to-T3'
        backgroundReconciliation = 'downloads, then exact mods.getWorkspace unless the fallback already ran it, then exact plugins.list after the persisted RPC snapshot'
        exactPlugins = 'plugins.list runs after exact mods.getWorkspace and is recorded as exactPluginsMs inside backgroundTotalMs'
        launch = 'metadata prepared before launch; probe process exits cleanly after each isolated sample'
    }
    settings = [ordered]@{
        modCounts = $resolvedModCounts
        filesPerMod = $FilesPerMod
        pluginCount = $PluginCount
        disabledPercent = $DisabledPercent
        conflictFilesPerMod = $ConflictFilesPerMod
        directoryDepth = $DirectoryDepth
        directoriesPerMod = $DirectoriesPerMod
        runs = $Runs
        warmups = $Warmups
        coldRuns = $ColdRuns
        maximumModeledFiles = $MaximumModeledFiles
        allowLargeFixture = [bool]$AllowLargeFixture
        importedStructuralStatistics = if ($null -eq $importedStructure) {
            $null
        }
        else {
            [ordered]@{
                sha256 = Get-Sha256 $importedStructure.sourcePath
                modCount = $importedStructure.modCount
                filesPerMod = $importedStructure.filesPerMod
                pluginCount = $importedStructure.pluginCount
                disabledPercent = $importedStructure.disabledPercent
                conflictFilesPerMod = $importedStructure.conflictFilesPerMod
                directoryDepth = $importedStructure.directoryDepth
                directoriesPerMod = $importedStructure.directoriesPerMod
            }
        }
        seed = '0xF10C0A'
    }
    scenarios = @()
}

foreach ($modCount in $resolvedModCounts) {
    $modeledFiles = [long]$modCount * [long]$FilesPerMod
    if (-not $AllowLargeFixture -and $modeledFiles -gt $MaximumModeledFiles) {
        throw "Refusing to generate $modeledFiles modeled files ($modCount mods x $FilesPerMod). The safety limit is $MaximumModeledFiles; pass -AllowLargeFixture only for an intentional stress run."
    }
    $fixtureRoot = Join-Path $resolvedWorkRoot ("fixture-{0}" -f $modCount)
    $pluginsForFixture = [math]::Min($PluginCount, $modCount)
    $directoryBranches = if ($DirectoryDepth -gt 0) {
        [math]::Max(1, [int][math]::Ceiling($DirectoriesPerMod / [double]$DirectoryDepth))
    }
    else { 1 }
    $builderArguments = @(
        '--output', $fixtureRoot,
        '--probe', $resolvedProbe,
        '--mods', $modCount,
        '--files-per-mod', $FilesPerMod,
        '--plugins', $pluginsForFixture,
        '--disabled-percent', $DisabledPercent,
        '--conflict-files', ([math]::Min($ConflictFilesPerMod, $FilesPerMod)),
        '--directory-depth', $DirectoryDepth,
        '--directory-branches', $directoryBranches,
        '--seed', '0xF10C0A'
    )

    $fixtureMetadata = $null
    $metadataColdSamples = @()
    for ($index = 0; $index -lt $ColdRuns; $index++) {
        & $resolvedBuilder @builderArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Fixture generation failed for $modCount mods."
        }
        $fixtureMetadata = Get-Content -LiteralPath (Join-Path $fixtureRoot '.fluxora-perf-fixture.json') -Raw |
            ConvertFrom-Json
        $expectedPluginCount = [int]$fixtureMetadata.expectedPluginCount
        if ($expectedPluginCount -lt 1) {
            throw "Fixture metadata for $modCount mods does not contain a valid expectedPluginCount."
        }
        $bridge = Start-BridgeHost $resolvedHost (Join-Path $fixtureRoot '.flow\performance-logs')
        try {
            $metadataColdSamples += Invoke-OpenFlow `
                $bridge $fixtureRoot $modCount $expectedPluginCount "cold_$index"
        }
        finally {
            $stderr = Stop-BridgeHost $bridge
            if (-not [string]::IsNullOrWhiteSpace($stderr)) {
                throw "BridgeHost stderr during metadata-cold run: $stderr"
            }
        }
    }

    $processColdSamples = @()
    for ($index = 0; $index -lt $Runs; $index++) {
        $bridge = Start-BridgeHost $resolvedHost (Join-Path $fixtureRoot '.flow\performance-logs')
        try {
            $processColdSamples += Invoke-OpenFlow `
                $bridge $fixtureRoot $modCount $expectedPluginCount "process_cold_$index"
        }
        finally {
            $stderr = Stop-BridgeHost $bridge
            if (-not [string]::IsNullOrWhiteSpace($stderr)) {
                throw "BridgeHost stderr during process-cold run: $stderr"
            }
        }
    }

    $profileBefore = Get-ProfileFileState $fixtureRoot
    $processWarmSamples = @()
    $launchSamples = @()
    $profileIsolationSamples = @()
    $bridge = Start-BridgeHost $resolvedHost (Join-Path $fixtureRoot '.flow\performance-logs')
    try {
        for ($index = 0; $index -lt $Warmups; $index++) {
            $null = Invoke-OpenFlow $bridge $fixtureRoot $modCount $expectedPluginCount "warmup_$index"
        }
        for ($index = 0; $index -lt $Runs; $index++) {
            $processWarmSamples += Invoke-OpenFlow `
                $bridge $fixtureRoot $modCount $expectedPluginCount "warm_$index"
        }

        if (-not $SkipLaunch) {
            if ($Warmups -gt 0) {
                $null = Invoke-LaunchSample $bridge $fixtureRoot 'launch_warmup'
            }
            for ($index = 0; $index -lt $Runs; $index++) {
                $launchSamples += Invoke-LaunchSample $bridge $fixtureRoot "launch_$index"
            }
            Prepare-AlternateProfileIsolationOrder $bridge $fixtureRoot
            $profileIsolationSamples += Invoke-LaunchSample `
                $bridge $fixtureRoot 'profile_isolation_alternate' 'Alternate' 'probe-alternate'
            $profileIsolationSamples += Invoke-LaunchSample `
                $bridge $fixtureRoot 'profile_isolation_default' 'Default' 'probe'
        }
    }
    finally {
        $stderr = Stop-BridgeHost $bridge
        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            throw "BridgeHost stderr during warm run: $stderr"
        }
    }
    $profileAfter = Get-ProfileFileState $fixtureRoot
    $allLaunchSamples = @($launchSamples) + @($profileIsolationSamples)
    $descriptorPaths = @($allLaunchSamples.descriptorPath)
    $profileHashPreserved = $profileBefore.contentSignature -eq $profileAfter.contentSignature
    $profileTimestampPreserved = $profileBefore.timestampSignature -eq $profileAfter.timestampSignature
    $allLaunchOverlaysCorrect = if ($SkipLaunch) {
        $null
    }
    else {
        @($allLaunchSamples | Where-Object { -not $_.overlayCorrect }).Count -eq 0
    }
    $launchDescriptorsUnique = if ($SkipLaunch) {
        $null
    }
    else {
        $descriptorPaths.Count -eq @($descriptorPaths | Sort-Object -Unique).Count
    }
    $managerEnvironmentUnchanged = if ($SkipLaunch) {
        $null
    }
    else {
        @($allLaunchSamples | Where-Object { -not $_.managerEnvironmentUnchanged }).Count -eq 0
    }

    if (-not $profileHashPreserved -or -not $profileTimestampPreserved) {
        throw "Measured read-only flow changed profile state for the $modCount-mod fixture."
    }
    if (-not $SkipLaunch -and (
            -not $allLaunchOverlaysCorrect -or
            -not $launchDescriptorsUnique -or
            -not $managerEnvironmentUnchanged)) {
        throw "Launch correctness invariant failed for the $modCount-mod fixture."
    }

    $result.scenarios += [pscustomobject]@{
        fixture = $fixtureMetadata
        fixtureRoot = $fixtureRoot
        metadataCold = [pscustomobject]@{
            samples = $metadataColdSamples
            statistics = Get-OpenSummary $metadataColdSamples
        }
        processColdMetadataWarm = [pscustomobject]@{
            samples = $processColdSamples
            statistics = Get-OpenSummary $processColdSamples
        }
        processWarm = [pscustomobject]@{
            samples = $processWarmSamples
            statistics = Get-OpenSummary $processWarmSamples
        }
        launch = [pscustomobject]@{
            samples = $launchSamples
            statistics = Get-LaunchSummary $launchSamples
            profileIsolationSamples = $profileIsolationSamples
        }
        correctness = [pscustomobject]@{
            repeatedProfileReadPreservedHash = $profileHashPreserved
            repeatedProfileReadPreservedTimestamp = $profileTimestampPreserved
            allLaunchOverlaysCorrect = $allLaunchOverlaysCorrect
            launchDescriptorsUnique = $launchDescriptorsUnique
            managerVfsEnvironmentUnchanged = $managerEnvironmentUnchanged
        }
    }
}

$json = $result | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText(
    $resolvedResultPath,
    $json,
    [System.Text.UTF8Encoding]::new($false))
Write-Output "Fluxora performance results written to $resolvedResultPath"
}
finally {
    $workRootLock.Dispose()
}
