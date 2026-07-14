param(
    [string]$DataRoot = (Join-Path $PSScriptRoot '..\..\data'),

    [switch]$SkipPmtiles
)

$ErrorActionPreference = 'Stop'

$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$buildTeam = Join-Path $PSScriptRoot 'build-team.ps1'
$teamDirs = Get-ChildItem -LiteralPath $DataRoot -Directory |
    Where-Object { $_.Name -eq 'main' -or $_.Name -match '^doi\d{2}$' } |
    Sort-Object Name

foreach ($dir in $teamDirs) {
    $hasKmz = @(Get-ChildItem -LiteralPath $dir.FullName -Filter '*.kmz' -File).Count -gt 0
    if (-not $hasKmz) {
        Write-Host "Bo qua $($dir.Name): chua co KMZ"
        continue
    }

    if ($SkipPmtiles) {
        powershell -ExecutionPolicy Bypass -File $buildTeam $dir.Name -DataRoot $DataRoot -SkipPmtiles
    } else {
        powershell -ExecutionPolicy Bypass -File $buildTeam $dir.Name -DataRoot $DataRoot
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Build $($dir.Name) failed with exit code $LASTEXITCODE"
    }
}
