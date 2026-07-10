[CmdletBinding()]
param(
    [string]$HostPath = '',

    [ValidateRange(50, 60000)]
    [int]$ResponseTimeoutMilliseconds = 5000,

    [ValidateRange(50, 60000)]
    [int]$ExitTimeoutMilliseconds = 5000,

    [switch]$RunTimeoutProbe
)

$ErrorActionPreference = 'Stop'

if (-not $RunTimeoutProbe -and [string]::IsNullOrWhiteSpace($HostPath)) {
    $HostPath = Join-Path $PSScriptRoot '..\..\build\backend\Release\FluxoraBridgeHost.exe'
}

function Wait-TextTask {
    param(
        [Parameter(Mandatory)]
        [System.Threading.Tasks.Task[string]]$Task,

        [Parameter(Mandatory)]
        [int]$TimeoutMilliseconds,

        [Parameter(Mandatory)]
        [string]$Description
    )

    if (-not $Task.Wait($TimeoutMilliseconds)) {
        throw [System.TimeoutException]::new(
            "$Description timed out after $TimeoutMilliseconds ms."
        )
    }

    return $Task.GetAwaiter().GetResult()
}

function Stop-OwnedProcess {
    param(
        [Parameter(Mandatory)]
        [System.Diagnostics.Process]$Process,

        [Parameter(Mandatory)]
        [int]$TimeoutMilliseconds
    )

    if ($Process.HasExited) {
        return
    }

    try {
        $Process.Kill()
    }
    catch {
        if (-not $Process.HasExited) {
            throw
        }
    }
    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        throw "Owned process $($Process.Id) could not be terminated within $TimeoutMilliseconds ms."
    }
}

function Invoke-BridgeHostRequest {
    param(
        [Parameter(Mandatory)]
        [hashtable]$Request
    )

    $resolvedHost = (Resolve-Path -LiteralPath $HostPath).Path
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $testRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $tempRoot ("fluxora-bridge-protocol-{0}" -f ([guid]::NewGuid().ToString('N'))))
    )
    if (-not $testRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Bridge protocol test root escaped the OS temp directory: $testRoot"
    }
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $process = $null
    $processStarted = $false

    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $resolvedHost
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.Environment['FLUXORA_LOG_DIR'] = $testRoot
        $startInfo.Environment['FLUXORA_OPERATION_CANCEL_DIR'] = (Join-Path $testRoot 'operation-cancel')

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw 'Failed to start FluxoraBridgeHost.'
        }
        $processStarted = $true

        $responseTask = $process.StandardOutput.ReadLineAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        $requestJson = $Request | ConvertTo-Json -Depth 10 -Compress
        $process.StandardInput.WriteLine($requestJson)
        $process.StandardInput.Close()

        $responseLine = Wait-TextTask `
            -Task $responseTask `
            -TimeoutMilliseconds $ResponseTimeoutMilliseconds `
            -Description 'FluxoraBridgeHost response'
        if (-not $process.WaitForExit($ExitTimeoutMilliseconds)) {
            throw "FluxoraBridgeHost did not exit within $ExitTimeoutMilliseconds ms after stdin closed."
        }

        $stderr = Wait-TextTask `
            -Task $stderrTask `
            -TimeoutMilliseconds $ExitTimeoutMilliseconds `
            -Description 'FluxoraBridgeHost stderr drain'
        if ([string]::IsNullOrWhiteSpace($responseLine)) {
            throw "FluxoraBridgeHost returned no response. stderr=$stderr"
        }

        return $responseLine | ConvertFrom-Json
    }
    finally {
        try {
            if ($processStarted) {
                Stop-OwnedProcess -Process $process -TimeoutMilliseconds $ExitTimeoutMilliseconds
            }
        }
        finally {
            if ($null -ne $process) {
                $process.Dispose()
            }
            if ($testRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Invoke-TimeoutProbe {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $startInfo.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 30"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $processStarted = $false
    $processId = $null
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        if (-not $process.Start()) {
            throw 'Failed to start the bridge timeout probe process.'
        }
        $processStarted = $true
        $processId = $process.Id
        $responseTask = $process.StandardOutput.ReadLineAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        try {
            Wait-TextTask `
                -Task $responseTask `
                -TimeoutMilliseconds $ResponseTimeoutMilliseconds `
                -Description 'Bridge timeout probe response' | Out-Null
            throw 'Bridge timeout probe unexpectedly produced output before the deadline.'
        }
        catch [System.TimeoutException] {
            $minimumExpectedMilliseconds = [Math]::Max(0, $ResponseTimeoutMilliseconds - 50)
            if ($stopwatch.ElapsedMilliseconds -lt $minimumExpectedMilliseconds) {
                throw "Bridge timeout probe fired too early after $($stopwatch.ElapsedMilliseconds) ms."
            }
        }
    }
    finally {
        $stopwatch.Stop()
        try {
            if ($processStarted) {
                Stop-OwnedProcess -Process $process -TimeoutMilliseconds $ExitTimeoutMilliseconds
            }
        }
        finally {
            $process.Dispose()
        }
    }

    if ($null -eq $processId -or (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
        throw 'Bridge timeout probe left its owned process running.'
    }

    Write-Output 'Bridge host timeout probe passed.'
}

if ($RunTimeoutProbe) {
    Invoke-TimeoutProbe
    return
}

$requestMeta = @{
    protocolVersion = '1.0'
    operationId = 'op_bridge_protocol_test'
    requestSource = 'backend-test'
    appVersion = '0.0.0-test'
    platform = 'win32'
    arch = 'x64'
    locale = 'en-US'
}

$incompatibleResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '2.0'
    id = 'handshake_incompatible'
    method = 'system.handshake'
    params = @{
        supportedProtocolVersions = @('999.0')
    }
    meta = $requestMeta
}

if ($incompatibleResponse.error.code -ne 'bridge.protocolVersionMismatch') {
    throw "Expected bridge.protocolVersionMismatch, received: $($incompatibleResponse | ConvertTo-Json -Depth 10 -Compress)"
}
if ($incompatibleResponse.meta.operationId -ne 'op_bridge_protocol_test') {
    throw 'Protocol mismatch response lost operationId correlation.'
}

$mismatchedMeta = $requestMeta.Clone()
$mismatchedMeta.protocolVersion = '999.0'
$mismatchedMetaResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '2.0'
    id = 'meta_incompatible'
    method = 'system.handshake'
    params = @{
        supportedProtocolVersions = @('1.0')
    }
    meta = $mismatchedMeta
}
if ($mismatchedMetaResponse.error.code -ne 'bridge.protocolVersionMismatch') {
    throw "Expected meta protocol mismatch rejection, received: $($mismatchedMetaResponse | ConvertTo-Json -Depth 10 -Compress)"
}

$invalidJsonRpcResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '1.0'
    id = 'invalid_jsonrpc'
    method = 'system.handshake'
    params = @{
        supportedProtocolVersions = @('1.0')
    }
    meta = $requestMeta
}
if ($invalidJsonRpcResponse.error.code -ne 'bridge.invalidRequest') {
    throw "Expected invalid jsonrpc rejection, received: $($invalidJsonRpcResponse | ConvertTo-Json -Depth 10 -Compress)"
}

$missingMetaResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '2.0'
    id = 'missing_meta'
    method = 'system.handshake'
    params = @{
        supportedProtocolVersions = @('1.0')
    }
}
if ($missingMetaResponse.error.code -ne 'bridge.invalidRequest') {
    throw "Expected missing metadata rejection, received: $($missingMetaResponse | ConvertTo-Json -Depth 10 -Compress)"
}

$invalidCompressionResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '2.0'
    id = 'invalid_fluxpack_compression'
    method = 'fluxPack.export'
    params = @{
        configPath = 'C:\missing\build.json'
        outputPath = 'C:\missing\build.fluxpack'
        includeGeneratedAssets = $false
        compressionMode = 'ultra'
    }
    meta = $requestMeta
}
if ($invalidCompressionResponse.error.code -ne 'bridge.invalidRequest') {
    throw "Expected invalid FluxPack compression rejection, received: $($invalidCompressionResponse | ConvertTo-Json -Depth 10 -Compress)"
}

$compatibleResponse = Invoke-BridgeHostRequest -Request @{
    jsonrpc = '2.0'
    id = 'handshake_compatible'
    method = 'system.handshake'
    params = @{
        supportedProtocolVersions = @('1.0')
    }
    meta = $requestMeta
}

if ($compatibleResponse.result.ok -ne $true -or $compatibleResponse.result.data.protocolVersion -ne '1.0') {
    throw "Expected a compatible 1.0 handshake, received: $($compatibleResponse | ConvertTo-Json -Depth 10 -Compress)"
}

Write-Output 'FluxoraBridgeHost protocol negotiation tests passed.'
