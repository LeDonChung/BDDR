const fs = require('fs');
const path = require('path');

const input = process.argv[2] || path.join(__dirname, 'BDDR.geojson');
const output = process.argv[3] || path.join(__dirname, 'BDDR-tippecanoe.geojsonl');

function stripPosition(position) {
  return [Number(position[0]), Number(position[1])];
}

function stripCoordinates(value) {
  if (!Array.isArray(value)) return value;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') return stripPosition(value);
  return value.map(stripCoordinates);
}

function flattenGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).flatMap(flattenGeometry);
  }
  return [{ type: geometry.type, coordinates: stripCoordinates(geometry.coordinates) }];
}

const geojson = JSON.parse(fs.readFileSync(input, 'utf8'));
const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
const stream = fs.createWriteStream(output, { encoding: 'utf8' });
let count = 0;

for (const feature of features) {
  if (!feature || feature.type !== 'Feature') continue;
  const properties = feature.properties || {};
  for (const geometry of flattenGeometry(feature.geometry)) {
    if (!geometry || !geometry.coordinates) continue;
    stream.write(JSON.stringify({ type: 'Feature', properties, geometry }) + '\n');
    count++;
  }
}

stream.end(() => {
  console.log(`Da tao ${output} (${count} features)`);
});
