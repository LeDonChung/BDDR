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
let currentBaseLayer = null;

const DEFAULT_CENTER = [13.8241, 107.7628];
const DEFAULT_ZOOM = 15;
const KML_RENDER_PADDING = 0.2;
const KML_RENDER_CHUNK_SIZE = 600;
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

  map.on('moveend zoomend', scheduleVisibleKMLRender);
  map.on('click', onMapBackgroundClick);

  $('locateBtn').addEventListener('click', locateUser);
  $('routeBtn').addEventListener('click', openRoutePanel);

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

// ===== KML =====
function loadDefaultKML() {
  if (kmlLoaded) {
    scheduleVisibleKMLRender();
    return;
  }
  setOverlayVisible(true);
  fetch('BDDR Tong.kml')
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(xml => {
      const run = () => parseAndIndexKML(xml);
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
      else setTimeout(run, 200);
    })
    .catch(err => {
      console.error(err);
      showToast('Không thể tải file KML');
      setOverlayVisible(false);
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

      const polygons = pm.getElementsByTagName('Polygon');
      for (let p = 0; p < polygons.length; p++) {
        const rings = polygons[p].getElementsByTagName('coordinates');
        const latlngs = parseCoords(rings);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('polygon', latlngs, name, desc));
          count++;
        }
      }
      const lines = pm.getElementsByTagName('LineString');
      for (let l = 0; l < lines.length; l++) {
        const cs = lines[l].getElementsByTagName('coordinates');
        const latlngs = parseCoords(cs);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('line', latlngs, name, desc));
          count++;
        }
      }
      const points = pm.getElementsByTagName('Point');
      for (let p = 0; p < points.length; p++) {
        const cs = points[p].getElementsByTagName('coordinates');
        const latlngs = parseCoords(cs);
        if (latlngs.length) {
          kmlFeatures.push(createFeatureRecord('point', latlngs[0], name, desc));
          count++;
        }
      }
    }

    kmlLoaded = true;
    scheduleVisibleKMLRender();
    setOverlayVisible(false);
    showToast('Đã sẵn sàng ' + count + ' đối tượng');
  } catch (err) {
    console.error(err);
    setOverlayVisible(false);
    showToast('Lỗi phân tích KML');
  }
}

function createFeatureRecord(type, latlngs, name, desc) {
  const bounds = type === 'point'
    ? L.latLngBounds([latlngs])
    : L.latLngBounds(flattenLatLngs(latlngs));
  return {
    type,
    latlngs,
    name,
    desc,
    bounds,
    layer: null
  };
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

function scheduleVisibleKMLRender() {
  if (!kmlLoaded || !kmlLayer) return;
  clearTimeout(kmlRenderTimer);
  kmlRenderTimer = setTimeout(renderVisibleKML, 100);
}

function renderVisibleKML() {
  if (!kmlLoaded || !kmlLayer) return;

  const job = ++kmlRenderJob;
  const bounds = map.getBounds().pad(KML_RENDER_PADDING);
  const pending = [];

  kmlFeatures.forEach(feature => {
    const visible = bounds.intersects(feature.bounds);
    if (visible) {
      if (!feature.layer) {
        pending.push(feature);
      }
    } else {
      if (feature.layer) {
        kmlLayer.removeLayer(feature.layer);
        feature.layer = null;
      }
    }
  });

  if (!pending.length) return;

  let index = 0;
  const renderChunk = () => {
    if (job !== kmlRenderJob) return;

    const end = Math.min(index + KML_RENDER_CHUNK_SIZE, pending.length);
    for (; index < end; index++) {
      const feature = pending[index];
      if (!feature.layer && bounds.intersects(feature.bounds)) {
        feature.layer = buildFeatureLayer(feature);
        kmlLayer.addLayer(feature.layer);
      }
    }

    if (index < pending.length) {
      if ('requestIdleCallback' in window) requestIdleCallback(renderChunk, { timeout: 300 });
      else requestAnimationFrame(renderChunk);
    }
  };

  renderChunk();
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
    interactive: true,
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

  attachFeatureHandlers(layer);
  return layer;
}

function textOf(node, tag) {
  const els = node.getElementsByTagName(tag);
  return els && els.length ? (els[0].textContent || '').trim() : '';
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
  }
}

function selectFeature(layer, clickLatLng) {
  lastFeature = layer;

  const center = clickLatLng || (layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng());
  const name = (layer.options && layer.options.pmName) || 'Thửa đất';
  const desc = (layer.options && layer.options.pmDesc) || formatArea(layer);

  showSelectedLandmark(center);
  showRouteConfirmModal({
    latlng: [center.lat, center.lng],
    name,
    desc
  });
}

function findRenderedFeatureAt(latlng) {
  if (!kmlLoaded || !map) return null;

  const clickPoint = map.latLngToLayerPoint(latlng);
  let best = null;
  let bestDistance = Infinity;
  const tolerance = FEATURE_CLICK_TOLERANCE_PX;

  kmlFeatures.forEach(feature => {
    if (!feature.layer) return;

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

  if (typeof setRouteDestination === 'function') {
    setRouteDestination(pendingRouteDestination.latlng, pendingRouteDestination.name);
  }
  closeRouteConfirmModal();

  if (typeof openRoutePanel === 'function') openRoutePanel();
  if (typeof startPoint !== 'undefined' && startPoint && typeof tryAutoRoute === 'function') {
    tryAutoRoute();
  } else if (typeof locateUser === 'function') {
    locateUser(true);
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
