param(
    [string]$InputGeoJson = (Join-Path $PSScriptRoot 'BDDR.geojson'),
    [string]$OutputPmTiles = (Join-Path $PSScriptRoot 'BDDR.pmtiles')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputGeoJson)) {
    throw "Khong tim thay GeoJSON: $InputGeoJson. Hay chay npm run convert:kmz truoc."
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw 'Khong tim thay Docker. Can cai Docker Desktop de tao PMTiles bang tippecanoe.'
}

$dataDir = Resolve-Path -LiteralPath $PSScriptRoot
$tempName = 'BDDR-tippecanoe.geojsonl'
$tempPath = Join-Path $PSScriptRoot $tempName
$outputName = Split-Path -Leaf $OutputPmTiles

Write-Host "Dang chuan bi GeoJSONL cho tippecanoe ..."
node (Join-Path $PSScriptRoot 'prepare-geojson-for-tippecanoe.js') $InputGeoJson $tempPath
if ($LASTEXITCODE -ne 0) {
    throw "prepare-geojson-for-tippecanoe failed with exit code $LASTEXITCODE"
}

Write-Host "Dang tao $OutputPmTiles tu $tempPath ..."

docker run --rm `
    -v "${dataDir}:/data" `
    strikehawk/tippecanoe:latest `
    tippecanoe `
    -o "/data/$outputName" `
    --force `
    --layer=bddr `
    --minimum-zoom=8 `
    --maximum-zoom=16 `
    --drop-densest-as-needed `
    --extend-zooms-if-still-dropping `
    --no-tile-size-limit `
    "/data/$tempName"

if ($LASTEXITCODE -ne 0) {
    throw "tippecanoe/docker failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $OutputPmTiles)) {
    throw "Khong tao duoc PMTiles: $OutputPmTiles"
}

Write-Host "Da tao $OutputPmTiles"
