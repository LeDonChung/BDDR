// ===== ROUTING MODULE =====
let startPoint = null;
let endPoint = null;
let routeLayer = null;
let routeMarkerLayer = null;
let currentDestinationLabel = '';


const routePanel = () => $('routePanel');
const startAddressInput = () => $('startAddress');
const endAddressInput   = () => $('endAddress');
const findRouteBtn      = () => $('findRouteBtn');
const routeDetails      = () => $('routeDetails');
const routeStepsEl      = () => $('routeSteps');
const routeDistanceEl   = () => $('routeDistance');
const routeDurationEl   = () => $('routeDuration');

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

function initRouting() {
  const closeBtn = $('closeRouteBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeRoutePanel);

  const fr = findRouteBtn();
  if (fr) fr.addEventListener('click', findRoute);

  const clearBtn = $('clearRouteBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearRoute);

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
  if (startPoint && endPoint) {
    openRoutePanel();
    findRoute();
  } else {
    openRoutePanel();
  }
}

async function findRoute() {
  if (!startPoint || !endPoint) {
    showToast('Thiếu điểm xuất phát hoặc điểm đến');
    if (!startPoint && typeof locateUser === 'function') locateUser(true);
    return;
  }
  const btn = findRouteBtn();
  if (!btn) return;
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = 'Đang tìm đường…';

  const start = startPoint[1] + ',' + startPoint[0];
  const end   = endPoint[1]   + ',' + endPoint[0];
  const url = 'https://router.project-osrm.org/route/v1/driving/' + start + ';' + end +
              '?steps=true&geometries=geojson&overview=full&alternatives=false&continue_straight=default';

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.routes && data.routes.length) {
      displayRoute(data.routes[0]);
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
    btn.innerHTML = original;
    updateRouteBtnState();
  }
}

function displayRoute(route) {
  clearRouteLayers();

  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  routeLayer = L.polyline(coords, {
    color: '#4f8cff',
    weight: 4,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  renderRouteMarkers();

  map.fitBounds(routeLayer.getBounds(), { padding: [70, 70] });

  const distance = (route.distance / 1000).toFixed(2);
  const duration = Math.round(route.duration / 60);
  routeDistanceEl().textContent = distance + ' km';
  routeDurationEl().textContent = duration + ' phút';

  let stepsHTML = '';
  let i = 1;
  route.legs.forEach(leg => {
    leg.steps.forEach(step => {
      const instr = instructionFromStep(step);
      const d = (step.distance / 1000).toFixed(2);
      stepsHTML += '<div class="step"><strong>Bước ' + i + ':</strong> ' + instr + ' (' + d + ' km)</div>';
      i++;
    });
  });
  routeStepsEl().innerHTML = stepsHTML;
  routeDetails().hidden = false;
}

function showFallbackRoute() {
  clearRouteLayers();

  routeLayer = L.polyline([startPoint, endPoint], {
    color: '#4f8cff',
    weight: 4,
    opacity: 0.8,
    dashArray: '8 8',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  renderRouteMarkers();
  map.fitBounds(routeLayer.getBounds(), { padding: [70, 70] });

  const distanceKm = distanceBetween(startPoint, endPoint);
  routeDistanceEl().textContent = distanceKm.toFixed(2) + ' km';
  routeDurationEl().textContent = 'Tham khảo';
  routeStepsEl().innerHTML = '<div class="step"><strong>Tuyến tham khảo:</strong> Không có dữ liệu đường bộ phù hợp, app đang nối trực tiếp từ vị trí hiện tại tới điểm đến.</div>';
  routeDetails().hidden = false;
}

function renderRouteMarkers() {
  routeMarkerLayer = L.layerGroup([
    L.circleMarker(startPoint, { radius: 6, color: '#fff', weight: 2, fillColor: '#4ade80', fillOpacity: 1 }),
    L.circleMarker(endPoint, { radius: 6, color: '#fff', weight: 2, fillColor: '#ff5b5b', fillOpacity: 1 })
  ]).addTo(map);
}

function clearRouteLayers() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (routeMarkerLayer) {
    map.removeLayer(routeMarkerLayer);
    routeMarkerLayer = null;
  }
}

function clearRoute() {
  clearRouteLayers();
  endPoint = null;
  currentDestinationLabel = '';
  const endInp = endAddressInput();
  if (endInp) endInp.value = '';
  routeDetails().hidden = true;
  updateRouteBtnState();
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

function formatRouteLatLng(latlng) {
  return Number(latlng[0]).toFixed(5) + ', ' + Number(latlng[1]).toFixed(5);
}


