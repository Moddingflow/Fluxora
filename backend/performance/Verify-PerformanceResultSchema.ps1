[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$resolvedResult = (Resolve-Path -LiteralPath $ResultPath -ErrorAction Stop).Path
$result = Get-Content -LiteralPath $resolvedResult -Raw | ConvertFrom-Json

function Assert-True {
    param(
        [Parameter(Mandatory)]
        [bool]$Condition,
        [Parameter(Mandatory)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-ApproximatelyEqual {
    param(
        [Parameter(Mandatory)]
        [double]$Actual,
        [Parameter(Mandatory)]
        [double]$Expected,
        [Parameter(Mandatory)]
        [string]$Message,
        [double]$Tolerance = 0.005
    )

    if ([Math]::Abs($Actual - $Expected) -gt $Tolerance) {
        throw "$Message Expected $Expected, received $Actual."
    }
}

Assert-True ([int]$result.schemaVersion -eq 5) 'Performance result schema version must be 5.'
Assert-True (
    [string]$result.environment.coreSha256 -match '^[0-9A-Fa-f]{64}$'
) 'Schema 5 environment must contain a valid coreSha256.'
Assert-True (
    [string]$result.environment.vfsSha256 -match '^[0-9A-Fa-f]{64}$'
) 'Schema 5 environment must contain a valid vfsSha256.'
Assert-True (
    [string]$result.cacheSemantics.nativeOpenRpcProxy -like '*not UI T0-to-T3*'
) 'Schema 5 must identify the native open RPC total as a non-UI proxy.'
Assert-True (
    [string]$result.cacheSemantics.interactivePlugins -like '*plugins.listPersisted*'
) 'Interactive plugin semantics must name plugins.listPersisted.'
Assert-True (
    [string]$result.cacheSemantics.exactPlugins -like '*plugins.list*'
) 'Exact plugin semantics must name plugins.list.'
Assert-True (
    [string]$result.cacheSemantics.interactiveFallback -like '*mods.getWorkspace*'
) 'Interactive fallback semantics must name mods.getWorkspace.'

$scenarios = @($result.scenarios)
Assert-True ($scenarios.Count -gt 0) 'Performance result must contain at least one scenario.'

foreach ($scenario in $scenarios) {
    foreach ($sectionName in @('metadataCold', 'processColdMetadataWarm', 'processWarm')) {
        $section = $scenario.$sectionName
        $samples = @($section.samples)
        Assert-True ($samples.Count -gt 0) "Scenario section '$sectionName' must contain samples."
        Assert-True (
            [int]$section.statistics.nativeOpenRpcTotal.runs -eq $samples.Count
        ) "Scenario section '$sectionName' must summarize native open RPC totals."
        Assert-True (
            [int]$section.statistics.plugins.runs -eq $samples.Count
        ) "Scenario section '$sectionName' must summarize persisted plugin samples."
        Assert-True (
            [int]$section.statistics.exactPlugins.runs -eq $samples.Count
        ) "Scenario section '$sectionName' must summarize exact plugin samples."
        Assert-True (
            [int]$section.statistics.interactiveFallback.runs -eq $samples.Count
        ) "Scenario section '$sectionName' must summarize interactive fallback samples."

        foreach ($sample in $samples) {
            Assert-True ($null -ne $sample.pluginsMs) 'Sample is missing persisted pluginsMs.'
            Assert-True ($null -ne $sample.exactPluginsMs) 'Sample is missing exactPluginsMs.'
            Assert-True ($null -ne $sample.exactPluginCount) 'Sample is missing exactPluginCount.'
            Assert-True ($null -ne $sample.expectedPluginCount) 'Sample is missing fixture-derived expectedPluginCount.'
            Assert-True (
                [string]$sample.persistedPluginProjectionSha256 -match '^[0-9A-Fa-f]{64}$'
            ) 'Sample is missing a valid persisted plugin projection digest.'
            Assert-True (
                [string]$sample.exactPluginProjectionSha256 -match '^[0-9A-Fa-f]{64}$'
            ) 'Sample is missing a valid exact plugin projection digest.'
            Assert-True ($null -ne $sample.persistedInstalledCount) 'Sample is missing persistedInstalledCount.'
            Assert-True ($null -ne $sample.persistedOrderCount) 'Sample is missing persistedOrderCount.'
            Assert-True ($null -ne $sample.interactiveFallbackMs) 'Sample is missing interactiveFallbackMs.'
            Assert-True ($null -ne $sample.nativeOpenRpcTotalMs) 'Sample is missing nativeOpenRpcTotalMs.'
            Assert-True (
                [int]$sample.pluginCount -eq [int]$sample.exactPluginCount
            ) 'Persisted and exact plugin counts differ for the deterministic fixture.'
            Assert-True (
                [int]$sample.pluginCount -eq [int]$sample.expectedPluginCount
            ) 'Persisted plugin count differs from the fixture-derived expected plugin count.'
            Assert-True (
                [string]$sample.persistedPluginProjectionSha256 -ceq
                [string]$sample.exactPluginProjectionSha256
            ) 'Persisted and exact plugin identity/order/enabled projections differ.'

            $usedInteractiveFallback = [double]$sample.interactiveFallbackMs -gt 0
            if ($sectionName -eq 'metadataCold') {
                Assert-True $usedInteractiveFallback 'Metadata-cold samples must use the interactive exact-mod fallback.'
            }
            else {
                Assert-True (-not $usedInteractiveFallback) "Section '$sectionName' unexpectedly used the interactive fallback."
            }
            if ($usedInteractiveFallback) {
                Assert-True (
                    [int]$sample.persistedInstalledCount -eq 0 -or
                    [int]$sample.persistedOrderCount -eq 0
                ) 'Interactive fallback requires an empty persisted installed/order snapshot.'
                Assert-ApproximatelyEqual `
                    -Actual ([double]$sample.reconciliationMs) `
                    -Expected 0 `
                    -Message 'Interactive fallback must suppress duplicate exact-mod T4 reconciliation.'
            }
            else {
                Assert-True (
                    [int]$sample.persistedInstalledCount -eq [int]$sample.installedCount -and
                    [int]$sample.persistedOrderCount -eq [int]$sample.orderCount
                ) 'Prepared interactive rows must come directly from the persisted snapshot.'
            }

            $nativeOpenRpcTotal =
                [double]$sample.openConfigMs +
                [double]$sample.modsWorkspaceMs +
                [double]$sample.pluginsMs +
                [double]$sample.profilesMs +
                [double]$sample.executablesMs +
                [double]$sample.interactiveFallbackMs
            Assert-ApproximatelyEqual `
                -Actual ([double]$sample.nativeOpenRpcTotalMs) `
                -Expected $nativeOpenRpcTotal `
                -Message 'Native open RPC total includes a deferred timing or omits a measured RPC timing.'

            $backgroundTotal =
                [double]$sample.downloadsMs +
                [double]$sample.reconciliationMs +
                [double]$sample.exactPluginsMs
            Assert-ApproximatelyEqual `
                -Actual ([double]$sample.backgroundTotalMs) `
                -Expected $backgroundTotal `
                -Message 'Background total must include downloads, exact mods, and exact plugins.'
        }
    }
}

Write-Output 'Performance result schema verified.'
