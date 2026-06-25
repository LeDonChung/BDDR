// ===== STATE =====
let map;
let kmlLayer = null;
let userMarker = null;
let userAccuracyCircle = null;
let selectedLandmarkMarker = null;
let lastFeature = null;
let pendingRouteDestination = null;
let kmlFeatures = [];
let kmlLoaded = false;
let kmlRenderTimer = null;
let kmlRenderJob = 0;
let kmlActiveFeatures = new Set();
let kmlFeatureGrid = new Map();
let kmlLargeFeatures = [];
let ctyCodeLabelBounds = [];
let currentBaseLayer = null;
let routeChoicePopup = null;
let showCtyCodeLabels = true;

const DEFAULT_CENTER = [13.8241, 107.7628];
const DEFAULT_ZOOM = 15;
const KMZ_SOURCE = 'data/BDDR.kmz';
const KML_RENDER_PADDING = 0.15;
const KML_RENDER_CHUNK_SIZE = 180;
const KML_RENDER_DEBOUNCE_MS = 180;
const KML_INDEX_CELL_SIZE = 0.02;
const KML_TINY_POLYGON_MAX_SPAN = 0.00035;
const KML_DETAIL_TEXT_MIN_ZOOM = 16;
const KML_OVERVIEW_TEXT_MIN_ZOOM = 11;
const KML_DETAIL_LINE_MIN_ZOOM = 12;
const KML_SHORT_LINE_MAX_SPAN = 0.001;
const KML_SHORT_LINE_MIN_ZOOM = 16;
const KML_SMALL_POLYGON_MAX_SPAN = 0.0012;
const KML_SMALL_POLYGON_MIN_ZOOM = 14;
const KML_LARGE_POLYGON_MIN_ZOOM = 11;
const KML_LINE_MIN_ZOOM = 10;
const KML_CODE_LABEL_CLUSTER_CELL_SIZE = 0.00045;
const KML_CODE_LABEL_MIN_WIDTH = 0.00035;
const KML_CODE_LABEL_MAX_WIDTH = 0.00108;
const KML_CODE_LABEL_MIN_HEIGHT = 0.00018;
const KML_CODE_LABEL_MAX_HEIGHT = 0.00092;
const KML_CODE_LABEL_MIN_PARTS = 40;
const KML_CODE_LABEL_MAX_PARTS = 950;
const KML_CODE_LABEL_LINE_PADDING = 0.00075;
const FEATURE_CLICK_TOLERANCE_PX = 18;

const $ = (id) => document.getElementById(id);

// ===== TILE LAYERS =====
const osmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
    minZoom: 2,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 3
  }
);

const satelliteLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
    minZoom: 2,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 2
  }
);

// ===== INIT MAP =====
function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    preferCanvas: true,
    renderer: L.canvas({ padding: 0.5, tolerance: FEATURE_CLICK_TOLERANCE_PX }),
    worldCopyJump: true,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    tap: true,
    tapTolerance: FEATURE_CLICK_TOLERANCE_PX
  });

  currentBaseLayer = osmLayer;
  currentBaseLayer.addTo(map);

  L.control.layers(
    {
      'Đường phố OSM': osmLayer,
      'Vệ tinh Esri': satelliteLayer
    },
    null,
    {
      position: 'bottomright',
      collapsed: true
    }
  ).addTo(map);

  map.on('movestart', cancelKMLRender);
  map.on('zoomstart', onKMLZoomStart);
  map.on('moveend', () => scheduleVisibleKMLRender(90));
  map.on('zoomend', () => scheduleVisibleKMLRender(260));
  map.on('click', onMapBackgroundClick);

  $('locateBtn').addEventListener('click', locateUser);
  $('routeBtn').addEventListener('click', promptRoutePick);

  initRouting();
  initRouteConfirmModal();
  setOverlayVisible(false);
}

function setOverlayVisible(visible) {
  const ov = $('loadingOverlay');
  if (!ov) return;
  if (visible) ov.classList.remove('hidden');
  else ov.classList.add('hidden');
}

function showToast(message, ms) {
  ms = ms || 2200;
  const t = $('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function promptRoutePick() {
  if (typeof closeRoutePanel === 'function') closeRoutePanel();
  closeRouteConfirmModal();
  showToast('Chạm điểm bất kỳ trên bản đồ để chỉ đường');
}

// ===== KML =====
function loadDefaultKML() {
  if (kmlLoaded) {
    scheduleVisibleKMLRender();
    return;
  }
  setOverlayVisible(true);
  fetch(KMZ_SOURCE)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    })
    .then(buffer => extractKMLFromKMZ(buffer))
    .then(xml => {
      const run = () => parseAndIndexKML(xml);
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
      else setTimeout(run, 200);
    })
    .catch(err => {
      console.error(err);
      showToast('Không thể tải file KMZ');
      setOverlayVisible(false);
    });
}

function extractKMLFromKMZ(buffer) {
  if (!window.fflate || typeof window.fflate.unzip !== 'function') {
    throw new Error('Thiếu thư viện giải nén KMZ');
  }

  return new Promise((resolve, reject) => {
    window.fflate.unzip(new Uint8Array(buffer), (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      const kmlName = Object.keys(files).find(name => /\.kml$/i.test(name));
      if (!kmlName) {
        reject(new Error('KMZ không chứa file KML'));
        return;
      }

      resolve(window.fflate.strFromU8(files[kmlName]));
    });
  });
}

function parseAndIndexKML(xmlText) {
  try {
    if (kmlLayer) {
      map.removeLayer(kmlLayer);
      kmlLayer = null;
    }
    kmlLayer = L.featureGroup();
    kmlLayer.addTo(map);
    kmlFeatures = [];
    kmlActiveFeatures = new Set();
    kmlFeatureGrid = new Map();
    kmlLargeFeatures = [];
    ctyCodeLabelBounds = [];

    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Parse error');
    }

    let count = 0;
    const placemarks = doc.getElementsByTagName('Placemark');
    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];
      const name = textOf(pm, 'name') || ('Thửa ' + (i + 1));
      const desc = textOf(pm, 'description') || '';
      const level = getPlacemarkLevel(pm);

      const polygons = pm.getElementsByTagName('Polygon');
      for (let p = 0; p < polygons.length; p++) {
        const rings = polygons[p].getElementsByTagName('coordinates');
        const latlngs = parseCoords(rings);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('polygon', latlngs, name, desc, level));
          count++;
        }
      }
      const lines = pm.getElementsByTagName('LineString');
      for (let l = 0; l < lines.length; l++) {
        const cs = lines[l].getElementsByTagName('coordinates');
        const latlngs = parseCoords(cs);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('line', latlngs, name, desc, level));
          count++;
        }
      }
      const points = pm.getElementsByTagName('Point');
      for (let p = 0; p < points.length; p++) {
        const cs = points[p].getElementsByTagName('coordinates');
        const latlngs = parseCoords(cs);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('point', latlngs[0], name, desc, level));
          count++;
        }
      }
    }

    kmlLoaded = true;
    classifyCtyCodeLabelClusters();
    buildKMLSpatialIndex();
    scheduleVisibleKMLRender();
    setOverlayVisible(false);
    showToast('Đã sẵn sàng ' + count + ' đối tượng');
  } catch (err) {
    console.error(err);
    setOverlayVisible(false);
    showToast('Lỗi phân tích KML');
  }
}

function createFeatureRecord(type, latlngs, name, desc, level) {
  const flatLatLngs = type === 'point' ? [latlngs] : flattenLatLngs(latlngs);
  const bounds = L.latLngBounds(flatLatLngs);
  const center = bounds.getCenter();
  const latSpan = Math.abs(bounds.getNorth() - bounds.getSouth());
  const lngSpan = Math.abs(bounds.getEast() - bounds.getWest());
  const maxSpan = Math.max(latSpan, lngSpan);
  const isTinyPolygon = type === 'polygon' && maxSpan > 0 && maxSpan <= KML_TINY_POLYGON_MAX_SPAN;
  const isLabelShape = type === 'polygon' && maxSpan > 0 && maxSpan <= KML_SMALL_POLYGON_MAX_SPAN;
  const isShortLine = type === 'line' && maxSpan > 0 && maxSpan <= KML_SHORT_LINE_MAX_SPAN;
  const isDetailLevel = level === 4;

  return {
    type,
    latlngs,
    name,
    desc,
    level,
    bounds,
    centerLat: center.lat,
    centerLng: center.lng,
    maxSpan,
    isLabelShape,
    isCtyCodeLabel: false,
    minZoom: getFeatureMinZoom(type, maxSpan, isDetailLevel),
    clickable: !isLabelShape && !isShortLine && !isDetailLevel,
    layer: null
  };
}

function getFeatureMinZoom(type, maxSpan, isDetailLevel) {
  if (type === 'line') {
    if (maxSpan <= KML_SHORT_LINE_MAX_SPAN) return KML_SHORT_LINE_MIN_ZOOM;
    return isDetailLevel ? KML_DETAIL_LINE_MIN_ZOOM : KML_LINE_MIN_ZOOM;
  }
  if (type === 'point') return KML_SMALL_POLYGON_MIN_ZOOM;
  if (maxSpan <= KML_TINY_POLYGON_MAX_SPAN) {
    return isDetailLevel ? KML_DETAIL_TEXT_MIN_ZOOM : KML_OVERVIEW_TEXT_MIN_ZOOM;
  }
  if (maxSpan <= KML_SMALL_POLYGON_MAX_SPAN) {
    return isDetailLevel ? KML_SMALL_POLYGON_MIN_ZOOM : KML_OVERVIEW_TEXT_MIN_ZOOM;
  }
  return KML_LARGE_POLYGON_MIN_ZOOM;
}

function flattenLatLngs(latlngs) {
  const out = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      out.push(value);
      return;
    }
    value.forEach(walk);
  };
  walk(latlngs);
  return out;
}

function scheduleKMLLoad() {
  if (kmlLoaded) {
    scheduleVisibleKMLRender();
    return;
  }
  const run = () => loadDefaultKML();
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 300);
}

function cancelKMLRender() {
  clearTimeout(kmlRenderTimer);
  kmlRenderTimer = null;
  kmlRenderJob++;
}

function scheduleVisibleKMLRender(delay) {
  if (!kmlLoaded || !kmlLayer) return;
  clearTimeout(kmlRenderTimer);
  kmlRenderTimer = setTimeout(renderVisibleKML, delay || KML_RENDER_DEBOUNCE_MS);
}

function buildKMLSpatialIndex() {
  kmlFeatureGrid = new Map();
  kmlLargeFeatures = [];

  kmlFeatures.forEach(feature => {
    if (feature.type === 'line' || feature.maxSpan > KML_INDEX_CELL_SIZE) {
      kmlLargeFeatures.push(feature);
      return;
    }

    const key = gridKey(feature.centerLat, feature.centerLng);
    let zoomGrid = kmlFeatureGrid.get(feature.minZoom);
    if (!zoomGrid) {
      zoomGrid = new Map();
      kmlFeatureGrid.set(feature.minZoom, zoomGrid);
    }

    let bucket = zoomGrid.get(key);
    if (!bucket) {
      bucket = [];
      zoomGrid.set(key, bucket);
    }
    bucket.push(feature);
  });
}

function classifyCtyCodeLabelClusters() {
  const candidates = kmlFeatures.filter(feature =>
    feature.type === 'polygon' &&
    feature.level === 4 &&
    feature.name === 'Style10' &&
    feature.isLabelShape
  );

  if (!candidates.length) return;

  const parents = candidates.map((_, index) => index);
  const grid = new Map();

  const find = (index) => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  candidates.forEach((feature, index) => {
    const gx = Math.floor(feature.centerLng / KML_CODE_LABEL_CLUSTER_CELL_SIZE);
    const gy = Math.floor(feature.centerLat / KML_CODE_LABEL_CLUSTER_CELL_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nearby = grid.get((gx + dx) + ':' + (gy + dy));
        if (!nearby) continue;

        nearby.forEach(otherIndex => {
          const other = candidates[otherIndex];
          if (
            Math.abs(feature.centerLng - other.centerLng) <= KML_CODE_LABEL_CLUSTER_CELL_SIZE &&
            Math.abs(feature.centerLat - other.centerLat) <= KML_CODE_LABEL_CLUSTER_CELL_SIZE
          ) {
            union(index, otherIndex);
          }
        });
      }
    }

    const key = gx + ':' + gy;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(index);
  });

  const clusters = new Map();
  candidates.forEach((feature, index) => {
    const root = find(index);
    let cluster = clusters.get(root);
    if (!cluster) {
      cluster = [];
      clusters.set(root, cluster);
    }
    cluster.push(feature);
  });

  clusters.forEach(cluster => {
    const bounds = getFeatureClusterBounds(cluster);
    if (!isCtyCodeLabelCluster(cluster, bounds)) return;
    ctyCodeLabelBounds.push(bounds);
    cluster.forEach(feature => {
      feature.isCtyCodeLabel = true;
    });
  });

  classifyCtyCodeLabelLines();
}

function getFeatureClusterBounds(cluster) {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;

  cluster.forEach(feature => {
    north = Math.max(north, feature.bounds.getNorth());
    south = Math.min(south, feature.bounds.getSouth());
    east = Math.max(east, feature.bounds.getEast());
    west = Math.min(west, feature.bounds.getWest());
  });

  return { north, south, east, west };
}

function isCtyCodeLabelCluster(cluster, bounds) {
  if (cluster.length < KML_CODE_LABEL_MIN_PARTS || cluster.length > KML_CODE_LABEL_MAX_PARTS) {
    return false;
  }

  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;

  return (
    width >= KML_CODE_LABEL_MIN_WIDTH &&
    width <= KML_CODE_LABEL_MAX_WIDTH &&
    height >= KML_CODE_LABEL_MIN_HEIGHT &&
    height <= KML_CODE_LABEL_MAX_HEIGHT
  );
}

function classifyCtyCodeLabelLines() {
  if (!ctyCodeLabelBounds.length) return;

  kmlFeatures.forEach(feature => {
    if (
      feature.type !== 'line' ||
      feature.level !== 4 ||
      (feature.name !== 'Style12' && feature.name !== 'Style13')
    ) {
      return;
    }

    if (isFeatureNearCtyCodeBounds(feature)) {
      feature.isCtyCodeLabel = true;
      feature.clickable = false;
    }
  });
}

function isFeatureNearCtyCodeBounds(feature) {
  return ctyCodeLabelBounds.some(bounds =>
    feature.centerLng >= bounds.west - KML_CODE_LABEL_LINE_PADDING &&
    feature.centerLng <= bounds.east + KML_CODE_LABEL_LINE_PADDING &&
    feature.centerLat >= bounds.south - KML_CODE_LABEL_LINE_PADDING &&
    feature.centerLat <= bounds.north + KML_CODE_LABEL_LINE_PADDING
  );
}

function renderVisibleKML() {
  if (!kmlLoaded || !kmlLayer) return;

  const job = ++kmlRenderJob;
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(KML_RENDER_PADDING);
  const pending = [];

  kmlActiveFeatures.forEach(feature => {
    if (!isFeatureRenderable(feature, bounds, zoom)) {
      removeFeatureLayer(feature);
    }
  });

  getKMLRenderCandidates(bounds, zoom).forEach(feature => {
    if (!feature.layer && isFeatureRenderable(feature, bounds, zoom)) {
      pending.push(feature);
    }
  });

  if (!pending.length) return;

  let index = 0;
  const renderChunk = () => {
    if (job !== kmlRenderJob) return;

    const end = Math.min(index + KML_RENDER_CHUNK_SIZE, pending.length);
    for (; index < end; index++) {
      const feature = pending[index];
      if (!feature.layer && isFeatureRenderable(feature, bounds, zoom)) {
        feature.layer = buildFeatureLayer(feature);
        kmlLayer.addLayer(feature.layer);
        kmlActiveFeatures.add(feature);
      }
    }

    if (index < pending.length) {
      if ('requestIdleCallback' in window) requestIdleCallback(renderChunk, { timeout: 300 });
      else requestAnimationFrame(renderChunk);
    }
  };

  renderChunk();
}

function getKMLRenderCandidates(bounds, zoom) {
  const candidates = kmlLargeFeatures.slice();

  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  const minX = Math.floor(Math.min(west, east) / KML_INDEX_CELL_SIZE);
  const maxX = Math.floor(Math.max(west, east) / KML_INDEX_CELL_SIZE);
  const minY = Math.floor(south / KML_INDEX_CELL_SIZE);
  const maxY = Math.floor(north / KML_INDEX_CELL_SIZE);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = x + ':' + y;
      kmlFeatureGrid.forEach((zoomGrid, minZoom) => {
        if (zoom < minZoom) return;
        const bucket = zoomGrid.get(key);
        if (bucket) candidates.push(...bucket);
      });
    }
  }

  return candidates;
}

function gridKey(lat, lng) {
  return Math.floor(lng / KML_INDEX_CELL_SIZE) + ':' + Math.floor(lat / KML_INDEX_CELL_SIZE);
}

function onKMLZoomStart() {
  cancelKMLRender();
  kmlActiveFeatures.forEach(feature => {
    if (!feature.clickable || feature.isLabelShape) removeFeatureLayer(feature);
  });
}

function isFeatureRenderable(feature, bounds, zoom) {
  return zoom >= feature.minZoom && bounds.intersects(feature.bounds);
}

function removeFeatureLayer(feature) {
  if (!feature.layer) return;
  kmlLayer.removeLayer(feature.layer);
  feature.layer = null;
  kmlActiveFeatures.delete(feature);
}

function buildFeatureLayer(feature) {
  let layer;
  const options = {
    color: '#ffd84d',
    weight: 1.5,
    opacity: 0.95,
    fillColor: '#ffd84d',
    fillOpacity: 0.08,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: feature.clickable,
    bubblingMouseEvents: false,
    pmName: feature.name,
    pmDesc: feature.desc,
    featureRecord: feature
  };

  if (feature.type === 'polygon') {
    layer = L.polygon(feature.latlngs, options);
  } else if (feature.type === 'line') {
    layer = L.polyline(feature.latlngs, options);
  } else {
    layer = L.marker(feature.latlngs, {
      pmName: feature.name,
      pmDesc: feature.desc,
      featureRecord: feature
    });
  }

  if (feature.clickable) attachFeatureHandlers(layer);
  return layer;
}

function textOf(node, tag) {
  const els = node.getElementsByTagName(tag);
  return els && els.length ? (els[0].textContent || '').trim() : '';
}

function directTextOf(node, tag) {
  if (!node || !node.childNodes) return '';
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1 && (child.localName || child.nodeName) === tag) {
      return (child.textContent || '').trim();
    }
  }
  return '';
}

function getPlacemarkLevel(placemark) {
  let node = placemark ? placemark.parentNode : null;
  while (node) {
    if (node.nodeType === 1 && (node.localName || node.nodeName) === 'Folder') {
      const match = directTextOf(node, 'name').match(/^Level\s+(\d+)/i);
      if (match) return Number(match[1]);
    }
    node = node.parentNode;
  }
  return null;
}

function parseCoords(coordNodes) {
  const out = [];
  for (let i = 0; i < coordNodes.length; i++) {
    const txt = (coordNodes[i].textContent || '').trim();
    if (!txt) continue;
    const tuples = txt.split(/\s+/);
    for (let j = 0; j < tuples.length; j++) {
      const parts = tuples[j].split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) out.push([lat, lng]);
      }
    }
  }
  return out;
}

function attachFeatureHandlers(layer) {
  layer.on('click', onFeatureClick);
  layer.on('mouseover', () => {
    if (map && map.getContainer()) map.getContainer().classList.add('is-selecting-feature');
  });
  layer.on('mouseout', () => {
    if (map && map.getContainer()) map.getContainer().classList.remove('is-selecting-feature');
  });
}

function onFeatureClick(e) {
  if (e.originalEvent) L.DomEvent.stop(e);
  const layer = e.target;
  selectFeature(layer, e.latlng);
}

function onMapBackgroundClick(e) {
  const hit = findRenderedFeatureAt(e.latlng);
  if (hit) {
    selectFeature(hit.layer, e.latlng);
    return;
  }
  selectMapPoint(e.latlng);
}

function selectFeature(layer, clickLatLng) {
  lastFeature = layer;

  const center = clickLatLng || (layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng());
  const name = cleanDestinationName((layer.options && layer.options.pmName) || 'Điểm đã chọn');
  const desc = (layer.options && layer.options.pmDesc) || formatArea(layer);

  showSelectedLandmark(center);
  showRouteChoicePopup({
    latlng: [center.lat, center.lng],
    name,
    desc
  });
}

function selectMapPoint(latlng) {
  if (!latlng) return;
  showSelectedLandmark(latlng);
  showRouteChoicePopup({
    latlng: [latlng.lat, latlng.lng],
    name: 'Điểm đã chọn',
    desc: formatLatLng(latlng)
  });
}

function cleanDestinationName(name) {
  const value = String(name || '').trim();
  return /^Style\d+$/i.test(value) ? 'Điểm đã chọn' : (value || 'Điểm đã chọn');
}

function findRenderedFeatureAt(latlng) {
  if (!kmlLoaded || !map) return null;

  const clickPoint = map.latLngToLayerPoint(latlng);
  let best = null;
  let bestDistance = Infinity;
  const tolerance = FEATURE_CLICK_TOLERANCE_PX;

  kmlActiveFeatures.forEach(feature => {
    if (!feature.layer || !feature.clickable) return;

    if (feature.type === 'polygon' && pointInAnyPolygon(latlng, feature.latlngs)) {
      best = { layer: feature.layer, distance: 0 };
      bestDistance = 0;
      return;
    }

    const distance = distanceToFeaturePx(clickPoint, feature);
    if (distance <= tolerance && distance < bestDistance) {
      best = { layer: feature.layer, distance };
      bestDistance = distance;
    }
  });

  return best;
}

function showRouteChoicePopup(destination) {
  pendingRouteDestination = destination;
  if (typeof closeRoutePanel === 'function') closeRoutePanel();

  const latlng = normalizeDestinationLatLng(destination.latlng);
  const title = destination.name || 'Điểm đã chọn';
  const coords = formatLatLng({ lat: latlng[0], lng: latlng[1] });
  const subtitle = destination.desc && destination.desc !== coords
    ? destination.desc + ' • ' + coords
    : coords;

  const content = document.createElement('div');
  content.className = 'route-choice';
  content.innerHTML =
    '<p class="route-choice__eyebrow">Điểm đến</p>' +
    '<h3>' + escapeHtml(title) + '</h3>' +
    '<p class="route-choice__coords">' + escapeHtml(subtitle) + '</p>' +
    '<div class="route-choice__actions">' +
      '<button type="button" class="btn btn--primary" data-route-action="direct">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>' +
        'Chỉ đường trực tiếp' +
      '</button>' +
      '<button type="button" class="btn btn--ghost" data-route-action="google">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>' +
        'Google Maps' +
      '</button>' +
    '</div>';

  L.DomEvent.disableClickPropagation(content);
  content.querySelector('[data-route-action="direct"]').addEventListener('click', () => {
    if (routeChoicePopup) map.closePopup(routeChoicePopup);
    if (typeof beginDirectRoute === 'function') {
      beginDirectRoute(latlng, title);
    }
  });
  content.querySelector('[data-route-action="google"]').addEventListener('click', () => {
    if (routeChoicePopup) map.closePopup(routeChoicePopup);
    if (typeof openGoogleMapsRoute === 'function') {
      openGoogleMapsRoute(latlng, title);
    }
  });

  routeChoicePopup = L.popup({
    className: 'route-choice-popup',
    closeButton: true,
    autoPan: true,
    maxWidth: 300,
    minWidth: 230
  })
    .setLatLng(latlng)
    .setContent(content)
    .openOn(map);
}

function normalizeDestinationLatLng(latlng) {
  if (Array.isArray(latlng)) return [Number(latlng[0]), Number(latlng[1])];
  return [Number(latlng.lat), Number(latlng.lng)];
}

function pointInAnyPolygon(latlng, rings) {
  if (!Array.isArray(rings)) return false;
  if (rings.length && typeof rings[0][0] === 'number') {
    return pointInRing(latlng, rings);
  }
  return rings.some(ring => pointInAnyPolygon(latlng, ring));
}

function pointInRing(latlng, ring) {
  let inside = false;
  const x = latlng.lng;
  const y = latlng.lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0];
    const xj = ring[j][1], yj = ring[j][0];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }

  return inside;
}

function distanceToFeaturePx(clickPoint, feature) {
  if (feature.type === 'point') {
    return clickPoint.distanceTo(map.latLngToLayerPoint(feature.latlngs));
  }

  const segments = [];
  collectSegments(feature.latlngs, segments);

  let min = Infinity;
  segments.forEach(segment => {
    const a = map.latLngToLayerPoint(segment[0]);
    const b = map.latLngToLayerPoint(segment[1]);
    min = Math.min(min, distanceToSegmentPx(clickPoint, a, b));
  });

  return min;
}

function collectSegments(latlngs, segments) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return;

  if (typeof latlngs[0][0] === 'number') {
    for (let i = 1; i < latlngs.length; i++) {
      segments.push([latlngs[i - 1], latlngs[i]]);
    }
    return;
  }

  latlngs.forEach(child => collectSegments(child, segments));
}

function distanceToSegmentPx(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return p.distanceTo(a);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const projection = L.point(a.x + t * dx, a.y + t * dy);
  return p.distanceTo(projection);
}

function initRouteConfirmModal() {
  const modal = $('routeConfirmModal');
  if (!modal) return;

  const close = () => closeRouteConfirmModal();
  const okBtn = $('routeConfirmOkBtn');
  const cancelBtn = $('routeConfirmCancelBtn');
  const closeBtn = $('routeConfirmCloseBtn');

  if (okBtn) okBtn.addEventListener('click', confirmSelectedRoute);
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);

  modal.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      close();
    }
  });
}

function showSelectedLandmark(latlng) {
  if (selectedLandmarkMarker) {
    map.removeLayer(selectedLandmarkMarker);
    selectedLandmarkMarker = null;
  }

  const icon = L.divIcon({
    className: '',
    html: '<div class="selected-landmark"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });

  selectedLandmarkMarker = L.marker(latlng, {
    icon,
    interactive: false,
    zIndexOffset: 900
  }).addTo(map);
}

function showRouteConfirmModal(destination) {
  pendingRouteDestination = destination;

  const modal = $('routeConfirmModal');
  const nameEl = $('routeConfirmName');
  const coordsEl = $('routeConfirmCoords');

  if (nameEl) nameEl.textContent = destination.name || 'Thửa đất đã chọn';
  if (coordsEl) {
    const coords = formatLatLng({ lat: destination.latlng[0], lng: destination.latlng[1] });
    coordsEl.textContent = destination.desc ? destination.desc + ' • ' + coords : coords;
  }

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeRouteConfirmModal() {
  const modal = $('routeConfirmModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function confirmSelectedRoute() {
  if (!pendingRouteDestination) return;

  closeRouteConfirmModal();
  if (typeof beginDirectRoute === 'function') {
    beginDirectRoute(pendingRouteDestination.latlng, pendingRouteDestination.name);
  }
}

function formatArea(layer) {
  if (!(layer instanceof L.Polygon)) return '';
  try {
    if (!L.GeometryUtil) return '';
    const area = L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]);
    return 'Diện tích: ' + (area / 10000).toFixed(2) + ' ha';
  } catch (e) {
    return '';
  }
}

function formatLatLng(latlng) {
  return latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== GEOLOCATION =====
function locateUser(pan) {  if (pan === undefined) pan = true;
  if (!('geolocation' in navigator)) {
    showToast('Trình duyệt không hỗ trợ định vị');
    setUserPosition(DEFAULT_CENTER, null, pan);
    scheduleKMLLoad();
    return;
  }
  showToast('Đang lấy vị trí...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng = [latitude, longitude];
      setUserPosition(latlng, accuracy, pan);
      scheduleKMLLoad();
      if (typeof endPoint !== 'undefined' && endPoint && typeof tryAutoRoute === 'function') {
        tryAutoRoute();
      }
    },
    (err) => {
      console.warn(err);
      const msg = err.code === 1 ? 'Bạn đã từ chối cấp vị trí' : 'Không lấy được vị trí';
      showToast(msg);
      const c = map.getCenter();
      setUserPosition([c.lat, c.lng], null, pan);
      scheduleKMLLoad();
      if (typeof endPoint !== 'undefined' && endPoint && typeof tryAutoRoute === 'function') {
        tryAutoRoute();
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function setUserPosition(latlng, accuracy, pan, heading, navigationMode) {
  if (userMarker) map.removeLayer(userMarker);
  if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

  const hasHeading = Number.isFinite(heading);
  const rotation = hasHeading ? ' style="transform: rotate(' + heading.toFixed(0) + 'deg)"' : '';
  const markerClass = 'user-marker' + (hasHeading ? ' user-marker--heading' : '');
  const icon = L.divIcon({
    className: '',
    html: '<div class="user-marker-wrap"' + rotation + '><div class="' + markerClass + '"></div></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
  userMarker = L.marker(latlng, { icon, interactive: false }).addTo(map);

  if (accuracy && accuracy > 0) {
    userAccuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#4f8cff',
      weight: 1,
      fillColor: '#4f8cff',
      fillOpacity: 0.1,
      interactive: false
    }).addTo(map);
  }

  if (typeof startPoint !== 'undefined') {
    startPoint = latlng;
  }
  if (typeof updateRouteBtnState === 'function') {
    updateRouteBtnState();
  }
  const startInput = $('startAddress');
  if (startInput) startInput.value = formatLatLng({ lat: latlng[0], lng: latlng[1] });

  if (pan && navigationMode) {
    map.panTo(latlng, { animate: true, duration: 0.35 });
  } else if (pan) {
    map.flyTo(latlng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.6 });
  }
}

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setTimeout(() => locateUser(true), 300);
});
