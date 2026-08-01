[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string] $Configuration = 'Release',

    [ValidateSet('win-x64')]
    [string] $Runtime = 'win-x64',

    [ValidateSet('Release')]
    [string] $Target = 'Release',

    [string] $Version,

    [switch] $IncludeSymbols,

    [switch] $PublishCurrentChanges,

    [AllowNull()]
    [byte[]] $SigningKeyPkcs8Bytes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$signingSecretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64'
[byte[]]$capturedSigningKeyBytes = $null
$capturedSigningKeyBase64 = [Environment]::GetEnvironmentVariable($signingSecretName, 'Process')
[Environment]::SetEnvironmentVariable($signingSecretName, $null, 'Process')
try {
    if ($null -ne $SigningKeyPkcs8Bytes -and -not [string]::IsNullOrWhiteSpace($capturedSigningKeyBase64)) {
        throw 'Provide the production signing key through Build.ps1 or the process environment, not both.'
    }
    if ($null -ne $SigningKeyPkcs8Bytes) {
        $capturedSigningKeyBytes = [byte[]]$SigningKeyPkcs8Bytes.Clone()
        $SigningKeyPkcs8Bytes = $null
    }
    elseif (-not [string]::IsNullOrWhiteSpace($capturedSigningKeyBase64)) {
        try {
            $capturedSigningKeyBytes = [Convert]::FromBase64String($capturedSigningKeyBase64.Trim())
        }
        catch {
            throw "$signingSecretName is not valid base64."
        }
    }
}
finally {
    $capturedSigningKeyBase64 = $null
}
trap {
    if ($null -ne $capturedSigningKeyBytes) {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($capturedSigningKeyBytes)
    }
    throw $_
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modulePath = Join-Path $PSScriptRoot 'Fluxora.Release.psm1'
$artifactScript = Join-Path $PSScriptRoot 'New-FluxoraUpdateArtifacts.ps1'
$repository = 'Moddingflow/Fluxora'
$publicKeyPath = Join-Path $projectRoot 'frontend-tauri\src-tauri\resources\update\stable-public-key.der'
$protectedKeyPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Fluxora\release-signing\update-manifest-p256-private.dpapi'
$outputDirectory = Join-Path $projectRoot 'output'
$installerPath = Join-Path $projectRoot 'output-installer\FluxoraSetup.exe'
$updateOutputRoot = Join-Path $projectRoot 'output-update'

Import-Module $modulePath -Force

function Invoke-ReleaseCommand {
    param(
        [Parameter(Mandatory = $true)] [string] $FilePath,
        [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [string[]] $Arguments,
        [string] $WorkingDirectory = $projectRoot
    )

    Assert-FluxoraReleaseChildEnvironment -SecretName $signingSecretName -ChildFilePath $FilePath

    Push-Location $WorkingDirectory
    try {
        $output = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        $detail = @($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')$([Environment]::NewLine)$detail"
    }
    return @($output | ForEach-Object { $_.ToString() })
}

function Test-ReleaseCommand {
    param(
        [Parameter(Mandatory = $true)] [string] $FilePath,
        [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [string[]] $Arguments
    )

    Assert-FluxoraReleaseChildEnvironment -SecretName $signingSecretName -ChildFilePath $FilePath
    Push-Location $projectRoot
    try {
        & $FilePath @Arguments *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        Pop-Location
    }
}

function Invoke-ReleaseStep {
    param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [scriptblock] $Action
    )

    Write-Host ''
    Write-Host "== $Name =="
    & $Action
}

function Get-ProductVersion {
    return Get-FluxoraProductVersion -ProjectRoot $projectRoot
}

function Get-VersionPaths {
    $paths = @(
        'frontend-tauri\src-tauri\tauri.conf.json',
        'frontend-tauri\package.json',
        'frontend-tauri\src-tauri\Cargo.toml',
        'frontend-tauri\src-tauri\Cargo.lock'
    )
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend-tauri\package-lock.json') -PathType Leaf) {
        $paths += 'frontend-tauri\package-lock.json'
    }
    return $paths
}

function Get-GitHubRepositorySpecifier {
    param([Parameter(Mandatory = $true)] [string] $RemoteUrl)

    $match = [regex]::Match($RemoteUrl, '^(?:https://github\.com/|ssh://git@github\.com/|git@github\.com:)(?<repository>[^/\s]+/[^/\s]+?)(?:\.git)?$')
    if (-not $match.Success) {
        throw "Production origin must use an explicit github.com repository URL, got '$RemoteUrl'."
    }
    return $match.Groups['repository'].Value
}

$currentVersion = Get-ProductVersion
$versionResolution = Resolve-FluxoraProductionVersion `
    -CurrentVersion $currentVersion `
    -Version $Version
if ($versionResolution.Cancelled) {
    Write-Host "Production publication cancelled. Fluxora remains at $currentVersion."
    return
}
$targetVersion = [string]$versionResolution.Version
$tag = "v$targetVersion"

foreach ($command in @('git', 'gh', 'cmake', 'ctest', 'cargo', 'pwsh')) {
    if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Production release requires '$command' on PATH."
    }
}
if (-not (Test-Path -LiteralPath $publicKeyPath -PathType Leaf)) {
    throw "Embedded update public key is missing: '$publicKeyPath'."
}
if (-not (Test-Path -LiteralPath $artifactScript -PathType Leaf)) {
    throw "Update artifact builder is missing: '$artifactScript'."
}

Invoke-ReleaseStep 'Authenticating GitHub release transport' {
    [void](Invoke-ReleaseCommand -FilePath 'gh' -Arguments @('auth', 'status', '--hostname', 'github.com'))
    $repositoryInfo = (Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
        'repo', 'view', $repository, '--json', 'nameWithOwner,visibility,defaultBranchRef')) -join "`n" | ConvertFrom-Json
    if ([string]$repositoryInfo.nameWithOwner -cne $repository -or [string]$repositoryInfo.visibility -cne 'PUBLIC') {
        throw "Production updater releases are pinned to the public '$repository' repository."
    }
    $script:defaultBranch = [string]$repositoryInfo.defaultBranchRef.name
    if ([string]::IsNullOrWhiteSpace($script:defaultBranch)) {
        throw 'GitHub did not return the repository default branch.'
    }

    $fetchUrls = @(Invoke-ReleaseCommand -FilePath 'git' -Arguments @('remote', 'get-url', '--all', 'origin'))
    $pushUrls = @(Invoke-ReleaseCommand -FilePath 'git' -Arguments @('remote', 'get-url', '--push', '--all', 'origin'))
    if ($fetchUrls.Count -ne 1 -or $pushUrls.Count -ne 1) {
        throw 'Production origin must have exactly one fetch URL and one push URL.'
    }
    $fetchSpecifier = Get-GitHubRepositorySpecifier -RemoteUrl $fetchUrls[0]
    $pushSpecifier = Get-GitHubRepositorySpecifier -RemoteUrl $pushUrls[0]
    $fetchInfo = (Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
        'repo', 'view', $fetchSpecifier, '--json', 'nameWithOwner,visibility,defaultBranchRef')) -join "`n" | ConvertFrom-Json
    $pushInfo = (Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
        'repo', 'view', $pushSpecifier, '--json', 'nameWithOwner,visibility,defaultBranchRef')) -join "`n" | ConvertFrom-Json
    Assert-FluxoraCanonicalRepositoryIdentity `
        -ExpectedRepository $repository `
        -FetchRepository ([string]$fetchInfo.nameWithOwner) `
        -PushRepository ([string]$pushInfo.nameWithOwner) `
        -Visibility ([string]$repositoryInfo.visibility)
    if ([string]$fetchInfo.visibility -cne 'PUBLIC' -or [string]$pushInfo.visibility -cne 'PUBLIC' -or
        [string]$fetchInfo.defaultBranchRef.name -cne $script:defaultBranch -or
        [string]$pushInfo.defaultBranchRef.name -cne $script:defaultBranch) {
        throw 'Production origin transport metadata does not match the canonical public repository.'
    }
    $script:canonicalFetchUrl = [string]$fetchUrls[0]
    $script:canonicalPushUrl = [string]$pushUrls[0]
}

Invoke-ReleaseStep 'Refreshing release refs' {
    [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @(
        'fetch', '--prune', '--tags', $script:canonicalFetchUrl,
        "refs/heads/$($script:defaultBranch):refs/remotes/origin/$($script:defaultBranch)"))
}

$branch = (Invoke-ReleaseCommand -FilePath 'git' -Arguments @('branch', '--show-current')) -join ''
$statusLines = @(
    Invoke-ReleaseCommand -FilePath 'git' -Arguments @('status', '--porcelain=v1', '--untracked-files=all') |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$counts = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @(
    'rev-list', '--left-right', '--count', "origin/$($script:defaultBranch)...HEAD")) -join '').Trim() -split '\s+'
if ($counts.Count -ne 2) {
    throw 'Could not determine local/upstream release branch divergence.'
}
$existingTag = Test-ReleaseCommand -FilePath 'git' -Arguments @('show-ref', '--verify', '--quiet', "refs/tags/$tag")
$existingRelease = Test-ReleaseCommand -FilePath 'gh' -Arguments @('release', 'view', $tag, '--repo', $repository)
# Validate remote lineage before any local checkpoint mutation. The working tree
# is intentionally validated after the separate, explicitly confirmed commit.
Assert-FluxoraReleasePreconditions `
    -Branch $branch `
    -DefaultBranch $script:defaultBranch `
    -StatusLines @() `
    -Behind ([int]$counts[0]) `
    -Ahead ([int]$counts[1]) `
    -ExistingTag $existingTag `
    -ExistingRelease $existingRelease

$checkpointCommitCreated = $false
$repositoryChangeCount = $statusLines.Count
$unpublishedCommitCount = [int]$counts[1]
if ($repositoryChangeCount -gt 0 -or $unpublishedCommitCount -gt 0) {
    Write-Host ''
    Write-Host 'Repository changes selected for the production publication:'
    Write-Host "  Working-tree entries: $repositoryChangeCount"
    Write-Host "  Existing unpublished commits: $unpublishedCommitCount"
    $checkpointPreview = @()
    if ($repositoryChangeCount -gt 0) {
        $checkpointPreview = @(Invoke-ReleaseCommand -FilePath 'git' -Arguments @('add', '--all', '--dry-run'))
        foreach ($line in $checkpointPreview) {
            Write-Host "  $line"
        }
    }

    if (-not $PublishCurrentChanges) {
        $confirmation = Read-Host "Type PUBLISH to create a separate checkpoint commit and include all listed commits in $tag"
        if ($confirmation.Trim() -cne 'PUBLISH') {
            Write-Host 'Production publication cancelled before changing Git state.'
            return
        }
    }
}

if ($repositoryChangeCount -gt 0) {
    Invoke-ReleaseStep "Creating controlled repository checkpoint for $tag" {
        $gitIndexPath = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @('rev-parse', '--git-path', 'index')) -join '').Trim()
        if (-not [IO.Path]::IsPathRooted($gitIndexPath)) {
            $gitIndexPath = Join-Path $projectRoot $gitIndexPath
        }
        if (-not (Test-Path -LiteralPath $gitIndexPath -PathType Leaf)) {
            throw "Git index was not found at '$gitIndexPath'."
        }
        $indexBackupPath = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-release-index-' + [Guid]::NewGuid().ToString('N'))
        Copy-Item -LiteralPath $gitIndexPath -Destination $indexBackupPath
        $checkpointCommitted = $false
        try {
            [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @('add', '--all'))
            [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @('diff', '--cached', '--check'))
            $stagedPaths = @(
                Invoke-ReleaseCommand -FilePath 'git' -Arguments @('-c', 'core.quotePath=false', 'diff', '--cached', '--name-only') |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            )
            if ($stagedPaths.Count -eq 0) {
                throw 'The production checkpoint did not contain any staged paths.'
            }
            Assert-FluxoraReleaseStagedPaths -Paths $stagedPaths
            [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @(
                'commit', '--no-verify', '-m', "release: checkpoint current changes for $tag"))
            $checkpointCommitted = $true
            $script:checkpointCommitCreated = $true
        }
        catch {
            if ($checkpointCommitted) {
                Write-Warning 'The controlled repository checkpoint was committed and was not rewritten automatically.'
            }
            throw
        }
        finally {
            if (-not $checkpointCommitted -and (Test-Path -LiteralPath $indexBackupPath -PathType Leaf)) {
                Copy-Item -LiteralPath $indexBackupPath -Destination $gitIndexPath -Force
            }
            Remove-Item -LiteralPath $indexBackupPath -Force -ErrorAction SilentlyContinue
        }
    }
    $statusLines = @(
        Invoke-ReleaseCommand -FilePath 'git' -Arguments @('status', '--porcelain=v1', '--untracked-files=all') |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

Assert-FluxoraReleasePreconditions `
    -Branch $branch `
    -DefaultBranch $script:defaultBranch `
    -StatusLines $statusLines `
    -Behind ([int]$counts[0]) `
    -Ahead ([int]$counts[1]) `
    -ExistingTag $false `
    -ExistingRelease $false
$preReleaseHead = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @('rev-parse', 'HEAD')) -join '').Trim()

$transactionRoot = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-production-release-' + [Guid]::NewGuid().ToString('N'))
$previousReleaseRoot = Join-Path $transactionRoot 'previous-release'
$verificationRoot = Join-Path $transactionRoot 'remote-verification'
New-Item -ItemType Directory -Path $previousReleaseRoot -Force | Out-Null
$versionPaths = @(Get-VersionPaths)
$versionSnapshots = @{}
foreach ($relativePath in $versionPaths) {
    $versionSnapshots[$relativePath] = [IO.File]::ReadAllBytes((Join-Path $projectRoot $relativePath))
}
$commitCreated = $false
$remotePushed = $false
$draftCreated = $false

try {
    $previousManifestPath = $null
    $previousSignaturePath = $null
    Invoke-ReleaseStep 'Resolving previous stable update ancestry' {
        $releaseRows = (Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
            'release', 'list', '--repo', $repository, '--limit', '20',
            '--json', 'tagName,isDraft,isPrerelease,publishedAt')) -join "`n" | ConvertFrom-Json
        $previousRelease = @($releaseRows | Where-Object {
            -not [bool]$_.isDraft -and -not [bool]$_.isPrerelease -and -not [string]::IsNullOrWhiteSpace([string]$_.publishedAt)
        } | Select-Object -First 1)
        if ($previousRelease.Count -eq 0) {
            Write-Host 'No prior stable GitHub release exists; this release will contain the mandatory full package only.'
            return
        }

        [void](Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
            'release', 'download', [string]$previousRelease[0].tagName,
            '--repo', $repository,
            '--dir', $previousReleaseRoot,
            '--pattern', 'fluxora-update-manifest.json',
            '--pattern', 'fluxora-update-manifest.sig'))
        $script:previousManifestPath = Join-Path $previousReleaseRoot 'fluxora-update-manifest.json'
        $script:previousSignaturePath = Join-Path $previousReleaseRoot 'fluxora-update-manifest.sig'
        $previousManifest = Read-FluxoraSignedUpdateManifest `
            -ManifestPath $script:previousManifestPath `
            -SignaturePath $script:previousSignaturePath `
            -PublicKeyPath $publicKeyPath
        Assert-FluxoraPreviousReleaseLineage `
            -TagName ([string]$previousRelease[0].tagName) `
            -ManifestVersion ([string]$previousManifest.version)
    }

    Invoke-ReleaseStep "Applying product version $targetVersion" {
        Set-FluxoraProductVersion -ProjectRoot $projectRoot -Version $targetVersion
        $script:expectedVersionSnapshots = @(Get-FluxoraFileSnapshots -ProjectRoot $projectRoot -RelativePaths $versionPaths)
    }

    Invoke-ReleaseStep 'Building the complete local release' {
        $buildArguments = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $projectRoot 'Build.ps1'),
            '-Mode', 'Local',
            '-Configuration', $Configuration,
            '-Runtime', $Runtime,
            '-Target', $Target)
        if ($IncludeSymbols) {
            $buildArguments += '-IncludeSymbols'
        }
        [void](Invoke-ReleaseCommand -FilePath 'pwsh' -Arguments $buildArguments)
    }

    Invoke-ReleaseStep 'Running strict release contract tests against built native artifacts' {
        [void](Invoke-ReleaseCommand -FilePath 'pwsh' -Arguments @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $projectRoot 'scripts\tests\Fluxora.Release.Tests.ps1'),
            '-RequireNativeAbi'))
    }

    Invoke-ReleaseStep 'Running complete backend CTest suite' {
        [void](Invoke-ReleaseCommand -FilePath 'ctest' -Arguments @(
            '--test-dir', (Join-Path $projectRoot 'build\backend'),
            '-C', $Configuration,
            '--output-on-failure',
            '--no-tests=error'))
    }

    Invoke-ReleaseStep 'Running native Tauri Setup and updater boundary suites' {
        $installerCoreLibrary = @(
            Get-ChildItem -LiteralPath (Join-Path $projectRoot 'build\backend') `
                -Recurse `
                -Filter 'FluxoraInstallerCore.lib' `
                -File `
                -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -First 1
        )
        if ($installerCoreLibrary.Count -ne 1) {
            throw 'The production boundary suite requires the built static FluxoraInstallerCore.lib.'
        }
        $previousInstallerCoreLibraryDirectory = [Environment]::GetEnvironmentVariable(
            'FLUXORA_INSTALLER_CORE_LIB_DIR',
            'Process')
        try {
            $env:FLUXORA_INSTALLER_CORE_LIB_DIR = $installerCoreLibrary[0].DirectoryName
            [void](Invoke-ReleaseCommand -FilePath 'cargo' -Arguments @(
                'test', '--release', '--locked',
                '--features', 'installer-native,custom-protocol',
                '--bin', 'FluxoraUpdater',
                '--bin', 'FluxoraSetup') -WorkingDirectory (Join-Path $projectRoot 'frontend-tauri\src-tauri'))
        }
        finally {
            if ($null -eq $previousInstallerCoreLibraryDirectory) {
                Remove-Item Env:FLUXORA_INSTALLER_CORE_LIB_DIR -ErrorAction SilentlyContinue
            }
            else {
                $env:FLUXORA_INSTALLER_CORE_LIB_DIR = $previousInstallerCoreLibraryDirectory
            }
        }
    }

    Invoke-ReleaseStep 'Running Tauri unit and component suites' {
        [void](Invoke-ReleaseCommand -FilePath 'npm' -Arguments @('run', 'typecheck') -WorkingDirectory (Join-Path $projectRoot 'frontend-tauri'))
        [void](Invoke-ReleaseCommand -FilePath 'npm' -Arguments @('test') -WorkingDirectory (Join-Path $projectRoot 'frontend-tauri'))
    }

    Invoke-ReleaseStep 'Running Tauri Playwright smoke suite' {
        [void](Invoke-ReleaseCommand -FilePath 'npm' -Arguments @('run', 'test:e2e') -WorkingDirectory (Join-Path $projectRoot 'frontend-tauri'))
    }

    Invoke-ReleaseStep 'Running Tauri Rust suite' {
        [void](Invoke-ReleaseCommand -FilePath 'cargo' -Arguments @('test', '--release', '--locked') -WorkingDirectory (Join-Path $projectRoot 'frontend-tauri\src-tauri'))
    }

    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Approved installer artifact is missing: '$installerPath'."
    }
    $packagedUpdaterPath = Join-Path $outputDirectory 'resources\native\FluxoraUpdater.exe'
    if (-not (Test-Path -LiteralPath $packagedUpdaterPath -PathType Leaf)) {
        throw "Release payload is missing the self-contained updater runtime '$packagedUpdaterPath'."
    }
    $unexpectedInstallerRuntime = Get-ChildItem `
        -LiteralPath (Join-Path $outputDirectory 'resources\native') `
        -File `
        -Filter 'FluxoraInstallerCore.*' `
        -ErrorAction SilentlyContinue
    if ($unexpectedInstallerRuntime.Count -ne 0) {
        throw 'Release payload contains a loose installer-core runtime even though Setup and Updater must link it statically.'
    }

    $artifactDirectory = Join-Path $updateOutputRoot $tag
    $artifactArguments = @{
        PayloadDirectory = $outputDirectory
        ArtifactDirectory = $artifactDirectory
        Version = $targetVersion
        PublicKeyPath = $publicKeyPath
    }
    if (-not [string]::IsNullOrWhiteSpace($previousManifestPath)) {
        $artifactArguments['PreviousManifestPath'] = $previousManifestPath
        $artifactArguments['PreviousSignaturePath'] = $previousSignaturePath
    }
    $script:releaseSigningKey = $null
    try {
        Invoke-ReleaseStep 'Opening isolated signing identity after all repository gates' {
            $script:releaseSigningKey = Open-FluxoraUpdateSigningKey `
                -ProtectedKeyPath $protectedKeyPath `
                -PrivateKeyPkcs8Bytes $capturedSigningKeyBytes
            $publicKey = [IO.File]::ReadAllBytes($publicKeyPath)
            $probe = [Text.Encoding]::UTF8.GetBytes("Fluxora production signing phase $tag")
            $probeSignature = New-FluxoraDetachedSignature `
                -ManifestBytes $probe `
                -SigningKey $script:releaseSigningKey `
                -KeyId 'stable-2026'
            if (-not (Test-FluxoraDetachedSignature -ManifestBytes $probe -Signature $probeSignature -PublicKeyDer $publicKey)) {
                throw 'Production signing key does not match the public key embedded in Fluxora.'
            }
        }
        $artifactArguments['SigningKey'] = $script:releaseSigningKey
        Invoke-ReleaseStep 'Creating and verifying signed full/delta update assets' {
            $script:artifactResult = & $artifactScript @artifactArguments
            $script:localUpdateManifest = Read-FluxoraSignedUpdateManifest `
                -ManifestPath $script:artifactResult.manifestPath `
                -SignaturePath $script:artifactResult.signaturePath `
                -PublicKeyPath $publicKeyPath
        }

        Invoke-ReleaseStep 'Creating signed release inventory' {
            Copy-Item -LiteralPath $installerPath -Destination (Join-Path $artifactDirectory 'FluxoraSetup.exe')

            $inventoryAssets = @(
                Get-ChildItem -LiteralPath $artifactDirectory -File |
                    ForEach-Object {
                        [pscustomobject]@{
                            name = $_.Name
                            size = [uint64]$_.Length
                            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
                        }
                    }
            )
            $inventoryBytes = ConvertTo-FluxoraReleaseInventoryBytes `
                -Version $targetVersion `
                -Assets $inventoryAssets
            $inventoryPath = Join-Path $artifactDirectory 'fluxora-release-inventory.json'
            $inventorySignaturePath = Join-Path $artifactDirectory 'fluxora-release-inventory.sig'
            $inventorySignature = New-FluxoraDetachedSignature `
                -ManifestBytes $inventoryBytes `
                -SigningKey $script:releaseSigningKey `
                -KeyId 'stable-2026'
            [IO.File]::WriteAllBytes($inventoryPath, $inventoryBytes)
            [IO.File]::WriteAllText($inventorySignaturePath, $inventorySignature + "`n", [Text.Encoding]::ASCII)
            $script:localReleaseInventory = Read-FluxoraSignedReleaseInventory `
                -InventoryPath $inventoryPath `
                -SignaturePath $inventorySignaturePath `
                -PublicKeyPath $publicKeyPath
        }
    }
    finally {
        if ($null -ne $script:releaseSigningKey) {
            $script:releaseSigningKey.Dispose()
            $script:releaseSigningKey = $null
        }
        if ($null -ne $capturedSigningKeyBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($capturedSigningKeyBytes)
            $capturedSigningKeyBytes = $null
        }
    }

    Assert-FluxoraFileSnapshots -ProjectRoot $projectRoot -Snapshots $expectedVersionSnapshots

    $changedPaths = @(
        Invoke-ReleaseCommand -FilePath 'git' -Arguments @('status', '--porcelain=v1', '--untracked-files=all') |
            ForEach-Object { if ($_.Length -ge 4) { $_.Substring(3).Replace('/', '\') } }
    )
    $unexpectedChanges = @($changedPaths | Where-Object { $_ -notin $versionPaths })
    $missingChanges = @($versionPaths | Where-Object { $_ -notin $changedPaths })
    if ($unexpectedChanges.Count -ne 0 -or $missingChanges.Count -ne 0) {
        throw "Release gates changed files outside the version transaction: $($unexpectedChanges -join ', ')."
    }
    Assert-FluxoraFileSnapshots -ProjectRoot $projectRoot -Snapshots $expectedVersionSnapshots

    Invoke-ReleaseStep "Committing and tagging $tag" {
        [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments (@('add', '--') + $versionPaths))
        [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @('diff', '--cached', '--check'))
        $stagedPaths = @(
            Invoke-ReleaseCommand -FilePath 'git' -Arguments @('diff', '--cached', '--name-only') |
                ForEach-Object { $_.Replace('/', '\') }
        )
        $unexpectedStaged = @($stagedPaths | Where-Object { $_ -notin $versionPaths })
        $missingStaged = @($versionPaths | Where-Object { $_ -notin $stagedPaths })
        if ($unexpectedStaged.Count -ne 0 -or $missingStaged.Count -ne 0) {
            throw "Release commit staging is outside the version allowlist: $($unexpectedStaged -join ', ')."
        }
        Assert-FluxoraFileSnapshots -ProjectRoot $projectRoot -Snapshots $expectedVersionSnapshots
        $expectedIndexObjectIds = @{}
        foreach ($relativePath in $versionPaths) {
            $gitPath = $relativePath.Replace('\', '/')
            $expectedBlobObjectId = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @(
                'hash-object', "--path=$gitPath", (Join-Path $projectRoot $relativePath))) -join '').Trim()
            $indexObjectId = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @('rev-parse', ":$gitPath")) -join '').Trim()
            if ($indexObjectId -cne $expectedBlobObjectId) {
                throw "Git index content does not match the sealed version file '$relativePath'."
            }
            $expectedIndexObjectIds[$relativePath] = $indexObjectId
        }

        [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @('commit', '--no-verify', '-m', "release: $tag"))
        $script:commitCreated = $true
        $commitParent = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @('rev-parse', 'HEAD^')) -join '').Trim()
        if ($commitParent -cne $preReleaseHead) {
            throw 'Release commit parent changed during the version transaction.'
        }
        $commitPaths = @(
            Invoke-ReleaseCommand -FilePath 'git' -Arguments @('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD') |
                ForEach-Object { $_.Replace('/', '\') }
        )
        $unexpectedCommitPaths = @($commitPaths | Where-Object { $_ -notin $versionPaths })
        $missingCommitPaths = @($versionPaths | Where-Object { $_ -notin $commitPaths })
        if ($unexpectedCommitPaths.Count -ne 0 -or $missingCommitPaths.Count -ne 0) {
            throw 'Release commit tree does not exactly match the version-file allowlist.'
        }
        foreach ($relativePath in $versionPaths) {
            $gitPath = $relativePath.Replace('\', '/')
            $treeObjectId = ((Invoke-ReleaseCommand -FilePath 'git' -Arguments @('rev-parse', "HEAD:$gitPath")) -join '').Trim()
            if ($treeObjectId -cne [string]$expectedIndexObjectIds[$relativePath]) {
                throw "Release commit changed staged content for '$relativePath'."
            }
        }
        Assert-FluxoraFileSnapshots -ProjectRoot $projectRoot -Snapshots $expectedVersionSnapshots
        $postCommitStatus = @(
            Invoke-ReleaseCommand -FilePath 'git' -Arguments @('status', '--porcelain=v1', '--untracked-files=all') |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        if ($postCommitStatus.Count -ne 0) {
            throw 'Release commit hooks or concurrent processes changed the worktree after commit.'
        }
        [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @('tag', '-a', $tag, '-m', "Fluxora $targetVersion"))
    }

    Invoke-ReleaseStep 'Atomically pushing release commit and tag' {
        [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments @(
            'push', '--atomic', $script:canonicalPushUrl, $script:defaultBranch, "refs/tags/$tag"))
        $script:remotePushed = $true
    }

    $releaseNotesPath = Join-Path $transactionRoot 'release-notes.md'
    [IO.File]::WriteAllText(
        $releaseNotesPath,
        "Fluxora $targetVersion`n`nInstall Fluxora with FluxoraSetup.exe. The other attached files are machine-consumed update data for Fluxora; they are not portable or independently runnable downloads.`n",
        [Text.UTF8Encoding]::new($false))
    $uploadPaths = @(
        Get-ChildItem -LiteralPath $artifactDirectory -File |
            Sort-Object -Property Name |
            ForEach-Object { $_.FullName }
    )
    Invoke-ReleaseStep 'Creating draft GitHub release' {
        [void](Invoke-ReleaseCommand -FilePath 'gh' -Arguments (@(
            'release', 'create', $tag,
            '--repo', $repository,
            '--verify-tag',
            '--draft',
            '--title', "Fluxora $targetVersion",
            '--notes-file', $releaseNotesPath) + $uploadPaths))
        $script:draftCreated = $true
    }

    Invoke-ReleaseStep 'Downloading and hash-verifying draft release assets' {
        New-Item -ItemType Directory -Path $verificationRoot -Force | Out-Null
        foreach ($localAsset in $uploadPaths) {
            $assetName = Split-Path -Leaf $localAsset
            [void](Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
                'release', 'download', $tag,
                '--repo', $repository,
                '--dir', $verificationRoot,
                '--pattern', $assetName))
            $downloadedAsset = Join-Path $verificationRoot $assetName
            if (-not (Test-Path -LiteralPath $downloadedAsset -PathType Leaf)) {
                throw "GitHub draft is missing uploaded asset '$assetName'."
            }
            $localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $localAsset).Hash
            $remoteHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadedAsset).Hash
            if ($localHash -cne $remoteHash) {
                throw "GitHub draft asset hash mismatch for '$assetName'."
            }
        }
        $remoteUpdateManifest = Read-FluxoraSignedUpdateManifest `
            -ManifestPath (Join-Path $verificationRoot 'fluxora-update-manifest.json') `
            -SignaturePath (Join-Path $verificationRoot 'fluxora-update-manifest.sig') `
            -PublicKeyPath $publicKeyPath
        $remoteReleaseInventory = Read-FluxoraSignedReleaseInventory `
            -InventoryPath (Join-Path $verificationRoot 'fluxora-release-inventory.json') `
            -SignaturePath (Join-Path $verificationRoot 'fluxora-release-inventory.sig') `
            -PublicKeyPath $publicKeyPath
        Assert-FluxoraDownloadedReleaseInventory `
            -Directory $verificationRoot `
            -Inventory $remoteReleaseInventory `
            -UpdateManifest $remoteUpdateManifest `
            -ExpectedAssetNames @($uploadPaths | ForEach-Object { Split-Path -Leaf $_ })
    }

    Invoke-ReleaseStep 'Publishing verified GitHub release' {
        [void](Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
            'release', 'edit', $tag,
            '--repo', $repository,
            '--draft=false',
            '--latest'))
        $published = (Invoke-ReleaseCommand -FilePath 'gh' -Arguments @(
            'release', 'view', $tag, '--repo', $repository, '--json', 'isDraft,tagName,url')) -join "`n" | ConvertFrom-Json
        if ([bool]$published.isDraft -or [string]$published.tagName -cne $tag) {
            throw 'GitHub release did not reach the published state.'
        }
        Write-Host "Published $($published.url)"
    }
}
catch {
    if (-not $commitCreated) {
        if (-not (Test-ReleaseCommand -FilePath 'git' -Arguments (@('diff', '--cached', '--quiet', '--') + $versionPaths))) {
            [void](Invoke-ReleaseCommand -FilePath 'git' -Arguments (@('restore', '--staged', '--') + $versionPaths))
        }
        foreach ($relativePath in $versionSnapshots.Keys) {
            [IO.File]::WriteAllBytes((Join-Path $projectRoot $relativePath), $versionSnapshots[$relativePath])
        }
    }
    if ($remotePushed) {
        Write-Warning "The release commit/tag were already pushed. They were not rewritten. Draft created: $draftCreated. Resolve or resume '$tag' explicitly."
    }
    elseif ($commitCreated) {
        Write-Warning "A local release commit/tag exists but was not pushed. No history was rewritten automatically. Resolve '$tag' explicitly."
    }
    elseif ($checkpointCommitCreated) {
        Write-Warning "The local checkpoint commit was preserved because it contains the selected current changes. No history was rewritten automatically. Resolve or retry '$tag' explicitly."
    }
    throw
}
finally {
    if ($null -ne $capturedSigningKeyBytes) {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($capturedSigningKeyBytes)
        $capturedSigningKeyBytes = $null
    }
    if (Test-Path -LiteralPath $transactionRoot) {
        Remove-Item -LiteralPath $transactionRoot -Recurse -Force
    }
}

Write-Host ''
Write-Host "Production release $tag completed successfully."
