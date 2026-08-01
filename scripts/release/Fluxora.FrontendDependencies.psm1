Set-StrictMode -Version Latest

function Get-FluxoraApplicationCommand {
    param([Parameter(Mandatory = $true)][string] $Name)

    return @(
        Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
    )
}

function Get-FluxoraApplicationVersion {
    param([Parameter(Mandatory = $true)][string] $FilePath)

    try {
        $output = @(& $FilePath --version 2>$null)
        $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        if ($exitCode -ne 0) {
            return $null
        }
        return (($output | ForEach-Object { $_.ToString() }) -join '').Trim()
    }
    catch {
        return $null
    }
}

function Get-FluxoraPinnedPnpmVersion {
    param([Parameter(Mandatory = $true)][string] $FrontendRoot)

    $manifestPath = Join-Path $FrontendRoot 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Frontend package manifest was not found at '$manifestPath'."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $packageManagerProperty = $manifest.PSObject.Properties['packageManager']
    $packageManager = if ($null -eq $packageManagerProperty) {
        ''
    }
    else {
        [string]$packageManagerProperty.Value
    }
    $match = [regex]::Match($packageManager, '^pnpm@(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$')
    if (-not $match.Success) {
        throw "Frontend package.json must pin pnpm as an exact version such as 'pnpm@11.9.0'."
    }
    return [string]$match.Groups['version'].Value
}

function Resolve-FluxoraFrontendPackageManager {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $FrontendRoot)

    if (-not (Test-Path -LiteralPath $FrontendRoot -PathType Container)) {
        throw "Frontend root was not found at '$FrontendRoot'."
    }

    $pnpmLockPath = Join-Path $FrontendRoot 'pnpm-lock.yaml'
    if (Test-Path -LiteralPath $pnpmLockPath -PathType Leaf) {
        $pinnedVersion = Get-FluxoraPinnedPnpmVersion -FrontendRoot $FrontendRoot
        $corepack = @(Get-FluxoraApplicationCommand -Name 'corepack')
        if ($corepack.Count -ne 0) {
            return [pscustomobject][ordered]@{
                Name = 'pnpm'
                Provider = 'corepack'
                FilePath = [string]$corepack[0].Source
                ArgumentPrefix = [string[]]@('pnpm')
                Version = $pinnedVersion
            }
        }

        $pnpm = @(Get-FluxoraApplicationCommand -Name 'pnpm')
        if ($pnpm.Count -ne 0) {
            $globalPnpmVersion = Get-FluxoraApplicationVersion -FilePath ([string]$pnpm[0].Source)
            if ([string]::Equals($globalPnpmVersion, $pinnedVersion, [StringComparison]::Ordinal)) {
                return [pscustomobject][ordered]@{
                    Name = 'pnpm'
                    Provider = 'pnpm'
                    FilePath = [string]$pnpm[0].Source
                    ArgumentPrefix = [string[]]@()
                    Version = $pinnedVersion
                }
            }
        }

        $npm = @(Get-FluxoraApplicationCommand -Name 'npm')
        if ($npm.Count -ne 0) {
            return [pscustomobject][ordered]@{
                Name = 'pnpm'
                Provider = 'npm-exec'
                FilePath = [string]$npm[0].Source
                ArgumentPrefix = [string[]]@(
                    'exec',
                    '--yes',
                    "--package=pnpm@$pinnedVersion",
                    '--',
                    'pnpm'
                )
                Version = $pinnedVersion
            }
        }

        if ($pnpm.Count -ne 0) {
            throw "The pnpm lockfile requires pnpm $pinnedVersion, global pnpm is '$globalPnpmVersion', and npm is unavailable for the exact-version fallback."
        }
        throw "The pnpm lockfile requires pnpm $pinnedVersion, but Corepack, pnpm, and npm are unavailable. Install Node.js with npm and retry."
    }

    $packageLockPath = Join-Path $FrontendRoot 'package-lock.json'
    if (Test-Path -LiteralPath $packageLockPath -PathType Leaf) {
        $npm = @(Get-FluxoraApplicationCommand -Name 'npm')
        if ($npm.Count -eq 0) {
            throw 'The npm lockfile requires npm, but npm is unavailable. Install Node.js with npm and retry.'
        }
        return [pscustomobject][ordered]@{
            Name = 'npm'
            Provider = 'npm'
            FilePath = [string]$npm[0].Source
            ArgumentPrefix = [string[]]@()
            Version = $null
        }
    }

    throw "No supported frontend lockfile was found under '$FrontendRoot'."
}

function Get-FluxoraFrontendPackageManagerArguments {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object] $PackageManager,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Arguments
    )

    return [string[]](@($PackageManager.ArgumentPrefix) + @($Arguments))
}

Export-ModuleMember -Function @(
    'Resolve-FluxoraFrontendPackageManager',
    'Get-FluxoraFrontendPackageManagerArguments'
)
