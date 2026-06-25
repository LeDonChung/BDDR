const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const inputKmz = process.argv[2] || path.join(__dirname, 'BDDR.kmz');
const outputGeoJson = process.argv[3] || path.join(__dirname, 'BDDR.geojson');

if (!fs.existsSync(inputKmz)) {
  throw new Error(`Khong tim thay KMZ: ${inputKmz}`);
}

function decodeXml(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function firstTag(text, tag) {
  const match = text.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function tagBlocks(text, tag) {
  return [...text.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>[\\s\\S]*?</(?:\\w+:)?${tag}>`, 'gi'))].map((match) => match[0]);
}

function parseCoordinates(text = '') {
  return decodeXml(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => {
      const parts = tuple.split(',').map(Number);
      return Number.isFinite(parts[2]) ? [parts[0], parts[1], parts[2]] : [parts[0], parts[1]];
    })
    .filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
}

function parsePoint(block) {
  const coordinates = parseCoordinates(firstTag(block, 'coordinates'));
  return coordinates.length ? { type: 'Point', coordinates: coordinates[0] } : null;
}

function parseLineString(block) {
  return { type: 'LineString', coordinates: parseCoordinates(firstTag(block, 'coordinates')) };
}

function parsePolygon(block) {
  const rings = tagBlocks(block, 'LinearRing')
    .map((ring) => parseCoordinates(firstTag(ring, 'coordinates')))
    .filter((ring) => ring.length);
  return { type: 'Polygon', coordinates: rings };
}

function parseGeometry(placemark) {
  const multi = tagBlocks(placemark, 'MultiGeometry')[0];
  if (multi) {
    const geometries = [
      ...tagBlocks(multi, 'Point').map(parsePoint),
      ...tagBlocks(multi, 'LineString').map(parseLineString),
      ...tagBlocks(multi, 'Polygon').map(parsePolygon),
    ].filter(Boolean);
    return { type: 'GeometryCollection', geometries };
  }

  const point = tagBlocks(placemark, 'Point')[0];
  if (point) return parsePoint(point);

  const line = tagBlocks(placemark, 'LineString')[0];
  if (line) return parseLineString(line);

  const polygon = tagBlocks(placemark, 'Polygon')[0];
  if (polygon) return parsePolygon(polygon);

  return null;
}

function parseExtendedData(placemark) {
  const properties = {};

  for (const match of placemark.matchAll(/<(?:\w+:)?Data\b[^>]*\bname=["']([^"']+)["'][^>]*>[\s\S]*?<(?:\w+:)?value[^>]*>([\s\S]*?)<\/(?:\w+:)?value>[\s\S]*?<\/(?:\w+:)?Data>/gi)) {
    properties[decodeXml(match[1])] = decodeXml(match[2]);
  }

  for (const match of placemark.matchAll(/<(?:\w+:)?SimpleData\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?SimpleData>/gi)) {
    properties[decodeXml(match[1])] = decodeXml(match[2]);
  }

  return properties;
}

function findKmlFile(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findKmlFile(fullPath);
      if (found) return found;
    } else if (entry.name.toLowerCase().endsWith('.kml')) {
      return fullPath;
    }
  }
  return null;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmz-geojson-'));
try {
  const escapedInput = path.resolve(inputKmz).replace(/'/g, "''");
  const escapedTemp = tempDir.replace(/'/g, "''");
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${escapedInput}', '${escapedTemp}')`,
  ], { stdio: 'inherit' });

  const kmlFile = findKmlFile(tempDir);
  if (!kmlFile) throw new Error('KMZ khong chua file .kml');

  const kml = fs.readFileSync(kmlFile, 'utf8');
  const documentName = firstTag(kml, 'name') || path.basename(inputKmz, path.extname(inputKmz));
  const placemarks = tagBlocks(kml, 'Placemark');
  const features = [];

  for (const placemark of placemarks) {
    const geometry = parseGeometry(placemark);
    if (!geometry) continue;

    const properties = parseExtendedData(placemark);
    const name = firstTag(placemark, 'name');
    const description = firstTag(placemark, 'description');
    const styleUrl = firstTag(placemark, 'styleUrl');
    if (name) properties.name = name;
    if (description) properties.description = description;
    if (styleUrl) properties.styleUrl = styleUrl;

    features.push({ type: 'Feature', properties, geometry });
  }

  fs.writeFileSync(outputGeoJson, JSON.stringify({
    type: 'FeatureCollection',
    name: documentName,
    features,
  }));

  console.log(`Da tao ${outputGeoJson} (${features.length} features)`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
