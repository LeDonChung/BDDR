const fs = require('fs');
const path = require('path');

const dxfPath = process.argv[2] || path.join(__dirname, 'BDDR Tong Final.dxf');
const outPath = process.argv[3] || path.join(__dirname, 'BDDR-labels.geojson');

if (!fs.existsSync(dxfPath)) {
  throw new Error(`Khong tim thay DXF: ${dxfPath}`);
}

const DXF_BOUNDS = { minX: 389811.837, maxX: 426749.934, minY: 1518967.41, maxY: 1545466.0654 };
const GEO_BOUNDS = { minLng: 107.4821130299, maxLng: 107.8242307943, minLat: 13.7335916077, maxLat: 13.9723554948 };

function toLonLat(x, y) {
  const lng = GEO_BOUNDS.minLng + ((x - DXF_BOUNDS.minX) / (DXF_BOUNDS.maxX - DXF_BOUNDS.minX)) * (GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng);
  const lat = GEO_BOUNDS.minLat + ((y - DXF_BOUNDS.minY) / (DXF_BOUNDS.maxY - DXF_BOUNDS.minY)) * (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat);
  return [lng, lat];
}

function cleanText(text) {
  return String(text || '').replace(/\\P/g, ' ').replace(/[{}]/g, '').replace(/\\[A-Za-z][^;]*;?/g, '').replace(/\s+/g, ' ').trim();
}

const lines = fs.readFileSync(dxfPath, 'utf8').split(/\r?\n/);
const pairs = [];
for (let i = 0; i < lines.length - 1; i += 2) pairs.push([lines[i].trim(), lines[i + 1] ?? '']);

const blocks = new Map();
let inBlock = false;
let blockName = '';
let blockTexts = [];
for (let i = 0; i < pairs.length; i++) {
  if (pairs[i][0] === '0' && pairs[i][1].trim() === 'BLOCK') {
    inBlock = true;
    blockName = '';
    blockTexts = [];
    continue;
  }
  if (inBlock && pairs[i][0] === '2' && !blockName) {
    blockName = pairs[i][1].trim();
    continue;
  }
  if (inBlock && pairs[i][0] === '0' && pairs[i][1].trim() === 'ENDBLK') {
    blocks.set(blockName, blockTexts.filter(Boolean));
    inBlock = false;
    continue;
  }
  if (inBlock && pairs[i][0] === '0' && (pairs[i][1].trim() === 'TEXT' || pairs[i][1].trim() === 'MTEXT')) {
    let text = '';
    for (let j = i + 1; j < pairs.length && pairs[j][0] !== '0'; j++) {
      if (pairs[j][0] === '1' || pairs[j][0] === '3') text += pairs[j][1].trim();
    }
    blockTexts.push(cleanText(text));
  }
}

let inEntities = false;
const features = [];
for (let i = 0; i < pairs.length; i++) {
  if (pairs[i][0] === '0' && pairs[i][1].trim() === 'SECTION' && pairs[i + 1]?.[0] === '2' && pairs[i + 1][1].trim() === 'ENTITIES') {
    inEntities = true;
    continue;
  }
  if (inEntities && pairs[i][0] === '0' && pairs[i][1].trim() === 'ENDSEC') break;
  if (!inEntities || pairs[i][0] !== '0' || pairs[i][1].trim() !== 'INSERT') continue;

  let layer = '';
  let name = '';
  let x = null;
  let y = null;
  let rotation = 0;
  for (let j = i + 1; j < pairs.length && pairs[j][0] !== '0'; j++) {
    const [code, value] = pairs[j];
    if (code === '8') layer = value.trim();
    if (code === '2') name = value.trim();
    if (code === '10') x = Number(value);
    if (code === '20') y = Number(value);
    if (code === '50') rotation = Number(value) || 0;
  }

  const texts = blocks.get(name) || [];
  if (!texts.length || !Number.isFinite(x) || !Number.isFinite(y)) continue;
  if (x < DXF_BOUNDS.minX || x > DXF_BOUNDS.maxX || y < DXF_BOUNDS.minY || y > DXF_BOUNDS.maxY) continue;

  const numeric = texts.find(value => /^\d+(?:[,.]\d+)?$/.test(value));
  const code = texts.find(value => /[A-Z]/i.test(value) && value !== 'CT75');
  const unit = texts.find(value => /^CT\d+/i.test(value));
  const label = texts.join(' ');

  features.push({
    type: 'Feature',
    properties: { layer, block: name, label, code: code || '', unit: unit || '', number: numeric || '', rotation },
    geometry: { type: 'Point', coordinates: toLonLat(x, y) }
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', name: 'BDDR labels', features }));
console.log(`Da tao ${outPath} (${features.length} labels)`);
