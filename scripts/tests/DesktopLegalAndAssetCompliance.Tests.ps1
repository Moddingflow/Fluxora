$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$validatorPath = Join-Path $repoRoot 'scripts\release\Test-DesktopLegalAndAssetCompliance.ps1'
$manifestPath = Join-Path $repoRoot 'legal\desktop\manifest.json'
$inventoryPath = Join-Path $repoRoot 'legal\desktop\dependency-inventory.json'
$iconAllowlistPath = Join-Path $repoRoot 'Icons\installer-updater-icons.json'

foreach ($requiredPath in @($validatorPath, $manifestPath, $inventoryPath, $iconAllowlistPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required desktop compliance input is missing: '$requiredPath'."
    }
}

& $validatorPath
if ($LASTEXITCODE -ne 0) {
    throw "Desktop legal/asset validator failed with exit code $LASTEXITCODE."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$inventory = Get-Content -LiteralPath $inventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$iconAllowlist = Get-Content -LiteralPath $iconAllowlistPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (@($manifest.documents).Count -ne 12) {
    throw 'Legal manifest must contain four documents in each of three languages.'
}
if (@($inventory.packageManagers.pnpm.runtimeDistributed.packages).Count -lt 1) {
    throw 'Production pnpm dependency inventory is unexpectedly empty.'
}
if (@($inventory.packageManagers.cargo.runtimeDistributed.packages).Count -lt 1) {
    throw 'Windows Cargo runtime dependency inventory is unexpectedly empty.'
}
if (@($inventory.cmake.dependencies | Where-Object resolvedReleaseEvidenceRequired).Count -ne 5) {
    throw 'All five direct CMake dependency contracts must require exact release evidence.'
}
if (@($iconAllowlist.icons).Count -lt 1) {
    throw 'Setup/Updater icon allowlist is unexpectedly empty.'
}

Write-Host 'Desktop legal/asset compliance integration test PASSED.' -ForegroundColor Green
