[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$HostPath
)

$ErrorActionPreference = 'Stop'
$resolvedHost = (Resolve-Path -LiteralPath $HostPath).Path
$tempRoot = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) ("fluxora-build-files-bridge-{0}" -f ([guid]::NewGuid().ToString('N'))))
)
$osTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $tempRoot.StartsWith($osTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Build-files bridge test root escaped temp: $tempRoot"
}
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null

$process = $null
try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedHost
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    foreach ($encodingProperty in @('StandardInputEncoding', 'StandardOutputEncoding', 'StandardErrorEncoding')) {
        if ($null -ne $startInfo.PSObject.Properties[$encodingProperty]) {
            $startInfo.$encodingProperty = $utf8
        }
    }
    $startInfo.EnvironmentVariables['FLUXORA_LOG_DIR'] = $tempRoot
    $startInfo.EnvironmentVariables['FLUXORA_APP_ROOT'] = $tempRoot
    $startInfo.EnvironmentVariables['FLUXORA_OPERATION_CANCEL_DIR'] = (Join-Path $tempRoot 'operation-cancel')

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw 'FluxoraBridgeHost did not start.'
    }
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.AutoFlush = $true

    $requestNumber = 0
    function Send-Request {
        param(
            [Parameter(Mandatory)][string]$Method,
            [Parameter(Mandatory)][hashtable]$Params,
            [string]$OperationId = 'op_build_files_bridge'
        )
        $script:requestNumber++
        $request = @{
            jsonrpc = '2.0'
            id = "build_files_$($script:requestNumber)"
            method = $Method
            params = $Params
            meta = @{
                protocolVersion = '1.0'
                operationId = $OperationId
                requestSource = 'backend-test'
                appVersion = '0.0.0-test'
                platform = 'win32'
                arch = 'x64'
                locale = 'en-US'
            }
        }
        $task = $process.StandardOutput.ReadLineAsync()
        $process.StandardInput.WriteLine(($request | ConvertTo-Json -Depth 20 -Compress))
        $process.StandardInput.Flush()
        if (-not $task.Wait(15000)) {
            $process.StandardInput.Close()
            $wasExited = $process.HasExited
            if (-not $wasExited) {
                $process.Kill()
                $process.WaitForExit(5000) | Out-Null
            }
            $stderr = $stderrTask.GetAwaiter().GetResult()
            throw "Timed out waiting for $Method. exited=$wasExited stderr=$stderr"
        }
        $line = $task.GetAwaiter().GetResult()
        if ([string]::IsNullOrWhiteSpace($line)) {
            throw "No response for $Method."
        }
        return $line | ConvertFrom-Json
    }

    $handshake = Send-Request -Method 'system.handshake' -Params @{
        supportedProtocolVersions = @('1.0')
    }
    if ($handshake.result.data.capabilities.features.aiFileToolsV1.state -ne 'private-dev') {
        throw 'aiFileToolsV1 capability is missing or public.'
    }

    $game = Join-Path $tempRoot 'Game'
    $installRoot = Join-Path $tempRoot 'Builds'
    [System.IO.Directory]::CreateDirectory((Join-Path $game 'Data')) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $game 'SkyrimSE.exe'), 'MZ', $utf8)
    [System.IO.File]::WriteAllText((Join-Path $game 'Data\Skyrim.esm'), 'master', $utf8)
    $created = Send-Request -Method 'projects.create' -Params @{
        projectName = 'AI Bridge Workspace'
        templateId = 'skyrimse'
        gamePath = $game
        installRootDirectory = $installRoot
    }
    if ($null -eq $created.result.data.projectDirectory) {
        throw 'Project creation did not return a project directory.'
    }

    $project = [string]$created.result.data.projectDirectory
    $file = Join-Path $project 'mods\Example\settings.json'
    $emptyFile = Join-Path $project 'mods\Example\empty.txt'
    $communitySettings = Join-Path $project 'mods\Cabbage CS Preset\SKSE\Plugins\CommunityShaders\SettingsUser.json'
    $grassControl = Join-Path $project 'mods\No Grass In Objects\SKSE\Plugins\GrassControl.ini'
    $managedGrass = Join-Path $project 'mods\Fluxora AI Overrides\SKSE\Plugins\GrassControl.ini'
    $overwriteGrass = Join-Path $project 'overwrite\SKSE\Plugins\GrassControl.ini'
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($file)) | Out-Null
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($communitySettings)) | Out-Null
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($grassControl)) | Out-Null
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($managedGrass)) | Out-Null
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($overwriteGrass)) | Out-Null
    [System.IO.File]::WriteAllText($file, "{`"enabled`":false}`r`n", $utf8)
    [System.IO.File]::WriteAllText($emptyFile, '', $utf8)
    [System.IO.File]::WriteAllText(
        $communitySettings,
        "{`"Menu`":{`"ToggleKey`":35,`"ShaderBlockNextKey`":34}}`r`n",
        $utf8)
    [System.IO.File]::WriteAllText(
        $grassControl,
        "[Grass]`r`nUse-grass-cache=false`r`nOnly-load-from-cache=true`r`n",
        $utf8)
    [System.IO.File]::WriteAllText(
        $managedGrass,
        "[Grass]`r`nUse-grass-cache=false`r`nOnly-load-from-cache=true`r`nManaged-only=keep`r`n",
        $utf8)
    [System.IO.File]::WriteAllText(
        $overwriteGrass,
        "[Grass]`r`nUse-grass-cache=false`r`nOnly-load-from-cache=true`r`nOverwrite-only=keep`r`n",
        $utf8)

    $begin = Send-Request -Method 'buildFiles.beginChat' -Params @{
        chatId = 'chat-bridge'
        projectDirectory = $project
        profile = 'Default'
    }
    if (-not $begin.result.data.active) {
        throw 'buildFiles.beginChat was not accepted.'
    }

    $discovery = Send-Request -Method 'buildFiles.discover' -Params @{
        chatId = 'chat-bridge'
        scopes = @('build')
        aliases = @('Community Shader', 'CommunityShaders', 'CS')
        extensions = @('.json', '.jsonc')
        configHints = @('SettingsUser')
        semanticKeys = @('Menu.ToggleKey', 'Menu.ShaderBlockNextKey')
        limit = 20
    }
    $communityCandidate = @($discovery.result.data.candidates) |
        Where-Object { $_.file.fileName -eq 'SettingsUser.json' -and $_.effectiveWinner } |
        Select-Object -First 1
    if ($null -eq $communityCandidate -or
        -not $discovery.result.data.complete -or
        $discovery.result.data.statistics.scannedEntries -lt 1 -or
        [string]::IsNullOrWhiteSpace([string]$discovery.result.data.revision)) {
        throw 'buildFiles.discover omitted the effective Community Shaders candidate or completion evidence.'
    }
    $communityExact = Send-Request -Method 'buildFiles.search' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'Cabbage CS Preset/SKSE/Plugins/CommunityShaders/SettingsUser.json'
        limit = 20
    }
    if ($communityExact.result.data.entries.Count -ne 1) {
        throw 'buildFiles.search did not resolve the exact Community Shaders target.'
    }
    $communityRef = [string]$communityExact.result.data.entries[0].fileRef
    $communityQuery = Send-Request -Method 'buildFiles.queryJson' -Params @{
        chatId = 'chat-bridge'
        fileRef = $communityRef
        pointer = '/Menu/ToggleKey'
    }
    $recipe = Send-Request -Method 'buildFiles.inspectConfigRecipe' -Params @{
        chatId = 'chat-bridge'
        fileRef = $communityRef
        targetPointer = '/Menu/ToggleKey'
        requestedValue = 'PageDown'
    }
    if ($recipe.result.data.encodedValue -ne '34' -or
        $recipe.result.data.currentValue -ne '35' -or
        $recipe.result.data.recipeId -ne 'community-shaders.menu-toggle-key.v1' -or
        $recipe.result.data.needsInput -or
        @($recipe.result.data.conflicts).Count -ne 0) {
        throw 'buildFiles.inspectConfigRecipe did not return the generic JSON Pointer preflight.'
    }
    $communityApply = Send-Request -Method 'buildFiles.apply' -OperationId 'op_bridge_json_pointer' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-json-pointer'
        mutations = @(
            @{
                kind = 'json-set-pointer'
                fileRef = $communityRef
                revision = [string]$communityExact.result.data.entries[0].indexRevision
                baseSha256 = [string]$communityQuery.result.data.sha256
                pointer = '/Menu/ToggleKey'
                expectedValue = '35'
                value = '34'
                format = 'json'
            }
        )
    }
    $managedSettings = Join-Path $project 'mods\Fluxora AI Overrides\SKSE\Plugins\CommunityShaders\SettingsUser.json'
    if ($null -ne $communityApply.error) {
        throw "buildFiles.json-set-pointer failed: $($communityApply.error | ConvertTo-Json -Depth 10 -Compress)"
    }
    if ($communityApply.result.data.files[0].verification -ne 'json-pointer-matched-after-reread' -or
        -not [System.IO.File]::Exists($managedSettings) -or
        -not ([System.IO.File]::ReadAllText($communitySettings).Contains('"ToggleKey":35')) -or
        -not ([System.IO.File]::ReadAllText($managedSettings).Contains('"ToggleKey":34'))) {
        throw 'buildFiles.json-set-pointer did not create and verify a managed override.'
    }
    $communityRollback = Send-Request -Method 'buildFiles.rollbackRun' -OperationId 'op_bridge_json_pointer_rollback' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-json-pointer'
    }
    if ($communityRollback.result.data.state -ne 'rolled-back' -or
        [System.IO.File]::Exists($managedSettings)) {
        throw 'Managed JSON Pointer override did not roll back cleanly.'
    }

    $grassSearch = Send-Request -Method 'buildFiles.search' -OperationId 'op_bridge_grass_broad_search' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'GrassControl.ini'
        limit = 20
    }
    $grassSourceSearch = Send-Request -Method 'buildFiles.search' -OperationId 'op_bridge_grass_source_search' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'No Grass In Objects/SKSE/Plugins/GrassControl.ini'
        limit = 20
    }
    if ($grassSearch.result.data.entries.Count -ne 1 -or
        $grassSearch.result.data.totalMatches -ne 1 -or
        $grassSourceSearch.result.data.entries.Count -ne 1 -or
        $grassSourceSearch.result.data.entries[0].fileRef -ne $grassSearch.result.data.entries[0].fileRef) {
        throw 'buildFiles.search did not normalize the broad and source-specific GrassControl.ini queries to one winner ref.'
    }
    if ($grassSearch.result.data.entries[0].ownerMod -ne 'Overwrite' -or
        $grassSearch.result.data.entries[0].managedOverrideEligible -ne $false -or
        $grassSearch.result.data.entries[0].directMutationEligible -ne $true -or
        -not (@($grassSearch.result.data.entries[0].conflictingOwners) -contains 'No Grass In Objects') -or
        -not (@($grassSearch.result.data.entries[0].conflictingOwners) -contains 'Fluxora AI Overrides')) {
        throw 'buildFiles.search did not return the directly mutable effective Overwrite config.'
    }
    $grassRef = [string]$grassSearch.result.data.entries[0].fileRef
    $useCache = Send-Request -Method 'buildFiles.queryIni' -Params @{
        chatId = 'chat-bridge'
        fileRef = $grassRef
        section = 'Grass'
        key = 'Use-grass-cache'
    }
    $onlyCache = Send-Request -Method 'buildFiles.queryIni' -Params @{
        chatId = 'chat-bridge'
        fileRef = $grassRef
        section = 'Grass'
        key = 'Only-load-from-cache'
    }
    $grassApply = Send-Request -Method 'buildFiles.apply' -OperationId 'op_bridge_ini_batch' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-ini-batch'
        mutations = @(
            @{
                kind = 'ini-set'
                fileRef = $grassRef
                revision = [string]$grassSearch.result.data.entries[0].indexRevision
                baseSha256 = [string]$useCache.result.data.sha256
                section = 'Grass'
                key = 'Use-grass-cache'
                expectedValue = 'false'
                value = 'true'
                format = 'ini'
            },
            @{
                kind = 'ini-set'
                fileRef = $grassRef
                revision = [string]$grassSearch.result.data.entries[0].indexRevision
                baseSha256 = [string]$onlyCache.result.data.sha256
                section = 'Grass'
                key = 'Only-load-from-cache'
                expectedValue = 'true'
                value = 'false'
                format = 'ini'
            }
        )
    }
    if ($null -ne $grassApply.error -or
        @($grassApply.result.data.files).Count -ne 1 -or
        $grassApply.result.data.files[0].ownerMod -ne 'Overwrite' -or
        $grassApply.result.data.files[0].verification -ne 'ini-keys-matched-after-reread' -or
        @($grassApply.result.data.files[0].hunks).Count -ne 2 -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Use-grass-cache=false')) -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Only-load-from-cache=true')) -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Managed-only=keep')) -or
        -not ([System.IO.File]::ReadAllText($overwriteGrass).Contains('Use-grass-cache=true')) -or
        -not ([System.IO.File]::ReadAllText($overwriteGrass).Contains('Only-load-from-cache=false')) -or
        -not ([System.IO.File]::ReadAllText($overwriteGrass).Contains('Overwrite-only=keep')) -or
        -not ([System.IO.File]::ReadAllText($grassControl).Contains('Use-grass-cache=false'))) {
        $actualGrassApply = $grassApply | ConvertTo-Json -Depth 20 -Compress
        throw "buildFiles.apply did not atomically apply two distinct INI keys. Actual: $actualGrassApply"
    }
    $grassRollback = Send-Request -Method 'buildFiles.rollbackRun' -OperationId 'op_bridge_ini_batch_rollback' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-ini-batch'
    }
    if ($grassRollback.result.data.state -ne 'rolled-back' -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Use-grass-cache=false')) -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Only-load-from-cache=true')) -or
        -not ([System.IO.File]::ReadAllText($managedGrass).Contains('Managed-only=keep')) -or
        -not ([System.IO.File]::ReadAllText($overwriteGrass).Contains('Use-grass-cache=false')) -or
        -not ([System.IO.File]::ReadAllText($overwriteGrass).Contains('Only-load-from-cache=true'))) {
        throw 'Direct Overwrite multi-key INI mutation did not roll back cleanly.'
    }

    $search = Send-Request -Method 'buildFiles.search' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'settings.json'
        limit = 20
    }
    if ($search.result.data.entries.Count -ne 1) {
        throw 'buildFiles.search did not return the unique file.'
    }
    $fileRef = [string]$search.result.data.entries[0].fileRef
    if ([string]::IsNullOrWhiteSpace($fileRef) -or $fileRef.Contains($project)) {
        throw 'buildFiles.search leaked a path or omitted fileRef.'
    }
    if ($search.result.data.entries[0].managedOverrideEligible -ne $true) {
        throw 'buildFiles.search did not expose managed override eligibility for the mod-owned file.'
    }

    $read = Send-Request -Method 'buildFiles.readText' -Params @{
        chatId = 'chat-bridge'
        fileRef = $fileRef
        startLine = 1
        maxLines = 120
        maxBytes = 8192
    }
    $hash = [string]$read.result.data.sha256
    if ([string]::IsNullOrWhiteSpace($hash)) {
        throw 'buildFiles.readText omitted SHA-256.'
    }

    $query = Send-Request -Method 'buildFiles.queryJson' -Params @{
        chatId = 'chat-bridge'
        fileRef = $fileRef
        pointer = '/enabled'
    }
    if ($query.result.data.value -ne 'false' -or
        $query.result.data.sha256 -ne $hash) {
        throw 'buildFiles.queryJson did not preserve the correlated read version.'
    }

    $contentSearch = Send-Request -Method 'buildFiles.searchText' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'enabled'
        limit = 20
    }
    if ($contentSearch.result.data.matches.Count -ne 1 -or
        $contentSearch.result.data.matches[0].fileRef -ne $fileRef) {
        throw 'buildFiles.searchText did not return one bounded opaque match.'
    }

    $apply = Send-Request -Method 'buildFiles.apply' -OperationId 'op_bridge_apply' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-bridge'
        mutations = @(
            @{
                kind = 'patch'
                fileRef = $fileRef
                revision = [string]$search.result.data.entries[0].indexRevision
                baseSha256 = $hash
                expectedText = '"enabled":false'
                replacementText = '"enabled":true'
                format = 'json'
            }
        )
    }
    if ($apply.result.data.schema -ne 'fluxora.ai.file-change-set.v1' -or
        $apply.result.data.operationId -ne 'op_bridge_apply') {
        throw 'buildFiles.apply lost schema or operationId.'
    }
    $settingsOverride = Join-Path $project 'mods\Fluxora AI Overrides\settings.json'
    if (-not ([System.IO.File]::ReadAllText($file).Contains('"enabled":false')) -or
        -not [System.IO.File]::Exists($settingsOverride) -or
        -not ([System.IO.File]::ReadAllText($settingsOverride).Contains('"enabled":true'))) {
        throw 'buildFiles.apply did not isolate the patch in the managed override.'
    }

    $invented = Send-Request -Method 'buildFiles.stat' -OperationId 'op_bridge_invented' -Params @{
        chatId = 'chat-bridge'
        fileRef = 'fileRef_invented'
    }
    if ($invented.error.code -ne 'outside-scope' -or
        $invented.meta.operationId -ne 'op_bridge_invented') {
        throw 'Invented fileRef did not fail with typed, correlated outside-scope.'
    }

    $statesBeforeRollback = Send-Request -Method 'buildFiles.getRollbackStates' -OperationId 'op_bridge_rollback_states_before' -Params @{
        chatId = 'chat-bridge'
    }
    $runBridgeStateBefore = @($statesBeforeRollback.result.data | Where-Object { $_.runId -eq 'run-bridge' })
    if ($runBridgeStateBefore.Count -ne 1 -or
        $runBridgeStateBefore[0].state -ne 'available' -or
        $statesBeforeRollback.meta.operationId -ne 'op_bridge_rollback_states_before') {
        $actualStates = $statesBeforeRollback | ConvertTo-Json -Depth 10 -Compress
        throw "buildFiles.getRollbackStates did not serialize the available run or preserve operationId. Actual: $actualStates"
    }

    $rollback = Send-Request -Method 'buildFiles.rollbackRun' -OperationId 'op_bridge_rollback' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-bridge'
    }
    if ($rollback.result.data.state -ne 'rolled-back' -or
        $rollback.result.data.operationId -ne 'op_bridge_rollback' -or
        $rollback.result.data.mode -ne 'exact' -or
        $rollback.result.data.preservedNewerChanges -ne $false -or
        [System.IO.File]::Exists($settingsOverride)) {
        throw 'buildFiles.rollbackRun failed or lost additive rollback fields/operationId.'
    }

    $statesAfterRollback = Send-Request -Method 'buildFiles.getRollbackStates' -OperationId 'op_bridge_rollback_states_after' -Params @{
        chatId = 'chat-bridge'
    }
    $runBridgeStateAfter = @($statesAfterRollback.result.data | Where-Object { $_.runId -eq 'run-bridge' })
    if ($runBridgeStateAfter.Count -ne 1 -or
        $runBridgeStateAfter[0].state -ne 'rolled-back') {
        throw 'buildFiles.getRollbackStates did not restore the run-level rolled-back state.'
    }

    $emptySearch = Send-Request -Method 'buildFiles.search' -Params @{
        chatId = 'chat-bridge'
        scope = 'build'
        query = 'Example/empty.txt'
        limit = 20
    }
    $emptyRef = [string]$emptySearch.result.data.entries[0].fileRef
    $emptyRead = Send-Request -Method 'buildFiles.readText' -Params @{
        chatId = 'chat-bridge'
        fileRef = $emptyRef
        startLine = 1
        maxLines = 120
        maxBytes = 8192
    }
    $documentSave = Send-Request -Method 'buildFiles.apply' -OperationId 'op_bridge_document_save' -Params @{
        chatId = 'chat-bridge'
        runId = 'run-document-save'
        mutations = @(
            @{
                kind = 'replace-document'
                fileRef = $emptyRef
                revision = [string]$emptySearch.result.data.entries[0].indexRevision
                baseSha256 = [string]$emptyRead.result.data.sha256
                replacementText = "saved`n"
                format = 'plain-text'
            }
        )
    }
    $emptyOverride = Join-Path $project 'mods\Fluxora AI Overrides\empty.txt'
    if ($documentSave.result.data.operationId -ne 'op_bridge_document_save' -or
        [System.IO.File]::ReadAllText($emptyFile) -ne '' -or
        -not [System.IO.File]::Exists($emptyOverride) -or
        [System.IO.File]::ReadAllText($emptyOverride) -ne "saved`n") {
        throw 'buildFiles.replace-document did not isolate the empty editor save in the managed override.'
    }

    $resetRollbackCheckpoints = Send-Request -Method 'buildFiles.resetRollbackCheckpoints' -OperationId 'op_bridge_rollback_reset' -Params @{}
    if ($resetRollbackCheckpoints.result.data.reset -ne $true -or
        $resetRollbackCheckpoints.meta.operationId -ne 'op_bridge_rollback_reset') {
        throw 'buildFiles.resetRollbackCheckpoints failed or lost operationId.'
    }
    $statesAfterReset = Send-Request -Method 'buildFiles.getRollbackStates' -Params @{
        chatId = 'chat-bridge'
    }
    if ($statesAfterReset.result.data.Count -ne 0) {
        throw 'Full AI rollback reset retained checkpoint state.'
    }

    $shutdown = Send-Request -Method 'system.shutdown' -Params @{}
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(5000)) {
        throw 'FluxoraBridgeHost did not exit after shutdown.'
    }
    Write-Output 'Build-files bridge protocol passed.'
}
finally {
    if ($null -ne $process) {
        if (-not $process.HasExited) {
            $process.Kill()
            $process.WaitForExit(5000) | Out-Null
        }
        $process.Dispose()
    }
    if ($tempRoot.StartsWith($osTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
