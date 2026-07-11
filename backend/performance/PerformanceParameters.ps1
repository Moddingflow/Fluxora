function ConvertTo-FluxoraModCounts {
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()]
        [string[]]$Values
    )

    $counts = [System.Collections.Generic.List[int]]::new()
    foreach ($value in @($Values)) {
        foreach ($candidate in $value.Split(',', [System.StringSplitOptions]::None)) {
            $token = $candidate.Trim()
            $parsed = 0
            if (
                [string]::IsNullOrWhiteSpace($token) -or
                -not [int]::TryParse(
                    $token,
                    [System.Globalization.NumberStyles]::None,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [ref]$parsed)
            ) {
                throw "Invalid mod count: '$candidate'. Use comma-separated whole numbers."
            }
            if ($parsed -lt 1 -or $parsed -gt 100000) {
                throw "Invalid mod count: $parsed. Expected a value from 1 through 100000."
            }
            $counts.Add($parsed)
        }
    }

    if ($counts.Count -eq 0) {
        throw 'At least one mod count is required.'
    }
    return $counts.ToArray()
}

function Import-FluxoraStructuralStatistics {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    try {
        $statistics = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json -Depth 64
    }
    catch {
        throw "Structural statistics are not valid JSON: $Path"
    }

    if ($statistics.schemaVersion -notin @(1, 2) -or
        $statistics.generator -ne 'FluxoraStructuralStatistics') {
        throw 'Unsupported structural-statistics schema or generator.'
    }
    if (
        -not [bool]$statistics.privacy.structuralStatisticsOnly -or
        [bool]$statistics.privacy.containsSourcePaths -or
        [bool]$statistics.privacy.containsModNames -or
        [bool]$statistics.privacy.containsProfileNames -or
        [bool]$statistics.privacy.containsFileNames -or
        [bool]$statistics.privacy.containsRawExtensions -or
        [bool]$statistics.privacy.containsFileContents -or
        [bool]$statistics.privacy.containsPrivateNameHashes -or
        [bool]$statistics.privacy.containsPathOrNameDerivedIdentifiers
    ) {
        throw 'Structural-statistics privacy declaration is missing or unsafe.'
    }

    $modCount = [int]$statistics.mods.directoryCount
    if ($modCount -lt 1 -or $modCount -gt 100000) {
        throw "Imported mod count is outside the supported range: $modCount"
    }
    $filesPerMod = [Math]::Max(1, [int][Math]::Ceiling(
        [double]$statistics.files.contentFilesPerMod.mean))
    $directoriesPerMod = if ($statistics.schemaVersion -ge 2 -and
        $null -ne $statistics.directories.contentDirectoriesPerMod.mean) {
        [Math]::Max(1, [int][Math]::Ceiling(
            [double]$statistics.directories.contentDirectoriesPerMod.mean))
    }
    else {
        20
    }
    $pluginCount = [Math]::Max(0, [int]$statistics.plugins.modContentPluginFileCount)
    $profileEntries = [long]$statistics.mods.selectedProfileOrderEntryCount
    $disabledPercent = if ($profileEntries -gt 0) {
        [Math]::Clamp(
            [int][Math]::Round(
                100.0 * [long]$statistics.mods.selectedProfileDisabledCount / $profileEntries),
            0,
            100)
    }
    else { 0 }
    $conflictFilesPerMod = [Math]::Max(
        0,
        [int][Math]::Ceiling(
            [double]$statistics.conflicts.providerOccurrencesOnConflictingPaths / $modCount))

    $depthP95 = 0
    $targetDepthRank = [Math]::Ceiling(0.95 * [long]$statistics.files.contentFileCount)
    [long]$seen = 0
    foreach ($bucket in @($statistics.files.contentFileDepthDistribution | Sort-Object depth)) {
        $seen += [long]$bucket.fileCount
        if ($seen -ge $targetDepthRank) {
            $depthP95 = [int]$bucket.depth
            break
        }
    }

    return [pscustomobject]@{
        sourcePath = $resolved
        modCount = $modCount
        filesPerMod = [Math]::Min(10000, $filesPerMod)
        directoriesPerMod = [Math]::Min(10000, $directoriesPerMod)
        pluginCount = [Math]::Min(10000, $pluginCount)
        disabledPercent = $disabledPercent
        conflictFilesPerMod = [Math]::Min($filesPerMod, $conflictFilesPerMod)
        directoryDepth = [Math]::Clamp($depthP95, 0, 12)
    }
}
