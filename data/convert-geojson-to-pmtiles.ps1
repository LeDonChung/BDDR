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
$inputName = Split-Path -Leaf $InputGeoJson
$outputName = Split-Path -Leaf $OutputPmTiles

Write-Host "Dang tao $OutputPmTiles tu $InputGeoJson ..."

docker run --rm `
    -v "${dataDir}:/data" `
    maptiler/tippecanoe:latest `
    tippecanoe `
    -o "/data/$outputName" `
    --force `
    --layer=bddr `
    --minimum-zoom=8 `
    --maximum-zoom=16 `
    --drop-densest-as-needed `
    --extend-zooms-if-still-dropping `
    --no-tile-size-limit `
    "/data/$inputName"

if ($LASTEXITCODE -ne 0) {
    throw "tippecanoe/docker failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $OutputPmTiles)) {
    throw "Khong tao duoc PMTiles: $OutputPmTiles"
}

Write-Host "Da tao $OutputPmTiles"

