[CmdletBinding()]
param(
    [switch] $RequireNativeAbi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$modulePath = Join-Path $projectRoot 'scripts\release\Fluxora.Release.psm1'
$nativeArtifactModulePath = Join-Path $projectRoot 'scripts\release\Fluxora.NativeArtifactValidation.psm1'
$frontendDependenciesModulePath = Join-Path $projectRoot 'scripts\release\Fluxora.FrontendDependencies.psm1'
Import-Module $modulePath -Force
Import-Module $nativeArtifactModulePath -Force
if (Test-Path -LiteralPath $frontendDependenciesModulePath -PathType Leaf) {
    Import-Module $frontendDependenciesModulePath -Force
}

$script:passed = 0
$script:failed = 0

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)] $Actual,
        [Parameter(Mandatory = $true)] $Expected,
        [Parameter(Mandatory = $true)] [string] $Because
    )

    if ($Actual -ne $Expected) {
        throw "$Because Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)] [bool] $Condition,
        [Parameter(Mandatory = $true)] [string] $Because
    )

    if (-not $Condition) {
        throw $Because
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)] [scriptblock] $Action,
        [Parameter(Mandatory = $true)] [string] $MessagePattern
    )

    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notlike $MessagePattern) {
            throw "Expected error '$MessagePattern', got '$($_.Exception.Message)'."
        }
        return
    }

    throw "Expected action to throw '$MessagePattern'."
}

function Invoke-Case {
    param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [scriptblock] $Test
    )

    try {
        & $Test
        $script:passed++
        Write-Host "PASS $Name"
    }
    catch {
        $script:failed++
        Write-Host "FAIL $Name"
        Write-Host "  $($_.Exception.Message)"
    }
}

Invoke-Case 'frontend dependency bootstrap uses the pinned pnpm through Corepack when pnpm is absent' {
    $frontendRoot = Join-Path $projectRoot 'frontend-tauri'
    $package = Get-Content -LiteralPath (Join-Path $frontendRoot 'package.json') -Raw | ConvertFrom-Json
    Assert-Equal `
        ([string]$package.packageManager) `
        'pnpm@11.9.0' `
        'The frontend manifest must pin the exact pnpm release used by every build.'
    Assert-True `
        ($null -ne (Get-Command 'Resolve-FluxoraFrontendPackageManager' -ErrorAction SilentlyContinue)) `
        'The focused frontend dependency bootstrap module must expose its resolver.'

    $shimRoot = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-corepack-shim-' + [Guid]::NewGuid().ToString('N'))
    $previousPath = $env:PATH
    try {
        New-Item -ItemType Directory -Path $shimRoot -Force | Out-Null
        "@echo off`r`nexit /b 0`r`n" |
            Set-Content -LiteralPath (Join-Path $shimRoot 'corepack.cmd') -Encoding ascii
        $env:PATH = $shimRoot

        $manager = Resolve-FluxoraFrontendPackageManager -FrontendRoot $frontendRoot
        Assert-Equal $manager.Name 'pnpm' 'The pnpm lockfile must select pnpm.'
        Assert-Equal $manager.Provider 'corepack' 'Corepack must provide pnpm without a global installation.'
        Assert-Equal $manager.Version '11.9.0' 'Corepack must resolve the manifest-pinned pnpm version.'
        Assert-Equal `
            (@($manager.ArgumentPrefix) -join ' ') `
            'pnpm' `
            'Corepack must receive pnpm as the package-manager selector.'
    }
    finally {
        $env:PATH = $previousPath
        if (Test-Path -LiteralPath $shimRoot) {
            Remove-Item -LiteralPath $shimRoot -Recurse -Force
        }
    }
}

Invoke-Case 'frontend dependency bootstrap replaces a mismatched global pnpm through npm exec' {
    $frontendRoot = Join-Path $projectRoot 'frontend-tauri'
    $shimRoot = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-pnpm-version-shim-' + [Guid]::NewGuid().ToString('N'))
    $previousPath = $env:PATH
    try {
        New-Item -ItemType Directory -Path $shimRoot -Force | Out-Null
        "@echo off`r`necho 10.0.0`r`nexit /b 0`r`n" |
            Set-Content -LiteralPath (Join-Path $shimRoot 'pnpm.cmd') -Encoding ascii
        "@echo off`r`nexit /b 0`r`n" |
            Set-Content -LiteralPath (Join-Path $shimRoot 'npm.cmd') -Encoding ascii
        $env:PATH = $shimRoot

        $manager = Resolve-FluxoraFrontendPackageManager -FrontendRoot $frontendRoot
        Assert-Equal $manager.Provider 'npm-exec' 'A mismatched global pnpm must not bypass the pinned repository version.'
        Assert-Equal `
            (@(Get-FluxoraFrontendPackageManagerArguments `
                -PackageManager $manager `
                -Arguments @('install', '--frozen-lockfile')) -join ' ') `
            'exec --yes --package=pnpm@11.9.0 -- pnpm install --frozen-lockfile' `
            'npm exec must download and run the exact pnpm version before restoring the frozen lockfile.'
    }
    finally {
        $env:PATH = $previousPath
        if (Test-Path -LiteralPath $shimRoot) {
            Remove-Item -LiteralPath $shimRoot -Recurse -Force
        }
    }
}

Invoke-Case 'local build and desktop compliance share the automatic frontend dependency bootstrap' {
    $buildSource = Get-Content -LiteralPath (Join-Path $projectRoot 'Build.ps1') -Raw
    $complianceSource = Get-Content -LiteralPath (
        Join-Path $projectRoot 'scripts\release\Test-DesktopLegalAndAssetCompliance.ps1'
    ) -Raw

    Assert-True ($buildSource.Contains('Fluxora.FrontendDependencies.psm1')) 'Build.ps1 must import the focused dependency bootstrap module.'
    Assert-True ($buildSource.Contains('Resolve-FluxoraFrontendPackageManager -FrontendRoot $TauriProject')) 'Local builds must resolve the pinned package manager instead of requiring global pnpm.'
    Assert-True ($buildSource.Contains('Invoke-TauriPackageManagerCommand')) 'Every local pnpm call must retain the resolver argument prefix.'
    Assert-True ($buildSource.Contains("Assert-Command 'node'")) 'Local builds must fail early when the Node.js runtime prerequisite is absent.'
    Assert-True ($buildSource.Contains("Assert-Command 'npm'")) 'Local builds must retain npm as the final automatic pnpm fallback.'
    Assert-True ($complianceSource.Contains('Fluxora.FrontendDependencies.psm1')) 'Desktop compliance must import the same dependency bootstrap module.'
    Assert-True ($complianceSource.Contains('Resolve-FluxoraFrontendPackageManager -FrontendRoot $frontendRoot')) 'Desktop compliance must work without a global pnpm command.'
    Assert-True (-not $complianceSource.Contains("Get-Command 'pnpm'")) 'Desktop compliance must not hard-require global pnpm.'
}

function Resolve-NativeInstallerStaticLibrary {
    param(
        [Parameter(Mandatory = $true)] [string[]] $Candidates,
        [switch] $Required
    )

    $library = @($Candidates | Where-Object {
        Test-Path -LiteralPath $_ -PathType Leaf
    } | Select-Object -First 1)
    if ($library.Count -ne 0) {
        return [string]$library[0]
    }
    if ($Required) {
        throw 'FluxoraInstallerCore.lib is required for the statically linked native update release gate, but no built library was found.'
    }
    return $null
}

function New-TestRepository {
    param([switch] $Pnpm)

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("fluxora-release-tests-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $root 'frontend-tauri\src-tauri\setup') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $root 'frontend-tauri\src-tauri\updater') -Force | Out-Null

    '{"version":"1.2.3","productName":"Fluxora"}' |
        Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\tauri.conf.json') -Encoding utf8NoBOM
    '{"version":"../../package.json","productName":"Fluxora"}' |
        Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\setup\tauri.conf.json') -Encoding utf8NoBOM
    '{"version":"../../package.json","productName":"Fluxora"}' |
        Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\updater\tauri.conf.json') -Encoding utf8NoBOM
    '{"name":"fluxora-tauri","version":"1.2.3"}' |
        Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\package.json') -Encoding utf8NoBOM
    if ($Pnpm) {
        "lockfileVersion: '9.0'`n`nimporters:`n`n  .: {}`n" |
            Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\pnpm-lock.yaml') -Encoding utf8NoBOM
    }
    else {
        '{"name":"fluxora-tauri","version":"1.2.3","lockfileVersion":3,"packages":{"":{"name":"fluxora-tauri","version":"1.2.3"},"node_modules/example":{"version":"9.9.9"}}}' |
            Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\package-lock.json') -Encoding utf8NoBOM
    }
    @'
[package]
name = "fluxora_tauri"
version = "1.2.3"
edition = "2021"

[dependencies]
serde = "1"
'@ | Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\Cargo.toml') -Encoding utf8NoBOM
    @'
version = 4

[[package]]
name = "fluxora_tauri"
version = "1.2.3"

[[package]]
name = "serde"
version = "1.0.0"
'@ | Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\Cargo.lock') -Encoding utf8NoBOM

    return $root
}

Invoke-Case 'explicit build modes are stable' {
    Assert-Equal (Resolve-FluxoraBuildMode -Mode Local -HasExplicitBuildArguments $false) Local 'Local mode must remain local.'
    Assert-Equal (Resolve-FluxoraBuildMode -Mode Production -HasExplicitBuildArguments $false) Production 'Production mode must remain production.'
}

Invoke-Case 'legacy parameterized builds stay non-interactive and local' {
    Assert-Equal (Resolve-FluxoraBuildMode -HasExplicitBuildArguments $true) Local 'Parameterized builds must not unexpectedly publish.'
}

Invoke-Case 'interactive menu maps only exact choices' {
    Assert-Equal (Resolve-FluxoraBuildMode -HasExplicitBuildArguments $false -Selection '1') Local 'Choice 1 must build locally.'
    Assert-Equal (Resolve-FluxoraBuildMode -HasExplicitBuildArguments $false -Selection '2') Production 'Choice 2 must publish production.'
    Assert-Throws { Resolve-FluxoraBuildMode -HasExplicitBuildArguments $false -Selection 'yes' } '*Enter 1 or 2*'
}

Invoke-Case 'patch versions increment without changing local builds' {
    Assert-Equal (Get-FluxoraNextPatchVersion -Version '0.0.0') '0.0.1' 'Initial production version must become 0.0.1.'
    Assert-Equal (Get-FluxoraNextPatchVersion -Version '1.2.9') '1.2.10' 'Patch increment must be numeric.'
    Assert-Throws { Get-FluxoraNextPatchVersion -Version '1.2' } '*major.minor.patch*'
    Assert-Throws { Get-FluxoraNextPatchVersion -Version '1.2.3-beta' } '*major.minor.patch*'
}

Invoke-Case 'production version menu offers cancel, patch, minor and major choices' {
    $cancelled = Resolve-FluxoraProductionVersion -CurrentVersion '0.0.0' -Selection '1'
    Assert-True $cancelled.Cancelled 'Choice 1 must leave the current version unchanged and cancel publication.'
    Assert-Equal $cancelled.Version '0.0.0' 'Cancellation must report the unchanged current version.'

    Assert-Equal `
        (Resolve-FluxoraProductionVersion -CurrentVersion '0.0.0' -Selection '2').Version `
        '0.0.1' `
        'Choice 2 must create the next patch version.'
    Assert-Equal `
        (Resolve-FluxoraProductionVersion -CurrentVersion '1.2.9' -Selection '3').Version `
        '1.3.0' `
        'Choice 3 must create the next minor version and reset patch.'
    Assert-Equal `
        (Resolve-FluxoraProductionVersion -CurrentVersion '1.2.9' -Selection '4').Version `
        '2.0.0' `
        'Choice 4 must create the next major version and reset minor/patch.'
}

Invoke-Case 'explicit production versions accept short SemVer without allowing downgrade or reuse' {
    $resolved = Resolve-FluxoraProductionVersion -CurrentVersion '0.0.0' -Version '0.1'
    Assert-True (-not $resolved.Cancelled) 'An explicit higher version must continue publication.'
    Assert-Equal $resolved.Version '0.1.0' 'A major.minor input must normalize to major.minor.patch.'
    Assert-Equal `
        (Resolve-FluxoraProductionVersion -CurrentVersion '0.1.0' -Version '1.0').Version `
        '1.0.0' `
        'A short major release must normalize to full SemVer.'
    Assert-Throws {
        Resolve-FluxoraProductionVersion -CurrentVersion '0.1.0' -Version '0.1'
    } '*must be greater than current version*'
    Assert-Throws {
        Resolve-FluxoraProductionVersion -CurrentVersion '0.1.0' -Version '0.0.9'
    } '*must be greater than current version*'
}

Invoke-Case 'product version reader returns only a synchronized product version' {
    $root = New-TestRepository
    try {
        Assert-Equal `
            (Get-FluxoraProductVersion -ProjectRoot $root) `
            '1.2.3' `
            'The current shared product version must be readable before a build.'

        $packagePath = Join-Path $root 'frontend-tauri\package.json'
        '{"name":"fluxora-tauri","version":"1.2.4"}' |
            Set-Content -LiteralPath $packagePath -Encoding utf8NoBOM
        Assert-Throws `
            { Get-FluxoraProductVersion -ProjectRoot $root } `
            '*must resolve one shared product SemVer*'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'product version edit updates every owned version atomically' {
    $root = New-TestRepository
    try {
        Set-FluxoraProductVersion -ProjectRoot $root -Version '2.0.4'

        Assert-Equal `
            -Actual ((Get-Content (Join-Path $root 'frontend-tauri\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version) `
            -Expected '2.0.4' `
            -Because 'Tauri version must update.'
        Assert-Equal `
            -Actual ((Get-Content (Join-Path $root 'frontend-tauri\src-tauri\setup\tauri.conf.json') -Raw | ConvertFrom-Json).version) `
            -Expected '../../package.json' `
            -Because 'Setup must inherit the package product SemVer.'
        Assert-Equal `
            -Actual ((Get-Content (Join-Path $root 'frontend-tauri\src-tauri\updater\tauri.conf.json') -Raw | ConvertFrom-Json).version) `
            -Expected '../../package.json' `
            -Because 'Updater must inherit the package product SemVer.'
        Assert-Equal `
            -Actual ((Get-Content (Join-Path $root 'frontend-tauri\package.json') -Raw | ConvertFrom-Json).version) `
            -Expected '2.0.4' `
            -Because 'Package version must update.'
        $lock = Get-Content (Join-Path $root 'frontend-tauri\package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
        Assert-Equal $lock['version'] '2.0.4' 'Package lock root version must update.'
        Assert-Equal $lock['packages']['']['version'] '2.0.4' 'Package lock workspace version must update.'
        Assert-Equal $lock['packages']['node_modules/example']['version'] '9.9.9' 'Dependency versions must not change.'
        $cargoManifest = Get-Content (Join-Path $root 'frontend-tauri\src-tauri\Cargo.toml') -Raw
        $cargoLock = Get-Content (Join-Path $root 'frontend-tauri\src-tauri\Cargo.lock') -Raw
        Assert-True ($cargoManifest -match '(?ms)^\[package\].*?^version = "2\.0\.4"') 'Cargo package version must update.'
        Assert-True ($cargoLock -match '(?ms)^\[\[package\]\]\s*name = "fluxora_tauri"\s*version = "2\.0\.4"') 'Cargo lock workspace version must update.'
        Assert-True ($cargoLock -match '(?ms)^\[\[package\]\]\s*name = "serde"\s*version = "1\.0\.0"') 'Cargo dependencies must remain untouched.'
        Assert-True (-not (Get-ChildItem -LiteralPath $root -Recurse -Force -Filter '*.fluxora-version-tmp')) 'Atomic temp files must be cleaned.'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'version validation fails before changing any file' {
    $root = New-TestRepository
    try {
        $before = @{}
        Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
            $before[$_.FullName] = Get-Content -LiteralPath $_.FullName -Raw
        }
        Set-Content -LiteralPath (Join-Path $root 'frontend-tauri\src-tauri\Cargo.lock') -Value 'invalid lock' -Encoding utf8NoBOM
        $before[(Join-Path $root 'frontend-tauri\src-tauri\Cargo.lock')] = 'invalid lock' + [Environment]::NewLine

        Assert-Throws { Set-FluxoraProductVersion -ProjectRoot $root -Version '2.0.4' } '*Cargo lock*'
        foreach ($path in $before.Keys) {
            Assert-Equal (Get-Content -LiteralPath $path -Raw) $before[$path] "A failed version transaction must preserve '$path'."
        }
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'pnpm product version transaction leaves dependency lock content untouched' {
    $root = New-TestRepository -Pnpm
    try {
        $pnpmPath = Join-Path $root 'frontend-tauri\pnpm-lock.yaml'
        $before = Get-Content -LiteralPath $pnpmPath -Raw
        Set-FluxoraProductVersion -ProjectRoot $root -Version '1.2.4'
        Assert-Equal (Get-Content -LiteralPath $pnpmPath -Raw) $before 'Pnpm lock has no workspace package version and must remain byte-stable.'
        Assert-Equal ((Get-Content -LiteralPath (Join-Path $root 'frontend-tauri\package.json') -Raw | ConvertFrom-Json).version) '1.2.4' 'Package version must still advance.'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'raw manifest signatures reject one-byte tampering' {
    $curve = [System.Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256')
    $key = [System.Security.Cryptography.ECDsa]::Create($curve)
    try {
        $manifest = [Text.Encoding]::UTF8.GetBytes('{"schemaVersion":1,"version":"1.2.4"}')
        $signature = New-FluxoraDetachedSignature -ManifestBytes $manifest -SigningKey $key -KeyId 'release-test'
        $publicKey = $key.ExportSubjectPublicKeyInfo()
        Assert-True (Test-FluxoraDetachedSignature -ManifestBytes $manifest -Signature $signature -PublicKeyDer $publicKey) 'Valid raw manifest signature must verify.'
        $manifest[10] = $manifest[10] -bxor 1
        Assert-True (-not (Test-FluxoraDetachedSignature -ManifestBytes $manifest -Signature $signature -PublicKeyDer $publicKey)) 'Tampered manifest must fail verification.'
    }
    finally {
        $key.Dispose()
    }
}

Invoke-Case 'release signing key is DPAPI protected and round-trips without plaintext' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI key-store contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-key-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $plaintextPath = Join-Path $root 'temporary-private.pem'
        $protectedPath = Join-Path $root 'private.dpapi'
        $publicPath = Join-Path $root 'public.der'
        $seedKey = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
        try {
            [IO.File]::WriteAllText($plaintextPath, $seedKey.ExportPkcs8PrivateKeyPem(), [Text.UTF8Encoding]::new($false))
            $expectedFingerprint = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($seedKey.ExportSubjectPublicKeyInfo())).ToLowerInvariant()
        }
        finally {
            $seedKey.Dispose()
        }

        $result = Initialize-FluxoraUpdateSigningKey `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -PlaintextMigrationPath $plaintextPath `
            -RemovePlaintextMigration
        Assert-Equal $result.fingerprint $expectedFingerprint 'Migration must preserve the signing identity.'
        Assert-True (Test-Path -LiteralPath $protectedPath -PathType Leaf) 'DPAPI signing blob must exist.'
        Assert-True (Test-Path -LiteralPath $publicPath -PathType Leaf) 'Only the public SPKI key is distributable.'
        Assert-True (-not (Test-Path -LiteralPath $plaintextPath)) 'Plaintext migration input must be removed only after verified protection.'

        $key = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath
        try {
            $manifest = [Text.Encoding]::UTF8.GetBytes('{"schemaVersion":1}')
            $signature = New-FluxoraDetachedSignature -ManifestBytes $manifest -SigningKey $key -KeyId 'stable-2026'
            Assert-True (Test-FluxoraDetachedSignature -ManifestBytes $manifest -Signature $signature -PublicKeyDer ([IO.File]::ReadAllBytes($publicPath))) 'DPAPI-restored key must sign for the committed public key.'
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'protected signing-key reader rejects oversized and reparse-point inputs' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI key-store contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-key-input-' + [Guid]::NewGuid().ToString('N'))
    try {
        $keyDirectory = Join-Path $root 'active-key'
        $publicPath = Join-Path $root 'public.der'
        $oversizedPath = Join-Path $root 'oversized.dpapi'
        New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
        [IO.File]::WriteAllBytes($oversizedPath, [byte[]]::new(64KB + 1))
        Assert-Throws {
            Open-FluxoraUpdateSigningKey -ProtectedKeyPath $oversizedPath
        } '*safety limit*'

        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $junctionPath = Join-Path $root 'key-junction'
        New-Item -ItemType Junction -Path $junctionPath -Target $keyDirectory | Out-Null
        Assert-Throws {
            Open-FluxoraUpdateSigningKey -ProtectedKeyPath (Join-Path $junctionPath 'private.dpapi')
        } '*must not use a reparse point*'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'portable signing-key backup restores the exact release identity' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $restoredPath = Join-Path $keyDirectory 'restored.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        $confirmation = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force

        $identity = Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath
        $exported = Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $confirmation
        Assert-Equal $exported.fingerprint $identity.fingerprint 'Backup export must retain the committed public identity.'
        Assert-True (Test-Path -LiteralPath $backupPath -PathType Leaf) 'Portable encrypted backup must be created.'

        $restored = Restore-FluxoraUpdateSigningKeyBackup `
            -BackupPath $backupPath `
            -ProtectedKeyPath $restoredPath `
            -PublicKeyPath $publicPath `
            -Password $password
        Assert-Equal $restored.fingerprint $identity.fingerprint 'Restore must retain the committed public identity.'
        Assert-True $restored.restored 'A missing DPAPI destination must be restored.'

        $key = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $restoredPath
        try {
            $probe = [Text.Encoding]::UTF8.GetBytes('portable backup release identity probe')
            $signature = New-FluxoraDetachedSignature -ManifestBytes $probe -SigningKey $key -KeyId 'backup-test'
            Assert-True (Test-FluxoraDetachedSignature -ManifestBytes $probe -Signature $signature -PublicKeyDer ([IO.File]::ReadAllBytes($publicPath))) 'Restored key must sign for the committed public key.'
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'backup password confirmation failure leaves no file behind' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-confirmation-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null

        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        $wrongConfirmation = ConvertTo-SecureString 'release-test-wrong-password-32-chars' -AsPlainText -Force
        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath $backupPath `
                -Password $password `
                -PasswordConfirmation $wrongConfirmation
        } '*password is incorrect or the backup was modified*'
        Assert-True (-not (Test-Path -LiteralPath $backupPath)) 'A mismatched password confirmation must not create a backup.'
        Assert-Equal @((Get-ChildItem -LiteralPath $backupDirectory -Force)).Count 0 'A failed confirmation must clean every temporary file.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'wrong backup password cannot create a restored DPAPI key' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-wrong-password-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $restoredPath = Join-Path $keyDirectory 'restored.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null

        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null
        $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
        $wrongPassword = ConvertTo-SecureString 'release-test-wrong-password-32-chars' -AsPlainText -Force

        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $backupPath `
                -ProtectedKeyPath $restoredPath `
                -PublicKeyPath $publicPath `
                -Password $wrongPassword
        } '*password is incorrect or the backup was modified*'
        Assert-True (-not (Test-Path -LiteralPath $restoredPath)) 'Wrong password must not create a DPAPI key.'
        Assert-Equal (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash $backupHash 'Restore failure must not alter the encrypted backup.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'tampered encrypted backup cannot mutate the active key store' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-tamper-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $restoredPath = Join-Path $keyDirectory 'restored.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        $tamperedPath = Join-Path $backupDirectory 'fluxora-update-signing-key.tampered.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null

        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null
        $tamperedBytes = [IO.File]::ReadAllBytes($backupPath)
        $tamperedBytes[$tamperedBytes.Length - 1] = $tamperedBytes[$tamperedBytes.Length - 1] -bxor 1
        [IO.File]::WriteAllBytes($tamperedPath, $tamperedBytes)

        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $tamperedPath `
                -ProtectedKeyPath $restoredPath `
                -PublicKeyPath $publicPath `
                -Password $password
        } '*backup*'
        Assert-True (-not (Test-Path -LiteralPath $restoredPath)) 'Tampered backup must not create a DPAPI key.'
        Assert-True (Test-Path -LiteralPath $protectedPath -PathType Leaf) 'Tampered backup must not affect the existing active key.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'backup export is randomized and never overwrites a collision' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-collision-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $firstBackup = Join-Path $backupDirectory 'first.encrypted.pk8'
        $secondBackup = Join-Path $backupDirectory 'second.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force

        foreach ($backupPath in @($firstBackup, $secondBackup)) {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath $backupPath `
                -Password $password `
                -PasswordConfirmation $password | Out-Null
        }
        $firstHash = (Get-FileHash -LiteralPath $firstBackup -Algorithm SHA256).Hash
        $secondHash = (Get-FileHash -LiteralPath $secondBackup -Algorithm SHA256).Hash
        Assert-True ($firstHash -cne $secondHash) 'Independent exports must use fresh random PBES2 salt and IV.'

        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath $firstBackup `
                -Password $password `
                -PasswordConfirmation $password
        } '*already exists*refusing to overwrite*'
        Assert-Equal (Get-FileHash -LiteralPath $firstBackup -Algorithm SHA256).Hash $firstHash 'Collision handling must preserve the existing backup byte-for-byte.'
        Assert-Equal @((Get-ChildItem -LiteralPath $backupDirectory -Force -Filter '*.tmp')).Count 0 'Collision handling must leave no temporary file.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'portable backup format pins PBES2 PBKDF2 SHA256 and AES256' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-format-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        $result = Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password

        $reader = [System.Formats.Asn1.AsnReader]::new(
            [IO.File]::ReadAllBytes($backupPath),
            [System.Formats.Asn1.AsnEncodingRules]::DER)
        $outer = $reader.ReadSequence()
        $algorithm = $outer.ReadSequence()
        Assert-Equal $algorithm.ReadObjectIdentifier() '1.2.840.113549.1.5.13' 'Backup must use PBES2.'
        $parameters = $algorithm.ReadSequence()
        $kdf = $parameters.ReadSequence()
        Assert-Equal $kdf.ReadObjectIdentifier() '1.2.840.113549.1.5.12' 'Backup must use PBKDF2.'
        $kdfParameters = $kdf.ReadSequence()
        Assert-True ($kdfParameters.ReadOctetString().Length -ge 16) 'PBKDF2 salt must contain at least 128 random bits.'
        Assert-Equal $kdfParameters.ReadInteger() 600000 'PBKDF2 work factor must remain at the reviewed value.'
        $prf = $kdfParameters.ReadSequence()
        Assert-Equal $prf.ReadObjectIdentifier() '1.2.840.113549.2.9' 'PBKDF2 PRF must be HMAC-SHA256.'
        if ($prf.HasData) {
            $prf.ReadNull()
        }
        Assert-True (-not $prf.HasData -and -not $kdfParameters.HasData -and -not $kdf.HasData) 'PBKDF2 parameters must not contain unreviewed extensions.'
        $cipher = $parameters.ReadSequence()
        Assert-Equal $cipher.ReadObjectIdentifier() '2.16.840.1.101.3.4.1.42' 'Backup cipher must be AES-256-CBC.'
        Assert-Equal $cipher.ReadOctetString().Length 16 'AES-CBC IV must be exactly 128 bits.'
        Assert-True (-not $cipher.HasData -and -not $parameters.HasData -and -not $algorithm.HasData) 'PBES2 parameters must not contain unreviewed extensions.'
        Assert-True ($outer.ReadOctetString().Length -gt 0) 'Encrypted PKCS#8 payload must not be empty.'
        Assert-True (-not $outer.HasData -and -not $reader.HasData) 'Backup must contain exactly one DER EncryptedPrivateKeyInfo value.'
        Assert-Equal $result.iterations 600000 'Export metadata must report the real PBKDF2 work factor.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'restore rejects weak or unreviewed backup cryptography before import' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-policy-' + [Guid]::NewGuid().ToString('N'))
    $key = $null
    [byte[]]$passwordBytes = $null
    [byte[]]$weakBackup = $null
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        $restoreDirectory = Join-Path $root 'restore-key'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory, $restoreDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $weakBackupPath = Join-Path $backupDirectory 'weak.encrypted.pk8'
        $restoredPath = Join-Path $restoreDirectory 'private.dpapi'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null

        $passwordText = 'release-test-backup-password-32-chars'
        $password = ConvertTo-SecureString $passwordText -AsPlainText -Force
        $passwordBytes = [Text.Encoding]::UTF8.GetBytes($passwordText)
        $key = Open-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath
        $weakPbe = [Security.Cryptography.PbeParameters]::new(
            [Security.Cryptography.PbeEncryptionAlgorithm]::Aes128Cbc,
            [Security.Cryptography.HashAlgorithmName]::SHA1,
            1)
        $weakBackup = $key.ExportEncryptedPkcs8PrivateKey($passwordBytes, $weakPbe)
        [IO.File]::WriteAllBytes($weakBackupPath, $weakBackup)

        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $weakBackupPath `
                -ProtectedKeyPath $restoredPath `
                -PublicKeyPath $publicPath `
                -Password $password | Out-Null
        } '*unsupported or malformed cryptographic policy*'
        Assert-True (-not (Test-Path -LiteralPath $restoredPath)) 'Unreviewed PBE input must fail before creating a DPAPI destination.'
    }
    finally {
        if ($null -ne $key) {
            $key.Dispose()
        }
        foreach ($sensitive in @($passwordBytes, $weakBackup)) {
            if ($null -ne $sensitive) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($sensitive)
            }
        }
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'restore rejects an iteration bomb before performing PBKDF2 work' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-iterations-' + [Guid]::NewGuid().ToString('N'))
    [byte[]]$mutatedBytes = $null
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        $restoreDirectory = Join-Path $root 'restore-key'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory, $restoreDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $validBackupPath = Join-Path $backupDirectory 'valid.encrypted.pk8'
        $iterationBombPath = Join-Path $backupDirectory 'iteration-bomb.encrypted.pk8'
        $restoredPath = Join-Path $restoreDirectory 'private.dpapi'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $validBackupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null

        $mutatedBytes = [IO.File]::ReadAllBytes($validBackupPath)
        $iterationOffset = -1
        for ($index = 0; $index -le $mutatedBytes.Length - 5; $index++) {
            if ($mutatedBytes[$index] -eq 0x02 -and
                $mutatedBytes[$index + 1] -eq 0x03 -and
                $mutatedBytes[$index + 2] -eq 0x09 -and
                $mutatedBytes[$index + 3] -eq 0x27 -and
                $mutatedBytes[$index + 4] -eq 0xC0) {
                $iterationOffset = $index
                break
            }
        }
        Assert-True ($iterationOffset -ge 0) 'Test fixture must locate the reviewed 600,000-iteration DER integer.'
        $mutatedBytes[$iterationOffset + 2] = 0x7F
        $mutatedBytes[$iterationOffset + 3] = 0xFF
        $mutatedBytes[$iterationOffset + 4] = 0xFF
        [IO.File]::WriteAllBytes($iterationBombPath, $mutatedBytes)

        $timer = [Diagnostics.Stopwatch]::StartNew()
        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $iterationBombPath `
                -ProtectedKeyPath $restoredPath `
                -PublicKeyPath $publicPath `
                -Password $password | Out-Null
        } '*unsupported or malformed cryptographic policy*'
        $timer.Stop()
        Assert-True ($timer.ElapsedMilliseconds -lt 1000) 'Iteration policy rejection must happen before an attacker-controlled PBKDF2 workload.'
        Assert-True (-not (Test-Path -LiteralPath $restoredPath)) 'Iteration-bomb input must not create a DPAPI destination.'
    }
    finally {
        if ($null -ne $mutatedBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($mutatedBytes)
        }
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'backup export rejects unsafe locations and restricts the final file ACL' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows ACL backup contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-backup-paths-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        $repositoryBackupPath = Join-Path $projectRoot (
            '.fluxora-signing-backup-test-' + [Guid]::NewGuid().ToString('N') + '.encrypted.pk8')

        foreach ($unsafePath in @(
                $repositoryBackupPath,
                (Join-Path $keyDirectory 'backup.encrypted.pk8'))) {
            Assert-Throws {
                Export-FluxoraUpdateSigningKeyBackup `
                    -ProtectedKeyPath $protectedPath `
                    -PublicKeyPath $publicPath `
                    -BackupPath $unsafePath `
                    -Password $password `
                    -PasswordConfirmation $password
            } '*must be stored outside*'
            Assert-True (-not (Test-Path -LiteralPath $unsafePath)) 'Unsafe output location must remain untouched.'
        }
        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath 'relative-backup.encrypted.pk8' `
                -Password $password `
                -PasswordConfirmation $password
        } '*path must be absolute*'

        $extendedRepositoryPath = '\\?\' + $repositoryBackupPath
        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath $extendedRepositoryPath `
                -Password $password `
                -PasswordConfirmation $password
        } '*standard local-drive path*'
        Assert-True (-not (Test-Path -LiteralPath $repositoryBackupPath)) 'Extended path aliases must not bypass the repository boundary.'

        $alternateStreamPath = (Join-Path $backupDirectory 'carrier.encrypted.pk8') + ':fluxora'
        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath $alternateStreamPath `
                -Password $password `
                -PasswordConfirmation $password
        } '*must not use an alternate data stream*'

        $substPath = Join-Path ([Environment]::SystemDirectory) 'subst.exe'
        $usedDriveNames = @([IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1) })
        $substLetter = @('Z', 'Y', 'X', 'W', 'V', 'U', 'T' | Where-Object {
            $_ -notin $usedDriveNames
        } | Select-Object -First 1)
        Assert-Equal $substLetter.Count 1 'The alias regression requires one unused drive letter.'
        & $substPath "$($substLetter[0]):" $projectRoot | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not create the disposable subst path alias.'
        }
        try {
            $substBackupPath = "$($substLetter[0]):\.fluxora-signing-backup-subst-test.encrypted.pk8"
            Assert-Throws {
                Export-FluxoraUpdateSigningKeyBackup `
                    -ProtectedKeyPath $protectedPath `
                    -PublicKeyPath $publicPath `
                    -BackupPath $substBackupPath `
                    -Password $password `
                    -PasswordConfirmation $password
            } '*must be stored outside*'
            Assert-True (-not (Test-Path -LiteralPath $repositoryBackupPath)) 'Subst aliases must resolve to the real repository boundary.'
        }
        finally {
            & $substPath "$($substLetter[0]):" '/D' | Out-Null
        }

        $junctionTarget = Join-Path $root 'junction-target'
        $junctionPath = Join-Path $root 'backup-junction'
        New-Item -ItemType Directory -Path $junctionTarget | Out-Null
        New-Item -ItemType Junction -Path $junctionPath -Target $junctionTarget | Out-Null
        Assert-Throws {
            Export-FluxoraUpdateSigningKeyBackup `
                -ProtectedKeyPath $protectedPath `
                -PublicKeyPath $publicPath `
                -BackupPath (Join-Path $junctionPath 'backup.encrypted.pk8') `
                -Password $password `
                -PasswordConfirmation $password
        } '*must not use a reparse point*'
        Assert-Equal @((Get-ChildItem -LiteralPath $junctionTarget -Force)).Count 0 'Reparse-point rejection must happen before any write.'

        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null
        $acl = Get-Acl -LiteralPath $backupPath
        $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        Assert-True $acl.AreAccessRulesProtected 'Backup file must disable inherited ACL rules.'
        Assert-True ($rules.Count -ge 1) 'Backup file must grant its owner explicit access.'
        foreach ($rule in $rules) {
            Assert-Equal $rule.IdentityReference.Value $currentSid.Value 'Only the current release operator may access the local backup copy.'
            Assert-Equal $rule.AccessControlType ([Security.AccessControl.AccessControlType]::Allow) 'Backup ACL must not introduce a deny rule.'
            Assert-True (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) 'Release operator must retain FullControl for offline-copy handling.'
        }
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'published-file verification rejects post-publication corruption' {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-published-file-verification-' + [Guid]::NewGuid().ToString('N'))
    [byte[]]$expected = 1..32
    [byte[]]$corrupt = $null
    try {
        New-Item -ItemType Directory -Path $root | Out-Null
        $path = Join-Path $root 'backup.encrypted.pk8'
        $corrupt = [byte[]]$expected.Clone()
        $corrupt[0] = $corrupt[0] -bxor 0xFF
        [IO.File]::WriteAllBytes($path, $corrupt)
        $releaseModule = Get-Module Fluxora.Release

        Assert-Throws {
            & $releaseModule {
                param($PublishedPath, $ExpectedBytes)
                Assert-FluxoraPublishedFileMatches `
                    -Path $PublishedPath `
                    -ExpectedBytes $ExpectedBytes `
                    -Context 'Published Fluxora signing-key backup'
            } $path $expected
        } '*changed during publication*'
    }
    finally {
        foreach ($sensitive in @($expected, $corrupt)) {
            if ($null -ne $sensitive) {
                [Security.Cryptography.CryptographicOperations]::ZeroMemory($sensitive)
            }
        }
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'restore is idempotent for the same key and refuses destructive replacement' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-restore-collision-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $keyDirectory = Join-Path $root 'active-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $keyDirectory, $backupDirectory -Force | Out-Null
        $protectedPath = Join-Path $keyDirectory 'private.dpapi'
        $restoredPath = Join-Path $keyDirectory 'restored.dpapi'
        $corruptPath = Join-Path $keyDirectory 'corrupt.dpapi'
        $publicPath = Join-Path $repositoryRoot 'stable-public-key.der'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedPath -PublicKeyPath $publicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $protectedPath `
            -PublicKeyPath $publicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null

        Restore-FluxoraUpdateSigningKeyBackup `
            -BackupPath $backupPath `
            -ProtectedKeyPath $restoredPath `
            -PublicKeyPath $publicPath `
            -Password $password | Out-Null
        $restoredHash = (Get-FileHash -LiteralPath $restoredPath -Algorithm SHA256).Hash
        $repeat = Restore-FluxoraUpdateSigningKeyBackup `
            -BackupPath $backupPath `
            -ProtectedKeyPath $restoredPath `
            -PublicKeyPath $publicPath `
            -Password $password
        Assert-True (-not $repeat.restored -and $repeat.alreadyPresent) 'Restoring an already-present matching key must be an idempotent no-op.'
        Assert-Equal (Get-FileHash -LiteralPath $restoredPath -Algorithm SHA256).Hash $restoredHash 'Idempotent restore must not rewrite DPAPI bytes.'

        [IO.File]::WriteAllBytes($corruptPath, [Security.Cryptography.RandomNumberGenerator]::GetBytes(128))
        $corruptHash = (Get-FileHash -LiteralPath $corruptPath -Algorithm SHA256).Hash
        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $backupPath `
                -ProtectedKeyPath $corruptPath `
                -PublicKeyPath $publicPath `
                -Password $password
        } '*destination already exists and was not modified*'
        Assert-Equal (Get-FileHash -LiteralPath $corruptPath -Algorithm SHA256).Hash $corruptHash 'Restore must never overwrite an unusable existing destination.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'restore rejects a backup from a different committed public identity' {
    if (-not $IsWindows) {
        Write-Host 'SKIP Windows DPAPI backup/restore contract is Windows-only.'
        return
    }

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-signing-restore-identity-' + [Guid]::NewGuid().ToString('N'))
    try {
        $repositoryRoot = Join-Path $root 'repository'
        $sourceKeyDirectory = Join-Path $root 'source-key'
        $otherKeyDirectory = Join-Path $root 'other-key'
        $backupDirectory = Join-Path $root 'offline-backup'
        New-Item -ItemType Directory -Path $repositoryRoot, $sourceKeyDirectory, $otherKeyDirectory, $backupDirectory -Force | Out-Null
        $sourceProtectedPath = Join-Path $sourceKeyDirectory 'private.dpapi'
        $sourcePublicPath = Join-Path $repositoryRoot 'source-public.der'
        $otherProtectedPath = Join-Path $otherKeyDirectory 'private.dpapi'
        $otherPublicPath = Join-Path $repositoryRoot 'other-public.der'
        $restoredPath = Join-Path $otherKeyDirectory 'restored.dpapi'
        $backupPath = Join-Path $backupDirectory 'fluxora-update-signing-key.encrypted.pk8'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $sourceProtectedPath -PublicKeyPath $sourcePublicPath | Out-Null
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $otherProtectedPath -PublicKeyPath $otherPublicPath | Out-Null
        $password = ConvertTo-SecureString 'release-test-backup-password-32-chars' -AsPlainText -Force
        Export-FluxoraUpdateSigningKeyBackup `
            -ProtectedKeyPath $sourceProtectedPath `
            -PublicKeyPath $sourcePublicPath `
            -BackupPath $backupPath `
            -Password $password `
            -PasswordConfirmation $password | Out-Null

        Assert-Throws {
            Restore-FluxoraUpdateSigningKeyBackup `
                -BackupPath $backupPath `
                -ProtectedKeyPath $restoredPath `
                -PublicKeyPath $otherPublicPath `
                -Password $password
        } '*does not match the committed Fluxora update public key*'
        Assert-True (-not (Test-Path -LiteralPath $restoredPath)) 'A backup from a different release identity must not create a DPAPI key.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'repository contains only the reviewed stable public update key' {
    $publicPath = Join-Path $projectRoot 'frontend-tauri\src-tauri\resources\update\stable-public-key.der'
    $gitIgnore = Get-Content -LiteralPath (Join-Path $projectRoot '.gitignore') -Raw
    Assert-True (Test-Path -LiteralPath $publicPath -PathType Leaf) 'The stable public key must be packaged.'
    Assert-Equal ((Get-FileHash -Algorithm SHA256 -LiteralPath $publicPath).Hash.ToLowerInvariant()) 'f2d6f63919c925d8ccad42a178fba83a5cd49f72e3e49ba94e1c0ba45d348b64' 'The embedded signing identity must not drift silently.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'update-manifest-p256-private.pem'))) 'A plaintext production private key must never be stored at repository root.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'update-manifest-p256-private.dpapi'))) 'A machine-bound production private key must never be stored in the repository.'
    Assert-True ($gitIgnore.Contains('*.encrypted.pk8')) 'Portable encrypted signing-key backups must be ignored as defense in depth.'
    Assert-True ($gitIgnore.Contains('update-manifest-p256-private.dpapi')) 'Machine-bound signing-key blobs must be ignored as defense in depth.'
    Assert-True ($gitIgnore.Contains('update-manifest-p256-private.pem')) 'Legacy plaintext signing-key files must be ignored as defense in depth.'
}

Invoke-Case 'delta plan contains additions replacements and deletions only' {
    $base = @(
        [pscustomobject]@{ path = 'Fluxora.exe'; size = 10; sha256 = 'aaa' },
        [pscustomobject]@{ path = 'resources/keep.bin'; size = 20; sha256 = 'bbb' },
        [pscustomobject]@{ path = 'resources/remove.bin'; size = 30; sha256 = 'ccc' }
    )
    $target = @(
        [pscustomobject]@{ path = 'Fluxora.exe'; size = 11; sha256 = 'ddd' },
        [pscustomobject]@{ path = 'resources/keep.bin'; size = 20; sha256 = 'bbb' },
        [pscustomobject]@{ path = 'resources/новый.bin'; size = 40; sha256 = 'eee' }
    )

    $plan = Compare-FluxoraFileManifests -BaseFiles $base -TargetFiles $target
    Assert-Equal $plan.changed.Count 2 'Delta must carry one replacement and one addition.'
    Assert-Equal $plan.deleted.Count 1 'Delta must carry one deletion.'
    Assert-True ($plan.changed.path -contains 'Fluxora.exe') 'Changed executable must be included.'
    Assert-True ($plan.changed.path -contains 'resources/новый.bin') 'Unicode addition must be included.'
    Assert-Equal $plan.deleted[0] 'resources/remove.bin' 'Deleted path must be explicit.'
}

Invoke-Case 'canonical update file digest is ordinal and cross-language stable' {
    $files = @(
        [pscustomobject]@{ path = 'resources/данные.bin'; size = [uint64]4; sha256 = ('b' * 64) },
        [pscustomobject]@{ path = 'Fluxora.exe'; size = [uint64]3; sha256 = ('a' * 64) }
    )

    Assert-Equal `
        (Get-FluxoraUpdateFileManifestSha256 -Files $files) `
        'ac3e167cb34844276a058ce123548553655a0dc31cf0b4ffa10347080d7ec5f8' `
        'The signed file-tree digest must be stable across the PowerShell and native readers.'
}

Invoke-Case 'manifest ordering uses UTF-8 bytes for supplementary Unicode paths' {
    $bmpPath = 'resources/' + [char]0xE000 + '.bin'
    $supplementaryPath = 'resources/' + [char]::ConvertFromUtf32(0x10000) + '.bin'
    $files = @(
        [pscustomobject]@{ path = $supplementaryPath; size = [uint64]1; sha256 = ('c' * 64) },
        [pscustomobject]@{ path = $bmpPath; size = [uint64]1; sha256 = ('b' * 64) },
        [pscustomobject]@{ path = 'Fluxora.exe'; size = [uint64]1; sha256 = ('a' * 64) }
    )
    $digest = Get-FluxoraUpdateFileManifestSha256 -Files $files
    $assets = @([pscustomobject]@{
        kind = 'full'; fromVersion = $null
        url = 'https://github.com/Moddingflow/Fluxora/releases/download/v1.0.0/Fluxora-1.0.0-win-x64-full.flxupd'
        size = [uint64]1; sha256 = ('d' * 64); targetFileManifestSha256 = $digest; baseFileManifestSha256 = $null
    })
    $manifest = [Text.Encoding]::UTF8.GetString((ConvertTo-FluxoraUpdateManifestBytes -Version '1.0.0' -Target 'win-x64' -ApplicationExecutable 'Fluxora.exe' -Files $files -Assets $assets)) | ConvertFrom-Json

    Assert-Equal $manifest.files[1].path $bmpPath 'UTF-8 byte ordering must place U+E000 before U+10000.'
    Assert-Equal $manifest.files[2].path $supplementaryPath 'Supplementary-plane paths must match Rust byte ordering.'
}

Invoke-Case 'payload manifest supports arbitrary files while excluding mutable user data' {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-update-payload-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path (Join-Path $root 'resources\nested') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $root 'Downloads') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $root 'Fluxora.exe'), [byte[]](0, 1, 2, 255))
        [IO.File]::WriteAllBytes((Join-Path $root 'resources\nested\данные.bin'), [byte[]](9, 8, 7))
        [IO.File]::WriteAllBytes((Join-Path $root 'Downloads\user.zip'), [byte[]](5))
        [IO.File]::WriteAllBytes((Join-Path $root 'logs\runtime.log'), [byte[]](6))
        [IO.File]::WriteAllBytes((Join-Path $root 'debug.pdb'), [byte[]](7))

        $files = @(Get-FluxoraUpdateFileManifest -PayloadRoot $root)
        Assert-Equal $files.Count 2 'Only immutable product files belong in update packages.'
        Assert-Equal $files[0].path 'Fluxora.exe' 'Paths must use deterministic ordinal ordering.'
        Assert-Equal $files[1].path 'resources/nested/данные.bin' 'Unicode binary paths must be normalized to forward slashes.'
        Assert-Equal $files[0].size ([uint64]4) 'Binary file sizes must be exact.'
        Assert-True ($files[0].sha256 -match '^[0-9a-f]{64}$') 'Every file must carry a lowercase SHA-256.'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'update paths fail closed on traversal case collisions and reparse points' {
    $validHash = 'a' * 64
    Assert-Throws {
        Get-FluxoraUpdateFileManifestSha256 -Files @([pscustomobject]@{ path = '../Fluxora.exe'; size = 1; sha256 = $validHash })
    } '*unsafe segment*'
    Assert-Throws {
        Get-FluxoraUpdateFileManifestSha256 -Files @(
            [pscustomobject]@{ path = 'Data/file.bin'; size = 1; sha256 = $validHash },
            [pscustomobject]@{ path = 'data/FILE.bin'; size = 1; sha256 = $validHash }
        )
    } '*duplicate Windows path*'
    Assert-Throws {
        Get-FluxoraUpdateFileManifestSha256 -Files @([pscustomobject]@{ path = 'Downloads/user.zip'; size = 1; sha256 = $validHash })
    } '*Mutable user path*'

    if ($IsWindows) {
        $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-update-reparse-' + [Guid]::NewGuid().ToString('N'))
        $external = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-update-external-' + [Guid]::NewGuid().ToString('N'))
        try {
            New-Item -ItemType Directory -Path $root, $external -Force | Out-Null
            [IO.File]::WriteAllBytes((Join-Path $external 'outside.bin'), [byte[]](1))
            New-Item -ItemType Junction -Path (Join-Path $root 'linked') -Target $external | Out-Null
            Assert-Throws { Get-FluxoraUpdateFileManifest -PayloadRoot $root } '*reparse point*'
        }
        finally {
            if (Test-Path -LiteralPath (Join-Path $root 'linked')) {
                Remove-Item -LiteralPath (Join-Path $root 'linked') -Force
            }
            if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
            if (Test-Path -LiteralPath $external) { Remove-Item -LiteralPath $external -Recurse -Force }
        }
    }
}

Invoke-Case 'signed update manifest has one full package and exact delta ancestry' {
    $files = @([pscustomobject]@{ path = 'Fluxora.exe'; size = [uint64]4; sha256 = ('a' * 64) })
    $targetDigest = Get-FluxoraUpdateFileManifestSha256 -Files $files
    $assets = @(
        [pscustomobject]@{
            kind = 'delta'; fromVersion = '1.2.2'
            url = 'https://github.com/Moddingflow/Fluxora/releases/download/v1.2.3/Fluxora-1.2.2-to-1.2.3-win-x64-delta.flxupd'
            size = [uint64]20; sha256 = ('b' * 64); targetFileManifestSha256 = $targetDigest; baseFileManifestSha256 = ('c' * 64)
        },
        [pscustomobject]@{
            kind = 'full'; fromVersion = $null
            url = 'https://github.com/Moddingflow/Fluxora/releases/download/v1.2.3/Fluxora-1.2.3-win-x64-full.flxupd'
            size = [uint64]40; sha256 = ('d' * 64); targetFileManifestSha256 = $targetDigest; baseFileManifestSha256 = $null
        }
    )

    $bytes = ConvertTo-FluxoraUpdateManifestBytes -Version '1.2.3' -Target 'win-x64' -ApplicationExecutable 'Fluxora.exe' -Files $files -Assets $assets
    $manifest = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    Assert-Equal $manifest.schemaVersion 1 'Manifest schema must be explicit.'
    Assert-Equal $manifest.files[0].path 'Fluxora.exe' 'Manifest files must preserve the signed tree.'
    Assert-Equal $manifest.assets[0].kind 'full' 'Full package must be ordered first for deterministic JSON.'
    Assert-Equal $manifest.assets[1].fromVersion '1.2.2' 'Delta ancestry must be explicit.'

    Assert-Throws {
        ConvertTo-FluxoraUpdateManifestBytes -Version '1.2.3' -Target 'win-x64' -ApplicationExecutable 'Fluxora.exe' -Files $files -Assets @($assets[0])
    } '*exactly one full*'
    $badAssets = @($assets[1].PSObject.Copy(), $assets[0].PSObject.Copy())
    $badAssets[1].url = 'https://example.com/update.flxupd'
    Assert-Throws {
        ConvertTo-FluxoraUpdateManifestBytes -Version '1.2.3' -Target 'win-x64' -ApplicationExecutable 'Fluxora.exe' -Files $files -Assets $badAssets
    } '*GitHub release URL*'
}

Invoke-Case 'signed manifest reader rejects tampering and schema smuggling' {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-signed-manifest-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $key = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
        try {
            $files = @([pscustomobject]@{ path = 'Fluxora.exe'; size = [uint64]1; sha256 = ('a' * 64) })
            $digest = Get-FluxoraUpdateFileManifestSha256 -Files $files
            $assets = @([pscustomobject]@{
                kind = 'full'; fromVersion = $null
                url = 'https://github.com/Moddingflow/Fluxora/releases/download/v1.0.0/Fluxora-1.0.0-win-x64-full.flxupd'
                size = [uint64]1; sha256 = ('b' * 64); targetFileManifestSha256 = $digest; baseFileManifestSha256 = $null
            })
            $bytes = ConvertTo-FluxoraUpdateManifestBytes -Version '1.0.0' -Target 'win-x64' -ApplicationExecutable 'Fluxora.exe' -Files $files -Assets $assets
            $validBytes = [byte[]]$bytes.Clone()
            $manifestPath = Join-Path $root 'manifest.json'
            $signaturePath = Join-Path $root 'manifest.sig'
            $publicPath = Join-Path $root 'public.der'
            [IO.File]::WriteAllBytes($manifestPath, $bytes)
            [IO.File]::WriteAllText($signaturePath, (New-FluxoraDetachedSignature -ManifestBytes $bytes -SigningKey $key -KeyId 'test'), [Text.Encoding]::ASCII)
            [IO.File]::WriteAllBytes($publicPath, $key.ExportSubjectPublicKeyInfo())
            [void](Read-FluxoraSignedUpdateManifest -ManifestPath $manifestPath -SignaturePath $signaturePath -PublicKeyPath $publicPath)

            $bytes[8] = $bytes[8] -bxor 1
            [IO.File]::WriteAllBytes($manifestPath, $bytes)
            Assert-Throws {
                Read-FluxoraSignedUpdateManifest -ManifestPath $manifestPath -SignaturePath $signaturePath -PublicKeyPath $publicPath
            } '*signature is invalid*'

            $smuggled = [Text.Encoding]::UTF8.GetBytes(([Text.Encoding]::UTF8.GetString($bytes).TrimEnd() -replace '}$', ',"unexpected":true}') + "`n")
            [IO.File]::WriteAllBytes($manifestPath, $smuggled)
            [IO.File]::WriteAllText($signaturePath, (New-FluxoraDetachedSignature -ManifestBytes $smuggled -SigningKey $key -KeyId 'test'), [Text.Encoding]::ASCII)
            Assert-Throws {
                Read-FluxoraSignedUpdateManifest -ManifestPath $manifestPath -SignaturePath $signaturePath -PublicKeyPath $publicPath
            } '*unexpected property set*'

            $invalidUtf8 = [byte[]]$validBytes.Clone()
            $stableOffset = ([Text.Encoding]::UTF8.GetString($validBytes)).IndexOf('stable', [StringComparison]::Ordinal)
            $invalidUtf8[$stableOffset] = 0xFF
            [IO.File]::WriteAllBytes($manifestPath, $invalidUtf8)
            [IO.File]::WriteAllText($signaturePath, (New-FluxoraDetachedSignature -ManifestBytes $invalidUtf8 -SigningKey $key -KeyId 'test'), [Text.Encoding]::ASCII)
            Assert-Throws {
                Read-FluxoraSignedUpdateManifest -ManifestPath $manifestPath -SignaturePath $signaturePath -PublicKeyPath $publicPath
            } '*not valid UTF-8 JSON*'
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
}

Invoke-Case 'full and delta packages use the strict FLXUPD1 binary contract' {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('fluxora-update-package-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path (Join-Path $root 'resources') -Force | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $root 'Fluxora.exe'), [byte[]](0, 1, 2, 255))
        [IO.File]::WriteAllBytes((Join-Path $root 'resources\new.bin'), [byte[]](9, 8, 7))
        $files = @(Get-FluxoraUpdateFileManifest -PayloadRoot $root)
        $targetDigest = Get-FluxoraUpdateFileManifestSha256 -Files $files
        $packagePath = Join-Path $root 'delta.flxupd'

        $package = Write-FluxoraUpdatePackage `
            -Kind Delta `
            -SourceDirectory $root `
            -Entries $files `
            -DeletedPaths @('resources/old.bin') `
            -FromVersion '1.2.2' `
            -TargetVersion '1.2.3' `
            -Target 'win-x64' `
            -BaseFileManifestSha256 ('c' * 64) `
            -TargetFileManifestSha256 $targetDigest `
            -PackagePath $packagePath

        Assert-True (Test-Path -LiteralPath $packagePath -PathType Leaf) 'Package writer must produce one atomic artifact.'
        Assert-True ($package.sha256 -match '^[0-9a-f]{64}$') 'Package asset hash must be returned.'
        Assert-Equal $package.size ([uint64](Get-Item -LiteralPath $packagePath).Length) 'Returned package size must be exact.'

        $stream = [IO.File]::OpenRead($packagePath)
        $reader = [IO.BinaryReader]::new($stream, [Text.Encoding]::UTF8, $false)
        try {
            Assert-Equal ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(8))) ("FLXUPD1" + [char]0) 'Package magic must be exact.'
            Assert-Equal $reader.ReadUInt32() ([uint32]1) 'Package format version must be exact.'
            Assert-Equal $reader.ReadByte() ([byte]1) 'Delta kind must be encoded as 1.'
            $fromLength = $reader.ReadUInt32()
            Assert-Equal ([Text.Encoding]::UTF8.GetString($reader.ReadBytes($fromLength))) '1.2.2' 'Base version must be encoded.'
            $targetLength = $reader.ReadUInt32()
            Assert-Equal ([Text.Encoding]::UTF8.GetString($reader.ReadBytes($targetLength))) '1.2.3' 'Target version must be encoded.'
            $platformLength = $reader.ReadUInt32()
            Assert-Equal ([Text.Encoding]::UTF8.GetString($reader.ReadBytes($platformLength))) 'win-x64' 'Target platform must be encoded.'
            Assert-Equal $reader.ReadBytes(32).Length 32 'Base digest must be 32 bytes.'
            Assert-Equal $reader.ReadBytes(32).Length 32 'Target digest must be 32 bytes.'
            Assert-Equal $reader.ReadUInt64() ([uint64]1) 'Delta must encode its explicit delete list.'
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'artifact builder emits signed full and previous-version delta releases' {
    if (-not $IsWindows) {
        Write-Host 'SKIP release artifact signing integration is Windows-only.'
        return
    }

    $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-artifacts-' + [Guid]::NewGuid().ToString('N'))
    try {
        $basePayload = Join-Path $root 'payload-base'
        $targetPayload = Join-Path $root 'payload-target'
        $baseArtifacts = Join-Path $root 'artifacts-base'
        $targetArtifacts = Join-Path $root 'artifacts-target'
        New-Item -ItemType Directory -Path (Join-Path $basePayload 'resources') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $targetPayload 'resources') -Force | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $basePayload 'Fluxora.exe'), [byte[]](1, 2, 3))
        [IO.File]::WriteAllBytes((Join-Path $basePayload 'resources\remove.bin'), [byte[]](4))
        [IO.File]::WriteAllBytes((Join-Path $targetPayload 'Fluxora.exe'), [byte[]](1, 2, 9))
        [IO.File]::WriteAllBytes((Join-Path $targetPayload 'resources\new.bin'), [byte[]](5, 6))

        $protectedKey = Join-Path $root 'private.dpapi'
        $publicKey = Join-Path $root 'public.der'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedKey -PublicKeyPath $publicKey | Out-Null
        $artifactScript = Join-Path $projectRoot 'scripts\release\New-FluxoraUpdateArtifacts.ps1'

        & $artifactScript -PayloadDirectory $basePayload -ArtifactDirectory $baseArtifacts -Version '1.2.2' -ProtectedSigningKeyPath $protectedKey -PublicKeyPath $publicKey | Out-Null
        & $artifactScript `
            -PayloadDirectory $targetPayload `
            -ArtifactDirectory $targetArtifacts `
            -Version '1.2.3' `
            -ProtectedSigningKeyPath $protectedKey `
            -PublicKeyPath $publicKey `
            -PreviousManifestPath (Join-Path $baseArtifacts 'fluxora-update-manifest.json') `
            -PreviousSignaturePath (Join-Path $baseArtifacts 'fluxora-update-manifest.sig') | Out-Null

        $manifest = Read-FluxoraSignedUpdateManifest `
            -ManifestPath (Join-Path $targetArtifacts 'fluxora-update-manifest.json') `
            -SignaturePath (Join-Path $targetArtifacts 'fluxora-update-manifest.sig') `
            -PublicKeyPath $publicKey
        Assert-Equal $manifest.assets.Count 2 'Second release must carry a full fallback and one incremental update.'
        Assert-Equal $manifest.assets[0].kind 'full' 'Full fallback must remain first.'
        Assert-Equal $manifest.assets[1].kind 'delta' 'Incremental package must be advertised.'
        Assert-Equal $manifest.assets[1].fromVersion '1.2.2' 'Delta ancestry must match the signed previous release.'
        Assert-True (Test-Path -LiteralPath (Join-Path $targetArtifacts 'Fluxora-1.2.3-win-x64-full.flxupd')) 'Full asset must use the stable release name.'
        Assert-True (Test-Path -LiteralPath (Join-Path $targetArtifacts 'Fluxora-1.2.2-to-1.2.3-win-x64-delta.flxupd')) 'Delta asset must use the stable release name.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'production artifact retries replace only the requested local version directory' {
    if (-not $IsWindows) {
        Write-Host 'SKIP release artifact signing integration is Windows-only.'
        return
    }

    $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-artifact-retry-' + [Guid]::NewGuid().ToString('N'))
    try {
        $payload = Join-Path $root 'payload'
        $artifacts = Join-Path $root 'artifacts'
        New-Item -ItemType Directory -Path $payload -Force | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $payload 'Fluxora.exe'), [byte[]](1, 2, 3))

        $protectedKey = Join-Path $root 'private.dpapi'
        $publicKey = Join-Path $root 'public.der'
        Initialize-FluxoraUpdateSigningKey -ProtectedKeyPath $protectedKey -PublicKeyPath $publicKey | Out-Null
        $artifactScript = Join-Path $projectRoot 'scripts\release\New-FluxoraUpdateArtifacts.ps1'
        $artifactArguments = @{
            PayloadDirectory = $payload
            ArtifactDirectory = $artifacts
            Version = '2.0.0'
            ProtectedSigningKeyPath = $protectedKey
            PublicKeyPath = $publicKey
        }

        & $artifactScript @artifactArguments | Out-Null
        $firstManifest = Read-FluxoraSignedUpdateManifest `
            -ManifestPath (Join-Path $artifacts 'fluxora-update-manifest.json') `
            -SignaturePath (Join-Path $artifacts 'fluxora-update-manifest.sig') `
            -PublicKeyPath $publicKey
        $markerPath = Join-Path $artifacts 'stale.marker'
        [IO.File]::WriteAllText($markerPath, 'preserve until replacement commits')
        [IO.File]::WriteAllBytes((Join-Path $payload 'Fluxora.exe'), [byte[]](9, 8, 7, 6))

        Assert-Throws {
            & $artifactScript @artifactArguments | Out-Null
        } '*already exists*refusing to mix release state*'
        Assert-True (Test-Path -LiteralPath $markerPath -PathType Leaf) 'The default collision guard must preserve an existing artifact directory.'

        & $artifactScript @artifactArguments -ReplaceExisting | Out-Null
        $replacementManifest = Read-FluxoraSignedUpdateManifest `
            -ManifestPath (Join-Path $artifacts 'fluxora-update-manifest.json') `
            -SignaturePath (Join-Path $artifacts 'fluxora-update-manifest.sig') `
            -PublicKeyPath $publicKey
        Assert-True ($replacementManifest.fileManifestSha256 -cne $firstManifest.fileManifestSha256) 'The retry must publish artifacts for the rebuilt payload instead of reusing stale bytes.'
        Assert-True (-not (Test-Path -LiteralPath $markerPath)) 'The committed replacement must not mix files from the prior attempt.'
        Assert-True (-not (Test-Path -LiteralPath ($artifacts + '.previous'))) 'A successful replacement must remove its local rollback directory.'

        $publisherSource = Get-Content -LiteralPath (Join-Path $projectRoot 'scripts\release\Invoke-FluxoraProductionRelease.ps1') -Raw
        Assert-True ($publisherSource.Contains('ReplaceExisting = $true')) 'Production must opt into transactional replacement after its tag and release collision checks pass.'
    }
    finally {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force
        }
    }
}

Invoke-Case 'standalone artifact signing clears the CI secret before later child processes' {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-artifact-secret-' + [Guid]::NewGuid().ToString('N'))
    $secretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64'
    $previousSecret = [Environment]::GetEnvironmentVariable($secretName, 'Process')
    $key = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
    [byte[]]$privateBytes = $null
    try {
        $artifactScript = Join-Path $projectRoot 'scripts\release\New-FluxoraUpdateArtifacts.ps1'
        $artifactSource = Get-Content -LiteralPath $artifactScript -Raw
        $clearOffset = $artifactSource.IndexOf("SetEnvironmentVariable(`$signingSecretName, `$null, 'Process')", [StringComparison]::Ordinal)
        $importOffset = $artifactSource.IndexOf('Import-Module $modulePath -Force', [StringComparison]::Ordinal)
        Assert-True ($clearOffset -ge 0 -and $clearOffset -lt $importOffset) 'Standalone artifact signing must clear the CI secret before importing repository code.'
        $payload = Join-Path $root 'payload'
        $artifacts = Join-Path $root 'artifacts'
        $publicKey = Join-Path $root 'public.der'
        New-Item -ItemType Directory -Path $payload -Force | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $payload 'Fluxora.exe'), [byte[]](1, 2, 3))
        [IO.File]::WriteAllBytes($publicKey, $key.ExportSubjectPublicKeyInfo())
        $privateBytes = $key.ExportPkcs8PrivateKey()
        [Environment]::SetEnvironmentVariable($secretName, [Convert]::ToBase64String($privateBytes), 'Process')

        & $artifactScript `
            -PayloadDirectory $payload `
            -ArtifactDirectory $artifacts `
            -Version '1.0.0' `
            -PublicKeyPath $publicKey | Out-Null

        Assert-True ([string]::IsNullOrWhiteSpace(
            [Environment]::GetEnvironmentVariable($secretName, 'Process'))) 'Standalone artifact signing must clear the process signing environment.'
        & pwsh -NoProfile -Command "if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('$secretName', 'Process'))) { exit 0 } else { exit 17 }"
        Assert-Equal $LASTEXITCODE 0 'A child started after standalone artifact signing must not inherit the CI signing secret.'
    }
    finally {
        [Environment]::SetEnvironmentVariable($secretName, $previousSecret, 'Process')
        if ($null -ne $privateBytes) {
            [Security.Cryptography.CryptographicOperations]::ZeroMemory($privateBytes)
        }
        $key.Dispose()
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
}

Invoke-Case 'native installer core is a static library and updater boundary tests are built' {
    if (-not $IsWindows) {
        Write-Host 'SKIP native static-link integration is Windows-only.'
        return
    }

    $nativeLibrary = Resolve-NativeInstallerStaticLibrary -Candidates @(
        (Join-Path $projectRoot 'build\backend\Release\FluxoraInstallerCore.lib'),
        (Join-Path $projectRoot 'build\backend\Debug\FluxoraInstallerCore.lib')
    ) -Required:$RequireNativeAbi
    if ([string]::IsNullOrWhiteSpace($nativeLibrary)) {
        Write-Host 'SKIP static installer core has not been built yet (developer standalone mode only).'
        return
    }

    Assert-True ((Get-Item -LiteralPath $nativeLibrary).Length -gt 0) 'The static installer core library must not be empty.'
    $updaterPath = @(
        (Join-Path $projectRoot 'frontend-tauri\src-tauri\target\release\FluxoraUpdater.exe'),
        (Join-Path $projectRoot 'frontend-tauri\src-tauri\target\debug\FluxoraUpdater.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($RequireNativeAbi) {
        Assert-True (-not [string]::IsNullOrWhiteSpace([string]$updaterPath)) 'Strict release mode requires the statically linked FluxoraUpdater.exe.'
    }
}

Invoke-Case 'static installer core availability skips only outside strict release mode' {
    $missing = Join-Path ([IO.Path]::GetTempPath()) ('missing-fluxora-installer-core-' + [Guid]::NewGuid().ToString('N') + '.lib')
    Assert-True ($null -eq (Resolve-NativeInstallerStaticLibrary -Candidates @($missing))) 'Developer standalone mode may skip an unavailable static native core.'
    Assert-Throws {
        Resolve-NativeInstallerStaticLibrary -Candidates @($missing) -Required
    } '*required for the statically linked native update release gate*'
}

Invoke-Case 'release preconditions fail closed' {
    Assert-Throws {
        Assert-FluxoraReleasePreconditions -Branch 'feature' -DefaultBranch 'master' -StatusLines @() -Ahead 0 -Behind 0 -ExistingTag $false -ExistingRelease $false
    } '*default branch*'
    Assert-Throws {
        Assert-FluxoraReleasePreconditions -Branch 'master' -DefaultBranch 'master' -StatusLines @(' M App.tsx') -Ahead 0 -Behind 0 -ExistingTag $false -ExistingRelease $false
    } '*clean working tree*'
    Assert-Throws {
        Assert-FluxoraReleasePreconditions -Branch 'master' -DefaultBranch 'master' -StatusLines @() -Ahead 0 -Behind 1 -ExistingTag $false -ExistingRelease $false
    } '*behind*'
    Assert-Throws {
        Assert-FluxoraReleasePreconditions -Branch 'master' -DefaultBranch 'master' -StatusLines @() -Ahead 0 -Behind 0 -ExistingTag $true -ExistingRelease $false
    } '*tag already exists*'
    Assert-Throws {
        Assert-FluxoraReleasePreconditions -Branch 'master' -DefaultBranch 'master' -StatusLines @() -Ahead 0 -Behind 0 -ExistingTag $false -ExistingRelease $true
    } '*release already exists*'

    Assert-FluxoraReleasePreconditions `
        -Branch 'master' `
        -DefaultBranch 'master' `
        -StatusLines @() `
        -Ahead 81 `
        -Behind 0 `
        -ExistingTag $false `
        -ExistingRelease $false
}

Invoke-Case 'controlled release checkpoint rejects likely secrets before commit' {
    Assert-FluxoraReleaseStagedPaths -Paths @(
        'Build.ps1',
        'scripts/release/Fluxora.Release.psm1',
        'frontend-tauri/src-tauri/src/update_service.rs'
    )
    foreach ($unsafePath in @(
        '.env',
        'certificates/release.pfx',
        'secrets/update-private.pk8',
        'frontend-tauri/id_ed25519'
    )) {
        Assert-Throws {
            Assert-FluxoraReleaseStagedPaths -Paths @('Build.ps1', $unsafePath)
        } '*sensitive path*'
    }
}

Invoke-Case 'controlled release checkpoint rejects generated artifacts' {
    Assert-FluxoraReleaseStagedPaths -Paths @(
        'scripts/build-helpers/Test-Release.ps1',
        'graphify-out/graph.json'
    )
    foreach ($generatedPath in @(
        'node_modules/.vite/vitest/results.json',
        'frontend-tauri/test-results/.last-run.json',
        'frontend-tauri/src-tauri/target/release/Fluxora.exe',
        'build/backend/Release/FluxoraCoreTests.exe',
        'output-installer/FluxoraSetup.exe',
        'output-update/0.0.2/fluxora-update-manifest.json'
    )) {
        Assert-Throws {
            Assert-FluxoraReleaseStagedPaths -Paths @('Build.ps1', $generatedPath)
        } '*generated path*'
    }

    Assert-FluxoraReleaseStagedPaths `
        -Paths @('Build.ps1', 'node_modules/.vite/vitest/results.json') `
        -DeletedPaths @('node_modules/.vite/vitest/results.json')
    Assert-Throws {
        Assert-FluxoraReleaseStagedPaths `
            -Paths @('Build.ps1') `
            -DeletedPaths @('node_modules/.vite/vitest/results.json')
    } '*not present in the staged path set*'
}

Invoke-Case 'canonical repository identity must bind fetch and push transports' {
    Assert-FluxoraCanonicalRepositoryIdentity `
        -ExpectedRepository 'Moddingflow/Fluxora' `
        -FetchRepository 'Moddingflow/Fluxora' `
        -PushRepository 'Moddingflow/Fluxora' `
        -Visibility 'PUBLIC'
    Assert-Throws {
        Assert-FluxoraCanonicalRepositoryIdentity `
            -ExpectedRepository 'Moddingflow/Fluxora' `
            -FetchRepository 'attacker/Fluxora' `
            -PushRepository 'Moddingflow/Fluxora' `
            -Visibility 'PUBLIC'
    } '*canonical repository*'
    Assert-Throws {
        Assert-FluxoraCanonicalRepositoryIdentity `
            -ExpectedRepository 'Moddingflow/Fluxora' `
            -FetchRepository 'Moddingflow/Fluxora' `
            -PushRepository 'attacker/Fluxora' `
            -Visibility 'PUBLIC'
    } '*canonical repository*'
}

Invoke-Case 'every release child command fails closed when the signing environment reappears' {
    $secretName = 'FLUXORA_UPDATE_SIGNING_KEY_PKCS8_BASE64'
    $previous = [Environment]::GetEnvironmentVariable($secretName, 'Process')
    try {
        [Environment]::SetEnvironmentVariable($secretName, 'release-test-secret', 'Process')
        Assert-Throws {
            Assert-FluxoraReleaseChildEnvironment -SecretName $secretName -ChildFilePath 'test-child.exe'
        } '*Refusing to start child process*'
        [Environment]::SetEnvironmentVariable($secretName, $null, 'Process')
        Assert-FluxoraReleaseChildEnvironment -SecretName $secretName -ChildFilePath 'test-child.exe'
    }
    finally {
        [Environment]::SetEnvironmentVariable($secretName, $previous, 'Process')
    }
}

Invoke-Case 'previous release tag is cryptographically bound to manifest version' {
    Assert-FluxoraPreviousReleaseLineage -TagName 'v1.2.3' -ManifestVersion '1.2.3'
    Assert-Throws {
        Assert-FluxoraPreviousReleaseLineage -TagName 'v1.2.3' -ManifestVersion '1.2.2'
    } '*does not match signed manifest version*'
}

Invoke-Case 'version transaction snapshots reject any later byte change' {
    $root = New-TestRepository
    try {
        $paths = @(
            'frontend-tauri\src-tauri\tauri.conf.json',
            'frontend-tauri\package.json'
        )
        $snapshots = @(Get-FluxoraFileSnapshots -ProjectRoot $root -RelativePaths $paths)
        Assert-FluxoraFileSnapshots -ProjectRoot $root -Snapshots $snapshots
        Add-Content -LiteralPath (Join-Path $root $paths[1]) -Value ' ' -NoNewline
        Assert-Throws {
            Assert-FluxoraFileSnapshots -ProjectRoot $root -Snapshots $snapshots
        } '*changed after the version transaction*'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'durable version recovery restores exact bytes after an interrupted release' {
    $root = New-TestRepository
    try {
        $paths = @(
            'frontend-tauri\src-tauri\tauri.conf.json',
            'frontend-tauri\package.json'
        )
        $journalPath = Join-Path $root '.release-state\version-recovery.json'
        $head = '0123456789abcdef0123456789abcdef01234567'
        $before = @{}
        foreach ($relativePath in $paths) {
            $before[$relativePath] = [Convert]::ToBase64String(
                [IO.File]::ReadAllBytes((Join-Path $root $relativePath)))
        }

        New-FluxoraVersionRecoveryJournal `
            -ProjectRoot $root `
            -JournalPath $journalPath `
            -RelativePaths $paths `
            -PreReleaseHead $head `
            -TargetVersion '1.2.4'
        Set-Content `
            -LiteralPath (Join-Path $root $paths[0]) `
            -Value '{"version":"9.9.9"}' `
            -Encoding utf8NoBOM
        Set-Content `
            -LiteralPath (Join-Path $root $paths[1]) `
            -Value '{"version":"9.9.9"}' `
            -Encoding utf8NoBOM

        Assert-True (Restore-FluxoraVersionRecoveryJournal `
            -ProjectRoot $root `
            -JournalPath $journalPath `
            -CurrentHead $head) 'An interrupted transaction must be recovered.'
        foreach ($relativePath in $paths) {
            $actual = [Convert]::ToBase64String(
                [IO.File]::ReadAllBytes((Join-Path $root $relativePath)))
            Assert-Equal $actual $before[$relativePath] "Recovery must restore exact bytes for '$relativePath'."
        }
        Assert-True (-not (Test-Path -LiteralPath $journalPath)) 'A successful recovery must remove its journal.'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'durable version recovery fails closed before changing any file' {
    $root = New-TestRepository
    try {
        $paths = @(
            'frontend-tauri\src-tauri\tauri.conf.json',
            'frontend-tauri\package.json'
        )
        $journalPath = Join-Path $root '.release-state\version-recovery.json'
        $head = '0123456789abcdef0123456789abcdef01234567'
        New-FluxoraVersionRecoveryJournal `
            -ProjectRoot $root `
            -JournalPath $journalPath `
            -RelativePaths $paths `
            -PreReleaseHead $head `
            -TargetVersion '1.2.4'
        foreach ($relativePath in $paths) {
            Set-Content `
                -LiteralPath (Join-Path $root $relativePath) `
                -Value '{"version":"9.9.9"}' `
                -Encoding utf8NoBOM
        }

        Assert-Throws {
            Restore-FluxoraVersionRecoveryJournal `
                -ProjectRoot $root `
                -JournalPath $journalPath `
                -CurrentHead 'ffffffffffffffffffffffffffffffffffffffff'
        } '*belongs to Git head*'
        $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json -AsHashtable
        $journal.files[1].bytesBase64 = [Convert]::ToBase64String([byte[]](0))
        ($journal | ConvertTo-Json -Depth 5 -Compress) | Set-Content -LiteralPath $journalPath -Encoding utf8NoBOM
        Assert-Throws {
            Restore-FluxoraVersionRecoveryJournal `
                -ProjectRoot $root `
                -JournalPath $journalPath `
                -CurrentHead $head
        } '*bytes failed validation*'
        foreach ($relativePath in $paths) {
            Assert-True ((Get-Content -LiteralPath (Join-Path $root $relativePath) -Raw).Contains('9.9.9')) 'Invalid recovery data must not partially restore files.'
        }
        Assert-True (Test-Path -LiteralPath $journalPath -PathType Leaf) 'Failed recovery must preserve the journal for diagnosis.'
        Remove-FluxoraVersionRecoveryJournal -JournalPath $journalPath
        Assert-True (-not (Test-Path -LiteralPath $journalPath)) 'Explicit retirement must remove a regular journal file.'
    }
    finally {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

Invoke-Case 'signed release inventory binds every downloaded package and installer byte' {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-release-inventory-' + [Guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $fullName = 'Fluxora-1.2.3-win-x64-full.flxupd'
        foreach ($asset in @{
            $fullName = [byte[]](1, 2, 3)
            'FluxoraSetup.exe' = [byte[]](4, 5, 6)
            'fluxora-update-manifest.json' = [byte[]](7)
            'fluxora-update-manifest.sig' = [byte[]](8)
        }.GetEnumerator()) {
            [IO.File]::WriteAllBytes((Join-Path $root $asset.Key), $asset.Value)
        }
        $inventoryAssets = @(
            Get-ChildItem -LiteralPath $root -File | ForEach-Object {
                [pscustomobject]@{
                    name = $_.Name
                    size = [uint64]$_.Length
                    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
                }
            }
        )
        $inventoryBytes = ConvertTo-FluxoraReleaseInventoryBytes -Version '1.2.3' -Assets $inventoryAssets
        $key = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
        try {
            $inventoryPath = Join-Path $root 'fluxora-release-inventory.json'
            $inventorySignaturePath = Join-Path $root 'fluxora-release-inventory.sig'
            $publicPath = Join-Path $root 'public.der'
            [IO.File]::WriteAllBytes($inventoryPath, $inventoryBytes)
            [IO.File]::WriteAllText(
                $inventorySignaturePath,
                (New-FluxoraDetachedSignature -ManifestBytes $inventoryBytes -SigningKey $key -KeyId 'test') + "`n",
                [Text.Encoding]::ASCII)
            [IO.File]::WriteAllBytes($publicPath, $key.ExportSubjectPublicKeyInfo())
            $inventory = Read-FluxoraSignedReleaseInventory `
                -InventoryPath $inventoryPath `
                -SignaturePath $inventorySignaturePath `
                -PublicKeyPath $publicPath
            Remove-Item -LiteralPath $publicPath -Force
            $packageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root $fullName)).Hash.ToLowerInvariant()
            $manifest = [pscustomobject]@{
                version = '1.2.3'
                assets = @([pscustomobject]@{
                    url = "https://github.com/Moddingflow/Fluxora/releases/download/v1.2.3/$fullName"
                    size = [uint64]3
                    sha256 = $packageHash
                })
            }
            $expectedNames = @($inventoryAssets.name) + @('fluxora-release-inventory.json', 'fluxora-release-inventory.sig')
            Assert-FluxoraDownloadedReleaseInventory `
                -Directory $root `
                -Inventory $inventory `
                -UpdateManifest $manifest `
                -ExpectedAssetNames $expectedNames

            [IO.File]::WriteAllBytes((Join-Path $root 'unexpected.txt'), [byte[]](1))
            Assert-Throws {
                Assert-FluxoraDownloadedReleaseInventory `
                    -Directory $root `
                    -Inventory $inventory `
                    -UpdateManifest $manifest `
                    -ExpectedAssetNames ($expectedNames + 'unexpected.txt')
            } '*does not bind the exact GitHub release asset set*'
            Remove-Item -LiteralPath (Join-Path $root 'unexpected.txt') -Force

            [IO.File]::WriteAllBytes((Join-Path $root $fullName), [byte[]](9, 9, 9))
            Assert-Throws {
                Assert-FluxoraDownloadedReleaseInventory `
                    -Directory $root `
                    -Inventory $inventory `
                    -UpdateManifest $manifest `
                    -ExpectedAssetNames $expectedNames
            } '*release inventory hash mismatch*'
        }
        finally {
            $key.Dispose()
        }
    }
    finally {
        if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
    }
}

Invoke-Case 'production publisher is parseable and publishes only after draft hash verification' {
    $scriptPath = Join-Path $projectRoot 'scripts\release\Invoke-FluxoraProductionRelease.ps1'
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
    Assert-Equal $errors.Count 0 'Production release script must parse without PowerShell errors.'
    $source = Get-Content -LiteralPath $scriptPath -Raw
    $secretClearOffset = $source.IndexOf("SetEnvironmentVariable(`$signingSecretName, `$null, 'Process')", [StringComparison]::Ordinal)
    $moduleImportOffset = $source.IndexOf('Import-Module $modulePath -Force', [StringComparison]::Ordinal)
    $signingOpenOffset = $source.IndexOf("Opening isolated signing identity after all repository gates", [StringComparison]::Ordinal)
    $versionMenuOffset = $source.IndexOf('Resolve-FluxoraProductionVersion', [StringComparison]::Ordinal)
    $recoveryOffset = $source.IndexOf('Restore-FluxoraVersionRecoveryJournal', [StringComparison]::Ordinal)
    $githubAuthOffset = $source.IndexOf('Authenticating GitHub release transport', [StringComparison]::Ordinal)
    $packageManagerBootstrapOffset = $source.IndexOf('Preparing pinned frontend package manager', [StringComparison]::Ordinal)
    $versionApplyOffset = $source.IndexOf('Applying product version', [StringComparison]::Ordinal)
    $journalCreateOffset = $source.IndexOf('New-FluxoraVersionRecoveryJournal', [StringComparison]::Ordinal)
    $dependencyRestoreOffset = $source.IndexOf('Restoring pinned frontend dependencies for release inventory', [StringComparison]::Ordinal)
    $dependencyInventoryRefreshOffset = $source.IndexOf('Refreshing deterministic dependency inventory for the release version', [StringComparison]::Ordinal)
    $buildOffset = $source.IndexOf('Building the complete local release', [StringComparison]::Ordinal)
    $updateAssetOffset = $source.IndexOf('Creating and verifying signed full/delta update assets', [StringComparison]::Ordinal)
    $inventoryOffset = $source.IndexOf('Creating signed release inventory', [StringComparison]::Ordinal)
    Assert-True ($secretClearOffset -ge 0 -and $secretClearOffset -lt $moduleImportOffset) 'The CI signing secret must be cleared before repository release code is imported.'
    Assert-True ($signingOpenOffset -gt $buildOffset) 'DPAPI or in-memory signing identity must not be opened before the release build finishes.'
    Assert-True ($recoveryOffset -ge 0 -and $recoveryOffset -lt $versionMenuOffset) 'An interrupted version transaction must be recovered before the next version menu is shown.'
    Assert-True ($versionMenuOffset -ge 0 -and $versionMenuOffset -lt $githubAuthOffset) 'Version selection and cancellation must happen before remote release prerequisites.'
    Assert-True ($packageManagerBootstrapOffset -ge 0 -and $packageManagerBootstrapOffset -lt $githubAuthOffset) 'Production must download or resolve the pinned frontend package manager before remote checks or checkpoint mutation.'
    Assert-True ($journalCreateOffset -gt $githubAuthOffset -and $journalCreateOffset -lt $versionApplyOffset) 'The durable recovery journal must be sealed before version files are edited.'
    Assert-True ($versionApplyOffset -ge 0 -and $dependencyRestoreOffset -gt $versionApplyOffset -and $dependencyInventoryRefreshOffset -gt $dependencyRestoreOffset -and $buildOffset -gt $dependencyInventoryRefreshOffset) 'Production must restore pinned frontend packages after changing version-owned inputs, then refresh deterministic dependency evidence before the full build.'
    $localBuildSection = $source.Substring($buildOffset, $signingOpenOffset - $buildOffset)
    Assert-True ($localBuildSection.Contains('-LiveOutput')) 'Production must stream the nested local build instead of buffering its output until completion.'
    Assert-True ($localBuildSection.Contains('Running the complete local Build.ps1 pipeline')) 'Production must identify the nested local build activity before its live output starts.'
    Assert-True (-not $localBuildSection.Contains('-RunTests')) 'Production must never opt into the local build test steps.'
    Assert-True ($source.Contains('$script:FluxoraReleaseStepNumber')) 'Production release steps must expose a stable sequential step number.'
    Assert-True ($source.Contains("[release {0:00} completed in {1}]")) 'Production release steps must print their completed duration.'
    Assert-True ($source.Contains("[release {0:00} failed after {1}]")) 'Production release steps must print their failed duration.'
    Assert-True ($source.Contains('Get-FluxoraFrontendPackageManagerArguments')) 'Production must preserve the package-manager bootstrap prefix for every pnpm invocation.'
    Assert-True ($source.Contains("'legal\desktop\dependency-inventory.json'")) 'The deterministic dependency inventory must belong to the recoverable version transaction.'
    Assert-True ($source.Contains("'-UpdateInventory'")) 'Production must explicitly regenerate dependency evidence for the selected release version.'
    Assert-True ($buildOffset -ge 0 -and $updateAssetOffset -gt $buildOffset) 'Production must build native artifacts before creating signed update assets.'
    Assert-True (-not $source.Contains('scripts\tests\Fluxora.Release.Tests.ps1')) 'Production must not run the PowerShell release contract suite automatically.'
    Assert-True (-not $source.Contains("Invoke-ReleaseCommand -FilePath 'ctest'")) 'Production must not run backend CTest automatically.'
    Assert-True (-not $source.Contains("'test', '--release', '--locked'")) 'Production must not run Cargo tests automatically.'
    Assert-True (-not $source.Contains("Arguments @('test')")) 'Production must not run Tauri unit or component tests automatically.'
    Assert-True (-not $source.Contains('node_modules/@playwright/test/cli.js')) 'Production must not run Playwright automatically.'
    Assert-True ($source.Contains('$unexpectedInstallerRuntime = @(')) 'Production must normalize an empty or singleton loose-runtime probe to an array before checking Count.'
    Assert-True ($inventoryOffset -gt $updateAssetOffset) 'Detached update assets must be signed before the release inventory.'
    Assert-True (-not $source.Contains('Authenticode')) 'Production must not require paid Authenticode code signing.'
    Assert-True (-not $source.Contains('signtool')) 'Production must not discover or invoke signtool.'
    Assert-True ($source.Contains('[IO.FileShare]::None')) 'Concurrent production publishers must be excluded by an OS-owned lock.'
    Assert-True ($source.Contains('Remove-FluxoraVersionRecoveryJournal')) 'A verified release commit must retire its recovery journal.'
    Assert-True (([regex]::Matches($source, 'Assert-FluxoraReleaseChildEnvironment')).Count -eq 2) 'Both production child-command helpers must fail closed if the signing environment reappears.'
    Assert-True ($source.Contains("'remote', 'get-url', '--all', 'origin'")) 'Fetch origin must be resolved and pinned through GitHub.'
    Assert-True ($source.Contains("'remote', 'get-url', '--push', '--all', 'origin'")) 'Push origin must be resolved independently and pinned through GitHub.'
    Assert-True ($source.Contains("'add', '--all', '--dry-run'")) 'Dirty production releases must preview the exact checkpoint before staging it.'
    Assert-True ($source.Contains('Assert-FluxoraReleaseStagedPaths')) 'The controlled checkpoint must reject likely secret material before commit.'
    Assert-True ($source.Contains("'--diff-filter=D'")) 'The controlled checkpoint must distinguish generated-file deletion from generated content publication.'
    Assert-True ($source.Contains('release: checkpoint current changes for')) 'Working-tree changes must use a separate checkpoint commit from version metadata.'
    Assert-True ($source.Contains("'push', '--atomic'")) 'Release commit and tag must be pushed atomically.'
    Assert-True ($source.Contains("'--draft'")) 'GitHub release must begin as a draft.'
    Assert-True ($source.Contains('Downloading and hash-verifying draft release assets')) 'Uploaded assets must be downloaded and hash-verified before publication.'
    Assert-True ($source.Contains('Read-FluxoraSignedReleaseInventory')) 'Draft package and installer bytes must be bound by a signed release inventory.'
    Assert-True ($source.Contains('Assert-FluxoraDownloadedReleaseInventory')) 'Downloaded draft assets must be checked against the signed inventory.'
    Assert-True ($source.Contains('Assert-FluxoraFileSnapshots')) 'Version files must remain byte-identical after the version transaction is sealed.'
    Assert-True ($source.Contains("'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'")) 'Committed tree paths must be reverified before tagging and push.'
    Assert-True ($source.Contains("'commit', '--no-verify'")) 'Repository hooks must not mutate the release index during commit.'
    Assert-True (-not $source.Contains("'dotnet'")) 'Production release must not depend on dotnet after the native migration.'
    Assert-True (-not $source.Contains('Fluxora.Updater.Tests')) 'Production release must not route validation through removed C# updater tests.'
    Assert-True ($source.Contains("'--draft=false'")) 'Only the verified draft may be published.'
    Assert-True (-not $source.Contains('--clobber')) 'Production release must never overwrite an existing asset.'
    Assert-True (-not $source.Contains('--force')) 'Production release must never force-push or force-rewrite a release.'

    $buildSource = Get-Content -LiteralPath (Join-Path $projectRoot 'Build.ps1') -Raw
    Assert-True ($buildSource.Contains('[switch]$RunTests')) 'Local build tests must require the explicit -RunTests switch.'
    Assert-True ($buildSource.Contains('$backendTestsOption = if ($RunTests)')) 'The backend test target build must follow the explicit -RunTests switch.'
    Assert-True ($buildSource.Contains('"-DBUILD_TESTING=$backendTestsOption"')) 'The conventional CMake test switch must follow -RunTests so dependency tests cannot leak from the cache.'
    Assert-True ($buildSource.Contains('"-DFLUXORA_BUILD_TESTS=$backendTestsOption"')) 'CMake must receive an explicit test-target build policy so cached test settings cannot leak into publication builds.'
    Assert-True ($buildSource.Contains("'-DZLIB_BUILD_EXAMPLES=OFF'")) 'Publication builds must not compile or register zlib example-test binaries.'
    Assert-Equal ([regex]::Matches($buildSource, 'if \(\$RunTests -and \$Runtime -like ''win-\*''\)')).Count 2 'Both build-coupled test steps must be guarded by the manual -RunTests switch.'

    $buildTokens = $null
    $buildErrors = $null
    $buildAst = [Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $projectRoot 'Build.ps1'),
        [ref]$buildTokens,
        [ref]$buildErrors)
    Assert-Equal $buildErrors.Count 0 'Build.ps1 must remain parseable while enforcing manual tests.'
    $testCommandLiterals = @($buildAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.StringConstantExpressionAst] -and
            $node.Value -ceq 'test'
    }, $true))
    Assert-Equal $testCommandLiterals.Count 3 'Build.ps1 must expose exactly the updater, Setup and native AI Cargo tests as manual build-coupled checks.'
    foreach ($testCommandLiteral in $testCommandLiterals) {
        $ancestor = $testCommandLiteral.Parent
        $guardedByRunTests = $false
        while ($null -ne $ancestor) {
            if ($ancestor -is [Management.Automation.Language.IfStatementAst] -and
                $ancestor.Extent.Text.Contains('$RunTests')) {
                $guardedByRunTests = $true
                break
            }
            $ancestor = $ancestor.Parent
        }
        Assert-True $guardedByRunTests "Cargo test command at line $($testCommandLiteral.Extent.StartLineNumber) must be guarded by -RunTests."
    }
}

Invoke-Case 'production release progress streams child output and reports timed step state' {
    $scriptPath = Join-Path $projectRoot 'scripts\release\Invoke-FluxoraProductionRelease.ps1'
    $tokens = $null
    $errors = $null
    $scriptAst = [Management.Automation.Language.Parser]::ParseFile(
        $scriptPath,
        [ref]$tokens,
        [ref]$errors)
    Assert-Equal $errors.Count 0 'Production release progress helpers must be parseable before their focused behavior test.'

    $commandFunction = $scriptAst.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -ceq 'Invoke-ReleaseCommand'
    }, $true)
    $stepFunction = $scriptAst.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -ceq 'Invoke-ReleaseStep'
    }, $true)
    Assert-True ($null -ne $commandFunction) 'The production release command helper must remain discoverable.'
    Assert-True ($null -ne $stepFunction) 'The production release step helper must remain discoverable.'
    Invoke-Expression $commandFunction.Extent.Text
    Invoke-Expression $stepFunction.Extent.Text

    $progressSecretName = 'FLUXORA_RELEASE_PROGRESS_TEST_SECRET'
    $previousProgressSecret = [Environment]::GetEnvironmentVariable($progressSecretName, 'Process')
    try {
        [Environment]::SetEnvironmentVariable($progressSecretName, $null, 'Process')
        $signingSecretName = $progressSecretName

        $visibleCommandOutput = @(
            & {
                [void](Invoke-ReleaseCommand `
                    -FilePath 'pwsh' `
                    -Arguments @(
                        '-NoProfile',
                        '-NonInteractive',
                        '-Command',
                        "Write-Output 'live-child-marker'") `
                    -LiveOutput `
                    -Activity 'Synthetic live release command')
            } 6>&1 | ForEach-Object { $_.ToString() }
        )
        $visibleCommandText = $visibleCommandOutput -join "`n"
        Assert-True ($visibleCommandText.Contains('Synthetic live release command; live output follows')) 'A long release command must identify its current activity before launching.'
        Assert-True ($visibleCommandText.Contains('live-child-marker')) 'A long release command must expose child output while its caller discards the returned capture.'
        Assert-True ($visibleCommandText.Contains('Synthetic live release command completed in')) 'A long release command must report its elapsed completion time.'

        Assert-Throws {
            [void](Invoke-ReleaseCommand `
                -FilePath 'pwsh' `
                -Arguments @(
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    "Write-Output 'retained-failure-marker'; exit 9"))
        } '*retained-failure-marker*'

        $script:FluxoraReleaseStepNumber = 0
        $visibleStepOutput = @(
            & {
                [void](Invoke-ReleaseStep 'Synthetic timed release step' {
                    Write-Output 'step-body-marker'
                })
            } 6>&1 | ForEach-Object { $_.ToString() }
        )
        $visibleStepText = $visibleStepOutput -join "`n"
        Assert-True ($visibleStepText.Contains('[release 01 |')) 'A release step must expose its sequential number and start time.'
        Assert-True ($visibleStepText.Contains('[release 01 completed in')) 'A successful release step must expose its elapsed time.'

        $failedStepOutput = @(
            & {
                try {
                    [void](Invoke-ReleaseStep 'Synthetic failed release step' {
                        throw 'synthetic release step failure'
                    })
                }
                catch {
                    Write-Output 'expected-step-failure'
                }
            } 6>&1 | ForEach-Object { $_.ToString() }
        )
        Assert-True (($failedStepOutput -join "`n").Contains('[release 02 failed after')) 'A failed release step must expose its elapsed time before preserving the error.'
    }
    finally {
        [Environment]::SetEnvironmentVariable($progressSecretName, $previousProgressSecret, 'Process')
    }
}

Invoke-Case 'local build progress reports numbered timed step state' {
    $buildPath = Join-Path $projectRoot 'Build.ps1'
    $tokens = $null
    $errors = $null
    $buildAst = [Management.Automation.Language.Parser]::ParseFile(
        $buildPath,
        [ref]$tokens,
        [ref]$errors)
    Assert-Equal $errors.Count 0 'Build.ps1 progress helpers must be parseable before their focused behavior test.'
    $stepFunction = $buildAst.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -ceq 'Invoke-BuildStep'
    }, $true)
    Assert-True ($null -ne $stepFunction) 'The local build step helper must remain discoverable.'
    Invoke-Expression $stepFunction.Extent.Text

    $script:FluxoraBuildStepNumber = 0
    $visibleStepOutput = @(
        & {
            [void](Invoke-BuildStep 'Synthetic local build step' {
                Write-Output 'local-step-body-marker'
            })
        } 6>&1 | ForEach-Object { $_.ToString() }
    )
    $visibleStepText = $visibleStepOutput -join "`n"
    Assert-True ($visibleStepText.Contains('[build 01 |')) 'A local build step must expose its sequential number and start time.'
    Assert-True ($visibleStepText.Contains('[build 01 completed in')) 'A successful local build step must expose its elapsed time.'

    $failedStepOutput = @(
        & {
            try {
                [void](Invoke-BuildStep 'Synthetic failed local build step' {
                    throw 'synthetic local build step failure'
                })
            }
            catch {
                Write-Output 'expected-local-step-failure'
            }
        } 6>&1 | ForEach-Object { $_.ToString() }
    )
    Assert-True (($failedStepOutput -join "`n").Contains('[build 02 failed after')) 'A failed local build step must expose its elapsed time before preserving the error.'
}

Invoke-Case 'Build.ps1 exposes safe local and production entry modes' {
    $buildPath = Join-Path $projectRoot 'Build.ps1'
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($buildPath, [ref]$tokens, [ref]$errors)
    Assert-Equal $errors.Count 0 'Build.ps1 must parse after adding release modes.'
    $source = Get-Content -LiteralPath $buildPath -Raw
    $secretClearOffset = $source.IndexOf("SetEnvironmentVariable(`$BuildSigningSecretName, `$null, 'Process')", [StringComparison]::Ordinal)
    $moduleImportOffset = $source.IndexOf('Import-Module $ReleaseModulePath -Force', [StringComparison]::Ordinal)
    Assert-True ($secretClearOffset -ge 0 -and $secretClearOffset -lt $moduleImportOffset) 'Build.ps1 must clear the CI signing environment before importing repository release code.'
    Assert-True ($source.Contains("[ValidateSet('Local', 'Production')]")) 'Build.ps1 must expose only Local and Production modes.'
    Assert-True ($source.Contains('Resolve-FluxoraBuildMode')) 'No-argument builds must use the exact 1/2 mode resolver.'
    Assert-True ($source.Contains('Invoke-FluxoraProductionRelease.ps1')) 'Production mode must delegate to the guarded release transaction.'
    Assert-True ($source.Contains("[Alias('ProductionVersion')]")) 'The public -Version parameter must retain the previous production-only alias.'
    Assert-True ($source.Contains('Set-FluxoraProductVersion -ProjectRoot $ProjectRoot -Version $Version')) 'A local -Version argument must update every owned product-version source before building.'
    Assert-True ($source.Contains("`$releaseArguments['Version'] = `$Version")) 'Production mode must forward the same public -Version argument.'
    Assert-True ($source.Contains('Build mode: Local (product version: $FluxoraProductVersion).')) 'Local builds must report the exact product version embedded in the artifacts.'
    $publisherSource = Get-Content -LiteralPath (Join-Path $projectRoot 'scripts\release\Invoke-FluxoraProductionRelease.ps1') -Raw
    Assert-True ($publisherSource.Contains("'-Mode', 'Local'")) 'The production transaction must re-enter a non-publishing local build.'
    Assert-True ($source.Contains("`$releaseArguments['SigningKeyPkcs8Bytes']")) 'Build.ps1 must pass only an in-memory signing key buffer to Production.'
    Assert-True (-not $source.Contains('AuthenticodeCertificateThumbprint')) 'Build.ps1 must not expose paid Authenticode certificate inputs.'
    Assert-True (-not $source.Contains('Invoke-FluxoraAuthenticodeSign')) 'Build.ps1 must not sign Fluxora executables through Authenticode.'
    Assert-True (-not $source.Contains('signtool')) 'Build.ps1 must not discover signtool.'
}

Invoke-Case 'Build.ps1 hands an interactive Production choice from Windows PowerShell to pwsh' {
    $windowsPowerShell = Get-Command 'powershell.exe' -CommandType Application -ErrorAction SilentlyContinue
    Assert-True ($null -ne $windowsPowerShell) 'The Windows release bootstrap test requires Windows PowerShell.'

    $shimRoot = Join-Path ([IO.Path]::GetTempPath()) ('fluxora-pwsh-shim-' + [Guid]::NewGuid().ToString('N'))
    $capturePath = Join-Path $shimRoot 'arguments.txt'
    $pwshShimPath = Join-Path $shimRoot 'pwsh.cmd'
    $previousPath = $env:PATH
    $previousCapturePath = $env:FLUXORA_BUILD_REENTRY_CAPTURE
    try {
        New-Item -ItemType Directory -Path $shimRoot -Force | Out-Null
        $env:PATH = $shimRoot
        $missingPwshOutput = @(
            '2' | & $windowsPowerShell.Source -NoLogo -NoProfile -File (Join-Path $projectRoot 'Build.ps1') 2>&1
        )
        Assert-True ($LASTEXITCODE -ne 0) 'A missing pwsh executable must fail the Windows PowerShell bootstrap.'
        Assert-True (
            (($missingPwshOutput | ForEach-Object { $_.ToString() }) -join "`n").Contains('PowerShell 7 (pwsh) was not found on PATH.')
        ) 'A missing pwsh executable must produce an actionable error instead of an indexing failure.'

        @'
@echo off
> "%FLUXORA_BUILD_REENTRY_CAPTURE%" echo %*
exit /b 0
'@ | Set-Content -LiteralPath $pwshShimPath -Encoding ascii
        $env:FLUXORA_BUILD_REENTRY_CAPTURE = $capturePath
        $env:PATH = "$shimRoot;$previousPath"

        '2' | & $windowsPowerShell.Source -NoLogo -NoProfile -File (Join-Path $projectRoot 'Build.ps1')
        Assert-Equal $LASTEXITCODE 0 'The Windows PowerShell bootstrap must return the successful pwsh exit code.'
        Assert-True (Test-Path -LiteralPath $capturePath -PathType Leaf) 'Production choice 2 must invoke pwsh instead of failing in Windows PowerShell.'
        $capturedArguments = Get-Content -LiteralPath $capturePath -Raw
        Assert-True ($capturedArguments.Contains('-NoLogo -NoProfile -File')) 'The pwsh handoff must use a deterministic profile-free file invocation.'
        Assert-True ($capturedArguments.Contains('-Mode Production')) 'The resolved interactive mode must be forwarded explicitly to avoid a second build-mode prompt.'
        Assert-True ($capturedArguments.Contains('-Configuration Release -Runtime win-x64 -Target Release')) 'The effective release build contract must survive the pwsh handoff.'
    }
    finally {
        $env:PATH = $previousPath
        if ($null -eq $previousCapturePath) {
            Remove-Item -LiteralPath 'Env:FLUXORA_BUILD_REENTRY_CAPTURE' -ErrorAction SilentlyContinue
        }
        else {
            $env:FLUXORA_BUILD_REENTRY_CAPTURE = $previousCapturePath
        }
        if (Test-Path -LiteralPath $shimRoot) {
            Remove-Item -LiteralPath $shimRoot -Recurse -Force
        }
    }
}

Invoke-Case 'Build.ps1 builds native Tauri Setup and a statically linked updater' {
    $source = Get-Content -LiteralPath (Join-Path $projectRoot 'Build.ps1') -Raw
    $package = Get-Content -LiteralPath (Join-Path $projectRoot 'frontend-tauri\package.json') -Raw | ConvertFrom-Json
    $tauriConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'frontend-tauri\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $cargoManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'frontend-tauri\src-tauri\Cargo.toml') -Raw
    Assert-True ($source.Contains("'--bin', 'FluxoraUpdater'")) 'Build must compile the dedicated native Tauri updater target.'
    $updaterStepOffset = $source.IndexOf('Building native Tauri updater', [StringComparison]::Ordinal)
    $updaterLibclangOffset = $source.IndexOf(
        "& (Join-Path `$TauriProject 'scripts\ensure-libclang.ps1')",
        $updaterStepOffset,
        [StringComparison]::Ordinal)
    $updaterCargoOffset = $source.IndexOf(
        "`$updaterCargoArguments = @(",
        $updaterStepOffset,
        [StringComparison]::Ordinal)
    Assert-True (
        $updaterStepOffset -ge 0 -and
        $updaterLibclangOffset -gt $updaterStepOffset -and
        $updaterCargoOffset -gt $updaterLibclangOffset
    ) 'Build must expose pinned libclang in-process before compiling the isolated updater target.'
    Assert-True ($source.Contains("'--bin', 'FluxoraSetup'")) 'Build must compile the dedicated native Tauri Setup target after creating the payload.'
    Assert-True ($cargoManifest.Contains('custom-protocol = ["tauri/custom-protocol"]')) 'Tauri release targets must expose the embedded-asset custom protocol feature.'
    Assert-True (
        $cargoManifest -match '(?ms)\[\[bin\]\]\s*name\s*=\s*"FluxoraSetup".*?required-features\s*=\s*\["installer-native"\]'
    ) 'The main Tauri build must skip the specialized Setup target unless the native installer feature is explicit.'
    Assert-True (
        $cargoManifest -match '(?ms)\[\[bin\]\]\s*name\s*=\s*"FluxoraUpdater".*?required-features\s*=\s*\["installer-native"\]'
    ) 'The main Tauri build must skip the specialized Updater target unless the native installer feature is explicit.'
    Assert-True ($source.Contains("'--features', 'installer-native,custom-protocol'")) 'The packaged updater must embed its renderer instead of loading the desktop localhost URL.'
    Assert-True ($source.Contains("'setup-production-assets,installer-native,custom-protocol'")) 'Production Setup must embed its payload, renderer, and statically linked installer core.'
    Assert-True (
        $source.Contains('$updaterReleaseContractArguments = @(') -and
        $source.Contains("Invoke-CheckedCommand -FilePath 'cargo' -Arguments `$updaterReleaseContractArguments")
    ) 'Updater release-contract tests must run while the updater renderer output still exists.'
    $setupReleaseContractStart = $source.IndexOf('$setupReleaseContractArguments = @(', [StringComparison]::Ordinal)
    $setupReleaseContractEnd = $source.IndexOf(
        "Invoke-CheckedCommand -FilePath 'cargo' -Arguments `$setupReleaseContractArguments",
        $setupReleaseContractStart,
        [StringComparison]::Ordinal)
    Assert-True (
        $setupReleaseContractStart -ge 0 -and
        $setupReleaseContractEnd -gt $setupReleaseContractStart -and
        -not $source.Substring(
            $setupReleaseContractStart,
            $setupReleaseContractEnd - $setupReleaseContractStart
        ).Contains("'--bin', 'FluxoraUpdater'")
    ) 'Setup release-contract tests must not recompile the updater after the main Vite build removes dist/updater.'
    $setupSource = Get-Content -LiteralPath (Join-Path $projectRoot 'frontend-tauri\src-tauri\src\bin\fluxora_setup.rs') -Raw
    $setupBuildSource = Get-Content -LiteralPath (Join-Path $projectRoot 'frontend-tauri\src-tauri\build.rs') -Raw
    Assert-True (-not $setupSource.Contains('include_bytes!(env!("FLUXORA_SETUP_PAYLOAD_PATH"))')) 'The large Setup payload must not pass through LLVM include_bytes.'
    Assert-True (
        $setupBuildSource.Contains('embed_resource::compile_for') -and
        $setupBuildSource.Contains('WINDOWS_RCDATA_RESOURCE_TYPE')
    ) 'Production Setup must link its payload as a binary-specific Windows RCDATA resource.'
    Assert-True ($source.Contains('FluxoraInstallerCore.lib')) 'Build must consume the MSVC static installer core.'
    Assert-True ($source.Contains("resources\native\FluxoraUpdater.exe")) 'Tauri payload must contain the external updater runtime.'
    Assert-True (-not $source.Contains('FluxoraInstallerCore.dll')) 'No installer-core DLL may be shipped or required.'
    Assert-True (-not $source.Contains('dotnet')) 'Build must not depend on the .NET SDK or runtime.'
    Assert-True (-not $source.Contains('Fluxora.Updater.csproj')) 'Build must not reference the removed C# updater.'
    Assert-True (-not $source.Contains('Fluxora.Installer.csproj')) 'Build must not reference the removed WPF Setup.'
    Assert-True ($source.Contains('Assert-FluxoraWebView2Bootstrapper')) 'Build must verify the pinned Microsoft bootstrapper before embedding it.'
    Assert-True ($source.Contains('"Verifying desktop legal, dependency, and icon compliance"')) 'Build must fail before payload creation when desktop legal, dependency, or icon compliance drifts.'
    Assert-True ($source.Contains("'-Release'")) 'The packaging build must require exact release dependency evidence.'
    Assert-True ($source.Contains("'-CMakeEvidencePath', `$CMakeDependencyEvidencePath")) 'The compliance gate must validate the exact dependency resolution emitted by CMake.'
    Assert-True ($source.Contains('Assert-FluxoraNativePayload -Root $OutputDir')) 'Build must reject CLR or legacy WPF/C# files in the assembled Windows payload.'
    Assert-True (
        $source.Contains('Assert-FluxoraNativePeImage') -and
        $source.Contains('-Path $setupExePath')
    ) 'Build must verify that the sole Setup artifact is a native non-.NET PE.'
    Assert-True ($source.Contains('Fluxora.NativeArtifactValidation.psm1')) 'Build must load the shared native-artifact validator.'
    Assert-True (([regex]::Matches($source, '-RequireStaticMsvcRuntime')).Count -ge 2) 'Build must enforce a static MSVC runtime for the self-contained Setup and Updater executables.'
    Assert-True (-not $source.Contains('Invoke-FluxoraAuthenticodeSign')) 'The build must not require unavailable paid executable signing.'
    Assert-True (-not $source.Contains('signtool')) 'The native build path must not probe signtool.'
    Assert-Equal ([string]$package.scripts.build) 'npm run typecheck && npm run stage:native && tauri build --no-bundle -- --locked' 'The exact packaged Tauri binary must enforce Cargo.lock and refuse secondary Tauri installers.'
    Assert-True (-not [bool]$tauriConfig.bundle.active) 'Normal Tauri builds must output only the executable; FluxoraSetup.exe is the sole approved installer.'
    Assert-True (@($tauriConfig.plugins.'deep-link'.desktop.schemes) -contains 'moddingflow') 'No-bundle builds must retain the neutral ModdingFlow runtime scheme.'
    Assert-True (@($tauriConfig.plugins.'deep-link'.desktop.schemes) -contains 'fluxora') 'No-bundle builds must retain the read-only legacy Fluxora runtime scheme.'
}

Invoke-Case 'native artifact gate rejects dotnet apphosts and managed runtime sidecars' {
    $validatorPath = Join-Path $projectRoot 'scripts\release\Fluxora.NativeArtifactValidation.psm1'
    $validatorSource = Get-Content -LiteralPath $validatorPath -Raw
    Assert-True ($validatorSource.Contains('DotNetAppHostBundleSignature')) 'The native gate must inspect the official .NET apphost bundle signature.'
    Assert-True ($validatorSource.Contains('(?:coreclr|hostfxr|hostpolicy)')) 'The native gate must reject managed host imports.'
    Assert-True ($validatorSource.Contains('(?:msvcp140|vcruntime140|concrt140)')) 'The native gate must reject dynamically linked MSVC C++ runtimes.'
    Assert-True ($validatorSource.Contains('(?:deps|runtimeconfig)')) 'The native payload gate must reject .NET runtime sidecars.'
    Assert-True ($validatorSource.Contains('FluxoraInstallerCore|FluxoraUpdaterProcessProbe')) 'The native payload gate must reject legacy installer DLL and ProcessProbe names.'
    Assert-True ($validatorSource.Contains('MachineType')) 'The native gate must validate the PE target architecture.'

    $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "fluxora-native-artifact-$([Guid]::NewGuid().ToString('N'))"
    $nativeSource = Join-Path $projectRoot 'third_party\webview2\MicrosoftEdgeWebview2Setup.exe'
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    try {
        Assert-Throws {
            Assert-FluxoraNativePeImage -Path $nativeSource
        } '*machine type*is forbidden*'
        Assert-FluxoraNativePeImage -Path $nativeSource -AllowedMachineTypes @([uint16]0x014c)

        $appHostFixture = Join-Path $fixtureRoot 'synthetic-dotnet-apphost.exe'
        Copy-Item -LiteralPath $nativeSource -Destination $appHostFixture
        [byte[]]$bundleSignature = @(
            0x8b, 0x12, 0x02, 0xb9, 0x6a, 0x61, 0x20, 0x38,
            0x72, 0x7b, 0x93, 0x02, 0x14, 0xd7, 0xa0, 0x32,
            0x13, 0xf5, 0xb9, 0xe6, 0xef, 0xae, 0x33, 0x18,
            0xee, 0x3b, 0x2d, 0xce, 0x24, 0xb3, 0x6a, 0xae
        )
        $appendStream = [IO.File]::Open(
            $appHostFixture,
            [IO.FileMode]::Append,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None)
        try {
            $appendStream.Write($bundleSignature, 0, $bundleSignature.Length)
        }
        finally {
            $appendStream.Dispose()
        }
        Assert-Throws {
            Assert-FluxoraNativePeImage -Path $appHostFixture -AllowedMachineTypes @([uint16]0x014c)
        } '*apphost or single-file bundle markers are forbidden*'

        $importFixture = Join-Path $fixtureRoot 'synthetic-hostfxr-import.exe'
        Copy-Item -LiteralPath $nativeSource -Destination $importFixture
        $importBytes = [IO.File]::ReadAllBytes($importFixture)
        $kernelImport = [Text.Encoding]::ASCII.GetBytes('KERNEL32.dll')
        $hostFxrImport = [Text.Encoding]::ASCII.GetBytes('hostfxr.dll')
        $importOffset = -1
        for ($candidate = 0; $candidate -le $importBytes.Length - $kernelImport.Length; $candidate++) {
            $matches = $true
            for ($index = 0; $index -lt $kernelImport.Length; $index++) {
                if ($importBytes[$candidate + $index] -ne $kernelImport[$index]) {
                    $matches = $false
                    break
                }
            }
            if ($matches) {
                $importOffset = $candidate
                break
            }
        }
        Assert-True ($importOffset -ge 0) 'The executable import fixture must expose a KERNEL32.dll name to patch.'
        [Array]::Copy($hostFxrImport, 0, $importBytes, $importOffset, $hostFxrImport.Length)
        $importBytes[$importOffset + $hostFxrImport.Length] = 0
        [IO.File]::WriteAllBytes($importFixture, $importBytes)
        Assert-Throws {
            Assert-FluxoraNativePeImage -Path $importFixture -AllowedMachineTypes @([uint16]0x014c)
        } '*Forbidden managed-host import*'

        $dynamicCrtFixture = Join-Path $fixtureRoot 'synthetic-dynamic-crt-import.exe'
        Copy-Item -LiteralPath $nativeSource -Destination $dynamicCrtFixture
        $dynamicCrtBytes = [IO.File]::ReadAllBytes($dynamicCrtFixture)
        $msvcpImport = [Text.Encoding]::ASCII.GetBytes('MSVCP140.dll')
        $dynamicCrtOffset = -1
        for ($candidate = 0; $candidate -le $dynamicCrtBytes.Length - $kernelImport.Length; $candidate++) {
            $matches = $true
            for ($index = 0; $index -lt $kernelImport.Length; $index++) {
                if ($dynamicCrtBytes[$candidate + $index] -ne $kernelImport[$index]) {
                    $matches = $false
                    break
                }
            }
            if ($matches) {
                $dynamicCrtOffset = $candidate
                break
            }
        }
        Assert-True ($dynamicCrtOffset -ge 0) 'The dynamic CRT fixture must expose a KERNEL32.dll name to patch.'
        [Array]::Copy($msvcpImport, 0, $dynamicCrtBytes, $dynamicCrtOffset, $msvcpImport.Length)
        [IO.File]::WriteAllBytes($dynamicCrtFixture, $dynamicCrtBytes)
        Assert-FluxoraNativePeImage `
            -Path $dynamicCrtFixture `
            -AllowedMachineTypes @([uint16]0x014c)
        Assert-Throws {
            Assert-FluxoraNativePeImage `
                -Path $dynamicCrtFixture `
                -AllowedMachineTypes @([uint16]0x014c) `
                -RequireStaticMsvcRuntime
        } '*Dynamic MSVC runtime import is forbidden*'

        $legacyPayloadRoot = Join-Path $fixtureRoot 'legacy-payload'
        New-Item -ItemType Directory -Path $legacyPayloadRoot | Out-Null
        Copy-Item -LiteralPath $nativeSource -Destination (Join-Path $legacyPayloadRoot 'FluxoraInstallerCore.dll')
        Copy-Item -LiteralPath $nativeSource -Destination (Join-Path $legacyPayloadRoot 'FluxoraUpdaterProcessProbe.exe')
        Assert-Throws {
            Assert-FluxoraNativePayload -Root $legacyPayloadRoot
        } '*Legacy installer/update payload files are forbidden*'

        $managedPayloadRoot = Join-Path $fixtureRoot 'managed-payload'
        New-Item -ItemType Directory -Path $managedPayloadRoot | Out-Null
        Set-Content -LiteralPath (Join-Path $managedPayloadRoot 'FluxoraUpdater.runtimeconfig.json') -Value '{}' -NoNewline
        Assert-Throws {
            Assert-FluxoraNativePayload -Root $managedPayloadRoot
        } '*Managed runtime files are forbidden*'
    }
    finally {
        if (Test-Path -LiteralPath $fixtureRoot) {
            Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
        }
    }
}

Invoke-Case 'signing-key backup command wrappers accept only in-memory SecureString passwords' {
    $exportPath = Join-Path $projectRoot 'scripts\release\Export-FluxoraUpdateSigningKeyBackup.ps1'
    $restorePath = Join-Path $projectRoot 'scripts\release\Restore-FluxoraUpdateSigningKeyBackup.ps1'
    foreach ($scriptPath in @($exportPath, $restorePath)) {
        $tokens = $null
        $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
        Assert-Equal $errors.Count 0 "Backup command '$scriptPath' must parse."
        $source = Get-Content -LiteralPath $scriptPath -Raw
        Assert-True ($source.Contains('[Security.SecureString] $Password')) 'Backup commands must expose only SecureString password parameters.'
        Assert-True ($source.Contains('-AsSecureString')) 'Backup commands must prompt without producing a plaintext managed password.'
        Assert-True (-not $source.Contains('ConvertFrom-SecureString')) 'Backup commands must not serialize password material.'
        Assert-True (-not $source.Contains('SetEnvironmentVariable')) 'Backup commands must not put passwords into child-process environments.'
        Assert-True (-not $source.Contains('[string] $Password')) 'Backup commands must never accept a plaintext password parameter.'
        Assert-True (-not $source.Contains('[switch] $Force')) 'Backup commands must never expose destructive overwrite mode.'
    }
    $exportSource = Get-Content -LiteralPath $exportPath -Raw
    $restoreSource = Get-Content -LiteralPath $restorePath -Raw
    $moduleSource = Get-Content -LiteralPath $modulePath -Raw
    Assert-True ($exportSource.Contains('Export-FluxoraUpdateSigningKeyBackup')) 'Export wrapper must delegate to the reviewed module boundary.'
    Assert-True ($restoreSource.Contains('Restore-FluxoraUpdateSigningKeyBackup')) 'Restore wrapper must delegate to the reviewed module boundary.'
    Assert-True ($moduleSource.Contains('(Split-Path -Parent (Split-Path -Parent $PSScriptRoot))')) 'The module must derive its own repository boundary instead of trusting caller input.'
    Assert-True ($moduleSource.Contains('backups must be stored outside the repository')) 'Export must reject backups inside the derived repository boundary.'
    Assert-True ($moduleSource.Contains('backups must be restored from outside the repository')) 'Restore must reject backups inside the derived repository boundary.'
}

Write-Host ""
Write-Host "Release contract tests: $script:passed passed, $script:failed failed."
if ($script:failed -ne 0) {
    exit 1
}
