// ===== ROUTING MODULE =====
let startPoint = null;
let endPoint = null;
let routeLayer = null;
let routeRemainingLayer = null;
let routeTraveledLayer = null;
let routeMarkerLayer = null;
let currentDestinationLabel = '';
let activeRoute = null;
let navigationWatchId = null;
let isNavigating = false;
let followUser = true;
let lastNavPosition = null;
let lastRerouteAt = 0;
let deviceHeading = null;
let deviceOrientationActive = false;
let lastHeadingSource = 'none';
let wakeLock = null;
let offRouteSince = null;
let lastAccuracy = null;
let pendingDirectRoute = false;

const OFF_ROUTE_METERS = 60;
const REROUTE_COOLDOWN_MS = 20000;
const ARRIVAL_METERS = 25;
const OFF_ROUTE_CONFIRM_MS = 5000;
const ROUTE_REQUEST_TIMEOUT_MS = 12000;


const routePanel = () => $('routePanel');
const startAddressInput = () => $('startAddress');
const endAddressInput   = () => $('endAddress');
const findRouteBtn      = () => $('findRouteBtn');
const routeDetails      = () => $('routeDetails');
const routeStepsEl      = () => $('routeSteps');
const routeDistanceEl   = () => $('routeDistance');
const routeDurationEl   = () => $('routeDuration');
const navigationCard    = () => $('navigationCard');
const nextDistanceEl    = () => $('nextDistance');
const nextInstructionEl = () => $('nextInstruction');
const navStatusEl       = () => $('navStatus');
const startNavBtn       = () => $('startNavBtn');
const stopNavBtn        = () => $('stopNavBtn');
const recenterNavBtn    = () => $('recenterNavBtn');
const navDriveOverlay   = () => $('navDriveOverlay');
const navDriveDistance  = () => $('navDriveDistance');
const navDriveInstruction = () => $('navDriveInstruction');
const navDriveEta       = () => $('navDriveEta');
const navDriveStatus    = () => $('navDriveStatus');
const navDriveHeading   = () => $('navDriveHeading');
const navDriveStopBtn   = () => $('navDriveStopBtn');
const navDriveRecenterBtn = () => $('navDriveRecenterBtn');

function openRoutePanel() {
  const p = routePanel();
  if (p) {
    p.classList.add('open');
    p.setAttribute('aria-hidden', 'false');
  }
}

function closeRoutePanel() {
  const p = routePanel();
  if (p) {
    p.classList.remove('open');
    p.setAttribute('aria-hidden', 'true');
  }
}

function beginDirectRoute(latlng, label) {
  setRouteDestination(latlng, label || 'Điểm đã chọn');
  closeRoutePanel();

  if (!startPoint) {
    pendingDirectRoute = true;
    showToast('Đang lấy vị trí hiện tại...');
    if (typeof locateUser === 'function') locateUser(false);
    return;
  }

  runDirectRoute();
}

async function runDirectRoute() {
  if (!startPoint || !endPoint) {
    pendingDirectRoute = true;
    return;
  }

  pendingDirectRoute = false;
  closeRoutePanel();
  showToast('Đang tìm đường...');

  await findRoute({ silent: true });

  if (activeRoute) {
    startNavigation();
  }
}

function openGoogleMapsRoute(latlng, label) {
  if (!Array.isArray(latlng) || latlng.length < 2) return;

  setRouteDestination(latlng, label || 'Điểm đã chọn');
  closeRoutePanel();

  const params = new URLSearchParams({
    api: '1',
    destination: routeParamLatLng(latlng),
    travelmode: 'driving'
  });

  if (startPoint) {
    params.set('origin', routeParamLatLng(startPoint));
  }

  window.open('https://www.google.com/maps/dir/?' + params.toString(), '_blank', 'noopener');
}

function routeParamLatLng(latlng) {
  return Number(latlng[0]).toFixed(6) + ',' + Number(latlng[1]).toFixed(6);
}

function initRouting() {
  const closeBtn = $('closeRouteBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeRoutePanel);

  const fr = findRouteBtn();
  if (fr) fr.addEventListener('click', findRoute);

  const clearBtn = $('clearRouteBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearRoute);

  const startBtn = startNavBtn();
  if (startBtn) startBtn.addEventListener('click', startNavigation);

  const stopBtn = stopNavBtn();
  if (stopBtn) stopBtn.addEventListener('click', () => stopNavigation(false));

  const recenterBtn = recenterNavBtn();
  if (recenterBtn) recenterBtn.addEventListener('click', recenterNavigation);

  const driveStopBtn = navDriveStopBtn();
  if (driveStopBtn) driveStopBtn.addEventListener('click', () => stopNavigation(false));

  const driveRecenterBtn = navDriveRecenterBtn();
  if (driveRecenterBtn) driveRecenterBtn.addEventListener('click', recenterNavigation);

  if (typeof map !== 'undefined' && map) {
    map.on('dragstart', () => {
      if (isNavigating) {
        followUser = false;
        updateNavStatus('Đã tạm dừng tự bám bản đồ. Bấm căn giữa để tiếp tục.');
        updateFollowControls();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isNavigating) {
      requestWakeLock();
    }
  });

  // cho phép nhập tọa độ tay vào ô "Đến"
  const endInp = endAddressInput();
  if (endInp) {
    endInp.removeAttribute('readonly');
    endInp.placeholder = 'Tọa độ hoặc chạm vào thửa đất';
    endInp.addEventListener('change', () => {
      const v = endInp.value.trim();
      const m = v.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
      if (m) {
        setRouteDestination([parseFloat(m[1]), parseFloat(m[3])], 'Tọa độ đã nhập');
      }
    });
  }
  updateRouteBtnState();
}

function setRouteDestination(latlng, label) {
  if (!Array.isArray(latlng) || latlng.length < 2) return;
  endPoint = [Number(latlng[0]), Number(latlng[1])];
  currentDestinationLabel = label || formatRouteLatLng(endPoint);

  const endInp = endAddressInput();
  if (endInp) {
    endInp.value = currentDestinationLabel + ' (' + formatRouteLatLng(endPoint) + ')';
  }

  updateRouteBtnState();
}

function updateRouteBtnState() {
  const btn = findRouteBtn();
  if (!btn) return;
  btn.disabled = !(startPoint && endPoint);
}

// Hàm này được script.js gọi tự động khi đã có cả 2 điểm
function tryAutoRoute() {
  if (pendingDirectRoute) {
    runDirectRoute();
    return;
  }

  if (startPoint && endPoint) {
    findRoute({ silent: true });
  }
}

async function findRoute() {
  const options = arguments[0] && !arguments[0].preventDefault ? arguments[0] : {};
  if (!startPoint || !endPoint) {
    showToast('Thiếu điểm xuất phát hoặc điểm đến');
    if (!startPoint && typeof locateUser === 'function') locateUser(true);
    return;
  }
  const btn = findRouteBtn();
  if (!btn) return;
  if (!options.silent) btn.disabled = true;
  const original = btn.innerHTML;
  if (!options.silent) btn.innerHTML = 'Đang tìm đường…';

  try {
    const route = await requestRoute(startPoint, endPoint);
    if (route) {
      displayRoute(route, { fit: !options.keepView, silent: options.silent });
      return route;
    } else {
      showFallbackRoute();
      showToast('Không tìm thấy đường theo dữ liệu đường bộ, đang vẽ tuyến tham khảo');
    }
  } catch (err) {
    console.error(err);
    showFallbackRoute();
    showToast('Lỗi máy chủ định tuyến, đang vẽ tuyến tham khảo');
  } finally {
    btn.disabled = false;
    if (!options.silent) btn.innerHTML = original;
    updateRouteBtnState();
  }
}

async function requestRoute(startLatLng, endLatLng) {
  const start = startLatLng[1] + ',' + startLatLng[0];
  const end = endLatLng[1] + ',' + endLatLng[0];
  const url = 'https://router.project-osrm.org/route/v1/driving/' + start + ';' + end +
              '?steps=true&geometries=geojson&overview=full&alternatives=false&continue_straight=default';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_REQUEST_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new Error('Routing HTTP ' + r.status);
  const data = await r.json();
  if (data.code && data.code !== 'Ok') throw new Error('Routing code ' + data.code);
  return data.routes && data.routes.length ? data.routes[0] : null;
}

function displayRoute(route, options) {
  options = options || {};
  clearRouteLayers();

  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  routeLayer = L.polyline(coords, {
    color: '#93a4bd',
    weight: 5,
    opacity: 0.35,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  routeRemainingLayer = L.polyline(coords, {
    color: '#4f8cff',
    weight: 5,
    opacity: 0.92,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  routeTraveledLayer = L.polyline([], {
    color: '#e8eef7',
    weight: 5,
    opacity: 0.28,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  renderRouteMarkers();

  if (options.fit !== false) {
    fitRouteBounds(routeLayer.getBounds());
  }

  const distance = (route.distance / 1000).toFixed(2);
  const duration = Math.round(route.duration / 60);
  routeDistanceEl().textContent = distance + ' km';
  routeDurationEl().textContent = duration + ' phút';
  activeRoute = normalizeRoute(route, coords);

  let stepsHTML = '';
  activeRoute.steps.forEach((step, index) => {
    stepsHTML += '<div class="step" data-step-index="' + index + '"><strong>Bước ' + (index + 1) + ':</strong> ' +
      escapeHtmlRoute(step.instruction) + ' (' + formatDistance(step.distance) + ')</div>';
  });
  routeStepsEl().innerHTML = stepsHTML;
  routeDetails().hidden = false;
  if (navigationCard()) navigationCard().hidden = false;
  updateNavigationPreview();
  updateNavigationButtons();

  if (isNavigating) {
    updateNavStatus(options.silent ? 'Đã tính lại tuyến đường.' : 'Đang dẫn đường.');
  }
}

function showFallbackRoute() {
  clearRouteLayers();

  routeLayer = L.polyline([startPoint, endPoint], {
    color: '#93a4bd',
    weight: 5,
    opacity: 0.35,
    dashArray: '8 8',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  routeRemainingLayer = L.polyline([startPoint, endPoint], {
    color: '#4f8cff',
    weight: 5,
    opacity: 0.85,
    dashArray: '8 8',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  routeTraveledLayer = L.polyline([], {
    color: '#e8eef7',
    weight: 5,
    opacity: 0.25,
    dashArray: '8 8',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  renderRouteMarkers();
  fitRouteBounds(routeLayer.getBounds());

  const distanceKm = distanceBetween(startPoint, endPoint);
  routeDistanceEl().textContent = distanceKm.toFixed(2) + ' km';
  routeDurationEl().textContent = 'Tham khảo';
  routeStepsEl().innerHTML = '<div class="step"><strong>Tuyến tham khảo:</strong> Không có dữ liệu đường bộ phù hợp, app đang nối trực tiếp từ vị trí hiện tại tới điểm đến.</div>';
  routeDetails().hidden = false;
  if (navigationCard()) navigationCard().hidden = false;
  activeRoute = buildFallbackRoute();
  updateNavigationPreview();
  updateNavigationButtons();
}

function renderRouteMarkers() {
  routeMarkerLayer = L.layerGroup([
    L.circleMarker(startPoint, { radius: 6, color: '#fff', weight: 2, fillColor: '#4ade80', fillOpacity: 1 }),
    L.circleMarker(endPoint, { radius: 6, color: '#fff', weight: 2, fillColor: '#ff5b5b', fillOpacity: 1 })
  ]).addTo(map);
}

function fitRouteBounds(bounds) {
  if (!bounds || !bounds.isValid || !bounds.isValid()) return;
  if (window.innerWidth > 640) {
    map.fitBounds(bounds, {
      paddingTopLeft: [390, 80],
      paddingBottomRight: [90, 90]
    });
  } else {
    map.fitBounds(bounds, {
      paddingTopLeft: [36, 70],
      paddingBottomRight: [36, 260]
    });
  }
}

function clearRouteLayers() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (routeRemainingLayer) {
    map.removeLayer(routeRemainingLayer);
    routeRemainingLayer = null;
  }
  if (routeTraveledLayer) {
    map.removeLayer(routeTraveledLayer);
    routeTraveledLayer = null;
  }
  if (routeMarkerLayer) {
    map.removeLayer(routeMarkerLayer);
    routeMarkerLayer = null;
  }
}

function clearRoute() {
  stopNavigation(false);
  clearRouteLayers();
  endPoint = null;
  currentDestinationLabel = '';
  activeRoute = null;
  const endInp = endAddressInput();
  if (endInp) endInp.value = '';
  routeDetails().hidden = true;
  updateRouteBtnState();
}

function startNavigation() {
  if (!activeRoute || !endPoint) {
    showToast('Hãy tìm đường trước khi bắt đầu dẫn đường');
    return;
  }
  if (!('geolocation' in navigator)) {
    showToast('Trình duyệt không hỗ trợ định vị realtime');
    return;
  }

  if (navigationWatchId !== null) {
    navigator.geolocation.clearWatch(navigationWatchId);
    navigationWatchId = null;
  }

  isNavigating = true;
  followUser = true;
  offRouteSince = null;
  lastAccuracy = null;
  lastHeadingSource = 'none';
  checkLocationPermission();
  requestDeviceHeading();
  requestWakeLock();
  setNavigationDriveMode(true);
  updateNavigationButtons();
  updateFollowControls();
  updateNavStatus('Đang bắt tín hiệu GPS...');
  updateDriveHeadingStatus();

  navigationWatchId = navigator.geolocation.watchPosition(
    onNavigationPosition,
    onNavigationError,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 1000 }
  );
}

function stopNavigation(arrived) {
  if (navigationWatchId !== null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(navigationWatchId);
    navigationWatchId = null;
  }
  isNavigating = false;
  followUser = true;
  offRouteSince = null;
  lastAccuracy = null;
  stopDeviceHeading();
  releaseWakeLock();
  setNavigationDriveMode(false);
  updateNavigationButtons();
  updateFollowControls();
  if (arrived) {
    updateNavStatus('Đã đến gần điểm đích.');
    showToast('Bạn đã đến gần điểm đích');
  } else if (activeRoute) {
    updateNavStatus('Đã dừng dẫn đường.');
  }
}

function onNavigationError(err) {
  console.warn(err);
  const msg = err.code === 1
    ? 'Bạn đã từ chối quyền vị trí. Hãy cấp lại quyền định vị cho trang.'
    : err.code === 3
      ? 'GPS phản hồi chậm, app vẫn đang thử lại...'
      : 'GPS chưa ổn định, đang thử lại...';
  updateNavStatus(msg);
  showToast(msg);
}

function onNavigationPosition(pos) {
  const { latitude, longitude, accuracy, heading } = pos.coords;
  const latlng = [latitude, longitude];
  const computedHeading = getNavigationHeading(latlng, heading);
  lastAccuracy = Number.isFinite(accuracy) ? accuracy : null;

  startPoint = latlng;
  if (typeof setUserPosition === 'function') {
    setUserPosition(latlng, accuracy, followUser, computedHeading, true);
  }
  updateRouteBtnState();

  if (!activeRoute) return;

  const projection = projectOnRoute(latlng, activeRoute);
  const remaining = Math.max(0, activeRoute.totalDistance - projection.along);
  const currentStep = getCurrentStep(projection.along);

  updateRouteProgress(projection.along);
  updateNavigationCard(currentStep, remaining, projection.distance, accuracy);
  highlightCurrentStep(currentStep);

  if (remaining <= ARRIVAL_METERS) {
    stopNavigation(true);
    return;
  }

  handleOffRoute(projection.distance);
}

function getNavigationHeading(latlng, gpsHeading) {
  if (Number.isFinite(gpsHeading) && gpsHeading >= 0) {
    lastNavPosition = latlng;
    lastHeadingSource = 'gps';
    return gpsHeading;
  }

  if (Number.isFinite(deviceHeading)) {
    lastHeadingSource = 'device';
    return deviceHeading;
  }

  if (!lastNavPosition) {
    lastNavPosition = latlng;
    lastHeadingSource = 'none';
    return null;
  }

  const moved = distanceBetween(lastNavPosition, latlng) * 1000;
  if (moved < 3) {
    lastHeadingSource = 'waiting';
    return null;
  }

  const heading = bearingBetween(lastNavPosition, latlng);
  lastNavPosition = latlng;
  lastHeadingSource = 'movement';
  return heading;
}

function maybeReroute(distanceFromRoute) {
  const now = Date.now();
  if (now - lastRerouteAt < REROUTE_COOLDOWN_MS) {
    updateNavStatus('Bạn đang lệch tuyến khoảng ' + Math.round(distanceFromRoute) + ' m.');
    return;
  }

  lastRerouteAt = now;
  updateNavStatus('Đang tính lại tuyến đường...');
  findRoute({ silent: true, keepView: true }).catch(() => {
    updateNavStatus('Chưa tính lại được tuyến, tiếp tục theo tuyến cũ.');
  });
}

function handleOffRoute(distanceFromRoute) {
  if (!Number.isFinite(distanceFromRoute) || distanceFromRoute <= OFF_ROUTE_METERS) {
    offRouteSince = null;
    return;
  }

  const now = Date.now();
  if (!offRouteSince) offRouteSince = now;

  const elapsed = now - offRouteSince;
  if (elapsed < OFF_ROUTE_CONFIRM_MS) {
    updateNavStatus('Có thể đang lệch tuyến khoảng ' + Math.round(distanceFromRoute) + ' m, đang xác nhận GPS...');
    return;
  }

  maybeReroute(distanceFromRoute);
}

function recenterNavigation() {
  followUser = true;
  if (startPoint && typeof map !== 'undefined' && map) {
    map.flyTo(startPoint, Math.max(map.getZoom(), 17), { animate: true, duration: 0.45 });
  }
  updateFollowControls();
  updateNavStatus(isNavigating ? 'Đang bám theo vị trí của bạn.' : 'Đã căn giữa vị trí.');
}

function setNavigationDriveMode(enabled) {
  const overlay = navDriveOverlay();
  document.body.classList.toggle('is-driving', enabled);

  if (overlay) {
    overlay.hidden = !enabled;
    overlay.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }

  const panel = routePanel();
  if (panel && enabled) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  if (enabled) {
    updateDriveOverlay();
  }

  if (typeof map !== 'undefined' && map) {
    setTimeout(() => map.invalidateSize(), 280);
  }
}

function requestDeviceHeading() {
  if (deviceOrientationActive || !('DeviceOrientationEvent' in window)) return;

  const startListening = () => {
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
    window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
    deviceOrientationActive = true;
  };

  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state === 'granted') startListening();
        })
        .catch(() => {});
    } else {
      startListening();
    }
  } catch (e) {
    console.warn(e);
  }
}

async function checkLocationPermission() {
  if (!navigator.permissions || !navigator.permissions.query) return;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (status.state === 'denied') {
      updateNavStatus('Quyền vị trí đang bị chặn. Hãy cấp lại quyền định vị cho trang.');
    } else if (status.state === 'prompt') {
      updateNavStatus('Trình duyệt sẽ hỏi quyền vị trí. Hãy chọn Cho phép.');
    }
  } catch (e) {
    console.warn(e);
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      updateDriveHeadingStatus();
    });
    updateDriveHeadingStatus();
  } catch (e) {
    wakeLock = null;
    console.warn(e);
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

function stopDeviceHeading() {
  if (!deviceOrientationActive) return;
  window.removeEventListener('deviceorientation', onDeviceOrientation, true);
  window.removeEventListener('deviceorientationabsolute', onDeviceOrientation, true);
  deviceOrientationActive = false;
  deviceHeading = null;
}

function onDeviceOrientation(event) {
  const compassHeading = Number(event.webkitCompassHeading);
  const alpha = Number(event.alpha);
  let heading = null;

  if (Number.isFinite(compassHeading)) {
    heading = compassHeading;
  } else if (event.absolute !== false && Number.isFinite(alpha)) {
    heading = 360 - alpha;
  }

  if (Number.isFinite(heading)) {
    deviceHeading = normalizeDegrees(heading);
    lastHeadingSource = 'device';
    updateDriveHeadingStatus();
  }
}

function normalizeRoute(route, coords) {
  const cumulative = buildCumulativeDistances(coords);
  const steps = [];
  let accumulated = 0;

  route.legs.forEach(leg => {
    leg.steps.forEach(step => {
      const distance = step.distance || 0;
      steps.push({
        instruction: instructionFromStep(step),
        distance,
        startDistance: accumulated,
        endDistance: accumulated + distance
      });
      accumulated += distance;
    });
  });

  return {
    coords,
    cumulative,
    totalDistance: route.distance || cumulative[cumulative.length - 1] || 0,
    totalDuration: route.duration || 0,
    steps
  };
}

function buildFallbackRoute() {
  const coords = [startPoint, endPoint];
  const distance = distanceBetween(startPoint, endPoint) * 1000;
  return {
    coords,
    cumulative: buildCumulativeDistances(coords),
    totalDistance: distance,
    totalDuration: 0,
    steps: [{
      instruction: 'Đi tới điểm đích theo tuyến tham khảo',
      distance,
      startDistance: 0,
      endDistance: distance
    }]
  };
}

function buildCumulativeDistances(coords) {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative[i] = cumulative[i - 1] + L.latLng(coords[i - 1][0], coords[i - 1][1]).distanceTo(L.latLng(coords[i][0], coords[i][1]));
  }
  return cumulative;
}

function projectOnRoute(latlng, route) {
  if (!route || !route.coords.length) return { distance: Infinity, along: 0 };
  if (route.coords.length === 1) {
    return { distance: L.latLng(latlng[0], latlng[1]).distanceTo(L.latLng(route.coords[0][0], route.coords[0][1])), along: 0 };
  }

  const p = toMercator(latlng);
  let bestDistance = Infinity;
  let bestAlong = 0;

  for (let i = 1; i < route.coords.length; i++) {
    const a = toMercator(route.coords[i - 1]);
    const b = toMercator(route.coords[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projection = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(p.x - projection.x, p.y - projection.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      const segmentDistance = (route.cumulative[i] || 0) - (route.cumulative[i - 1] || 0);
      bestAlong = (route.cumulative[i - 1] || 0) + segmentDistance * t;
    }
  }

  return { distance: bestDistance, along: bestAlong };
}

function toMercator(latlng) {
  const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
  const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;
  const r = 6378137;
  const x = r * lng * Math.PI / 180;
  const y = r * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return { x, y };
}

function getCurrentStep(along) {
  if (!activeRoute || !activeRoute.steps.length) return null;
  return activeRoute.steps.find(step => step.endDistance >= along + 5) || activeRoute.steps[activeRoute.steps.length - 1];
}

function updateRouteProgress(along) {
  if (!activeRoute || !routeRemainingLayer || !routeTraveledLayer) return;

  const split = splitRouteAtDistance(activeRoute, along);
  routeTraveledLayer.setLatLngs(split.traveled);
  routeRemainingLayer.setLatLngs(split.remaining);
}

function splitRouteAtDistance(route, along) {
  const coords = route.coords || [];
  const cumulative = route.cumulative || [];

  if (!coords.length) return { traveled: [], remaining: [] };
  if (along <= 0) return { traveled: [], remaining: coords };
  if (along >= route.totalDistance) return { traveled: coords, remaining: [] };

  let splitIndex = 1;
  while (splitIndex < cumulative.length && cumulative[splitIndex] < along) {
    splitIndex++;
  }

  const before = coords[splitIndex - 1];
  const after = coords[splitIndex] || before;
  const startDistance = cumulative[splitIndex - 1] || 0;
  const endDistance = cumulative[splitIndex] || startDistance;
  const ratio = endDistance === startDistance ? 0 : (along - startDistance) / (endDistance - startDistance);
  const splitPoint = [
    before[0] + (after[0] - before[0]) * ratio,
    before[1] + (after[1] - before[1]) * ratio
  ];

  return {
    traveled: coords.slice(0, splitIndex).concat([splitPoint]),
    remaining: [splitPoint].concat(coords.slice(splitIndex))
  };
}

function updateNavigationPreview() {
  if (!activeRoute || !activeRoute.steps.length) return;
  const step = activeRoute.steps[0];
  if (nextInstructionEl()) nextInstructionEl().textContent = step.instruction;
  if (nextDistanceEl()) nextDistanceEl().textContent = formatDistance(step.distance);
  if (navDriveInstruction()) navDriveInstruction().textContent = step.instruction;
  if (navDriveDistance()) navDriveDistance().textContent = formatDistance(step.distance);
  updateDriveEta(activeRoute.totalDistance);
  updateNavStatus('Bấm bắt đầu để theo dõi vị trí realtime.');
}

function updateNavigationCard(step, remaining, offRouteDistance, accuracy) {
  if (!step) return;
  const stepRemaining = Math.max(0, step.endDistance - (activeRoute.totalDistance - remaining));
  const stepDistance = formatDistance(stepRemaining);

  if (nextInstructionEl()) nextInstructionEl().textContent = step.instruction;
  if (nextDistanceEl()) nextDistanceEl().textContent = stepDistance;
  if (navDriveInstruction()) navDriveInstruction().textContent = step.instruction;
  if (navDriveDistance()) navDriveDistance().textContent = stepDistance;
  updateDriveEta(remaining);

  const parts = ['Còn ' + formatDistance(remaining)];
  if (accuracy) parts.push('GPS ±' + Math.round(accuracy) + ' m');
  if (offRouteDistance > OFF_ROUTE_METERS) parts.push('lệch tuyến ' + Math.round(offRouteDistance) + ' m');
  updateNavStatus(parts.join(' • '));
  updateDriveHeadingStatus();
}

function highlightCurrentStep(step) {
  if (!step || !routeStepsEl()) return;
  const index = activeRoute.steps.indexOf(step);
  routeStepsEl().querySelectorAll('.step').forEach(el => {
    const active = Number(el.dataset.stepIndex) === index;
    el.classList.toggle('step--active', active);
    if (active) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function updateNavigationButtons() {
  const startBtn = startNavBtn();
  const stopBtn = stopNavBtn();
  if (startBtn) startBtn.hidden = isNavigating || !activeRoute;
  if (stopBtn) stopBtn.hidden = !isNavigating;
  updateFollowControls();
}

function updateNavStatus(text) {
  if (navStatusEl()) navStatusEl().textContent = text;
  if (navDriveStatus()) navDriveStatus().textContent = text;
}

function updateDriveOverlay() {
  if (!activeRoute || !activeRoute.steps.length) return;
  const step = activeRoute.steps[0];
  if (navDriveInstruction()) navDriveInstruction().textContent = step.instruction;
  if (navDriveDistance()) navDriveDistance().textContent = formatDistance(step.distance);
  updateDriveEta(activeRoute.totalDistance);
  updateDriveHeadingStatus();
}

function updateDriveEta(distanceMeters) {
  if (!navDriveEta()) return;
  const durationMinutes = estimateDurationMinutes(distanceMeters);
  const etaParts = ['Còn ' + formatDistance(distanceMeters)];
  if (durationMinutes) etaParts.push(durationMinutes + ' phút');
  navDriveEta().textContent = etaParts.join(' • ');
}

function updateDriveHeadingStatus() {
  const el = navDriveHeading();
  if (!el) return;

  const text = {
    gps: 'Hướng: GPS',
    device: 'Hướng: la bàn điện thoại',
    movement: 'Hướng: theo chiều di chuyển',
    waiting: 'Hướng: di chuyển thêm vài mét',
    none: 'Hướng: đang chờ GPS'
  }[lastHeadingSource] || 'Hướng: đang chờ GPS';

  const parts = [text];
  if (lastAccuracy) parts.push('GPS ±' + Math.round(lastAccuracy) + ' m');
  if (wakeLock) parts.push('màn hình luôn bật');
  el.textContent = parts.join(' • ');
}

function updateFollowControls() {
  const btns = [recenterNavBtn(), navDriveRecenterBtn()].filter(Boolean);
  btns.forEach(btn => {
    btn.classList.toggle('map-fab--active', isNavigating && followUser);
    btn.classList.toggle('icon-btn--active', isNavigating && followUser);
    btn.title = followUser ? 'Đang bám theo vị trí' : 'Căn giữa và bám theo vị trí';
    btn.setAttribute('aria-label', btn.title);
  });
}

function instructionFromStep(step) {
  if (step.maneuver && step.maneuver.instruction) return step.maneuver.instruction;

  const maneuver = step.maneuver || {};
  const modifier = maneuver.modifier || '';
  const type = maneuver.type || '';
  const road = step.name ? ' vào ' + step.name : '';

  const modifierText = {
    left: 'rẽ trái',
    right: 'rẽ phải',
    slight_left: 'chếch trái',
    slight_right: 'chếch phải',
    sharp_left: 'rẽ ngoặt trái',
    sharp_right: 'rẽ ngoặt phải',
    straight: 'đi thẳng',
    uturn: 'quay đầu'
  }[modifier];

  if (type === 'arrive') return 'Đến điểm đích';
  if (type === 'depart') return 'Bắt đầu di chuyển' + road;
  if (modifierText) return modifierText.charAt(0).toUpperCase() + modifierText.slice(1) + road;
  return 'Tiếp tục' + road;
}

function distanceBetween(a, b) {
  const p1 = L.latLng(a[0], a[1]);
  const p2 = L.latLng(b[0], b[1]);
  return p1.distanceTo(p2) / 1000;
}

function bearingBetween(a, b) {
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function formatRouteLatLng(latlng) {
  return Number(latlng[0]).toFixed(5) + ', ' + Number(latlng[1]).toFixed(5);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return Math.max(0, Math.round(meters)) + ' m';
  return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
}

function estimateDurationMinutes(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  if (activeRoute && activeRoute.totalDistance > 0 && activeRoute.totalDuration > 0) {
    const ratio = Math.max(0, Math.min(1, distanceMeters / activeRoute.totalDistance));
    return Math.max(1, Math.round(activeRoute.totalDuration * ratio / 60));
  }
  return Math.max(1, Math.round(distanceMeters / 1000 / 25 * 60));
}

function escapeHtmlRoute(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


