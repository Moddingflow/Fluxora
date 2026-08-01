[CmdletBinding()]
param(
    [switch]$UpdateInventory,
    [switch]$Release,
    [switch]$MachineReadable,
    [string]$CMakeEvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$legalRoot = Join-Path $repoRoot 'legal\desktop'
$iconsRoot = Join-Path $repoRoot 'Icons'
$inventoryPath = Join-Path $legalRoot 'dependency-inventory.json'
$policyPath = Join-Path $legalRoot 'license-policy.json'
$manifestPath = Join-Path $legalRoot 'manifest.json'
$failures = New-Object System.Collections.Generic.List[string]
$checks = 0

function Add-Failure {
    param([Parameter(Mandatory = $true)][string]$Message)
    $script:failures.Add($Message)
}

function Assert-Compliance {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    $script:checks++
    if (-not $Condition) {
        Add-Failure -Message $Message
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Cannot hash missing file '$Path'."
    }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256Hex {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $bytes = $encoding.GetBytes($Text)
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-PackageSetHash {
    param([Parameter(Mandatory = $true)][object[]]$Packages)
    $lines = @(
        $Packages |
            ForEach-Object { "$($_.name)@$($_.version)|$($_.license)|$($_.source)" } |
            Sort-Object -Unique
    )
    $canonical = if ($lines.Count -gt 0) {
        ($lines -join "`n") + "`n"
    }
    else {
        ''
    }
    return Get-TextSha256Hex -Text $canonical
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required JSON file is missing: '$Path'."
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Invoke-JsonCommand {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    Push-Location $WorkingDirectory
    $stderrPath = [System.IO.Path]::GetTempFileName()
    try {
        $output = @(& $Executable @Arguments 2> $stderrPath)
        $stderr = if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
            Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        }
        else {
            ''
        }
        if ($LASTEXITCODE -ne 0) {
            throw "'$Executable $($Arguments -join ' ')' failed with exit code $LASTEXITCODE.`n$stderr`n$($output -join "`n")"
        }
        return ($output -join "`n") | ConvertFrom-Json
    }
    finally {
        if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
            [System.IO.File]::Delete($stderrPath)
        }
        Pop-Location
    }
}

function Expand-PnpmPackages {
    param([Parameter(Mandatory = $true)][object]$LicenseReport)
    $packages = New-Object System.Collections.Generic.List[object]
    foreach ($licenseProperty in $LicenseReport.PSObject.Properties) {
        foreach ($package in @($licenseProperty.Value)) {
            $license = [string]$package.license
            if ([string]::IsNullOrWhiteSpace($license)) {
                $license = [string]$licenseProperty.Name
            }
            foreach ($version in @($package.versions)) {
                $packages.Add([pscustomobject][ordered]@{
                    name = [string]$package.name
                    version = [string]$version
                    license = $license
                    source = 'npm-registry'
                })
            }
        }
    }
    return @($packages.ToArray() | Sort-Object name,version,license,source -Unique)
}

function New-PnpmInventory {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $frontendRoot = Join-Path $repoRoot 'frontend-tauri'
    $pnpmCommand = (Get-Command 'pnpm' -ErrorAction Stop).Source
    $runtimeReport = Invoke-JsonCommand -WorkingDirectory $frontendRoot -Executable $pnpmCommand -Arguments @(
        'licenses', 'list', '--prod', '--json'
    )
    $allReport = Invoke-JsonCommand -WorkingDirectory $frontendRoot -Executable $pnpmCommand -Arguments @(
        'licenses', 'list', '--json'
    )
    $runtime = @(Expand-PnpmPackages -LicenseReport $runtimeReport)
    $all = @(Expand-PnpmPackages -LicenseReport $allReport)

    $runtimeKeys = @{}
    foreach ($package in $runtime) {
        $runtimeKeys["$($package.name)@$($package.version)|$($package.license)"] = $true
    }
    $buildOnly = @(
        $all |
            Where-Object {
                -not $runtimeKeys.ContainsKey("$($_.name)@$($_.version)|$($_.license)")
            } |
            Sort-Object name,version,license,source -Unique
    )

    $approved = @($Policy.pnpmApprovedExpressions)
    foreach ($package in $all) {
        Assert-Compliance -Condition (
            -not [string]::IsNullOrWhiteSpace([string]$package.license) -and
            $approved -contains [string]$package.license
        ) -Message "pnpm package '$($package.name)@$($package.version)' has missing or unapproved licence '$($package.license)'."
    }

    return [pscustomobject][ordered]@{
        platform = 'win32-x64'
        runtimeDistributed = [pscustomobject][ordered]@{
            count = $runtime.Count
            packageSetSha256 = Get-PackageSetHash -Packages $runtime
            packages = $runtime
        }
        buildTestOnly = [pscustomobject][ordered]@{
            count = $buildOnly.Count
            packageSetSha256 = Get-PackageSetHash -Packages $buildOnly
            packages = $buildOnly
        }
    }
}

function Test-NormalCargoDependency {
    param([Parameter(Mandatory = $true)][object]$Dependency)
    foreach ($kind in @($Dependency.dep_kinds)) {
        if ($null -eq $kind.kind -or [string]$kind.kind -eq 'normal') {
            return $true
        }
    }
    return $false
}

function Convert-CargoPackage {
    param([Parameter(Mandatory = $true)][object]$Package)
    $license = [string]$Package.license
    if ([string]::IsNullOrWhiteSpace($license)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$Package.license_file)) {
            $license = "LicenseRef-file:$([System.IO.Path]::GetFileName([string]$Package.license_file))"
        }
        else {
            $license = '<missing>'
        }
    }
    $source = [string]$Package.source
    if ([string]::IsNullOrWhiteSpace($source)) {
        $source = 'path-or-workspace'
    }
    return [pscustomobject][ordered]@{
        name = [string]$Package.name
        version = [string]$Package.version
        license = $license
        source = $source
    }
}

function New-CargoInventory {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $cargoRoot = Join-Path $repoRoot 'frontend-tauri\src-tauri'
    $cargoCommand = (Get-Command 'cargo' -ErrorAction Stop).Source
    $metadata = Invoke-JsonCommand -WorkingDirectory $cargoRoot -Executable $cargoCommand -Arguments @(
        'metadata',
        '--format-version', '1',
        '--locked',
        '--offline',
        '--filter-platform', 'x86_64-pc-windows-msvc',
        '--all-features'
    )
    $manifestFullPath = [System.IO.Path]::GetFullPath((Join-Path $cargoRoot 'Cargo.toml'))
    $rootPackage = @(
        $metadata.packages |
            Where-Object {
                [System.IO.Path]::GetFullPath([string]$_.manifest_path) -eq $manifestFullPath
            }
    )
    if ($rootPackage.Count -ne 1) {
        throw "Expected exactly one Cargo root package for '$manifestFullPath', found $($rootPackage.Count)."
    }
    $rootId = [string]$rootPackage[0].id

    $nodeById = @{}
    foreach ($node in @($metadata.resolve.nodes)) {
        $nodeById[[string]$node.id] = $node
    }
    $packageById = @{}
    foreach ($package in @($metadata.packages)) {
        $packageById[[string]$package.id] = $package
    }

    $runtimeIds = @{}
    $queue = New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($rootId)
    while ($queue.Count -gt 0) {
        $currentId = $queue.Dequeue()
        if (-not $nodeById.ContainsKey($currentId)) {
            continue
        }
        foreach ($dependency in @($nodeById[$currentId].deps)) {
            if (-not (Test-NormalCargoDependency -Dependency $dependency)) {
                continue
            }
            $dependencyId = [string]$dependency.pkg
            if (-not $runtimeIds.ContainsKey($dependencyId)) {
                $runtimeIds[$dependencyId] = $true
                $queue.Enqueue($dependencyId)
            }
        }
    }

    $resolvedIds = @{}
    foreach ($node in @($metadata.resolve.nodes)) {
        $id = [string]$node.id
        if ($id -ne $rootId) {
            $resolvedIds[$id] = $true
        }
    }
    $runtime = @(
        foreach ($id in $runtimeIds.Keys) {
            if ($packageById.ContainsKey($id)) {
                Convert-CargoPackage -Package $packageById[$id]
            }
        }
    ) | Sort-Object name,version,license,source -Unique
    $buildOnly = @(
        foreach ($id in $resolvedIds.Keys) {
            if (-not $runtimeIds.ContainsKey($id) -and $packageById.ContainsKey($id)) {
                Convert-CargoPackage -Package $packageById[$id]
            }
        }
    ) | Sort-Object name,version,license,source -Unique

    $approved = @($Policy.cargoApprovedExpressions)
    foreach ($package in @($runtime) + @($buildOnly)) {
        Assert-Compliance -Condition (
            -not [string]::IsNullOrWhiteSpace([string]$package.license) -and
            $approved -contains [string]$package.license
        ) -Message "Cargo package '$($package.name)@$($package.version)' has missing or unapproved licence '$($package.license)'."
    }

    return [pscustomobject][ordered]@{
        platform = 'x86_64-pc-windows-msvc'
        features = 'all'
        runtimeDistributed = [pscustomobject][ordered]@{
            count = @($runtime).Count
            packageSetSha256 = Get-PackageSetHash -Packages @($runtime)
            packages = @($runtime)
        }
        buildTestOnly = [pscustomobject][ordered]@{
            count = @($buildOnly).Count
            packageSetSha256 = Get-PackageSetHash -Packages @($buildOnly)
            packages = @($buildOnly)
        }
    }
}

function New-CmakeInventory {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $backendCmakePath = Join-Path $repoRoot 'backend\CMakeLists.txt'
    $testsCmakePath = Join-Path $repoRoot 'backend\tests\CMakeLists.txt'
    $backendCmake = Get-Content -LiteralPath $backendCmakePath -Raw -Encoding UTF8
    $testsCmake = Get-Content -LiteralPath $testsCmakePath -Raw -Encoding UTF8
    $buildScript = Get-Content -LiteralPath (Join-Path $repoRoot 'Build.ps1') -Raw -Encoding UTF8
    Assert-Compliance -Condition (
        $backendCmake -match '(?s)option\s*\(\s*FLUXORA_ALLOW_SYSTEM_DEPENDENCIES.+?\bOFF\s*\)'
    ) -Message 'CMake must default FLUXORA_ALLOW_SYSTEM_DEPENDENCIES to OFF.'
    Assert-Compliance -Condition (
        $buildScript.Contains('-DFLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF')
    ) -Message 'Build.ps1 must explicitly disable system CMake dependencies.'
    $approved = @($Policy.cmakeApprovedLicenses)
    $entries = New-Object System.Collections.Generic.List[object]

    foreach ($dependency in @($Policy.cmakeDependencies)) {
        $declarationFile = if ([string]$dependency.name -eq 'GoogleTest') {
            'backend/tests/CMakeLists.txt'
        }
        else {
            'backend/CMakeLists.txt'
        }
        $sourceText = if ([string]$dependency.name -eq 'GoogleTest') {
            $testsCmake
        }
        else {
            $backendCmake
        }
        Assert-Compliance -Condition (
            $sourceText.Contains([string]$dependency.sourceDeclaration)
        ) -Message "CMake declaration for '$($dependency.name)' no longer contains '$($dependency.sourceDeclaration)'."
        Assert-Compliance -Condition (
            $approved -contains [string]$dependency.license
        ) -Message "CMake dependency '$($dependency.name)' has unapproved licence '$($dependency.license)'."

        $entries.Add([pscustomobject][ordered]@{
            name = [string]$dependency.name
            scope = [string]$dependency.scope
            license = [string]$dependency.license
            configuredFallbackVersion = [string]$dependency.fallbackVersion
            declarationFile = $declarationFile
            nonReleaseSystemOverrideSupported = [bool]$dependency.nonReleaseSystemOverrideSupported
            releaseAllowsSystemDependencies = [bool]$dependency.releaseAllowsSystemDependencies
            resolvedReleaseEvidenceRequired = [bool]$dependency.resolvedReleaseEvidenceRequired
        })
    }
    return $entries.ToArray()
}

function New-InputFilesInventory {
    $relativePaths = @(
        'legal/desktop/manifest.json',
        'legal/desktop/license-policy.json',
        'frontend-tauri/package.json',
        'frontend-tauri/pnpm-lock.yaml',
        'frontend-tauri/src-tauri/Cargo.toml',
        'frontend-tauri/src-tauri/Cargo.lock',
        'Build.ps1',
        'backend/CMakeLists.txt',
        'backend/tests/CMakeLists.txt',
        'frontend-tauri/speech/manifest.v1.json',
        'frontend-tauri/speech/licenses/whisper.cpp-MIT.txt',
        'frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt',
        'frontend-tauri/speech/licenses/silero-vad-MIT.txt',
        'frontend-tauri/speech/licenses/whisper-rs-UNLICENSE.txt',
        'frontend-tauri/scripts/ensure-libclang.ps1',
        'frontend-tauri/scripts/ensure-vulkan-sdk.ps1',
        'frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt',
        'frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt',
        'Icons/provenance.json',
        'Icons/installer-updater-icons.json',
        'Icons/README.md',
        'Icons/FLUXORA-ASSET-NOTICE.txt',
        'Icons/LUCIDE-LICENSE.txt',
        'Icons/BOOTSTRAP-ICONS-LICENSE.txt',
        'Icons/TABLER-ICONS-LICENSE.txt',
        'Icons/MATERIAL-DESIGN-ICONS-LICENSE.txt',
        'Icons/TWEMOJI-LICENSE.txt',
        'third_party/webview2/source.json',
        'third_party/webview2/MicrosoftEdgeWebview2Setup.exe'
    )
    $entries = New-Object System.Collections.Generic.List[object]
    foreach ($relativePath in $relativePaths) {
        $absolutePath = Join-Path $repoRoot ($relativePath -replace '/', '\')
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "Inventory input is missing: '$relativePath'."
        }
        $entries.Add([pscustomobject][ordered]@{
            path = $relativePath
            sha256 = Get-Sha256Hex -Path $absolutePath
        })
    }
    return $entries.ToArray()
}

function New-CurrentInventory {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $speechManifest = Read-JsonFile -Path (Join-Path $repoRoot 'frontend-tauri\speech\manifest.v1.json')
    $webViewSource = Read-JsonFile -Path (Join-Path $repoRoot 'third_party\webview2\source.json')
    $iconProvenance = Read-JsonFile -Path (Join-Path $iconsRoot 'provenance.json')
    $installerIcons = Read-JsonFile -Path (Join-Path $iconsRoot 'installer-updater-icons.json')
    $libclangScript = Get-Content -LiteralPath (Join-Path $repoRoot 'frontend-tauri\scripts\ensure-libclang.ps1') -Raw -Encoding UTF8
    $libclangVersionMatch = [regex]::Match($libclangScript, "\`$version\s*=\s*'(?<value>[^']+)'")
    $libclangHashMatch = [regex]::Match($libclangScript, "\`$expectedSha256\s*=\s*'(?<value>[0-9a-fA-F]{64})'")
    $libclangLicenseMatch = [regex]::Match($libclangScript, "\`$licenseExpression\s*=\s*'(?<value>[^']+)'")
    $libclangRepositoryMatch = [regex]::Match($libclangScript, "\`$sourceRepository\s*=\s*'(?<value>[^']+)'")
    $libclangTagMatch = [regex]::Match($libclangScript, "\`$sourceTag\s*=\s*'(?<value>[^']+)'")
    if (-not $libclangVersionMatch.Success -or
        -not $libclangHashMatch.Success -or
        -not $libclangLicenseMatch.Success -or
        -not $libclangRepositoryMatch.Success -or
        -not $libclangTagMatch.Success) {
        throw 'Unable to extract the pinned libclang build-tool identity, licence, and SHA-256.'
    }
    Assert-Compliance -Condition (
        @($Policy.cargoApprovedExpressions) -contains $libclangLicenseMatch.Groups['value'].Value
    ) -Message "Pinned libclang build tool has unapproved licence '$($libclangLicenseMatch.Groups['value'].Value)'."
    Assert-Compliance -Condition (
        $libclangTagMatch.Groups['value'].Value -eq
            "llvmorg-$($libclangVersionMatch.Groups['value'].Value)"
    ) -Message 'Pinned libclang source tag must match its package version.'
    $vulkanScript = Get-Content -LiteralPath (Join-Path $repoRoot 'frontend-tauri\scripts\ensure-vulkan-sdk.ps1') -Raw -Encoding UTF8
    $versionMatch = [regex]::Match($vulkanScript, "\`$sdkVersion\s*=\s*'(?<value>[^']+)'")
    $hashMatch = [regex]::Match($vulkanScript, "\`$sdkSha256\s*=\s*'(?<value>[0-9a-fA-F]{64})'")
    if (-not $versionMatch.Success -or -not $hashMatch.Success) {
        throw 'Unable to extract the pinned Vulkan SDK version and SHA-256.'
    }

    $pnpmInventory = New-PnpmInventory -Policy $Policy
    $cargoInventory = New-CargoInventory -Policy $Policy
    $cmakeInventory = New-CmakeInventory -Policy $Policy

    return [pscustomobject][ordered]@{
        schemaVersion = 1
        target = 'Fluxora Windows desktop distribution'
        inputs = @(New-InputFilesInventory)
        packageManagers = [pscustomobject][ordered]@{
            pnpm = $pnpmInventory
            cargo = $cargoInventory
        }
        cmake = [pscustomobject][ordered]@{
            dependencies = $cmakeInventory
            resolutionRule = 'Production sets FLUXORA_ALLOW_SYSTEM_DEPENDENCIES=OFF and must match exact pinned source/version/scope evidence; opt-in system overrides are non-release only.'
            releaseEvidencePath = [string]$Policy.releaseEvidence.cmakeResolvedDependencies
        }
        webView2 = [pscustomobject][ordered]@{
            role = 'runtime prerequisite bootstrapper embedded in Setup'
            fileName = [string]$webViewSource.fileName
            sourceUrl = [string]$webViewSource.sourceUrl
            retrievedOn = [string]$webViewSource.retrievedOn
            size = [long]$webViewSource.size
            sha256 = ([string]$webViewSource.sha256).ToLowerInvariant()
            authenticodeSignerSubject = [string]$webViewSource.authenticodeSignerSubject
            authenticodeSignerThumbprint = ([string]$webViewSource.authenticodeSignerThumbprint).ToUpperInvariant()
            deploymentDocumentation = [string]$webViewSource.deploymentDocumentation
            licenseKind = [string]$webViewSource.licenseKind
        }
        speech = [pscustomobject][ordered]@{
            scope = 'runtime-distributed'
            manifestSchema = [string]$speechManifest.schema
            manifestVersion = [string]$speechManifest.version
            model = [pscustomobject][ordered]@{
                version = [string]$speechManifest.model.version
                fileName = [string]$speechManifest.model.fileName
                revision = [string]$speechManifest.model.revision
                sourceUrl = [string]$speechManifest.model.sourceUrl
                sha256 = ([string]$speechManifest.model.sha256).ToLowerInvariant()
                sizeBytes = [long]$speechManifest.model.sizeBytes
                license = 'MIT'
                licenseFile = 'frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt'
            }
            vad = [pscustomobject][ordered]@{
                version = [string]$speechManifest.vad.version
                fileName = [string]$speechManifest.vad.fileName
                revision = [string]$speechManifest.vad.revision
                sourceUrl = [string]$speechManifest.vad.sourceUrl
                sha256 = ([string]$speechManifest.vad.sha256).ToLowerInvariant()
                license = 'MIT'
                licenseFile = 'frontend-tauri/speech/licenses/silero-vad-MIT.txt'
            }
        }
        fonts = @(
            [pscustomobject][ordered]@{
                name = 'Geist'
                scope = 'runtime-distributed'
                license = 'OFL-1.1'
                licenseFile = 'frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt'
            },
            [pscustomobject][ordered]@{
                name = 'IBM Plex Sans and IBM Plex Mono'
                scope = 'runtime-distributed'
                license = 'OFL-1.1'
                licenseFile = 'frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt'
            }
        )
        icons = [pscustomobject][ordered]@{
            sourceRoot = 'Icons'
            verifiedGroupCount = @($iconProvenance.verified).Count
            verifiedFileCount = @($iconProvenance.verified | ForEach-Object { @($_.files) }).Count
            projectOwnedFileCount = @($iconProvenance.projectOwned | ForEach-Object { @($_.files) }).Count
            quarantinedFileCount = @($iconProvenance.quarantined).Count
            installerUpdaterAllowlistedCount = @($installerIcons.icons).Count + @($installerIcons.projectOwnedAssets).Count
            provenanceSha256 = Get-Sha256Hex -Path (Join-Path $iconsRoot 'provenance.json')
            installerUpdaterAllowlistSha256 = Get-Sha256Hex -Path (Join-Path $iconsRoot 'installer-updater-icons.json')
        }
        buildTestOnlyTools = @(
            [pscustomobject][ordered]@{
                name = 'libclang Windows x64 runtime for bindgen'
                version = $libclangVersionMatch.Groups['value'].Value
                sha256 = $libclangHashMatch.Groups['value'].Value.ToLowerInvariant()
                license = $libclangLicenseMatch.Groups['value'].Value
                sourceRepository = $libclangRepositoryMatch.Groups['value'].Value
                sourceTag = $libclangTagMatch.Groups['value'].Value
                distributedWithFluxora = $false
            },
            [pscustomobject][ordered]@{
                name = 'LunarG Vulkan SDK'
                version = $versionMatch.Groups['value'].Value
                sha256 = $hashMatch.Groups['value'].Value.ToLowerInvariant()
                distributedWithFluxora = $false
            },
            [pscustomobject][ordered]@{
                name = 'Node.js, pnpm, Vite, TypeScript, Vitest and Playwright'
                distributedWithFluxora = $false
            },
            [pscustomobject][ordered]@{
                name = 'CMake, MSVC, Rust/Cargo, PowerShell and Git'
                distributedWithFluxora = $false
            }
        )
        classificationRule = 'Only runtimeDistributed entries and explicitly identified runtime assets are represented as shipped; buildTestOnly entries and tools are not claimed to be installed with Fluxora.'
    }
}

function Test-LegalManifest {
    $manifest = Read-JsonFile -Path $manifestPath
    Assert-Compliance -Condition ([int]$manifest.schemaVersion -eq 1) -Message 'Legal manifest schemaVersion must be 1.'
    Assert-Compliance -Condition ([string]$manifest.fallbackLanguage -eq 'en') -Message 'Legal manifest fallbackLanguage must be en.'
    Assert-Compliance -Condition (
        [string]$manifest.effectiveDate -match '^\d{4}-\d{2}-\d{2}$'
    ) -Message 'Legal manifest effectiveDate must use YYYY-MM-DD.'

    # Keep this source ASCII-only so Windows PowerShell 5.1 can parse the gate
    # without relying on a UTF-8 BOM. Values are SHA-256 of the UTF-8 title.
    $expectedTitleHashes = @{
        'en|privacy' = '506ff394621596dd88138642eddfc1e41833b3ae92d95e5c77c94327098abd9a'
        'en|terms' = '12a0015fa32217778863154566bce500732726db6ea596518712c12955d9a225'
        'en|third-party-notices' = '98fc4ea62110092ee4080f1c4c259578b44a5ab02134ec4e0fc7aa935ccce4ee'
        'en|legal-notice' = '058d2182bd01da2dea7d302ebee141bafb99d18df9325ae9ddcc0b618e0df507'
        'de|privacy' = 'a1235efbc18d60e2359b3257cd79769df0b2fd2f7bb5683e73495bbef69b3282'
        'de|terms' = 'df6700c4be0c1e181652c9c2b16e6eb7a5047af7e8ca5b6abf2147f8ba7ae84a'
        'de|third-party-notices' = 'c87e1eb4a7476af93e3db8bcdc5a4d04f9ea604cfdb38158341f0b913d03f6dd'
        'de|legal-notice' = '346bad1b9f0ad9a96da49ae0421a0eac800b7f048af007ec39b303df9cb9f01d'
        'ru|privacy' = '3ba8eaa5d624cefb4e4d3f6944683486dd44b0eb39ac7659f9c0db49f6560d75'
        'ru|terms' = '4b5ef4dc258e983d61ff53d7632f50279c64beda5e1c5b9b26646e3f3363d804'
        'ru|third-party-notices' = '9bec39d72a9a558a68b33aafee58272536e47ac15d693ce5ce89480fb0f7a292'
        'ru|legal-notice' = '013e672c9daecf249f9c52659a15101d6fffff51b6e24840a68b893b0164b54a'
    }
    $seen = @{}
    $seenPaths = @{}
    Assert-Compliance -Condition (@($manifest.documents).Count -eq 12) -Message 'Legal manifest must contain exactly 12 documents.'
    foreach ($document in @($manifest.documents)) {
        $key = "$($document.language)|$($document.kind)"
        Assert-Compliance -Condition (-not $seen.ContainsKey($key)) -Message "Duplicate legal manifest entry '$key'."
        $seen[$key] = $true
        Assert-Compliance -Condition ($expectedTitleHashes.ContainsKey($key)) -Message "Unexpected legal manifest entry '$key'."
        if ($expectedTitleHashes.ContainsKey($key)) {
            Assert-Compliance -Condition (
                (Get-TextSha256Hex -Text ([string]$document.title)) -eq [string]$expectedTitleHashes[$key]
            ) -Message "Legal title for '$key' does not match its reviewed UTF-8 title hash."
        }

        $relativePath = [string]$document.path
        Assert-Compliance -Condition (-not $seenPaths.ContainsKey($relativePath)) -Message "Duplicate legal path '$relativePath'."
        $seenPaths[$relativePath] = $true
        Assert-Compliance -Condition (
            $relativePath -eq "$($document.language)/$(
                if ([string]$document.kind -eq 'third-party-notices') {
                    'third-party-notices'
                }
                elseif ([string]$document.kind -eq 'legal-notice') {
                    'legal-notice'
                }
                else {
                    [string]$document.kind
                }
            ).md"
        ) -Message "Legal path '$relativePath' does not match language/kind."

        $absolutePath = [System.IO.Path]::GetFullPath((Join-Path $legalRoot ($relativePath -replace '/', '\')))
        $legalPrefix = [System.IO.Path]::GetFullPath($legalRoot).TrimEnd('\') + '\'
        Assert-Compliance -Condition (
            $absolutePath.StartsWith($legalPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        ) -Message "Legal path escapes legal/desktop: '$relativePath'."
        Assert-Compliance -Condition (
            Test-Path -LiteralPath $absolutePath -PathType Leaf
        ) -Message "Legal document is missing: '$relativePath'."
        if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
            $actualHash = Get-Sha256Hex -Path $absolutePath
            Assert-Compliance -Condition (
                [string]::Equals($actualHash, [string]$document.sha256, [System.StringComparison]::OrdinalIgnoreCase)
            ) -Message "Legal SHA-256 mismatch for '$relativePath': expected '$($document.sha256)', actual '$actualHash'."
            $text = Get-Content -LiteralPath $absolutePath -Raw -Encoding UTF8
            $firstLine = ($text -split "\r?\n", 2)[0].TrimStart([char]0xFEFF)
            Assert-Compliance -Condition (
                $firstLine -eq "# $($document.title)"
            ) -Message "First heading in '$relativePath' must be '# $($document.title)'."
            Assert-Compliance -Condition (
                $text -notmatch '(?i)\bImpressum\b'
            ) -Message "User-visible legacy heading word found in '$relativePath'."
            Assert-Compliance -Condition (
                $text -notmatch '(?i)ec\.europa\.eu/consumers/odr'
            ) -Message "Obsolete EU dispute-platform URL found in '$relativePath'."
            if ([string]$document.kind -in @('terms', 'third-party-notices')) {
                Assert-Compliance -Condition (
                    $text -notmatch '(?i)\b(?:\.NET|WPF|SharpVectors)\b'
                ) -Message "Removed legacy dependency claim found in '$relativePath'."
            }
            if ([string]$document.kind -eq 'third-party-notices') {
                Assert-Compliance -Condition (
                    $text -notmatch '(?i)Tauri\s+(?:bundles|includes|ships)\s+(?:Node(?:\.js)?|Chromium)'
                ) -Message "Stale Tauri runtime claim found in '$relativePath'."
            }
        }
    }
    foreach ($key in $expectedTitleHashes.Keys) {
        Assert-Compliance -Condition ($seen.ContainsKey($key)) -Message "Missing legal manifest entry '$key'."
    }
    foreach ($gateName in @(
        'publicReleaseBlockedUntilApproved',
        'ownerApprovalRequired',
        'qualifiedGermanCounselReviewRequired',
        'translationsReviewRequired',
        'unknownOrMissingLicenseBlocksRelease',
        'unverifiedAssetProvenanceBlocksRelease'
    )) {
        $property = $manifest.releaseGate.PSObject.Properties[$gateName]
        Assert-Compliance -Condition (
            $null -ne $property -and [bool]$property.Value
        ) -Message "Legal release gate '$gateName' must be true."
    }

    $privacyText = Get-Content -LiteralPath (Join-Path $legalRoot 'en\privacy.md') -Raw -Encoding UTF8
    $coverage = [ordered]@{
        'Setup' = '(?i)\bSetup\b'
        'WebView2 bootstrap' = '(?i)WebView2.+Bootstrapper'
        'GitHub update checks' = '(?i)GitHub Releases'
        'ModdingFlow' = '(?i)\bModdingFlow\b'
        'Nexus' = '(?i)\bNexus Mods\b'
        'AI provider' = '(?i)\bAI\b.+(?:Google|Gemini)'
        'web research' = '(?i)web research'
        'microphone' = '(?i)\bmicrophone\b'
        'local speech' = '(?i)processed locally.+(?:Whisper|Silero)'
        'settings' = '(?i)\bsettings\b'
        'credentials' = '(?i)\bcredentials?\b'
        'logs' = '(?i)\blogs?\b'
        'crash data' = '(?i)\bcrash\b'
        'cache and retention' = '(?i)cache.+retention|retention.+cache'
        'recipients' = '(?i)\bRecipients\b'
        'legal bases' = '(?i)\bLegal bases\b'
        'deletion controls' = '(?i)\bdelete\b|\bremov(?:e|al)\b'
        'international transfers' = '(?i)\bInternational transfers\b'
    }
    foreach ($item in $coverage.GetEnumerator()) {
        Assert-Compliance -Condition (
            $privacyText -match [string]$item.Value
        ) -Message "English privacy policy is missing coverage for '$($item.Key)'."
    }
    Assert-Compliance -Condition (
        $privacyText -match '(?i)privacy acknowledgement is not .+ consent'
    ) -Message 'Privacy acknowledgement must be distinguished from consent.'

    $setupUpdateDisclosures = @(
        @{ Privacy = 'en\privacy.md'; Terms = 'en\terms.md' },
        @{ Privacy = 'de\privacy.md'; Terms = 'de\terms.md' },
        @{ Privacy = 'ru\privacy.md'; Terms = 'ru\terms.md' }
    )
    foreach ($disclosure in $setupUpdateDisclosures) {
        $localizedPrivacy = Get-Content -LiteralPath (Join-Path $legalRoot $disclosure.Privacy) -Raw -Encoding UTF8
        $localizedTerms = Get-Content -LiteralPath (Join-Path $legalRoot $disclosure.Terms) -Raw -Encoding UTF8
        Assert-Compliance -Condition (
            $localizedPrivacy -match '(?i)%APPDATA%\\Fluxora\\updates' -and
            $localizedPrivacy -match '(?i)GitHub Releases' -and
            $localizedPrivacy -match '(?i)Updater' -and
            $localizedPrivacy -match '(?i)telemetr'
        ) -Message "Privacy disclosure '$($disclosure.Privacy)' must describe the post-Setup GitHub update, local cache, Updater handoff, and absence of telemetry."
        Assert-Compliance -Condition (
            $localizedTerms -match '(?i)FluxoraSetup\.exe' -and
            $localizedTerms -match '(?i)Updater' -and
            $localizedTerms -match '(?i)downgrade' -and
            $localizedTerms -match '(?i)delta' -and
            $localizedTerms -match '(?i)rollback'
        ) -Message "Terms disclosure '$($disclosure.Terms)' must bind Setup to full-only update, no downgrade/delta, Updater handoff, and rollback."
    }
}

function Test-IconCompliance {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $provenance = Read-JsonFile -Path (Join-Path $iconsRoot 'provenance.json')
    $installerAllowlist = Read-JsonFile -Path (Join-Path $iconsRoot 'installer-updater-icons.json')
    $readme = Get-Content -LiteralPath (Join-Path $iconsRoot 'README.md') -Raw -Encoding UTF8
    $approvedLicenses = @($Policy.assetApprovedLicenses)
    $verified = @{}
    $projectOwned = @{}
    $quarantined = @{}

    foreach ($fileName in @($provenance.quarantined)) {
        $quarantined[[string]$fileName] = $true
    }
    foreach ($group in @($provenance.verified)) {
        Assert-Compliance -Condition (
            $approvedLicenses -contains [string]$group.license
        ) -Message "Icon group '$($group.repository)@$($group.tag)' has unapproved licence '$($group.license)'."
        $licensePath = Join-Path $iconsRoot ([string]$group.licenseFile)
        Assert-Compliance -Condition (
            Test-Path -LiteralPath $licensePath -PathType Leaf
        ) -Message "Icon licence file is missing: '$($group.licenseFile)'."
        Assert-Compliance -Condition (
            -not [string]::IsNullOrWhiteSpace([string]$group.repository) -and
            -not [string]::IsNullOrWhiteSpace([string]$group.tag) -and
            -not [string]::IsNullOrWhiteSpace([string]$group.upstreamBasePath)
        ) -Message 'Verified icon group must have an upstream repository, pinned tag, and base path.'
        foreach ($fileName in @($group.files)) {
            $file = [string]$fileName
            Assert-Compliance -Condition (-not $verified.ContainsKey($file)) -Message "Duplicate verified icon '$file'."
            $verified[$file] = [pscustomobject]@{
                license = [string]$group.license
                licenseFile = [string]$group.licenseFile
                repository = [string]$group.repository
                tag = [string]$group.tag
            }
            Assert-Compliance -Condition (
                Test-Path -LiteralPath (Join-Path $iconsRoot $file) -PathType Leaf
            ) -Message "Verified icon file is missing: '$file'."
            Assert-Compliance -Condition (
                $readme.Contains("``$file``")
            ) -Message "Verified icon '$file' is not documented in Icons/README.md."
            Assert-Compliance -Condition (
                -not $quarantined.ContainsKey($file)
            ) -Message "Icon '$file' cannot be both verified and quarantined."
            $hashProperty = $group.hashes.PSObject.Properties[$file]
            Assert-Compliance -Condition (
                $null -ne $hashProperty -and [string]$hashProperty.Value -match '^[0-9a-f]{64}$'
            ) -Message "Verified icon '$file' has no pinned SHA-256."
            $iconPath = Join-Path $iconsRoot $file
            if ($null -ne $hashProperty -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
                $actualHash = Get-Sha256Hex -Path $iconPath
                Assert-Compliance -Condition (
                    [string]::Equals($actualHash, [string]$hashProperty.Value, [System.StringComparison]::OrdinalIgnoreCase)
                ) -Message "Verified icon '$file' hash mismatch: expected '$($hashProperty.Value)', actual '$actualHash'."
            }
            $overrideProperty = $group.upstreamOverrides.PSObject.Properties[$file]
            $upstreamPath = if ($null -ne $overrideProperty) {
                [string]$overrideProperty.Value
            }
            else {
                "$($group.upstreamBasePath)/$file"
            }
            Assert-Compliance -Condition (
                -not [string]::IsNullOrWhiteSpace($upstreamPath) -and
                $upstreamPath -notmatch '(?:^|/)\.\.(?:/|$)'
            ) -Message "Verified icon '$file' has an invalid upstream path."
        }
        Assert-Compliance -Condition (
            @($group.hashes.PSObject.Properties).Count -eq @($group.files).Count
        ) -Message "Icon group '$($group.repository)@$($group.tag)' hash map does not match its file list."
    }
    foreach ($group in @($provenance.projectOwned)) {
        Assert-Compliance -Condition (
            $approvedLicenses -contains [string]$group.license
        ) -Message "Project-owned asset group '$($group.owner)' has unapproved rights classification '$($group.license)'."
        Assert-Compliance -Condition (
            Test-Path -LiteralPath (Join-Path $iconsRoot ([string]$group.licenseFile)) -PathType Leaf
        ) -Message "Project-owned asset notice is missing: '$($group.licenseFile)'."
        foreach ($fileName in @($group.files)) {
            $file = [string]$fileName
            $projectOwned[$file] = $true
            Assert-Compliance -Condition (
                Test-Path -LiteralPath (Join-Path $iconsRoot $file) -PathType Leaf
            ) -Message "Project-owned icon/artwork file is missing: '$file'."
            Assert-Compliance -Condition (
                $readme.Contains("``$file``")
            ) -Message "Project-owned icon/artwork '$file' is not documented in Icons/README.md."
            Assert-Compliance -Condition (
                -not $quarantined.ContainsKey($file)
            ) -Message "Project-owned icon/artwork '$file' cannot be quarantined."
            $hashProperty = $group.hashes.PSObject.Properties[$file]
            Assert-Compliance -Condition (
                $null -ne $hashProperty -and [string]$hashProperty.Value -match '^[0-9a-f]{64}$'
            ) -Message "Project-owned icon/artwork '$file' has no pinned SHA-256."
            $assetPath = Join-Path $iconsRoot $file
            if ($null -ne $hashProperty -and (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
                $actualHash = Get-Sha256Hex -Path $assetPath
                Assert-Compliance -Condition (
                    [string]::Equals($actualHash, [string]$hashProperty.Value, [System.StringComparison]::OrdinalIgnoreCase)
                ) -Message "Project-owned icon/artwork '$file' hash mismatch: expected '$($hashProperty.Value)', actual '$actualHash'."
            }
        }
        Assert-Compliance -Condition (
            @($group.hashes.PSObject.Properties).Count -eq @($group.files).Count
        ) -Message "Project-owned asset group '$($group.owner)' hash map does not match its file list."
    }

    Assert-Compliance -Condition (
        [string]$installerAllowlist.license -eq 'ISC' -and
        [string]$installerAllowlist.licenseFile -eq 'LUCIDE-LICENSE.txt'
    ) -Message 'Setup/Updater icon allowlist must use the pinned Lucide ISC source.'
    Assert-Compliance -Condition (
        Test-Path -LiteralPath (Join-Path $iconsRoot ([string]$installerAllowlist.licenseFile)) -PathType Leaf
    ) -Message 'Setup/Updater icon licence file is missing.'

    $installerFiles = @{}
    foreach ($icon in @($installerAllowlist.icons)) {
        $file = [string]$icon.file
        Assert-Compliance -Condition (-not $installerFiles.ContainsKey($file)) -Message "Duplicate Setup/Updater icon '$file'."
        $installerFiles[$file] = $true
        Assert-Compliance -Condition ($verified.ContainsKey($file)) -Message "Setup/Updater icon '$file' is not verified."
        Assert-Compliance -Condition (-not $quarantined.ContainsKey($file)) -Message "Setup/Updater icon '$file' is quarantined."
        $iconPath = Join-Path $iconsRoot $file
        Assert-Compliance -Condition (Test-Path -LiteralPath $iconPath -PathType Leaf) -Message "Setup/Updater icon '$file' is missing."
        if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
            $actualHash = Get-Sha256Hex -Path $iconPath
            Assert-Compliance -Condition (
                [string]::Equals($actualHash, [string]$icon.sha256, [System.StringComparison]::OrdinalIgnoreCase)
            ) -Message "Setup/Updater icon '$file' hash mismatch: expected '$($icon.sha256)', actual '$actualHash'."
        }
        Assert-Compliance -Condition ($readme.Contains("``$file``")) -Message "Setup/Updater icon '$file' is absent from Icons/README.md."
        Assert-Compliance -Condition (
            -not [string]::IsNullOrWhiteSpace([string]$icon.upstreamPath)
        ) -Message "Setup/Updater icon '$file' has no upstream path."
        Assert-Compliance -Condition (
            @($icon.usedBy).Count -gt 0
        ) -Message "Setup/Updater icon '$file' has no actual-use mapping."
    }
    foreach ($asset in @($installerAllowlist.projectOwnedAssets)) {
        $file = [string]$asset.file
        Assert-Compliance -Condition (-not $installerFiles.ContainsKey($file)) -Message "Duplicate Setup/Updater asset '$file'."
        $installerFiles[$file] = $true
        Assert-Compliance -Condition ($projectOwned.ContainsKey($file)) -Message "Setup/Updater asset '$file' is not project-owned in provenance."
        Assert-Compliance -Condition (
            [string]$asset.license -eq 'project-owned' -and
            (Test-Path -LiteralPath (Join-Path $iconsRoot ([string]$asset.licenseFile)) -PathType Leaf)
        ) -Message "Setup/Updater project-owned asset '$file' has no rights notice."
        $assetPath = Join-Path $iconsRoot $file
        Assert-Compliance -Condition (Test-Path -LiteralPath $assetPath -PathType Leaf) -Message "Setup/Updater project-owned asset '$file' is missing."
        if (Test-Path -LiteralPath $assetPath -PathType Leaf) {
            $actualHash = Get-Sha256Hex -Path $assetPath
            Assert-Compliance -Condition (
                [string]::Equals($actualHash, [string]$asset.sha256, [System.StringComparison]::OrdinalIgnoreCase)
            ) -Message "Setup/Updater project-owned asset '$file' hash mismatch: expected '$($asset.sha256)', actual '$actualHash'."
        }
        Assert-Compliance -Condition ($readme.Contains("``$file``")) -Message "Setup/Updater project-owned asset '$file' is absent from Icons/README.md."
        Assert-Compliance -Condition (@($asset.usedBy).Count -gt 0) -Message "Setup/Updater project-owned asset '$file' has no actual-use mapping."
    }

    $sourceRoot = Join-Path $repoRoot 'frontend-tauri'
    $sourceFiles = @(
        Get-ChildItem -LiteralPath $sourceRoot -Recurse -File |
            Where-Object {
                $_.Extension -in @('.ts', '.tsx', '.css', '.html') -and
                $_.FullName -notmatch '(?i)[\\/](?:node_modules|target|dist|playwright-report|test-results)[\\/]'
            }
    )
    $iconReferencePattern = [regex]'(?i)(?<prefix>@fluxora-icons/|(?:\.\.?/)+(?:Icons|icons)/)(?<file>[A-Za-z0-9._-]+\.svg)'
    foreach ($sourceFile in $sourceFiles) {
        $text = Get-Content -LiteralPath $sourceFile.FullName -Raw -Encoding UTF8
        $productSourcePrefix = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot 'src')).TrimEnd('\') + '\'
        $isProductSource = $sourceFile.FullName.StartsWith(
            $productSourcePrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )
        $isInstallerSource = $isProductSource -and (
            $sourceFile.FullName -match '(?i)[\\/](?:installer|setup|updater)(?:[\\/._-]|$)' -or
            $sourceFile.BaseName -match '(?i)(?:installer|setup|updater)'
        )
        foreach ($match in $iconReferencePattern.Matches($text)) {
            $file = [string]$match.Groups['file'].Value
            Assert-Compliance -Condition (
                $verified.ContainsKey($file) -or $projectOwned.ContainsKey($file)
            ) -Message "Imported icon '$file' in '$($sourceFile.FullName)' lacks verified provenance."
            Assert-Compliance -Condition (
                -not $quarantined.ContainsKey($file)
            ) -Message "Imported icon '$file' in '$($sourceFile.FullName)' is quarantined."
            Assert-Compliance -Condition (
                $readme.Contains("``$file``")
            ) -Message "Imported icon '$file' in '$($sourceFile.FullName)' is absent from Icons/README.md."
            if ($isInstallerSource) {
                Assert-Compliance -Condition (
                    $installerFiles.ContainsKey($file)
                ) -Message "Setup/Updater source imports non-allowlisted icon '$file' in '$($sourceFile.FullName)'."
                Assert-Compliance -Condition (
                    [string]$match.Groups['prefix'].Value -eq '@fluxora-icons/'
                ) -Message "Setup/Updater icon '$file' must use the @fluxora-icons Vite alias in '$($sourceFile.FullName)'."
            }
        }
        if ($isInstallerSource -and $sourceFile.Extension -eq '.tsx') {
            Assert-Compliance -Condition (
                $text -notmatch '(?i)<\s*(?:svg|path)\b'
            ) -Message "Setup/Updater source '$($sourceFile.FullName)' contains inline SVG markup."
        }
    }
}

function Test-RuntimeAssets {
    param([Parameter(Mandatory = $true)][object]$Policy)
    $webViewSourcePath = Join-Path $repoRoot 'third_party\webview2\source.json'
    $webViewSource = Read-JsonFile -Path $webViewSourcePath
    $bootstrapperPath = Join-Path (Split-Path -Parent $webViewSourcePath) ([string]$webViewSource.fileName)
    Assert-Compliance -Condition (
        [string]$webViewSource.sourceUrl -eq 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
    ) -Message 'WebView2 bootstrapper must use the official pinned Microsoft fwlink.'
    Assert-Compliance -Condition (
        [string]$webViewSource.deploymentDocumentation -eq 'https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution'
    ) -Message 'WebView2 deployment documentation must be the official Microsoft source.'
    Assert-Compliance -Condition (
        Test-Path -LiteralPath $bootstrapperPath -PathType Leaf
    ) -Message "WebView2 bootstrapper is missing: '$bootstrapperPath'."
    if (Test-Path -LiteralPath $bootstrapperPath -PathType Leaf) {
        $file = Get-Item -LiteralPath $bootstrapperPath
        Assert-Compliance -Condition (
            [long]$file.Length -eq [long]$webViewSource.size
        ) -Message "WebView2 bootstrapper size mismatch: expected '$($webViewSource.size)', actual '$($file.Length)'."
        $actualHash = Get-Sha256Hex -Path $bootstrapperPath
        Assert-Compliance -Condition (
            [string]::Equals($actualHash, [string]$webViewSource.sha256, [System.StringComparison]::OrdinalIgnoreCase)
        ) -Message "WebView2 bootstrapper hash mismatch: expected '$($webViewSource.sha256)', actual '$actualHash'."
        $signature = Get-AuthenticodeSignature -LiteralPath $bootstrapperPath
        Assert-Compliance -Condition (
            [string]$signature.Status -eq 'Valid'
        ) -Message "WebView2 bootstrapper Authenticode status is '$($signature.Status)', expected Valid."
        Assert-Compliance -Condition (
            $null -ne $signature.SignerCertificate -and
            [string]$signature.SignerCertificate.Subject -eq [string]$webViewSource.authenticodeSignerSubject
        ) -Message 'WebView2 bootstrapper Authenticode signer subject mismatch.'
        Assert-Compliance -Condition (
            $null -ne $signature.SignerCertificate -and
            [string]::Equals(
                [string]$signature.SignerCertificate.Thumbprint,
                [string]$webViewSource.authenticodeSignerThumbprint,
                [System.StringComparison]::OrdinalIgnoreCase
            )
        ) -Message 'WebView2 bootstrapper Authenticode signer thumbprint mismatch.'
    }

    $speechManifest = Read-JsonFile -Path (Join-Path $repoRoot 'frontend-tauri\speech\manifest.v1.json')
    Assert-Compliance -Condition (
        [string]$speechManifest.schema -eq 'fluxora.speech.models.v1'
    ) -Message 'Speech manifest schema mismatch.'
    foreach ($entryName in @('model', 'vad')) {
        $entry = $speechManifest.PSObject.Properties[$entryName].Value
        Assert-Compliance -Condition (
            [string]$entry.revision -match '^[0-9a-f]{40}$'
        ) -Message "Speech '$entryName' revision must be a pinned 40-character commit."
        Assert-Compliance -Condition (
            [string]$entry.sha256 -match '^[0-9a-f]{64}$'
        ) -Message "Speech '$entryName' SHA-256 is invalid."
        Assert-Compliance -Condition (
            ([string]$entry.sourceUrl).Contains([string]$entry.revision)
        ) -Message "Speech '$entryName' source URL does not contain its pinned revision."
    }
    foreach ($licensePath in @(
        'frontend-tauri/speech/licenses/whisper.cpp-MIT.txt',
        'frontend-tauri/speech/licenses/whisper-model-weights-MIT.txt',
        'frontend-tauri/speech/licenses/silero-vad-MIT.txt',
        'frontend-tauri/speech/licenses/whisper-rs-UNLICENSE.txt'
    )) {
        Assert-Compliance -Condition (
            Test-Path -LiteralPath (Join-Path $repoRoot ($licensePath -replace '/', '\')) -PathType Leaf
        ) -Message "Speech licence file is missing: '$licensePath'."
    }
    foreach ($fontPath in @(
        'frontend-tauri/src/renderer/assets/fonts/geist/LICENSE.txt',
        'frontend-tauri/src/renderer/assets/fonts/ibm-plex/LICENSE.txt'
    )) {
        $absolutePath = Join-Path $repoRoot ($fontPath -replace '/', '\')
        Assert-Compliance -Condition (
            Test-Path -LiteralPath $absolutePath -PathType Leaf
        ) -Message "Font licence file is missing: '$fontPath'."
        if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
            $licenseText = Get-Content -LiteralPath $absolutePath -Raw -Encoding UTF8
            Assert-Compliance -Condition (
                $licenseText -match 'SIL OPEN FONT LICENSE Version 1\.1'
            ) -Message "Font licence '$fontPath' is not OFL-1.1."
        }
    }

    if ($Release) {
        $evidenceRequestedPath = if (-not [string]::IsNullOrWhiteSpace($CMakeEvidencePath)) {
            $CMakeEvidencePath
        }
        else {
            [string]$Policy.releaseEvidence.cmakeResolvedDependencies
        }
        $evidencePath = if ([System.IO.Path]::IsPathRooted($evidenceRequestedPath)) {
            [System.IO.Path]::GetFullPath($evidenceRequestedPath)
        }
        else {
            [System.IO.Path]::GetFullPath((Join-Path $repoRoot ($evidenceRequestedPath -replace '/', '\')))
        }
        $repoPrefix = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
        Assert-Compliance -Condition (
            $evidencePath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)
        ) -Message "CMake release evidence must remain inside the repository workspace: '$evidenceRequestedPath'."
        Assert-Compliance -Condition (
            Test-Path -LiteralPath $evidencePath -PathType Leaf
        ) -Message "Production release requires exact CMake resolution evidence at '$evidenceRequestedPath'."
        if (Test-Path -LiteralPath $evidencePath -PathType Leaf) {
            $evidence = Read-JsonFile -Path $evidencePath
            Assert-Compliance -Condition (
                [int]$evidence.schemaVersion -eq 1
            ) -Message 'CMake resolution evidence must use schemaVersion 1.'
            Assert-Compliance -Condition (
                -not [bool]$evidence.allowSystemDependencies
            ) -Message 'CMake resolution evidence must set allowSystemDependencies to false.'
            $evidenceByName = @{}
            foreach ($dependency in @($evidence.dependencies)) {
                $name = [string]$dependency.name
                Assert-Compliance -Condition (
                    -not $evidenceByName.ContainsKey($name)
                ) -Message "CMake release evidence contains duplicate dependency '$name'."
                $evidenceByName[$name] = $dependency
            }
            Assert-Compliance -Condition (
                @($evidence.dependencies).Count -eq @($Policy.cmakeDependencies).Count
            ) -Message 'CMake release evidence must contain exactly the policy dependency set.'
            foreach ($required in @($Policy.cmakeDependencies | Where-Object resolvedReleaseEvidenceRequired)) {
                $name = [string]$required.name
                Assert-Compliance -Condition ($evidenceByName.ContainsKey($name)) -Message "CMake release evidence is missing '$name'."
                if ($evidenceByName.ContainsKey($name)) {
                    $actual = $evidenceByName[$name]
                    Assert-Compliance -Condition (
                        [string]$actual.version -eq [string]$required.fallbackVersion -and
                        -not [string]::IsNullOrWhiteSpace([string]$actual.source) -and
                        [string]$actual.source -notmatch '(?i)\b(?:system|installed)\b' -and
                        [string]$actual.scope -eq [string]$required.scope
                    ) -Message "CMake release evidence for '$name' must identify pinned version '$($required.fallbackVersion)', non-system source, and scope '$($required.scope)'."
                }
            }
        }
    }
}

function Compare-Inventory {
    param(
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][object]$Actual
    )
    $expectedJson = $Expected | ConvertTo-Json -Depth 100 -Compress
    $actualJson = $Actual | ConvertTo-Json -Depth 100 -Compress
    Assert-Compliance -Condition (
        [string]::Equals($expectedJson, $actualJson, [System.StringComparison]::Ordinal)
    ) -Message "Dependency inventory is stale. Review dependency/licence changes, then run '.\scripts\release\Test-DesktopLegalAndAssetCompliance.ps1 -UpdateInventory'."
}

try {
    $policy = Read-JsonFile -Path $policyPath
    Assert-Compliance -Condition ([int]$policy.schemaVersion -eq 1) -Message 'Licence policy schemaVersion must be 1.'
    Assert-Compliance -Condition (
        [bool]$policy.unknownOrMissingLicenseBlocksRelease
    ) -Message 'Licence policy must fail closed for unknown or missing licences.'

    Test-LegalManifest
    Test-IconCompliance -Policy $policy
    Test-RuntimeAssets -Policy $policy
    $currentInventory = New-CurrentInventory -Policy $policy

    if ($UpdateInventory) {
        if ($failures.Count -gt 0) {
            throw "Refusing to update dependency inventory while $($failures.Count) compliance failure(s) exist."
        }
        $json = $currentInventory | ConvertTo-Json -Depth 100
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($inventoryPath, $json + "`n", $encoding)
        if (-not $MachineReadable) {
            Write-Host "Updated deterministic dependency inventory: $inventoryPath"
        }
    }
    else {
        Assert-Compliance -Condition (
            Test-Path -LiteralPath $inventoryPath -PathType Leaf
        ) -Message 'Deterministic dependency inventory is missing. Run with -UpdateInventory after reviewing licences.'
        if (Test-Path -LiteralPath $inventoryPath -PathType Leaf) {
            $storedInventory = Read-JsonFile -Path $inventoryPath
            Compare-Inventory -Expected $storedInventory -Actual $currentInventory
        }
    }
}
catch {
    $location = if ($null -ne $_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber -gt 0) {
        " (line $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim()))"
    }
    else {
        ''
    }
    Add-Failure -Message "$($_.Exception.Message)$location"
}

if ($failures.Count -gt 0) {
    if ($MachineReadable) {
        [pscustomobject][ordered]@{
            schema = 'fluxora.desktop-compliance.result.v1'
            status = 'failed'
            checks = $checks
            failureCount = $failures.Count
            failures = @($failures.ToArray())
            releaseMode = [bool]$Release
            inventoryUpdated = [bool]$UpdateInventory
        } | ConvertTo-Json -Depth 10 -Compress
        exit 1
    }
    Write-Host "Desktop legal/asset compliance FAILED ($($failures.Count) failure(s), $checks checks)." -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

if ($MachineReadable) {
    [pscustomobject][ordered]@{
        schema = 'fluxora.desktop-compliance.result.v1'
        status = 'passed'
        checks = $checks
        failureCount = 0
        failures = @()
        releaseMode = [bool]$Release
        inventoryUpdated = [bool]$UpdateInventory
        inventoryPath = 'legal/desktop/dependency-inventory.json'
    } | ConvertTo-Json -Depth 10 -Compress
    exit 0
}

Write-Host "Desktop legal/asset compliance PASSED ($checks checks)." -ForegroundColor Green
