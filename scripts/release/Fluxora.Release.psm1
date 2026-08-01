Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:FluxoraSigningKeyBackupIterations = 600000
$script:FluxoraSigningKeyBackupMaximumBytes = 64KB

function Resolve-FluxoraBuildMode {
    [CmdletBinding()]
    param(
        [AllowEmptyString()]
        [string] $Mode,

        [bool] $HasExplicitBuildArguments = $false,

        [AllowEmptyString()]
        [string] $Selection
    )

    if (-not [string]::IsNullOrWhiteSpace($Mode)) {
        if ($Mode -notin @('Local', 'Production')) {
            throw "Build mode must be Local or Production."
        }
        return $Mode
    }

    if ($HasExplicitBuildArguments) {
        return 'Local'
    }

    if ([string]::IsNullOrWhiteSpace($Selection)) {
        Write-Host 'Choose build mode:'
        Write-Host '  1. Build locally'
        Write-Host '  2. Production release'
        $Selection = Read-Host 'Selection'
    }

    switch ($Selection.Trim()) {
        '1' { return 'Local' }
        '2' { return 'Production' }
        default { throw 'Enter 1 or 2.' }
    }
}

function Get-FluxoraNextPatchVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Version
    )

    $match = [regex]::Match($Version, '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
    if (-not $match.Success) {
        throw "Fluxora version '$Version' must use major.minor.patch."
    }

    $major = [uint64]::Parse($match.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    $minor = [uint64]::Parse($match.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)
    $patch = [uint64]::Parse($match.Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture)
    if ($patch -eq [uint64]::MaxValue) {
        throw 'Fluxora patch version cannot be incremented further.'
    }

    return '{0}.{1}.{2}' -f $major, $minor, ($patch + 1)
}

function ConvertTo-FluxoraNormalizedSemVer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Version,

        [switch] $RequirePatch
    )

    $pattern = if ($RequirePatch) {
        '^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$'
    }
    else {
        '^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)(?:\.(?<patch>0|[1-9]\d*))?$'
    }
    $match = [regex]::Match($Version.Trim(), $pattern)
    if (-not $match.Success) {
        throw "Fluxora version '$Version' must use major.minor or major.minor.patch."
    }

    $major = [uint64]::Parse($match.Groups['major'].Value, [Globalization.CultureInfo]::InvariantCulture)
    $minor = [uint64]::Parse($match.Groups['minor'].Value, [Globalization.CultureInfo]::InvariantCulture)
    $patch = if ($match.Groups['patch'].Success) {
        [uint64]::Parse($match.Groups['patch'].Value, [Globalization.CultureInfo]::InvariantCulture)
    }
    else {
        [uint64]0
    }
    return [pscustomobject]@{
        Major = $major
        Minor = $minor
        Patch = $patch
        Version = '{0}.{1}.{2}' -f $major, $minor, $patch
    }
}

function Compare-FluxoraSemVer {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Left,
        [Parameter(Mandatory = $true)] [string] $Right
    )

    $leftVersion = ConvertTo-FluxoraNormalizedSemVer -Version $Left -RequirePatch
    $rightVersion = ConvertTo-FluxoraNormalizedSemVer -Version $Right -RequirePatch
    foreach ($part in @('Major', 'Minor', 'Patch')) {
        if ($leftVersion.$part -lt $rightVersion.$part) { return -1 }
        if ($leftVersion.$part -gt $rightVersion.$part) { return 1 }
    }
    return 0
}

function Resolve-FluxoraProductionVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $CurrentVersion,

        [AllowEmptyString()]
        [string] $Version,

        [AllowEmptyString()]
        [string] $Selection
    )

    $current = ConvertTo-FluxoraNormalizedSemVer -Version $CurrentVersion -RequirePatch
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        $target = ConvertTo-FluxoraNormalizedSemVer -Version $Version
        if ((Compare-FluxoraSemVer -Left $target.Version -Right $current.Version) -le 0) {
            throw "Production version '$($target.Version)' must be greater than current version '$($current.Version)'."
        }
        return [pscustomobject]@{
            Cancelled = $false
            Version = $target.Version
            Kind = 'Explicit'
        }
    }

    if ([string]::IsNullOrWhiteSpace($Selection)) {
        Write-Host "Current Fluxora version: $($current.Version)"
        Write-Host 'Choose the production version:'
        Write-Host '  1. Keep current version / cancel publication'
        Write-Host "  2. Small (patch) -> $($current.Major).$($current.Minor).$($current.Patch + 1)"
        Write-Host "  3. Minor         -> $($current.Major).$($current.Minor + 1).0"
        Write-Host "  4. Major         -> $($current.Major + 1).0.0"
        $Selection = Read-Host 'Selection'
    }

    $kind = switch ($Selection.Trim().ToLowerInvariant()) {
        { $_ -in @('1', 'current', 'cancel') } { 'Current'; break }
        { $_ -in @('2', 'patch', 'small') } { 'Patch'; break }
        { $_ -in @('3', 'minor') } { 'Minor'; break }
        { $_ -in @('4', 'major') } { 'Major'; break }
        default { throw 'Enter 1, 2, 3 or 4.' }
    }
    if ($kind -eq 'Current') {
        return [pscustomobject]@{
            Cancelled = $true
            Version = $current.Version
            Kind = $kind
        }
    }

    $major = $current.Major
    $minor = $current.Minor
    $patch = $current.Patch
    switch ($kind) {
        'Patch' {
            if ($patch -eq [uint64]::MaxValue) { throw 'Fluxora patch version cannot be incremented further.' }
            $patch++
        }
        'Minor' {
            if ($minor -eq [uint64]::MaxValue) { throw 'Fluxora minor version cannot be incremented further.' }
            $minor++
            $patch = 0
        }
        'Major' {
            if ($major -eq [uint64]::MaxValue) { throw 'Fluxora major version cannot be incremented further.' }
            $major++
            $minor = 0
            $patch = 0
        }
    }

    return [pscustomobject]@{
        Cancelled = $false
        Version = '{0}.{1}.{2}' -f $major, $minor, $patch
        Kind = $kind
    }
}

function Write-FluxoraAtomicText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string] $Content
    )

    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Path))
    if (-not (Test-Path -LiteralPath $resolvedParent -PathType Container)) {
        throw "Version file parent directory does not exist: '$resolvedParent'."
    }

    $temporaryPath = Join-Path $resolvedParent ((Split-Path -Leaf $Path) + '.' + [Guid]::NewGuid().ToString('N') + '.fluxora-version-tmp')
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $Content,
            [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::Move($temporaryPath, [System.IO.Path]::GetFullPath($Path), $true)
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Set-FluxoraJsonVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Version,

        [switch] $PackageLock
    )

    $content = Get-Content -LiteralPath $Path -Raw
    $document = $content | ConvertFrom-Json -AsHashtable
    if (-not $document.ContainsKey('version')) {
        throw "JSON version file '$Path' does not contain a root version property."
    }
    $rootPattern = '(?s)\A(?<prefix>\s*\{.*?"version"\s*:\s*")[^"]+(?<suffix>")'
    if ([regex]::Matches($content, $rootPattern).Count -ne 1) {
        throw "JSON version file '$Path' has an ambiguous root version property."
    }
    $updated = [regex]::Replace(
        $content,
        $rootPattern,
        { param($match) $match.Groups['prefix'].Value + $Version + $match.Groups['suffix'].Value },
        1)
    if ($PackageLock) {
        $rootPackage = $document['packages']['']
        if ($null -eq $rootPackage) {
            throw "Package lock '$Path' does not contain the root workspace entry."
        }
        $workspacePattern = '(?s)(?<prefix>"packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*")[^"]+(?<suffix>")'
        if ([regex]::Matches($updated, $workspacePattern).Count -ne 1) {
            throw "Package lock '$Path' has an ambiguous root workspace version."
        }
        $updated = [regex]::Replace(
            $updated,
            $workspacePattern,
            { param($match) $match.Groups['prefix'].Value + $Version + $match.Groups['suffix'].Value },
            1)
    }

    return $updated
}

function Get-FluxoraProductVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot
    )

    $tauriRoot = Join-Path ([System.IO.Path]::GetFullPath($ProjectRoot)) 'frontend-tauri'
    $tauriConfigPath = Join-Path $tauriRoot 'src-tauri\tauri.conf.json'
    $setupConfigPath = Join-Path $tauriRoot 'src-tauri\setup\tauri.conf.json'
    $updaterConfigPath = Join-Path $tauriRoot 'src-tauri\updater\tauri.conf.json'
    $packagePath = Join-Path $tauriRoot 'package.json'
    $packageLockPath = Join-Path $tauriRoot 'package-lock.json'
    $cargoManifestPath = Join-Path $tauriRoot 'src-tauri\Cargo.toml'
    $cargoLockPath = Join-Path $tauriRoot 'src-tauri\Cargo.lock'

    foreach ($path in @(
        $tauriConfigPath,
        $setupConfigPath,
        $updaterConfigPath,
        $packagePath,
        $cargoManifestPath,
        $cargoLockPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Fluxora version file was not found: '$path'."
        }
    }

    $version = [string](Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "Current Fluxora version '$version' must use major.minor.patch."
    }

    $setupVersion = [string](Get-Content -LiteralPath $setupConfigPath -Raw | ConvertFrom-Json).version
    $updaterVersion = [string](Get-Content -LiteralPath $updaterConfigPath -Raw | ConvertFrom-Json).version
    $packageVersion = [string](Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version
    $cargoManifest = Get-Content -LiteralPath $cargoManifestPath -Raw
    $cargoManifestMatch = [regex]::Match(
        $cargoManifest,
        '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')
    $cargoLock = Get-Content -LiteralPath $cargoLockPath -Raw
    $cargoLockMatch = [regex]::Match(
        $cargoLock,
        '(?ms)^\[\[package\]\]\s*name\s*=\s*"fluxora_tauri"\s*version\s*=\s*"([^"]+)"')

    $isSynchronized = $setupVersion -ceq '../../package.json' -and
        $updaterVersion -ceq '../../package.json' -and
        $packageVersion -ceq $version -and
        $cargoManifestMatch.Success -and
        $cargoManifestMatch.Groups[1].Value -ceq $version -and
        $cargoLockMatch.Success -and
        $cargoLockMatch.Groups[1].Value -ceq $version

    if ($isSynchronized -and (Test-Path -LiteralPath $packageLockPath -PathType Leaf)) {
        $packageLock = Get-Content -LiteralPath $packageLockPath -Raw | ConvertFrom-Json -AsHashtable
        $isSynchronized = [string]$packageLock['version'] -ceq $version -and
            [string]$packageLock['packages']['']['version'] -ceq $version
    }

    if (-not $isSynchronized) {
        throw 'Fluxora app, Setup, updater, package, Cargo manifest, and lock files must resolve one shared product SemVer.'
    }

    return $version
}

function Set-FluxoraProductVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot,

        [Parameter(Mandatory = $true)]
        [string] $Version
    )

    if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "Fluxora version '$Version' must use major.minor.patch."
    }

    $tauriRoot = Join-Path ([System.IO.Path]::GetFullPath($ProjectRoot)) 'frontend-tauri'
    $tauriConfigPath = Join-Path $tauriRoot 'src-tauri\tauri.conf.json'
    $packagePath = Join-Path $tauriRoot 'package.json'
    $packageLockPath = Join-Path $tauriRoot 'package-lock.json'
    $cargoManifestPath = Join-Path $tauriRoot 'src-tauri\Cargo.toml'
    $cargoLockPath = Join-Path $tauriRoot 'src-tauri\Cargo.lock'

    $requiredPaths = @($tauriConfigPath, $packagePath, $cargoManifestPath, $cargoLockPath)
    foreach ($path in $requiredPaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Fluxora version file was not found: '$path'."
        }
    }

    $updates = [ordered]@{}
    $updates[$tauriConfigPath] = Set-FluxoraJsonVersion -Path $tauriConfigPath -Version $Version
    $updates[$packagePath] = Set-FluxoraJsonVersion -Path $packagePath -Version $Version
    if (Test-Path -LiteralPath $packageLockPath -PathType Leaf) {
        $updates[$packageLockPath] = Set-FluxoraJsonVersion -Path $packageLockPath -Version $Version -PackageLock
    }

    $cargoManifest = Get-Content -LiteralPath $cargoManifestPath -Raw
    $cargoManifestPattern = '(?ms)(^\[package\]\s*.*?^version\s*=\s*")[^"]+("\s*$)'
    if ([regex]::Matches($cargoManifest, $cargoManifestPattern).Count -ne 1) {
        throw "Cargo manifest '$cargoManifestPath' has an ambiguous package version."
    }
    $cargoManifest = [regex]::Replace(
        $cargoManifest,
        $cargoManifestPattern,
        { param($match) $match.Groups[1].Value + $Version + $match.Groups[2].Value },
        1)
    $updates[$cargoManifestPath] = $cargoManifest

    $cargoLock = Get-Content -LiteralPath $cargoLockPath -Raw
    $cargoLockPattern = '(?ms)(^\[\[package\]\]\s*name\s*=\s*"fluxora_tauri"\s*version\s*=\s*")[^"]+("\s*$)'
    if ([regex]::Matches($cargoLock, $cargoLockPattern).Count -ne 1) {
        throw "Cargo lock '$cargoLockPath' has an ambiguous Fluxora package version."
    }
    $cargoLock = [regex]::Replace(
        $cargoLock,
        $cargoLockPattern,
        { param($match) $match.Groups[1].Value + $Version + $match.Groups[2].Value },
        1)
    $updates[$cargoLockPath] = $cargoLock

    $originals = @{}
    foreach ($path in $updates.Keys) {
        $originals[$path] = Get-Content -LiteralPath $path -Raw
    }

    $written = [System.Collections.Generic.List[string]]::new()
    try {
        foreach ($path in $updates.Keys) {
            Write-FluxoraAtomicText -Path $path -Content $updates[$path]
            $written.Add($path)
        }
    }
    catch {
        $originalError = $_
        foreach ($path in $written) {
            try {
                Write-FluxoraAtomicText -Path $path -Content $originals[$path]
            }
            catch {
                Write-Warning "Could not roll back version file '$path': $($_.Exception.Message)"
            }
        }
        throw $originalError
    }
}

function ConvertTo-FluxoraHexString {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [byte[]] $Bytes)

    return [Convert]::ToHexString($Bytes).ToLowerInvariant()
}

function ConvertFrom-FluxoraSha256Hex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Value,

        [Parameter(Mandatory = $true)]
        [string] $FieldName
    )

    if ($Value -cnotmatch '^[0-9a-f]{64}$') {
        throw "$FieldName must be a lowercase 64-character SHA-256 value."
    }
    return ,([Convert]::FromHexString($Value))
}

function Get-FluxoraFileSha256Hex {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $Path)

    $stream = [IO.File]::Open(
        [IO.Path]::GetFullPath($Path),
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read)
    try {
        return ConvertTo-FluxoraHexString -Bytes ([Security.Cryptography.SHA256]::HashData($stream))
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-FluxoraUpdateRelativePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [switch] $AllowMutableData
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Length -gt 1024) {
        throw 'Update path must be a non-empty relative UTF-8 path.'
    }
    if ($Path.Contains('\') -or $Path.StartsWith('/') -or $Path.EndsWith('/') -or
        $Path.Contains('//') -or $Path.Contains(':') -or $Path.IndexOf([char]0) -ge 0) {
        throw "Update path '$Path' is not a normalized relative path."
    }

    foreach ($segment in $Path.Split('/')) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..' -or
            $segment.EndsWith(' ') -or $segment.EndsWith('.')) {
            throw "Update path '$Path' contains an unsafe segment."
        }
        foreach ($character in $segment.ToCharArray()) {
            if ([char]::IsControl($character)) {
                throw "Update path '$Path' contains a control character."
            }
        }
    }

    if (-not $AllowMutableData) {
        $firstSegment = $Path.Split('/')[0]
        if ($firstSegment -ieq 'Downloads' -or $firstSegment -ieq 'logs') {
            throw "Mutable user path '$Path' cannot be part of an update package."
        }
    }
}

function Get-FluxoraUtf8OrdinalComparer {
    return [System.Collections.Generic.Comparer[string]]::Create(
        [System.Comparison[string]]{
            param([string] $left, [string] $right)
            if ([object]::ReferenceEquals($left, $right)) { return 0 }
            if ($null -eq $left) { return -1 }
            if ($null -eq $right) { return 1 }
            $leftBytes = [Text.Encoding]::UTF8.GetBytes($left)
            $rightBytes = [Text.Encoding]::UTF8.GetBytes($right)
            $sharedLength = [Math]::Min($leftBytes.Length, $rightBytes.Length)
            for ($index = 0; $index -lt $sharedLength; $index++) {
                if ($leftBytes[$index] -lt $rightBytes[$index]) { return -1 }
                if ($leftBytes[$index] -gt $rightBytes[$index]) { return 1 }
            }
            return $leftBytes.Length.CompareTo($rightBytes.Length)
        })
}

function Get-FluxoraOrdinalFileEntries {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [object[]] $Files)

    $byPath = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    $windowsPaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Files) {
        $path = [string]$file.path
        Assert-FluxoraUpdateRelativePath -Path $path
        if (-not $byPath.TryAdd($path, $file) -or -not $windowsPaths.Add($path)) {
            throw "Update file manifest contains duplicate Windows path '$path'."
        }
        if ([uint64]$file.size -lt 0) {
            throw "Update file '$path' has an invalid size."
        }
        [void](ConvertFrom-FluxoraSha256Hex -Value ([string]$file.sha256) -FieldName "File '$path' sha256")
    }

    $paths = [string[]]@($byPath.Keys)
    [Array]::Sort($paths, (Get-FluxoraUtf8OrdinalComparer))
    return @($paths | ForEach-Object { $byPath[$_] })
}

function Test-FluxoraUpdatePayloadExcluded {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $RelativePath)

    $firstSegment = $RelativePath.Split('/')[0]
    return $firstSegment -ieq 'Downloads' -or
        $firstSegment -ieq 'logs' -or
        [IO.Path]::GetExtension($RelativePath) -ieq '.pdb'
}

function Get-FluxoraUpdateFileManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $PayloadRoot)

    $root = [IO.Path]::GetFullPath($PayloadRoot)
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Update payload root does not exist: '$root'."
    }
    $rootItem = Get-Item -LiteralPath $root -Force
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Update payload root cannot be a reparse point: '$root'."
    }

    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Update payload cannot contain a reparse point: '$($item.FullName)'."
        }
        if ($item.PSIsContainer) {
            continue
        }

        $relative = [IO.Path]::GetRelativePath($root, $item.FullName).Replace('\', '/')
        Assert-FluxoraUpdateRelativePath -Path $relative -AllowMutableData
        if (Test-FluxoraUpdatePayloadExcluded -RelativePath $relative) {
            continue
        }
        Assert-FluxoraUpdateRelativePath -Path $relative
        $entries.Add([pscustomobject][ordered]@{
            path = $relative
            size = [uint64]$item.Length
            sha256 = Get-FluxoraFileSha256Hex -Path $item.FullName
        })
    }

    return @(Get-FluxoraOrdinalFileEntries -Files $entries.ToArray())
}

function Get-FluxoraUpdateFileManifestSha256 {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [object[]] $Files)

    $orderedFiles = @(Get-FluxoraOrdinalFileEntries -Files $Files)
    $stream = [IO.MemoryStream]::new()
    try {
        foreach ($file in $orderedFiles) {
            foreach ($part in @(
                [Text.Encoding]::UTF8.GetBytes([string]$file.path),
                [Text.Encoding]::ASCII.GetBytes(([uint64]$file.size).ToString([Globalization.CultureInfo]::InvariantCulture)),
                [Text.Encoding]::ASCII.GetBytes([string]$file.sha256))) {
                $stream.Write($part, 0, $part.Length)
                $stream.WriteByte(0)
            }
            $stream.Position--
            $stream.WriteByte(10)
        }
        $stream.Position = 0
        return ConvertTo-FluxoraHexString -Bytes ([Security.Cryptography.SHA256]::HashData($stream))
    }
    finally {
        $stream.Dispose()
    }
}

function Test-FluxoraSemVer {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $Version)
    return $Version -cmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
}

function ConvertTo-FluxoraUpdateManifestBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Version,
        [Parameter(Mandatory = $true)] [string] $Target,
        [Parameter(Mandatory = $true)] [string] $ApplicationExecutable,
        [Parameter(Mandatory = $true)] [object[]] $Files,
        [Parameter(Mandatory = $true)] [object[]] $Assets,
        [ValidateSet('stable')] [string] $Channel = 'stable'
    )

    if (-not (Test-FluxoraSemVer -Version $Version)) {
        throw "Update version '$Version' must use major.minor.patch."
    }
    if ($Target -cne 'win-x64') {
        throw "Unsupported update target '$Target'."
    }
    Assert-FluxoraUpdateRelativePath -Path $ApplicationExecutable
    if (-not $ApplicationExecutable.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Application executable must use the .exe extension.'
    }
    $orderedFiles = @(Get-FluxoraOrdinalFileEntries -Files $Files)
    if (-not ($orderedFiles.path -ccontains $ApplicationExecutable)) {
        throw "Application executable '$ApplicationExecutable' is missing from the update file manifest."
    }
    $targetDigest = Get-FluxoraUpdateFileManifestSha256 -Files $orderedFiles

    $fullAssets = @($Assets | Where-Object { [string]$_.kind -ceq 'full' })
    if ($fullAssets.Count -ne 1) {
        throw 'Update manifest must contain exactly one full package.'
    }
    if (@($Assets | Where-Object { [string]$_.kind -cnotin @('full', 'delta') }).Count -ne 0) {
        throw 'Update manifest contains an unsupported asset kind.'
    }

    $normalizedAssets = [System.Collections.Generic.List[object]]::new()
    $deltaVersions = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($asset in $Assets) {
        $kind = [string]$asset.kind
        $fromVersion = if ($null -eq $asset.fromVersion) { $null } else { [string]$asset.fromVersion }
        $baseDigest = if ($null -eq $asset.baseFileManifestSha256) { $null } else { [string]$asset.baseFileManifestSha256 }
        if ($kind -ceq 'full') {
            if ($null -ne $fromVersion -or $null -ne $baseDigest) {
                throw 'Full update assets cannot declare a base version or digest.'
            }
        }
        else {
            if (-not (Test-FluxoraSemVer -Version $fromVersion) -or $fromVersion -ceq $Version) {
                throw 'Delta update assets require a distinct semantic fromVersion.'
            }
            if (-not $deltaVersions.Add($fromVersion)) {
                throw "Update manifest contains duplicate delta ancestry '$fromVersion'."
            }
            [void](ConvertFrom-FluxoraSha256Hex -Value $baseDigest -FieldName 'baseFileManifestSha256')
        }

        $uri = $null
        if (-not [Uri]::TryCreate([string]$asset.url, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -cne 'https' -or
            -not [string]::Equals($uri.Host, 'github.com', [StringComparison]::OrdinalIgnoreCase) -or
            -not $uri.AbsolutePath.StartsWith("/Moddingflow/Fluxora/releases/download/v$Version/", [StringComparison]::Ordinal) -or
            -not [string]::IsNullOrEmpty($uri.Query) -or
            -not [string]::IsNullOrEmpty($uri.Fragment) -or
            -not [string]::IsNullOrEmpty($uri.UserInfo)) {
            throw "Update asset must use the immutable GitHub release URL for v$Version."
        }
        if ([uint64]$asset.size -eq 0 -or [uint64]$asset.size -gt 16GB) {
            throw 'Update asset size must be between 1 byte and 16 GiB.'
        }
        [void](ConvertFrom-FluxoraSha256Hex -Value ([string]$asset.sha256) -FieldName 'Asset sha256')
        if ([string]$asset.targetFileManifestSha256 -cne $targetDigest) {
            throw 'Update asset targetFileManifestSha256 does not match the signed file tree.'
        }

        $normalizedAssets.Add([pscustomobject][ordered]@{
            kind = $kind
            fromVersion = $fromVersion
            url = $uri.AbsoluteUri
            size = [uint64]$asset.size
            sha256 = [string]$asset.sha256
            targetFileManifestSha256 = $targetDigest
            baseFileManifestSha256 = $baseDigest
        })
    }

    $assetArray = @($normalizedAssets.ToArray())
    $assetArray = @(
        $assetArray | Sort-Object `
            @{ Expression = { if ($_.kind -ceq 'full') { 0 } else { 1 } } },
            @{ Expression = { [string]$_.fromVersion } } -CaseSensitive
    )
    $manifest = [ordered]@{
        schemaVersion = 1
        channel = $Channel
        version = $Version
        target = $Target
        applicationExecutable = $ApplicationExecutable
        files = $orderedFiles
        fileManifestSha256 = $targetDigest
        assets = $assetArray
    }
    $json = $manifest | ConvertTo-Json -Depth 20 -Compress -EscapeHandling EscapeNonAscii
    $bytes = [Text.Encoding]::UTF8.GetBytes($json + "`n")
    if ($bytes.Length -gt 512KB) {
        throw 'Update manifest exceeds the 512 KiB runtime limit.'
    }
    return ,$bytes
}

function Assert-FluxoraExactJsonProperties {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [object] $Value,
        [Parameter(Mandatory = $true)] [string[]] $Expected,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    $actual = [string[]]@($Value.PSObject.Properties.Name)
    [Array]::Sort($actual, [StringComparer]::Ordinal)
    $expectedSorted = [string[]]@($Expected)
    [Array]::Sort($expectedSorted, [StringComparer]::Ordinal)
    if ($actual.Count -ne $expectedSorted.Count) {
        throw "$Context has an unexpected property set."
    }
    for ($index = 0; $index -lt $actual.Count; $index++) {
        if ($actual[$index] -cne $expectedSorted[$index]) {
            throw "$Context has an unexpected property '$($actual[$index])'."
        }
    }
}

function Read-FluxoraSignedUpdateManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ManifestPath,
        [Parameter(Mandatory = $true)] [string] $SignaturePath,
        [Parameter(Mandatory = $true)] [string] $PublicKeyPath
    )

    foreach ($path in @($ManifestPath, $SignaturePath, $PublicKeyPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Signed update manifest input is missing: '$path'."
        }
    }
    $manifestFile = Get-Item -LiteralPath $ManifestPath
    $signatureFile = Get-Item -LiteralPath $SignaturePath
    if ($manifestFile.Length -le 0 -or $manifestFile.Length -gt 4MB) {
        throw 'Signed update manifest exceeds the 4 MiB safety limit.'
    }
    if ($signatureFile.Length -le 0 -or $signatureFile.Length -gt 1024) {
        throw 'Detached update signature exceeds the safety limit.'
    }

    $manifestBytes = [IO.File]::ReadAllBytes($manifestFile.FullName)
    $signature = [IO.File]::ReadAllText($signatureFile.FullName, [Text.Encoding]::ASCII)
    $publicKey = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($PublicKeyPath))
    if (-not (Test-FluxoraDetachedSignature -ManifestBytes $manifestBytes -Signature $signature -PublicKeyDer $publicKey)) {
        throw 'Detached update manifest signature is invalid.'
    }

    try {
        $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
        $manifest = $strictUtf8.GetString($manifestBytes) | ConvertFrom-Json
    }
    catch {
        throw 'Signed update manifest is not valid UTF-8 JSON.'
    }
    Assert-FluxoraExactJsonProperties -Value $manifest -Expected @(
        'schemaVersion', 'channel', 'version', 'target', 'applicationExecutable',
        'files', 'fileManifestSha256', 'assets') -Context 'Signed update manifest'
    if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.channel -cne 'stable') {
        throw 'Signed update manifest schema or channel is unsupported.'
    }
    foreach ($file in @($manifest.files)) {
        Assert-FluxoraExactJsonProperties -Value $file -Expected @('path', 'size', 'sha256') -Context 'Signed update file entry'
    }
    foreach ($asset in @($manifest.assets)) {
        Assert-FluxoraExactJsonProperties -Value $asset -Expected @(
            'kind', 'fromVersion', 'url', 'size', 'sha256',
            'targetFileManifestSha256', 'baseFileManifestSha256') -Context 'Signed update asset'
    }

    $files = @($manifest.files)
    $computedDigest = Get-FluxoraUpdateFileManifestSha256 -Files $files
    if ([string]$manifest.fileManifestSha256 -cne $computedDigest) {
        throw 'Signed update file manifest digest does not match its entries.'
    }
    [void](ConvertTo-FluxoraUpdateManifestBytes `
        -Version ([string]$manifest.version) `
        -Target ([string]$manifest.target) `
        -ApplicationExecutable ([string]$manifest.applicationExecutable) `
        -Files $files `
        -Assets @($manifest.assets) `
        -Channel ([string]$manifest.channel))
    return $manifest
}

function Assert-FluxoraReleaseAssetName {
    param([Parameter(Mandatory = $true)] [string] $Name)

    if ([string]::IsNullOrWhiteSpace($Name) -or $Name.Length -gt 255 -or
        [IO.Path]::GetFileName($Name) -cne $Name -or $Name -in @('.', '..') -or
        $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw "Release asset name '$Name' is not a safe file name."
    }
}

function ConvertTo-FluxoraReleaseInventoryBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Version,
        [Parameter(Mandatory = $true)] [object[]] $Assets
    )

    if (-not (Test-FluxoraSemVer -Version $Version)) {
        throw "Release inventory version '$Version' must use major.minor.patch."
    }
    $byName = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    $windowsNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($asset in $Assets) {
        $name = [string]$asset.name
        Assert-FluxoraReleaseAssetName -Name $name
        if (-not $byName.TryAdd($name, $asset) -or -not $windowsNames.Add($name)) {
            throw "Release inventory contains duplicate Windows asset name '$name'."
        }
        if ([uint64]$asset.size -eq 0 -or [uint64]$asset.size -gt 16GB) {
            throw "Release inventory asset '$name' has an invalid size."
        }
        [void](ConvertFrom-FluxoraSha256Hex -Value ([string]$asset.sha256) -FieldName "Release asset '$name' sha256")
    }

    $names = [string[]]@($byName.Keys)
    [Array]::Sort($names, (Get-FluxoraUtf8OrdinalComparer))
    $orderedAssets = @($names | ForEach-Object {
        $asset = $byName[$_]
        [pscustomobject][ordered]@{
            name = [string]$asset.name
            size = [uint64]$asset.size
            sha256 = [string]$asset.sha256
        }
    })
    $inventory = [ordered]@{
        schemaVersion = 1
        version = $Version
        assets = $orderedAssets
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(
        ($inventory | ConvertTo-Json -Depth 10 -Compress -EscapeHandling EscapeNonAscii) + "`n")
    if ($bytes.Length -gt 256KB) {
        throw 'Release inventory exceeds the 256 KiB safety limit.'
    }
    return ,$bytes
}

function Read-FluxoraSignedReleaseInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $InventoryPath,
        [Parameter(Mandatory = $true)] [string] $SignaturePath,
        [Parameter(Mandatory = $true)] [string] $PublicKeyPath
    )

    foreach ($path in @($InventoryPath, $SignaturePath, $PublicKeyPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Signed release inventory input is missing: '$path'."
        }
    }
    $inventoryFile = Get-Item -LiteralPath $InventoryPath
    $signatureFile = Get-Item -LiteralPath $SignaturePath
    if ($inventoryFile.Length -le 0 -or $inventoryFile.Length -gt 256KB -or
        $signatureFile.Length -le 0 -or $signatureFile.Length -gt 1024) {
        throw 'Signed release inventory exceeds its safety limit.'
    }
    $bytes = [IO.File]::ReadAllBytes($inventoryFile.FullName)
    $signature = [IO.File]::ReadAllText($signatureFile.FullName, [Text.Encoding]::ASCII)
    $publicKey = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($PublicKeyPath))
    if (-not (Test-FluxoraDetachedSignature -ManifestBytes $bytes -Signature $signature -PublicKeyDer $publicKey)) {
        throw 'Detached release inventory signature is invalid.'
    }
    try {
        $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
        $inventory = $strictUtf8.GetString($bytes) | ConvertFrom-Json
    }
    catch {
        throw 'Signed release inventory is not valid UTF-8 JSON.'
    }
    Assert-FluxoraExactJsonProperties -Value $inventory -Expected @('schemaVersion', 'version', 'assets') -Context 'Signed release inventory'
    if ([int]$inventory.schemaVersion -ne 1) {
        throw 'Signed release inventory schema is unsupported.'
    }
    foreach ($asset in @($inventory.assets)) {
        Assert-FluxoraExactJsonProperties -Value $asset -Expected @('name', 'size', 'sha256') -Context 'Signed release inventory asset'
    }
    [void](ConvertTo-FluxoraReleaseInventoryBytes -Version ([string]$inventory.version) -Assets @($inventory.assets))
    return $inventory
}

function Assert-FluxoraDownloadedReleaseInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Directory,
        [Parameter(Mandatory = $true)] [object] $Inventory,
        [Parameter(Mandatory = $true)] [object] $UpdateManifest,
        [Parameter(Mandatory = $true)] [string[]] $ExpectedAssetNames
    )

    $root = [IO.Path]::GetFullPath($Directory)
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        throw "Downloaded release directory does not exist: '$root'."
    }
    if ([string]$Inventory.version -cne [string]$UpdateManifest.version) {
        throw 'Signed release inventory version does not match the signed update manifest.'
    }

    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $ExpectedAssetNames) {
        Assert-FluxoraReleaseAssetName -Name $name
        if (-not $expected.Add($name)) {
            throw "Expected release asset list contains duplicate Windows name '$name'."
        }
    }
    $actual = @((Get-ChildItem -LiteralPath $root -File -Force).Name)
    if ($actual.Count -ne $expected.Count -or @($actual | Where-Object { -not $expected.Contains($_) }).Count -ne 0) {
        throw 'Downloaded GitHub draft asset names do not exactly match the upload inventory.'
    }

    $inventoryByName = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($asset in @($Inventory.assets)) {
        $name = [string]$asset.name
        Assert-FluxoraReleaseAssetName -Name $name
        if (-not $inventoryByName.TryAdd($name, $asset)) {
            throw "Signed release inventory contains duplicate Windows name '$name'."
        }
        $path = Join-Path $root $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Signed release inventory asset is missing: '$name'."
        }
        $file = Get-Item -LiteralPath $path
        if ([uint64]$file.Length -ne [uint64]$asset.size) {
            throw "Downloaded release inventory size mismatch for '$name'."
        }
        $hash = Get-FluxoraFileSha256Hex -Path $path
        if ($hash -cne [string]$asset.sha256) {
            throw "Downloaded release inventory hash mismatch for '$name'."
        }
    }
    $inventoryEnvelopeNames = @('fluxora-release-inventory.json', 'fluxora-release-inventory.sig')
    $expectedInventoryNames = @($ExpectedAssetNames | Where-Object { $_ -notin $inventoryEnvelopeNames })
    if ($inventoryByName.Count -ne $expectedInventoryNames.Count -or
        @($expectedInventoryNames | Where-Object { -not $inventoryByName.ContainsKey($_) }).Count -ne 0) {
        throw 'Signed release inventory does not bind the exact GitHub release asset set.'
    }
    foreach ($required in @('FluxoraSetup.exe', 'fluxora-update-manifest.json', 'fluxora-update-manifest.sig')) {
        if (-not $inventoryByName.ContainsKey($required)) {
            throw "Signed release inventory is missing required asset '$required'."
        }
    }

    $manifestPackageNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($asset in @($UpdateManifest.assets)) {
        $uri = [Uri][string]$asset.url
        $name = [Uri]::UnescapeDataString([IO.Path]::GetFileName($uri.AbsolutePath))
        Assert-FluxoraReleaseAssetName -Name $name
        if (-not $manifestPackageNames.Add($name) -or -not $inventoryByName.ContainsKey($name)) {
            throw "Signed update package '$name' is not uniquely bound by the release inventory."
        }
        $inventoryAsset = $inventoryByName[$name]
        if ([uint64]$inventoryAsset.size -ne [uint64]$asset.size -or
            [string]$inventoryAsset.sha256 -cne [string]$asset.sha256) {
            throw "Signed update package '$name' does not match the signed release inventory."
        }
    }
    $inventoryPackageNames = @($inventoryByName.Keys | Where-Object { [IO.Path]::GetExtension($_) -ieq '.flxupd' })
    if ($inventoryPackageNames.Count -ne $manifestPackageNames.Count -or
        @($inventoryPackageNames | Where-Object { -not $manifestPackageNames.Contains($_) }).Count -ne 0) {
        throw 'Signed release inventory contains an update package not declared by the update manifest.'
    }
}

function Get-FluxoraSafePayloadFilePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $SourceDirectory,
        [Parameter(Mandatory = $true)] [string] $RelativePath
    )

    Assert-FluxoraUpdateRelativePath -Path $RelativePath
    $root = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Update path '$RelativePath' escapes the payload root."
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Update payload file is missing: '$RelativePath'."
    }

    $currentPath = $candidate
    while ($currentPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        $current = Get-Item -LiteralPath $currentPath -Force
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Update payload path '$RelativePath' traverses a reparse point."
        }
        $currentPath = Split-Path -Parent $currentPath
    }
    return $candidate
}

function Write-FluxoraUpdateBinaryString {
    param(
        [Parameter(Mandatory = $true)] [IO.BinaryWriter] $Writer,
        [Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Value
    )

    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    if ([uint64]$bytes.Length -gt [uint32]::MaxValue) {
        throw 'Update package string is too large.'
    }
    $Writer.Write([uint32]$bytes.Length)
    $Writer.Write($bytes)
}

function Write-FluxoraUpdatePackage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [ValidateSet('Full', 'Delta')] [string] $Kind,
        [Parameter(Mandatory = $true)] [string] $SourceDirectory,
        [Parameter(Mandatory = $true)] [object[]] $Entries,
        [AllowEmptyCollection()] [string[]] $DeletedPaths = @(),
        [AllowEmptyString()] [string] $FromVersion,
        [Parameter(Mandatory = $true)] [string] $TargetVersion,
        [Parameter(Mandatory = $true)] [string] $Target,
        [AllowEmptyString()] [string] $BaseFileManifestSha256,
        [Parameter(Mandatory = $true)] [string] $TargetFileManifestSha256,
        [Parameter(Mandatory = $true)] [string] $PackagePath
    )

    if (-not (Test-FluxoraSemVer -Version $TargetVersion)) {
        throw 'Update package target version must use major.minor.patch.'
    }
    if ($Target -cne 'win-x64') {
        throw "Unsupported update package target '$Target'."
    }
    $targetDigestBytes = ConvertFrom-FluxoraSha256Hex -Value $TargetFileManifestSha256 -FieldName 'Target file manifest digest'
    if ($Kind -ceq 'Full') {
        if (-not [string]::IsNullOrEmpty($FromVersion) -or -not [string]::IsNullOrEmpty($BaseFileManifestSha256) -or $DeletedPaths.Count -ne 0) {
            throw 'A full update package cannot have a base version, base digest, or deletions.'
        }
        $baseDigestBytes = [byte[]]::new(32)
        $FromVersion = ''
    }
    else {
        if (-not (Test-FluxoraSemVer -Version $FromVersion) -or $FromVersion -ceq $TargetVersion) {
            throw 'A delta update package requires a distinct semantic base version.'
        }
        $baseDigestBytes = ConvertFrom-FluxoraSha256Hex -Value $BaseFileManifestSha256 -FieldName 'Base file manifest digest'
    }

    $orderedEntries = @(Get-FluxoraOrdinalFileEntries -Files $Entries)
    if ($Kind -ceq 'Full' -and (Get-FluxoraUpdateFileManifestSha256 -Files $orderedEntries) -cne $TargetFileManifestSha256) {
        throw 'Full update package entries do not match the target file manifest digest.'
    }

    $deleteSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($deletedPath in $DeletedPaths) {
        Assert-FluxoraUpdateRelativePath -Path $deletedPath
        if (-not $deleteSet.Add($deletedPath)) {
            throw "Delta delete list contains duplicate Windows path '$deletedPath'."
        }
        if ($orderedEntries.path -icontains $deletedPath) {
            throw "Delta path '$deletedPath' cannot be both written and deleted."
        }
    }
    $orderedDeletes = [string[]]@($deleteSet)
    [Array]::Sort($orderedDeletes, (Get-FluxoraUtf8OrdinalComparer))

    $verifiedEntries = [System.Collections.Generic.List[object]]::new()
    [uint64]$totalPayloadBytes = 0
    foreach ($entry in $orderedEntries) {
        $filePath = Get-FluxoraSafePayloadFilePath -SourceDirectory $SourceDirectory -RelativePath ([string]$entry.path)
        $file = Get-Item -LiteralPath $filePath -Force
        if ([uint64]$file.Length -ne [uint64]$entry.size) {
            throw "Update payload size changed for '$($entry.path)'."
        }
        $actualHash = Get-FluxoraFileSha256Hex -Path $filePath
        if ($actualHash -cne [string]$entry.sha256) {
            throw "Update payload hash changed for '$($entry.path)'."
        }
        if ([uint64]::MaxValue - $totalPayloadBytes -lt [uint64]$entry.size) {
            throw 'Update package payload size overflowed UInt64.'
        }
        $totalPayloadBytes += [uint64]$entry.size
        $verifiedEntries.Add([pscustomobject]@{ Manifest = $entry; FilePath = $filePath })
    }

    $packageFullPath = [IO.Path]::GetFullPath($PackagePath)
    $parent = Split-Path -Parent $packageFullPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporaryPath = Join-Path $parent ((Split-Path -Leaf $packageFullPath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $stream = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $writer = [IO.BinaryWriter]::new($stream, [Text.Encoding]::UTF8, $true)
            try {
                $writer.Write([Text.Encoding]::ASCII.GetBytes("FLXUPD1`0"))
                $writer.Write([uint32]1)
                $kindByte = if ($Kind -ceq 'Full') { [byte]0 } else { [byte]1 }
                $writer.Write($kindByte)
                Write-FluxoraUpdateBinaryString -Writer $writer -Value $FromVersion
                Write-FluxoraUpdateBinaryString -Writer $writer -Value $TargetVersion
                Write-FluxoraUpdateBinaryString -Writer $writer -Value $Target
                $writer.Write($baseDigestBytes)
                $writer.Write($targetDigestBytes)
                $writer.Write([uint64]$orderedDeletes.Count)
                foreach ($deletedPath in $orderedDeletes) {
                    Write-FluxoraUpdateBinaryString -Writer $writer -Value $deletedPath
                }
                $writer.Write([uint64]$verifiedEntries.Count)
                $writer.Write($totalPayloadBytes)

                $buffer = [byte[]]::new(1024 * 1024)
                foreach ($verified in $verifiedEntries) {
                    $entry = $verified.Manifest
                    Write-FluxoraUpdateBinaryString -Writer $writer -Value ([string]$entry.path)
                    $writer.Write([uint64]$entry.size)
                    $writer.Write((ConvertFrom-FluxoraSha256Hex -Value ([string]$entry.sha256) -FieldName "File '$($entry.path)' sha256"))
                    $input = [IO.File]::Open($verified.FilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
                    $writeHash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
                    [uint64]$writtenBytes = 0
                    try {
                        while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                            $writer.Write($buffer, 0, $read)
                            $writeHash.AppendData($buffer, 0, $read)
                            $writtenBytes += [uint64]$read
                        }
                        $writtenHash = ConvertTo-FluxoraHexString -Bytes $writeHash.GetHashAndReset()
                        if ($writtenBytes -ne [uint64]$entry.size -or $writtenHash -cne [string]$entry.sha256) {
                            throw "Update payload changed while packaging '$($entry.path)'."
                        }
                    }
                    finally {
                        $writeHash.Dispose()
                        $input.Dispose()
                    }
                }
            }
            finally {
                $writer.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }
        [IO.File]::Move($temporaryPath, $packageFullPath, $true)
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    $package = Get-Item -LiteralPath $packageFullPath
    return [pscustomobject]@{
        path = $package.FullName
        size = [uint64]$package.Length
        sha256 = Get-FluxoraFileSha256Hex -Path $package.FullName
        kind = $Kind.ToLowerInvariant()
        fromVersion = if ($Kind -ceq 'Delta') { $FromVersion } else { $null }
        targetFileManifestSha256 = $TargetFileManifestSha256
        baseFileManifestSha256 = if ($Kind -ceq 'Delta') { $BaseFileManifestSha256 } else { $null }
    }
}

function New-FluxoraDetachedSignature {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [byte[]] $ManifestBytes,

        [Parameter(Mandatory = $true)]
        [System.Security.Cryptography.ECDsa] $SigningKey,

        [Parameter(Mandatory = $true)]
        [string] $KeyId
    )

    if ([string]::IsNullOrWhiteSpace($KeyId)) {
        throw 'Signing key id is required.'
    }

    $signature = $SigningKey.SignData(
        $ManifestBytes,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.DSASignatureFormat]::IeeeP1363FixedFieldConcatenation)
    if ($signature.Length -ne 64) {
        throw "ECDSA P-256 signature must be exactly 64 bytes, got $($signature.Length)."
    }
    return [Convert]::ToBase64String($signature)
}

function Test-FluxoraDetachedSignature {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [byte[]] $ManifestBytes,

        [Parameter(Mandatory = $true)]
        [string] $Signature,

        [Parameter(Mandatory = $true)]
        [byte[]] $PublicKeyDer
    )

    try {
        $signatureBytes = [Convert]::FromBase64String($Signature.Trim())
    }
    catch {
        return $false
    }
    if ($signatureBytes.Length -ne 64) {
        return $false
    }

    $verificationKey = [System.Security.Cryptography.ECDsa]::Create()
    try {
        $read = 0
        $verificationKey.ImportSubjectPublicKeyInfo($PublicKeyDer, [ref] $read)
        if ($read -ne $PublicKeyDer.Length) {
            return $false
        }
        return $verificationKey.VerifyData(
            $ManifestBytes,
            $signatureBytes,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.DSASignatureFormat]::IeeeP1363FixedFieldConcatenation)
    }
    catch {
        return $false
    }
    finally {
        $verificationKey.Dispose()
    }
}

function Get-FluxoraSigningKeyEntropy {
    return ,([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes('Fluxora.UpdateManifestSigningKey.CurrentUser.v1')))
}

function Write-FluxoraAtomicBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [byte[]] $Bytes
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $fullPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporaryPath = Join-Path $parent ((Split-Path -Leaf $fullPath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllBytes($temporaryPath, $Bytes)
        [IO.File]::Move($temporaryPath, $fullPath, $true)
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Set-FluxoraSigningKeyAcl {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $Path)

    if (-not $IsWindows) {
        return
    }
    $fullPath = [IO.Path]::GetFullPath($Path)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $grant = if (Test-Path -LiteralPath $fullPath -PathType Container) {
        "*$sid`:(OI)(CI)F"
    }
    else {
        "*$sid`:F"
    }
    $output = & "$env:SystemRoot\System32\icacls.exe" $fullPath '/inheritance:r' '/grant:r' $grant 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict the update signing key ACL: $($output -join ' ')"
    }
}

function ConvertFrom-FluxoraSecureStringToUtf8Bytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [Security.SecureString] $Value,
        [Parameter(Mandatory = $true)] [string] $Name
    )

    if ($Value.Length -lt 20) {
        throw "$Name must contain at least 20 characters."
    }
    if ($Value.Length -gt 1024) {
        throw "$Name exceeds the 1,024-character safety limit."
    }

    [IntPtr]$pointer = [IntPtr]::Zero
    [char[]]$characters = $null
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Value)
        $characters = [char[]]::new($Value.Length)
        for ($index = 0; $index -lt $characters.Length; $index++) {
            $characters[$index] = [char][uint16][Runtime.InteropServices.Marshal]::ReadInt16(
                $pointer,
                $index * 2)
        }
        $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
        return ,$strictUtf8.GetBytes($characters)
    }
    finally {
        if ($null -ne $characters) {
            [Array]::Clear($characters, 0, $characters.Length)
        }
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
        }
    }
}

function Initialize-FluxoraNativePathSupport {
    [CmdletBinding()]
    param()

    if ($null -ne ('Fluxora.Release.NativePath' -as [type])) {
        return
    }

    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Fluxora.Release
{
    public static class NativePath
    {
        private const uint OpenExisting = 3;
        private const uint FileShareRead = 0x00000001;
        private const uint FileShareWrite = 0x00000002;
        private const uint FileShareDelete = 0x00000004;
        private const uint FileFlagOpenReparsePoint = 0x00200000;
        private const uint FileFlagBackupSemantics = 0x02000000;
        private const uint VolumeNameGuid = 0x00000001;
        private const int MaximumWindowsPathCharacters = 32768;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder path,
            uint pathCharacters,
            uint flags);

        public static string GetFinalPath(string path)
        {
            using (SafeFileHandle handle = CreateFileW(
                path,
                0,
                FileShareRead | FileShareWrite | FileShareDelete,
                IntPtr.Zero,
                OpenExisting,
                FileFlagBackupSemantics | FileFlagOpenReparsePoint,
                IntPtr.Zero))
            {
                if (handle.IsInvalid)
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Could not open the path for canonical identity verification.");
                }

                var buffer = new StringBuilder(MaximumWindowsPathCharacters);
                uint length = GetFinalPathNameByHandleW(
                    handle,
                    buffer,
                    (uint)buffer.Capacity,
                    VolumeNameGuid);
                if (length == 0)
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Could not canonicalize the path identity.");
                }
                if (length >= buffer.Capacity)
                {
                    throw new InvalidOperationException(
                        "Canonical path exceeds the Windows safety limit.");
                }
                return buffer.ToString();
            }
        }
    }
}
'@
}

function ConvertTo-FluxoraSafeLocalFullPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    if (-not $IsWindows) {
        return [IO.Path]::GetFullPath($Path)
    }
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or
        $Path.StartsWith('\\?\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\.\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\??\', [StringComparison]::Ordinal)) {
        throw "$Context must use a standard local-drive path; UNC, device and extended path aliases are not allowed."
    }
    if ($Path.IndexOf(':', 2) -ge 0) {
        throw "$Context must not use an alternate data stream."
    }

    $fullPath = [IO.Path]::GetFullPath($Path)
    if ($fullPath -notmatch '^[A-Za-z]:\\') {
        throw "$Context must use a standard local-drive path."
    }
    $drive = [IO.DriveInfo]::new($fullPath.Substring(0, 3))
    if ($drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) {
        throw "$Context must use a fixed or removable local drive."
    }

    foreach ($segment in $fullPath.Substring(3).Split(
            [char[]]@([IO.Path]::DirectorySeparatorChar),
            [StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment.EndsWith(' ', [StringComparison]::Ordinal) -or
            $segment.EndsWith('.', [StringComparison]::Ordinal)) {
            throw "$Context contains a Windows path alias ending in a space or period."
        }
        if ($segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw "$Context contains a reserved Windows device name."
        }
    }
    return $fullPath
}

function Resolve-FluxoraCanonicalBoundaryPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    $fullPath = ConvertTo-FluxoraSafeLocalFullPath -Path $Path -Context $Context
    Assert-FluxoraPathHasNoReparsePoint -Path $fullPath -Context $Context
    Initialize-FluxoraNativePathSupport

    if (Test-Path -LiteralPath $fullPath) {
        return [Fluxora.Release.NativePath]::GetFinalPath($fullPath)
    }

    $parent = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "$Context parent directory does not exist: '$parent'."
    }
    $canonicalParent = [IO.Path]::TrimEndingDirectorySeparator(
        [Fluxora.Release.NativePath]::GetFinalPath($parent))
    return $canonicalParent + [IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $fullPath)
}

function Test-FluxoraPathWithinRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [string] $Root
    )

    $fullPath = [IO.Path]::TrimEndingDirectorySeparator(
        (Resolve-FluxoraCanonicalBoundaryPath -Path $Path -Context 'Fluxora boundary path'))
    $fullRoot = [IO.Path]::TrimEndingDirectorySeparator(
        (Resolve-FluxoraCanonicalBoundaryPath -Path $Root -Context 'Fluxora boundary root'))
    if ([string]::Equals($fullPath, $fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $fullPath.StartsWith(
        $fullRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)
}

function Assert-FluxoraPathHasNoReparsePoint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    $current = [IO.Path]::GetFullPath($Path)
    while (-not (Test-Path -LiteralPath $current)) {
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) {
            break
        }
        $current = $parent.FullName
    }

    while (-not [string]::IsNullOrWhiteSpace($current)) {
        $attributes = [IO.File]::GetAttributes($current)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Context must not use a reparse point: '$current'."
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) {
            break
        }
        $current = $parent.FullName
    }
}

function Read-FluxoraBoundedFileBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [long] $MaximumBytes,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    Assert-FluxoraPathHasNoReparsePoint -Path $fullPath -Context $Context
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "$Context is unavailable at '$fullPath'."
    }

    $stream = [IO.FileStream]::new(
        $fullPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read)
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt $MaximumBytes) {
            throw "$Context exceeds the $MaximumBytes-byte safety limit."
        }
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($read -le 0) {
                throw "$Context ended before its declared length."
            }
            $offset += $read
        }
        return ,$bytes
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-FluxoraPublishedFileMatches {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [byte[]] $ExpectedBytes,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    [byte[]]$publishedBytes = $null
    try {
        $publishedBytes = Read-FluxoraBoundedFileBytes `
            -Path $Path `
            -MaximumBytes $ExpectedBytes.Length `
            -Context $Context
        if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
                $publishedBytes,
                $ExpectedBytes)) {
            throw "$Context changed during publication; refusing to report success."
        }
        Assert-FluxoraPathHasNoReparsePoint -Path $Path -Context $Context
    }
    finally {
        if ($null -ne $publishedBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($publishedBytes)
        }
    }
}

function Assert-FluxoraSigningKeyMatchesPublicKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [Security.Cryptography.ECDsa] $SigningKey,
        [Parameter(Mandatory = $true)] [byte[]] $PublicKeyDer,
        [Parameter(Mandatory = $true)] [string] $Context
    )

    if ($SigningKey.KeySize -ne 256) {
        throw "$Context must contain an ECDSA P-256 key."
    }
    $actualPublic = $SigningKey.ExportSubjectPublicKeyInfo()
    try {
        if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
                $actualPublic,
                $PublicKeyDer)) {
            throw "$Context does not match the committed Fluxora update public key."
        }

        $probe = [Text.Encoding]::UTF8.GetBytes('Fluxora portable signing-key backup self-test v1')
        $signature = New-FluxoraDetachedSignature `
            -ManifestBytes $probe `
            -SigningKey $SigningKey `
            -KeyId 'backup-self-test'
        if (-not (Test-FluxoraDetachedSignature `
                -ManifestBytes $probe `
                -Signature $signature `
                -PublicKeyDer $PublicKeyDer)) {
            throw "$Context failed its sign/verify self-test."
        }
        return ConvertTo-FluxoraHexString -Bytes (
            [Security.Cryptography.SHA256]::HashData($actualPublic))
    }
    finally {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($actualPublic)
    }
}

function Assert-FluxoraEncryptedSigningKeyBackupPolicy {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [byte[]] $EncryptedPkcs8)

    [byte[]]$salt = $null
    [byte[]]$iv = $null
    [byte[]]$ciphertext = $null
    try {
        $reader = [System.Formats.Asn1.AsnReader]::new(
            $EncryptedPkcs8,
            [System.Formats.Asn1.AsnEncodingRules]::DER)
        $outer = $reader.ReadSequence()
        $algorithm = $outer.ReadSequence()
        if ($algorithm.ReadObjectIdentifier() -ne '1.2.840.113549.1.5.13') {
            throw 'PBES2 is required.'
        }

        $parameters = $algorithm.ReadSequence()
        $kdf = $parameters.ReadSequence()
        if ($kdf.ReadObjectIdentifier() -ne '1.2.840.113549.1.5.12') {
            throw 'PBKDF2 is required.'
        }
        $kdfParameters = $kdf.ReadSequence()
        $salt = $kdfParameters.ReadOctetString()
        if ($salt.Length -lt 16 -or $salt.Length -gt 64) {
            throw 'PBKDF2 salt length is outside the reviewed policy.'
        }
        $iterations = $kdfParameters.ReadInteger()
        if ($iterations -ne $script:FluxoraSigningKeyBackupIterations) {
            throw 'PBKDF2 work factor is outside the reviewed policy.'
        }
        $prf = $kdfParameters.ReadSequence()
        if ($prf.ReadObjectIdentifier() -ne '1.2.840.113549.2.9') {
            throw 'PBKDF2-HMAC-SHA256 is required.'
        }
        if ($prf.HasData) {
            $prf.ReadNull()
        }
        if ($prf.HasData -or $kdfParameters.HasData -or $kdf.HasData) {
            throw 'PBKDF2 contains an unsupported extension.'
        }

        $cipher = $parameters.ReadSequence()
        if ($cipher.ReadObjectIdentifier() -ne '2.16.840.1.101.3.4.1.42') {
            throw 'AES-256-CBC is required.'
        }
        $iv = $cipher.ReadOctetString()
        if ($iv.Length -ne 16) {
            throw 'AES-256-CBC IV must contain exactly 16 bytes.'
        }
        if ($cipher.HasData -or $parameters.HasData -or $algorithm.HasData) {
            throw 'PBES2 contains an unsupported extension.'
        }

        $ciphertext = $outer.ReadOctetString()
        if ($ciphertext.Length -lt 16 -or
            $ciphertext.Length -gt $script:FluxoraSigningKeyBackupMaximumBytes -or
            ($ciphertext.Length % 16) -ne 0) {
            throw 'Encrypted PKCS#8 payload length is invalid.'
        }
        if ($outer.HasData -or $reader.HasData) {
            throw 'Encrypted PKCS#8 contains trailing data.'
        }
    }
    catch {
        throw (
            'Encrypted Fluxora signing-key backup uses an unsupported or malformed ' +
            'cryptographic policy. Only the reviewed Fluxora backup format is accepted.')
    }
    finally {
        foreach ($temporary in @($salt, $iv, $ciphertext)) {
            if ($null -ne $temporary) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($temporary)
            }
        }
    }
}

function Open-FluxoraEncryptedSigningKeyBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [byte[]] $EncryptedPkcs8,
        [Parameter(Mandatory = $true)] [Security.SecureString] $Password,
        [Parameter(Mandatory = $true)] [byte[]] $PublicKeyDer
    )

    [byte[]]$passwordBytes = $null
    $key = [Security.Cryptography.ECDsa]::Create()
    try {
        Assert-FluxoraEncryptedSigningKeyBackupPolicy -EncryptedPkcs8 $EncryptedPkcs8
        $passwordBytes = ConvertFrom-FluxoraSecureStringToUtf8Bytes `
            -Value $Password `
            -Name 'Backup password'
        $read = 0
        try {
            $key.ImportEncryptedPkcs8PrivateKey(
                $passwordBytes,
                $EncryptedPkcs8,
                [ref]$read)
        }
        catch {
            throw 'Encrypted Fluxora signing-key backup could not be decrypted. The password is incorrect or the backup was modified.'
        }
        if ($read -ne $EncryptedPkcs8.Length) {
            throw 'Encrypted Fluxora signing-key backup contains trailing data.'
        }
        [void](Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $key `
            -PublicKeyDer $PublicKeyDer `
            -Context 'Encrypted Fluxora signing-key backup')
        return $key
    }
    catch {
        $key.Dispose()
        throw
    }
    finally {
        if ($null -ne $passwordBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($passwordBytes)
        }
    }
}

function Write-FluxoraNewRestrictedFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [byte[]] $Bytes,
        [Parameter(Mandatory = $true)] [string] $Context,
        [switch] $AllowNonAclFileSystem
    )

    $fullPath = [IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "$Context parent directory does not exist: '$parent'."
    }
    Assert-FluxoraPathHasNoReparsePoint -Path $parent -Context "$Context parent directory"
    if (Test-Path -LiteralPath $fullPath) {
        throw "$Context already exists at '$fullPath'; refusing to overwrite it."
    }

    $temporaryPath = Join-Path $parent (
        '.' + (Split-Path -Leaf $fullPath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $stream = $null
    try {
        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough)
        try {
            Set-FluxoraSigningKeyAcl -Path $temporaryPath
        }
        catch {
            if (-not $AllowNonAclFileSystem) {
                throw
            }
            Write-Warning "$Context is being written without a restrictive filesystem ACL because -AllowNonAclFileSystem was explicitly supplied. Encryption remains mandatory."
        }

        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null
        [IO.File]::Move($temporaryPath, $fullPath, $false)
        Assert-FluxoraPublishedFileMatches `
            -Path $fullPath `
            -ExpectedBytes $Bytes `
            -Context $Context
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Open-FluxoraUpdateSigningKey {
    [CmdletBinding()]
    param(
        [string] $ProtectedKeyPath,
        [AllowEmptyString()] [string] $PrivateKeyPkcs8Base64,
        [AllowNull()] [byte[]] $PrivateKeyPkcs8Bytes
    )

    [byte[]]$privateBytes = $null
    if ($null -ne $PrivateKeyPkcs8Bytes -and -not [string]::IsNullOrWhiteSpace($PrivateKeyPkcs8Base64)) {
        throw 'Provide the Fluxora signing key as bytes or base64, not both.'
    }
    if ($null -ne $PrivateKeyPkcs8Bytes) {
        $privateBytes = [byte[]]$PrivateKeyPkcs8Bytes.Clone()
    }
    elseif (-not [string]::IsNullOrWhiteSpace($PrivateKeyPkcs8Base64)) {
        try {
            $privateBytes = [Convert]::FromBase64String($PrivateKeyPkcs8Base64.Trim())
        }
        catch {
            throw 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64 is not valid base64.'
        }
    }
    else {
        if (-not $IsWindows) {
            throw 'The local Fluxora signing key store requires Windows DPAPI; provide the CI PKCS#8 base64 secret instead.'
        }
        if ([string]::IsNullOrWhiteSpace($ProtectedKeyPath) -or -not (Test-Path -LiteralPath $ProtectedKeyPath -PathType Leaf)) {
            throw "Fluxora update signing key is unavailable at '$ProtectedKeyPath'."
        }
        $protectedBytes = Read-FluxoraBoundedFileBytes `
            -Path $ProtectedKeyPath `
            -MaximumBytes $script:FluxoraSigningKeyBackupMaximumBytes `
            -Context 'Protected Fluxora update signing key'
        [byte[]]$entropy = Get-FluxoraSigningKeyEntropy
        try {
            $privateBytes = [Security.Cryptography.ProtectedData]::Unprotect(
                $protectedBytes,
                $entropy,
                [Security.Cryptography.DataProtectionScope]::CurrentUser)
        }
        catch {
            throw 'Fluxora update signing key could not be unprotected for the current Windows user.'
        }
        finally {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($protectedBytes)
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($entropy)
        }
    }

    $key = [Security.Cryptography.ECDsa]::Create()
    try {
        $read = 0
        $key.ImportPkcs8PrivateKey($privateBytes, [ref]$read)
        if ($read -ne $privateBytes.Length -or $key.KeySize -ne 256) {
            throw 'Fluxora update signing key must be exactly one ECDSA P-256 PKCS#8 key.'
        }
        return $key
    }
    catch {
        $key.Dispose()
        throw
    }
    finally {
        if ($null -ne $privateBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($privateBytes)
        }
    }
}

function Initialize-FluxoraUpdateSigningKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProtectedKeyPath,
        [Parameter(Mandatory = $true)] [string] $PublicKeyPath,
        [string] $PlaintextMigrationPath,
        [switch] $RemovePlaintextMigration
    )

    if (-not $IsWindows) {
        throw 'Fluxora local release signing key initialization requires Windows DPAPI.'
    }
    $protectedFullPath = [IO.Path]::GetFullPath($ProtectedKeyPath)
    $publicFullPath = [IO.Path]::GetFullPath($PublicKeyPath)
    if ([string]::Equals($protectedFullPath, $publicFullPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Private and public update signing key paths must be different.'
    }

    $key = $null
    [byte[]]$privateBytes = $null
    [byte[]]$protectedBytes = $null
    [byte[]]$entropy = $null
    try {
        if (Test-Path -LiteralPath $protectedFullPath -PathType Leaf) {
            $key = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedFullPath
        }
        elseif (-not [string]::IsNullOrWhiteSpace($PlaintextMigrationPath) -and
            (Test-Path -LiteralPath $PlaintextMigrationPath -PathType Leaf)) {
            $key = [Security.Cryptography.ECDsa]::Create()
            $pem = [IO.File]::ReadAllText([IO.Path]::GetFullPath($PlaintextMigrationPath), [Text.Encoding]::UTF8)
            try {
                $key.ImportFromPem($pem)
            }
            finally {
                $pem = $null
            }
            if ($key.KeySize -ne 256) {
                throw 'Migrated Fluxora update signing key must be ECDSA P-256.'
            }
        }
        else {
            $key = [Security.Cryptography.ECDsa]::Create(
                [Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
        }

        $privateBytes = $key.ExportPkcs8PrivateKey()
        $publicBytes = $key.ExportSubjectPublicKeyInfo()
        $fingerprint = ConvertTo-FluxoraHexString -Bytes ([Security.Cryptography.SHA256]::HashData($publicBytes))

        if (Test-Path -LiteralPath $publicFullPath -PathType Leaf) {
            $existingPublic = [IO.File]::ReadAllBytes($publicFullPath)
            if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($existingPublic, $publicBytes)) {
                throw "Existing public update key '$publicFullPath' does not match the protected signing key. Explicit rotation is required."
            }
        }

        $entropy = Get-FluxoraSigningKeyEntropy
        $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
            $privateBytes,
            $entropy,
            [Security.Cryptography.DataProtectionScope]::CurrentUser)
        Write-FluxoraAtomicBytes -Path $protectedFullPath -Bytes $protectedBytes
        Write-FluxoraAtomicBytes -Path $publicFullPath -Bytes $publicBytes
        Set-FluxoraSigningKeyAcl -Path (Split-Path -Parent $protectedFullPath)
        Set-FluxoraSigningKeyAcl -Path $protectedFullPath

        $roundTrip = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedFullPath
        try {
            $probe = [Text.Encoding]::UTF8.GetBytes('Fluxora update signing key self-test v1')
            $signature = New-FluxoraDetachedSignature -ManifestBytes $probe -SigningKey $roundTrip -KeyId 'self-test'
            if (-not (Test-FluxoraDetachedSignature -ManifestBytes $probe -Signature $signature -PublicKeyDer $publicBytes)) {
                throw 'Fluxora update signing key failed its sign/verify round-trip.'
            }
        }
        finally {
            $roundTrip.Dispose()
        }

        if ($RemovePlaintextMigration -and
            -not [string]::IsNullOrWhiteSpace($PlaintextMigrationPath) -and
            (Test-Path -LiteralPath $PlaintextMigrationPath -PathType Leaf)) {
            Remove-Item -LiteralPath ([IO.Path]::GetFullPath($PlaintextMigrationPath)) -Force
        }

        return [pscustomobject]@{
            protectedKeyPath = $protectedFullPath
            publicKeyPath = $publicFullPath
            fingerprint = $fingerprint
        }
    }
    finally {
        if ($null -ne $key) {
            $key.Dispose()
        }
        foreach ($sensitive in @($privateBytes, $protectedBytes, $entropy)) {
            if ($null -ne $sensitive) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($sensitive)
            }
        }
    }
}

function Export-FluxoraUpdateSigningKeyBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProtectedKeyPath,
        [Parameter(Mandatory = $true)] [string] $PublicKeyPath,
        [Parameter(Mandatory = $true)] [string] $BackupPath,
        [Parameter(Mandatory = $true)] [Security.SecureString] $Password,
        [Parameter(Mandatory = $true)] [Security.SecureString] $PasswordConfirmation,
        [switch] $AllowNonAclFileSystem
    )

    if (-not $IsWindows) {
        throw 'Fluxora signing-key backup export requires Windows DPAPI.'
    }
    if (-not [IO.Path]::IsPathFullyQualified($BackupPath)) {
        throw 'Fluxora signing-key backup path must be absolute.'
    }

    $protectedFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $ProtectedKeyPath `
        -Context 'Protected Fluxora signing key'
    $publicFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $PublicKeyPath `
        -Context 'Fluxora update public key'
    $backupFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $BackupPath `
        -Context 'Fluxora signing-key backup path'
    $repositoryFullPath = [IO.Path]::GetFullPath(
        (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    $activeKeyDirectory = Split-Path -Parent $protectedFullPath

    if (Test-FluxoraPathWithinRoot -Path $backupFullPath -Root $repositoryFullPath) {
        throw 'Fluxora signing-key backups must be stored outside the repository.'
    }
    if (Test-FluxoraPathWithinRoot -Path $backupFullPath -Root $activeKeyDirectory) {
        throw 'Fluxora signing-key backups must be stored outside the active key directory.'
    }
    foreach ($otherPath in @($protectedFullPath, $publicFullPath)) {
        if ([string]::Equals($backupFullPath, $otherPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Fluxora signing-key backup path must be distinct from active key files.'
        }
    }
    Assert-FluxoraPathHasNoReparsePoint -Path $protectedFullPath -Context 'Protected Fluxora signing key'
    Assert-FluxoraPathHasNoReparsePoint -Path $publicFullPath -Context 'Fluxora update public key'
    Assert-FluxoraPathHasNoReparsePoint -Path (Split-Path -Parent $backupFullPath) -Context 'Fluxora signing-key backup directory'
    if (Test-Path -LiteralPath $backupFullPath) {
        throw "Fluxora signing-key backup already exists at '$backupFullPath'; refusing to overwrite it."
    }

    [byte[]]$publicBytes = $null
    [byte[]]$passwordBytes = $null
    [byte[]]$encryptedBytes = $null
    [byte[]]$publishedBytes = $null
    $signingKey = $null
    $confirmationKey = $null
    $publishedKey = $null
    try {
        $publicBytes = Read-FluxoraBoundedFileBytes `
            -Path $publicFullPath `
            -MaximumBytes 4096 `
            -Context 'Fluxora update public key'
        $signingKey = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedFullPath
        $fingerprint = Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $signingKey `
            -PublicKeyDer $publicBytes `
            -Context 'Protected Fluxora signing key'

        $passwordBytes = ConvertFrom-FluxoraSecureStringToUtf8Bytes `
            -Value $Password `
            -Name 'Backup password'
        $pbe = [Security.Cryptography.PbeParameters]::new(
            [Security.Cryptography.PbeEncryptionAlgorithm]::Aes256Cbc,
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            $script:FluxoraSigningKeyBackupIterations)
        $encryptedBytes = $signingKey.ExportEncryptedPkcs8PrivateKey($passwordBytes, $pbe)
        if ($encryptedBytes.Length -le 0 -or
            $encryptedBytes.Length -gt $script:FluxoraSigningKeyBackupMaximumBytes) {
            throw 'Encrypted Fluxora signing-key backup exceeds its safety limit.'
        }

        $confirmationKey = Open-FluxoraEncryptedSigningKeyBackup `
            -EncryptedPkcs8 $encryptedBytes `
            -Password $PasswordConfirmation `
            -PublicKeyDer $publicBytes
        [void](Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $confirmationKey `
            -PublicKeyDer $publicBytes `
            -Context 'Confirmed Fluxora signing-key backup')

        Write-FluxoraNewRestrictedFile `
            -Path $backupFullPath `
            -Bytes $encryptedBytes `
            -Context 'Fluxora signing-key backup' `
            -AllowNonAclFileSystem:$AllowNonAclFileSystem

        $publishedBytes = Read-FluxoraBoundedFileBytes `
            -Path $backupFullPath `
            -MaximumBytes $script:FluxoraSigningKeyBackupMaximumBytes `
            -Context 'Published Fluxora signing-key backup'
        if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
                $publishedBytes,
                $encryptedBytes)) {
            throw 'Published Fluxora signing-key backup changed before final verification.'
        }
        $publishedKey = Open-FluxoraEncryptedSigningKeyBackup `
            -EncryptedPkcs8 $publishedBytes `
            -Password $PasswordConfirmation `
            -PublicKeyDer $publicBytes
        [void](Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $publishedKey `
            -PublicKeyDer $publicBytes `
            -Context 'Published Fluxora signing-key backup')

        return [pscustomobject]@{
            backupPath = $backupFullPath
            fingerprint = $fingerprint
            format = 'PKCS#8 EncryptedPrivateKeyInfo'
            encryption = 'PBES2/PBKDF2-HMAC-SHA256/AES-256-CBC'
            iterations = $script:FluxoraSigningKeyBackupIterations
        }
    }
    finally {
        if ($null -ne $publishedKey) {
            $publishedKey.Dispose()
        }
        if ($null -ne $confirmationKey) {
            $confirmationKey.Dispose()
        }
        if ($null -ne $signingKey) {
            $signingKey.Dispose()
        }
        foreach ($sensitive in @($passwordBytes, $encryptedBytes, $publishedBytes)) {
            if ($null -ne $sensitive) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($sensitive)
            }
        }
    }
}

function Restore-FluxoraUpdateSigningKeyBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $BackupPath,
        [Parameter(Mandatory = $true)] [string] $ProtectedKeyPath,
        [Parameter(Mandatory = $true)] [string] $PublicKeyPath,
        [Parameter(Mandatory = $true)] [Security.SecureString] $Password
    )

    if (-not $IsWindows) {
        throw 'Fluxora signing-key backup restore requires Windows DPAPI.'
    }
    if (-not [IO.Path]::IsPathFullyQualified($BackupPath)) {
        throw 'Fluxora signing-key backup path must be absolute.'
    }

    $backupFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $BackupPath `
        -Context 'Fluxora signing-key backup path'
    $protectedFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $ProtectedKeyPath `
        -Context 'Protected Fluxora signing key'
    $publicFullPath = ConvertTo-FluxoraSafeLocalFullPath `
        -Path $PublicKeyPath `
        -Context 'Fluxora update public key'
    $repositoryFullPath = [IO.Path]::GetFullPath(
        (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    if (Test-FluxoraPathWithinRoot -Path $backupFullPath -Root $repositoryFullPath) {
        throw 'Fluxora signing-key backups must be restored from outside the repository.'
    }
    foreach ($otherPath in @($protectedFullPath, $publicFullPath)) {
        if ([string]::Equals($backupFullPath, $otherPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Fluxora signing-key backup path must be distinct from active key files.'
        }
    }

    [byte[]]$publicBytes = $null
    [byte[]]$encryptedBytes = $null
    [byte[]]$privateBytes = $null
    [byte[]]$protectedBytes = $null
    [byte[]]$entropy = $null
    $backupKey = $null
    $existingKey = $null
    $roundTrip = $null
    $createdProtectedFile = $false
    try {
        $publicBytes = Read-FluxoraBoundedFileBytes `
            -Path $publicFullPath `
            -MaximumBytes 4096 `
            -Context 'Fluxora update public key'
        $encryptedBytes = Read-FluxoraBoundedFileBytes `
            -Path $backupFullPath `
            -MaximumBytes $script:FluxoraSigningKeyBackupMaximumBytes `
            -Context 'Encrypted Fluxora signing-key backup'
        $backupKey = Open-FluxoraEncryptedSigningKeyBackup `
            -EncryptedPkcs8 $encryptedBytes `
            -Password $Password `
            -PublicKeyDer $publicBytes
        $fingerprint = Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $backupKey `
            -PublicKeyDer $publicBytes `
            -Context 'Encrypted Fluxora signing-key backup'

        Assert-FluxoraPathHasNoReparsePoint `
            -Path $protectedFullPath `
            -Context 'Protected Fluxora signing-key destination'
        if (Test-Path -LiteralPath $protectedFullPath -PathType Leaf) {
            try {
                $existingKey = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedFullPath
                [void](Assert-FluxoraSigningKeyMatchesPublicKey `
                    -SigningKey $existingKey `
                    -PublicKeyDer $publicBytes `
                    -Context 'Existing protected Fluxora signing key')
            }
            catch {
                throw "Protected Fluxora signing-key destination already exists and was not modified: $($_.Exception.Message)"
            }
            return [pscustomobject]@{
                protectedKeyPath = $protectedFullPath
                publicKeyPath = $publicFullPath
                fingerprint = $fingerprint
                restored = $false
                alreadyPresent = $true
            }
        }
        if (Test-Path -LiteralPath $protectedFullPath) {
            throw "Protected Fluxora signing-key destination is not a file: '$protectedFullPath'."
        }

        $protectedParent = Split-Path -Parent $protectedFullPath
        $createdParent = $false
        if (-not (Test-Path -LiteralPath $protectedParent -PathType Container)) {
            New-Item -ItemType Directory -Path $protectedParent | Out-Null
            $createdParent = $true
        }
        Assert-FluxoraPathHasNoReparsePoint `
            -Path $protectedParent `
            -Context 'Protected Fluxora signing-key directory'
        if ($createdParent) {
            Set-FluxoraSigningKeyAcl -Path $protectedParent
        }

        $privateBytes = $backupKey.ExportPkcs8PrivateKey()
        $entropy = Get-FluxoraSigningKeyEntropy
        $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
            $privateBytes,
            $entropy,
            [Security.Cryptography.DataProtectionScope]::CurrentUser)
        Write-FluxoraNewRestrictedFile `
            -Path $protectedFullPath `
            -Bytes $protectedBytes `
            -Context 'Protected Fluxora signing key'
        $createdProtectedFile = $true

        $roundTrip = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedFullPath
        [void](Assert-FluxoraSigningKeyMatchesPublicKey `
            -SigningKey $roundTrip `
            -PublicKeyDer $publicBytes `
            -Context 'Restored protected Fluxora signing key')

        return [pscustomobject]@{
            protectedKeyPath = $protectedFullPath
            publicKeyPath = $publicFullPath
            fingerprint = $fingerprint
            restored = $true
            alreadyPresent = $false
        }
    }
    catch {
        if ($createdProtectedFile -and
            (Test-Path -LiteralPath $protectedFullPath -PathType Leaf) -and
            $null -ne $protectedBytes) {
            [byte[]]$currentProtectedBytes = $null
            try {
                $currentProtectedBytes = [IO.File]::ReadAllBytes($protectedFullPath)
                if ([Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
                        $currentProtectedBytes,
                        $protectedBytes)) {
                    Remove-Item -LiteralPath $protectedFullPath -Force
                }
            }
            finally {
                if ($null -ne $currentProtectedBytes) {
                    [Security.Cryptography.CryptographicOperations]::ZeroMemory($currentProtectedBytes)
                }
            }
        }
        throw
    }
    finally {
        foreach ($key in @($roundTrip, $existingKey, $backupKey)) {
            if ($null -ne $key) {
                $key.Dispose()
            }
        }
        foreach ($sensitive in @(
                $encryptedBytes,
                $privateBytes,
                $protectedBytes,
                $entropy)) {
            if ($null -ne $sensitive) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($sensitive)
            }
        }
    }
}

function Compare-FluxoraFileManifests {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object[]] $BaseFiles,

        [Parameter(Mandatory = $true)]
        [object[]] $TargetFiles
    )

    $baseByPath = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    $targetByPath = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    $caseFolded = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $BaseFiles) {
        if (-not $baseByPath.TryAdd([string] $file.path, $file)) {
            throw "Base file manifest contains duplicate path '$($file.path)'."
        }
    }
    foreach ($file in $TargetFiles) {
        if (-not $targetByPath.TryAdd([string] $file.path, $file) -or -not $caseFolded.Add([string] $file.path)) {
            throw "Target file manifest contains duplicate Windows path '$($file.path)'."
        }
    }

    $changed = [System.Collections.Generic.List[object]]::new()
    foreach ($file in $TargetFiles) {
        $baseFile = $null
        if (-not $baseByPath.TryGetValue([string] $file.path, [ref] $baseFile) -or
            [string] $baseFile.sha256 -cne [string] $file.sha256 -or
            [uint64] $baseFile.size -ne [uint64] $file.size) {
            $changed.Add($file)
        }
    }

    $deleted = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $BaseFiles) {
        if (-not $targetByPath.ContainsKey([string] $file.path)) {
            $deleted.Add([string] $file.path)
        }
    }

    return [pscustomobject]@{
        changed = @($changed | Sort-Object -Property path -CaseSensitive)
        deleted = @($deleted | Sort-Object -CaseSensitive)
    }
}

function Get-FluxoraFileSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProjectRoot,
        [Parameter(Mandatory = $true)] [string[]] $RelativePaths
    )

    $root = [IO.Path]::GetFullPath($ProjectRoot)
    $snapshots = [Collections.Generic.List[object]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($relativePath in $RelativePaths) {
        if ([string]::IsNullOrWhiteSpace($relativePath) -or [IO.Path]::IsPathRooted($relativePath) -or
            -not $seen.Add($relativePath)) {
            throw "Version snapshot path '$relativePath' is invalid or duplicated."
        }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
        $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Version snapshot path '$relativePath' is outside the repository or missing."
        }
        $file = Get-Item -LiteralPath $fullPath
        $snapshots.Add([pscustomobject]@{
            relativePath = $relativePath
            size = [uint64]$file.Length
            sha256 = Get-FluxoraFileSha256Hex -Path $fullPath
        })
    }
    return @($snapshots)
}

function Assert-FluxoraFileSnapshots {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProjectRoot,
        [Parameter(Mandatory = $true)] [object[]] $Snapshots
    )

    foreach ($snapshot in $Snapshots) {
        $current = @(Get-FluxoraFileSnapshots -ProjectRoot $ProjectRoot -RelativePaths @([string]$snapshot.relativePath))[0]
        if ([uint64]$current.size -ne [uint64]$snapshot.size -or
            [string]$current.sha256 -cne [string]$snapshot.sha256) {
            throw "Version file '$($snapshot.relativePath)' changed after the version transaction was sealed."
        }
    }
}

function Resolve-FluxoraRecoveryFilePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProjectRoot,
        [Parameter(Mandatory = $true)] [string] $RelativePath
    )

    $root = [IO.Path]::GetFullPath($ProjectRoot)
    if (-not (Test-Path -LiteralPath $root -PathType Container) -or
        [string]::IsNullOrWhiteSpace($RelativePath) -or
        [IO.Path]::IsPathRooted($RelativePath)) {
        throw "Version recovery path '$RelativePath' is invalid."
    }

    $fullPath = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Version recovery path '$RelativePath' is outside the repository."
    }

    $parent = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "Version recovery parent directory is missing for '$RelativePath'."
    }
    $relativeParent = [IO.Path]::GetRelativePath($root, $parent)
    $cursor = $root
    if ($relativeParent -ne '.') {
        foreach ($segment in $relativeParent.Split(
            [IO.Path]::DirectorySeparatorChar,
            [StringSplitOptions]::RemoveEmptyEntries)) {
            $cursor = Join-Path $cursor $segment
            $directory = Get-Item -LiteralPath $cursor -Force
            if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Version recovery path '$RelativePath' crosses a reparse point."
            }
        }
    }
    if (Test-Path -LiteralPath $fullPath) {
        $file = Get-Item -LiteralPath $fullPath -Force
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Version recovery path '$RelativePath' is a reparse point."
        }
    }
    return $fullPath
}

function New-FluxoraVersionRecoveryJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProjectRoot,
        [Parameter(Mandatory = $true)] [string] $JournalPath,
        [Parameter(Mandatory = $true)] [string[]] $RelativePaths,
        [Parameter(Mandatory = $true)] [string] $PreReleaseHead,
        [Parameter(Mandatory = $true)] [string] $TargetVersion
    )

    if ($PreReleaseHead -notmatch '\A(?:[0-9a-f]{40}|[0-9a-f]{64})\z' -or
        -not (Test-FluxoraSemVer -Version $TargetVersion)) {
        throw 'Version recovery metadata contains an invalid Git head or target version.'
    }
    if (Test-Path -LiteralPath $JournalPath) {
        throw "A version recovery journal already exists at '$JournalPath'."
    }
    if ($RelativePaths.Count -eq 0 -or $RelativePaths.Count -gt 32) {
        throw 'Version recovery requires between 1 and 32 repository files.'
    }

    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $files = [Collections.Generic.List[object]]::new()
    [uint64]$totalSize = 0
    foreach ($relativePath in $RelativePaths) {
        if (-not $seen.Add($relativePath)) {
            throw "Version recovery path '$relativePath' is duplicated."
        }
        $fullPath = Resolve-FluxoraRecoveryFilePath -ProjectRoot $ProjectRoot -RelativePath $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Version recovery source file '$relativePath' is missing."
        }
        $bytes = [IO.File]::ReadAllBytes($fullPath)
        $totalSize += [uint64]$bytes.Length
        if ($bytes.Length -gt 8MB -or $totalSize -gt 32MB) {
            throw 'Version recovery data exceeds its bounded size limit.'
        }
        $files.Add([ordered]@{
            relativePath = $relativePath
            size = [uint64]$bytes.Length
            sha256 = [Convert]::ToHexString(
                [Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
            bytesBase64 = [Convert]::ToBase64String($bytes)
        })
    }

    $journal = [ordered]@{
        schemaVersion = 1
        preReleaseHead = $PreReleaseHead
        targetVersion = $TargetVersion
        files = @($files)
    }
    $journalBytes = [Text.UTF8Encoding]::new($false).GetBytes(
        (($journal | ConvertTo-Json -Depth 5 -Compress) + "`n"))
    Write-FluxoraAtomicBytes -Path $JournalPath -Bytes $journalBytes
}

function Restore-FluxoraVersionRecoveryJournal {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ProjectRoot,
        [Parameter(Mandatory = $true)] [string] $JournalPath,
        [Parameter(Mandatory = $true)] [string] $CurrentHead
    )

    if (-not (Test-Path -LiteralPath $JournalPath -PathType Leaf)) {
        return $false
    }
    $journalFile = Get-Item -LiteralPath $JournalPath -Force
    if (($journalFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $journalFile.Length -gt 48MB) {
        throw "Version recovery journal '$JournalPath' is unsafe or oversized."
    }

    try {
        $journal = Get-Content -LiteralPath $JournalPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
    }
    catch {
        throw "Version recovery journal '$JournalPath' is not valid JSON."
    }
    if ($null -eq $journal -or
        -not $journal.ContainsKey('schemaVersion') -or [int]$journal.schemaVersion -ne 1 -or
        -not $journal.ContainsKey('preReleaseHead') -or
        -not $journal.ContainsKey('targetVersion') -or
        -not $journal.ContainsKey('files')) {
        throw "Version recovery journal '$JournalPath' has an unsupported schema."
    }
    $preReleaseHead = [string]$journal.preReleaseHead
    if ($preReleaseHead -notmatch '\A(?:[0-9a-f]{40}|[0-9a-f]{64})\z' -or
        $CurrentHead -cne $preReleaseHead) {
        throw "Version recovery journal belongs to Git head '$preReleaseHead', but the current head is '$CurrentHead'."
    }
    if (-not (Test-FluxoraSemVer -Version ([string]$journal.targetVersion))) {
        throw "Version recovery journal '$JournalPath' has an invalid target version."
    }

    $entries = @($journal.files)
    if ($entries.Count -eq 0 -or $entries.Count -gt 32) {
        throw "Version recovery journal '$JournalPath' has an invalid file count."
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $restores = [Collections.Generic.List[object]]::new()
    [uint64]$totalSize = 0
    foreach ($entry in $entries) {
        if ($null -eq $entry -or
            -not $entry.ContainsKey('relativePath') -or
            -not $entry.ContainsKey('size') -or
            -not $entry.ContainsKey('sha256') -or
            -not $entry.ContainsKey('bytesBase64')) {
            throw "Version recovery journal '$JournalPath' contains an invalid file entry."
        }
        $relativePath = [string]$entry.relativePath
        if (-not $seen.Add($relativePath)) {
            throw "Version recovery journal contains duplicate path '$relativePath'."
        }
        $fullPath = Resolve-FluxoraRecoveryFilePath -ProjectRoot $ProjectRoot -RelativePath $relativePath
        try {
            $bytes = [Convert]::FromBase64String([string]$entry.bytesBase64)
            $declaredSize = [uint64]$entry.size
        }
        catch {
            throw "Version recovery journal contains invalid bytes for '$relativePath'."
        }
        $totalSize += [uint64]$bytes.Length
        $actualSha256 = [Convert]::ToHexString(
            [Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
        if ($bytes.Length -gt 8MB -or $totalSize -gt 32MB -or
            [uint64]$bytes.Length -ne $declaredSize -or
            [string]$entry.sha256 -cnotmatch '\A[0-9a-f]{64}\z' -or
            $actualSha256 -cne [string]$entry.sha256) {
            throw "Version recovery journal bytes failed validation for '$relativePath'."
        }
        $restores.Add([pscustomobject]@{
            relativePath = $relativePath
            fullPath = $fullPath
            bytes = $bytes
            size = $declaredSize
            sha256 = $actualSha256
        })
    }

    foreach ($restore in $restores) {
        Write-FluxoraAtomicBytes -Path $restore.fullPath -Bytes $restore.bytes
    }
    foreach ($restore in $restores) {
        $file = Get-Item -LiteralPath $restore.fullPath
        if ([uint64]$file.Length -ne [uint64]$restore.size -or
            (Get-FluxoraFileSha256Hex -Path $restore.fullPath) -cne [string]$restore.sha256) {
            throw "Version recovery verification failed for '$($restore.relativePath)'."
        }
    }
    Remove-Item -LiteralPath $JournalPath -Force
    if (Test-Path -LiteralPath $JournalPath) {
        throw "Version recovery journal '$JournalPath' could not be removed after recovery."
    }
    return $true
}

function Remove-FluxoraVersionRecoveryJournal {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] [string] $JournalPath)

    if (-not (Test-Path -LiteralPath $JournalPath)) {
        return
    }
    $journalFile = Get-Item -LiteralPath $JournalPath -Force
    if (($journalFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $journalFile.PSIsContainer) {
        throw "Version recovery journal '$JournalPath' is not a regular file."
    }
    Remove-Item -LiteralPath $JournalPath -Force
}

function Assert-FluxoraCanonicalRepositoryIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $ExpectedRepository,
        [Parameter(Mandatory = $true)] [string] $FetchRepository,
        [Parameter(Mandatory = $true)] [string] $PushRepository,
        [Parameter(Mandatory = $true)] [string] $Visibility
    )

    if (-not [string]::Equals($FetchRepository, $ExpectedRepository, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals($PushRepository, $ExpectedRepository, [StringComparison]::OrdinalIgnoreCase) -or
        $Visibility -cne 'PUBLIC') {
        throw "Production fetch and push transports must resolve to the canonical repository '$ExpectedRepository'."
    }
}

function Assert-FluxoraPreviousReleaseLineage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $TagName,
        [Parameter(Mandatory = $true)] [string] $ManifestVersion
    )

    if (-not (Test-FluxoraSemVer -Version $ManifestVersion) -or $TagName -cne "v$ManifestVersion") {
        throw "Previous release tag '$TagName' does not match signed manifest version '$ManifestVersion'."
    }
}

function Assert-FluxoraReleaseChildEnvironment {
    [CmdletBinding()]
    param(
        [string] $SecretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64',
        [string] $ChildFilePath = '<unknown>'
    )

    if (-not [string]::IsNullOrWhiteSpace(
        [Environment]::GetEnvironmentVariable($SecretName, 'Process'))) {
        throw "Refusing to start child process '$ChildFilePath' while the permanent signing secret is present in its environment."
    }
}

function Assert-FluxoraReleaseStagedPaths {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]] $Paths,

        [AllowEmptyCollection()]
        [string[]] $DeletedPaths = @()
    )

    $sensitivePathPattern = '(?i)(^|[\\/])(?:\.env(?:\.[^\\/]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|[^\\/]+\.(?:pfx|p12|pem|key|pk8|dpapi))$|(^|[\\/])secrets?([\\/]|$)'
    $generatedPathPattern = '(?i)(^|[\\/])(?:node_modules|target|build|dist|coverage|test-results|playwright-report|output|output-installer|output-update)([\\/]|$)'
    $staged = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not $staged.Add($path)) {
            throw "Production checkpoint contains an invalid or duplicate staged path: '$path'."
        }
    }
    $deleted = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $DeletedPaths) {
        if ([string]::IsNullOrWhiteSpace($path) -or
            -not $staged.Contains($path) -or
            -not $deleted.Add($path)) {
            throw "Deleted path '$path' is not present in the staged path set or is duplicated."
        }
    }

    foreach ($path in $Paths) {
        if ($deleted.Contains($path)) {
            continue
        }
        if ($path -match $sensitivePathPattern) {
            throw "Production checkpoint contains a sensitive path that must be reviewed and committed separately: '$path'."
        }
        if ($path -match $generatedPathPattern) {
            throw "Production checkpoint contains a generated path that must not be published from the worktree: '$path'."
        }
    }
}

function Assert-FluxoraReleasePreconditions {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] [string] $Branch,
        [Parameter(Mandatory = $true)] [string] $DefaultBranch,
        [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [string[]] $StatusLines,
        [Parameter(Mandatory = $true)] [int] $Ahead,
        [Parameter(Mandatory = $true)] [int] $Behind,
        [Parameter(Mandatory = $true)] [bool] $ExistingTag,
        [Parameter(Mandatory = $true)] [bool] $ExistingRelease
    )

    if ($Branch -cne $DefaultBranch) {
        throw "Production releases must run from the default branch '$DefaultBranch'."
    }
    if ($StatusLines.Count -ne 0) {
        throw 'Production releases require a clean working tree before the version transaction starts.'
    }
    if ($Behind -ne 0) {
        throw "The local default branch is behind its upstream by $Behind commit(s)."
    }
    if ($ExistingTag) {
        throw 'The production release tag already exists.'
    }
    if ($ExistingRelease) {
        throw 'The production GitHub release already exists.'
    }
}

Export-ModuleMember -Function @(
    'Resolve-FluxoraBuildMode',
    'Get-FluxoraNextPatchVersion',
    'Resolve-FluxoraProductionVersion',
    'Get-FluxoraProductVersion',
    'Set-FluxoraProductVersion',
    'New-FluxoraDetachedSignature',
    'Test-FluxoraDetachedSignature',
    'Initialize-FluxoraUpdateSigningKey',
    'Open-FluxoraUpdateSigningKey',
    'Export-FluxoraUpdateSigningKeyBackup',
    'Restore-FluxoraUpdateSigningKeyBackup',
    'Get-FluxoraUpdateFileManifest',
    'Get-FluxoraUpdateFileManifestSha256',
    'ConvertTo-FluxoraUpdateManifestBytes',
    'Read-FluxoraSignedUpdateManifest',
    'ConvertTo-FluxoraReleaseInventoryBytes',
    'Read-FluxoraSignedReleaseInventory',
    'Assert-FluxoraDownloadedReleaseInventory',
    'Write-FluxoraUpdatePackage',
    'Compare-FluxoraFileManifests',
    'Get-FluxoraFileSnapshots',
    'Assert-FluxoraFileSnapshots',
    'New-FluxoraVersionRecoveryJournal',
    'Restore-FluxoraVersionRecoveryJournal',
    'Remove-FluxoraVersionRecoveryJournal',
    'Assert-FluxoraCanonicalRepositoryIdentity',
    'Assert-FluxoraPreviousReleaseLineage',
    'Assert-FluxoraReleaseChildEnvironment',
    'Assert-FluxoraReleaseStagedPaths',
    'Assert-FluxoraReleasePreconditions'
)
