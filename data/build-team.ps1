param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Team,

    [switch]$SkipPmtiles
)

$ErrorActionPreference = 'Stop'

function Resolve-TeamFolder {
    param([string]$Value)

    $code = $Value.Trim().ToLowerInvariant()
    if ($code -eq 'main' -or $code -eq 'doankinhtecty75') {
        return 'main'
    }
    if ($code -match '^cty75doi(\d{1,2})$') {
        return ('doi{0:D2}' -f [int]$Matches[1])
    }
    if ($code -match '^doi0*(\d{1,2})$') {
        return ('doi{0:D2}' -f [int]$Matches[1])
    }
    return $code
}

$teamFolder = Resolve-TeamFolder $Team
$teamDir = Join-Path $PSScriptRoot $teamFolder

if (-not (Test-Path -LiteralPath $teamDir -PathType Container)) {
    throw "Khong tim thay folder doi: $teamDir"
}

$kmz = Get-ChildItem -LiteralPath $teamDir -Filter '*.kmz' -File | Select-Object -First 1
if (-not $kmz) {
    throw "Khong tim thay file KMZ trong $teamDir"
}

$dxf = Get-ChildItem -LiteralPath $teamDir -Filter '*.dxf' -File | Select-Object -First 1
$geojson = Join-Path $teamDir 'BDDR.geojson'
$labels = Join-Path $teamDir 'BDDR-labels.geojson'
$pmtiles = Join-Path $teamDir 'BDDR.pmtiles'

Write-Host "==> Build $teamFolder"
Write-Host "KMZ: $($kmz.Name)"
node (Join-Path $PSScriptRoot 'convert-kmz-to-geojson.js') $kmz.FullName $geojson
if ($LASTEXITCODE -ne 0) {
    throw "convert-kmz-to-geojson failed with exit code $LASTEXITCODE"
}

if ($dxf) {
    Write-Host "DXF: $($dxf.Name)"
    node (Join-Path $PSScriptRoot 'convert-dxf-labels-to-geojson.js') $dxf.FullName $labels
    if ($LASTEXITCODE -ne 0) {
        throw "convert-dxf-labels-to-geojson failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Warning "Khong tim thay DXF trong $teamDir. Tao labels rong."
    Set-Content -LiteralPath $labels -Value '{"type":"FeatureCollection","name":"BDDR labels","features":[]}' -Encoding UTF8
}

if ($SkipPmtiles) {
    Write-Host "Bo qua PMTiles theo tham so -SkipPmtiles."
    return
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Warning "Khong tim thay Docker. Da tao GeoJSON/labels; web se fallback GeoJSON neu chua co PMTiles."
    return
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    docker info > $null 2> $null
    $dockerInfoExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($dockerInfoExitCode -ne 0) {
    Write-Warning "Docker chua chay. Da tao GeoJSON/labels; web se fallback GeoJSON neu chua co PMTiles."
    return
}

powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'convert-geojson-to-pmtiles.ps1') -InputGeoJson $geojson -OutputPmTiles $pmtiles
if ($LASTEXITCODE -ne 0) {
    throw "convert-geojson-to-pmtiles failed with exit code $LASTEXITCODE"
}

Write-Host "Da build xong $teamFolder"
