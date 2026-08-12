param(
    [string]$DataRoot,
    [string]$Bucket = 'capstone',
    [string]$Prefix = 'bddr/data',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$scriptRoot = [System.IO.Path]::GetFullPath($scriptRoot)

if (-not $DataRoot) {
    $DataRoot = Join-Path $scriptRoot '..\..\data'
}

function Get-ContentType {
    param([string]$Path)

    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    switch ($ext) {
        '.geojson' { return 'application/geo+json; charset=utf-8' }
        '.json'    { return 'application/json; charset=utf-8' }
        '.txt'     { return 'text/plain; charset=utf-8' }
        '.pmtiles' { return 'application/octet-stream' }
        '.mbtiles' { return 'application/octet-stream' }
        '.kmz'     { return 'application/vnd.google-earth.kmz' }
        '.dxf'     { return 'application/dxf' }
        '.ps1'     { return 'text/plain; charset=utf-8' }
        '.js'      { return 'text/javascript; charset=utf-8' }
        default    { return 'application/octet-stream' }
    }
}

$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) {
    throw "Khong tim thay DataRoot: $DataRoot"
}

$Prefix = $Prefix.Trim('/')
$rootWithSlash = $DataRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$files = Get-ChildItem -LiteralPath $DataRoot -Recurse -File | Sort-Object FullName

Write-Host "Upload $($files.Count) file tu $DataRoot len R2 bucket '$Bucket' prefix '$Prefix'"
if ($DryRun) {
    Write-Host "DryRun: chi in object key, khong upload."
}

foreach ($file in $files) {
    $relative = $file.FullName.Substring($rootWithSlash.Length).Replace('\', '/')
    $key = if ($Prefix) { "$Prefix/$relative" } else { $relative }
    $objectPath = "$Bucket/$key"
    $contentType = Get-ContentType $file.FullName

    if ($DryRun) {
        Write-Host "DRY $objectPath"
        continue
    }

    Write-Host "PUT $objectPath"
    & npx wrangler r2 object put $objectPath --file $file.FullName --content-type $contentType --remote
    if ($LASTEXITCODE -ne 0) {
        throw "Upload failed: $objectPath"
    }
}

Write-Host "Da upload xong len R2."
