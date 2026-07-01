param(
    [string]$InputGeoJson = (Join-Path $PSScriptRoot 'BDDR.geojson'),
    [string]$OutputPmTiles = (Join-Path $PSScriptRoot 'BDDR.pmtiles')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputGeoJson)) {
    throw "Khong tim thay GeoJSON: $InputGeoJson. Hay chay npm run convert:kmz truoc."
}

$InputGeoJson = (Resolve-Path -LiteralPath $InputGeoJson).Path
$OutputPmTiles = [System.IO.Path]::GetFullPath($OutputPmTiles)
$dataDir = (Resolve-Path -LiteralPath (Split-Path -Parent $InputGeoJson)).Path
$outputDir = [System.IO.Path]::GetFullPath((Split-Path -Parent $OutputPmTiles))
if ($outputDir -ne $dataDir) {
    throw "OutputPmTiles phai nam cung thu muc voi InputGeoJson. Input dir: $dataDir. Output dir: $outputDir"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw 'Khong tim thay Docker. Can cai Docker Desktop de tao PMTiles bang tippecanoe.'
}

$tempName = 'BDDR-tippecanoe.geojsonl'
$tempPath = Join-Path $dataDir $tempName
$mbtilesName = 'BDDR.mbtiles'
$mbtilesPath = Join-Path $dataDir $mbtilesName
$outputName = Split-Path -Leaf $OutputPmTiles

Write-Host "Dang chuan bi GeoJSONL cho tippecanoe ..."
node (Join-Path $PSScriptRoot 'prepare-geojson-for-tippecanoe.js') $InputGeoJson $tempPath
if ($LASTEXITCODE -ne 0) {
    throw "prepare-geojson-for-tippecanoe failed with exit code $LASTEXITCODE"
}

Write-Host "Dang tao MBTiles tam: $mbtilesPath ..."

docker run --rm `
    -v "${dataDir}:/data" `
    strikehawk/tippecanoe:latest `
    tippecanoe `
    -o "/data/$mbtilesName" `
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

if (-not (Test-Path -LiteralPath $mbtilesPath)) {
    throw "Khong tao duoc MBTiles: $mbtilesPath"
}

Write-Host "Dang convert MBTiles sang PMTiles: $OutputPmTiles ..."
if (Test-Path -LiteralPath $OutputPmTiles) {
    Remove-Item -LiteralPath $OutputPmTiles -Force
}

docker run --rm `
    -v "${dataDir}:/data" `
    protomaps/go-pmtiles:latest `
    convert "/data/$mbtilesName" "/data/$outputName"

if ($LASTEXITCODE -ne 0) {
    throw "pmtiles convert failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $OutputPmTiles)) {
    throw "Khong tao duoc PMTiles: $OutputPmTiles"
}

Write-Host "Da tao $OutputPmTiles"
