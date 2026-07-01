// ===== STATE =====
let map;
let kmlLayer = null;
let userMarker = null;
let userAccuracyCircle = null;
let currentUserHeading = null;
let currentUserLatLng = null;
let appliedMarkerAngle = null;
let rotateTileRefreshTimer = null;
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
let kmlStyleMode = 'street';
let isInitialKMLLoading = false;
let parcelSearchIndex = [];
let parcelSearchActiveIndex = -1;
let parcelSearchResults = [];
let labelFeatures = [];
let labelsLoaded = false;
let labelLayer = null;
let pmtilesLayer = null;
let allowedLoginCodes = new Set();
let currentAuthUser = null;
let currentDataProfile = null;
let appStarted = false;
let permissionModalAction = null;

const DEFAULT_CENTER = [13.8241, 107.7628];
const DEFAULT_ZOOM = 15;
const DATA_ROOT = 'data';
const USERS_SOURCE = DATA_ROOT + '/users.txt';
// false: test local trong repo; true: doc PMTiles tren Cloudflare R2
const USE_R2_PMTILES = true;
const R2_PMTILES_BASE_URL = 'https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/bddr';
const AUTH_STORAGE_KEY = 'bddr-auth-user';
const GEOJSON_DATA_VERSION = '1.0.2';
const KML_CACHE_DB = 'bddr-map-cache';
const KML_CACHE_STORE = 'kml';
const KML_CACHE_KEY_PREFIX = 'bddr-geojson';
const APP_STATE_KEY_PREFIX = 'bddr-app-state';
const KML_RENDER_PADDING = 0.08;
const KML_RENDER_CHUNK_SIZE = 120;
const KML_RENDER_DEBOUNCE_MS = 220;
const KML_INDEX_CELL_SIZE = 0.02;
const KML_TINY_POLYGON_MAX_SPAN = 0.00035;
const KML_DETAIL_TEXT_MIN_ZOOM = 13;
const KML_OVERVIEW_TEXT_MIN_ZOOM = 11;
const KML_DETAIL_LINE_MIN_ZOOM = 11;
const KML_SHORT_LINE_MAX_SPAN = 0.001;
const KML_SHORT_LINE_MIN_ZOOM = 13;
const KML_SMALL_POLYGON_MAX_SPAN = 0.0012;
const KML_SMALL_POLYGON_MIN_ZOOM = 12;
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
const VECTOR_STROKE_WEIGHT = Object.freeze({ detail: 1.15, normal: 1.45 });
const TRUSO_VECTOR_STROKE_WIDTH = Object.freeze({ detail: 2.6, normal: 4.2 });
const TRUSO_KML_STROKE_WEIGHT = Object.freeze({ satellite: 4.2, street: 4.6 });
const GROUP_STYLE_COLORS = Object.freeze({
  RanhOne: '#ffd84d',
  RanhTwo: '#22d3ee',
  RanhThree: '#d946ef',
  RanhFour: '#6366f1',
  RanhFive: '#f97316',
  TruSo: '#ff3b3b'
});

const $ = (id) => document.getElementById(id);

function getPlatformPermissionHint(kind) {
  const ua = navigator.userAgent || '';
  const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  if (kind === 'compass') {
    if (isiOS) return 'iPhone/iPad: vào Cài đặt > Safari > Motion & Orientation Access, bật quyền này rồi mở lại trang.';
    if (isAndroid) return 'Android: mở cài đặt trang trong Chrome, cho phép cảm biến/chuyển động nếu trình duyệt có mục này.';
    return 'Trình duyệt có thể đang chặn cảm biến chuyển động hoặc la bàn. Hãy kiểm tra quyền của trang.';
  }

  if (isiOS) return 'iPhone/iPad: bấm aA hoặc ổ khóa trên thanh địa chỉ, mở Cài đặt trang web và cho phép Vị trí.';
  if (isAndroid) return 'Android: bấm biểu tượng ổ khóa trên thanh địa chỉ, vào Quyền và cho phép Vị trí.';
  return 'Hãy mở cài đặt quyền của trang trong trình duyệt và cho phép Vị trí.';
}

function isIOSLikeDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function useDistinctBoundaryColors() {
  return !!(currentDataProfile && currentDataProfile.userCode === 'doankinhtecty75');
}

function getGroupColor(group) {
  if (group === 'TruSo') return GROUP_STYLE_COLORS.TruSo;
  if (!useDistinctBoundaryColors()) return '';
  return GROUP_STYLE_COLORS[group] || '';
}

function getDefaultFeatureColor() {
  if (!useDistinctBoundaryColors()) return GROUP_STYLE_COLORS.RanhOne;
  return kmlStyleMode === 'satellite' ? GROUP_STYLE_COLORS.RanhOne : '#2563eb';
}

function getVectorFeatureVisualStyle(group, isLine, isDetailLabel) {
  const strokeKey = isDetailLabel ? 'detail' : 'normal';
  const isTruSo = group === 'TruSo';
  const defaultColor = getDefaultFeatureColor();
  const groupColor = getGroupColor(group);

  return {
    strokeColor: isTruSo ? groupColor : ((isLine && groupColor) ? groupColor : defaultColor),
    fillColor: isTruSo ? groupColor : defaultColor,
    strokeOpacity: isDetailLabel ? 0.95 : 1,
    strokeWidth: isTruSo ? TRUSO_VECTOR_STROKE_WIDTH[strokeKey] : VECTOR_STROKE_WEIGHT[strokeKey],
    fillOpacity: isTruSo ? (isDetailLabel ? 0.95 : 0.8) : (isDetailLabel ? 0.95 : 1),
    isTruSo
  };
}

// ===== AUTH / DATA PROFILE =====
function normalizeLoginCode(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function resolveDataProfile(loginCode) {
  const code = normalizeLoginCode(loginCode);
  if (code === 'doankinhtecty75') {
    return {
      userCode: code,
      folder: 'main',
      dataDir: DATA_ROOT + '/main',
      displayName: 'Toàn bộ vùng',
      shortLabel: 'Công ty 75',
      subtitle: 'Bản đồ đất đai - Toàn bộ vùng'
    };
  }

  const teamMatch = code.match(/^cty75doi(\d{1,2})$/);
  if (!teamMatch) return null;

  const teamNumber = Number(teamMatch[1]);
  if (!Number.isInteger(teamNumber) || teamNumber <= 0) return null;

  const padded = String(teamNumber).padStart(2, '0');
  return {
    userCode: code,
    folder: 'doi' + padded,
    dataDir: DATA_ROOT + '/doi' + padded,
    displayName: 'Đội ' + teamNumber,
    shortLabel: 'Đội ' + teamNumber,
    subtitle: 'Bản đồ đất đai - Đội ' + teamNumber
  };
}

function buildPmtilesCandidates(profile) {
  const localSource = profile.dataDir + '/BDDR.pmtiles';
  if (!USE_R2_PMTILES) return [localSource];

  const remoteFolderSource = R2_PMTILES_BASE_URL + '/' + profile.folder + '/BDDR.pmtiles';
  // Giữ tương thích bản main cũ nếu trên R2 vẫn đang để ở root /bddr/BDDR.pmtiles
  if (profile.folder === 'main') {
    return [remoteFolderSource, R2_PMTILES_BASE_URL + '/BDDR.pmtiles', localSource];
  }

  return [remoteFolderSource, localSource];
}

function withProfileSources(profile) {
  const pmtilesCandidates = buildPmtilesCandidates(profile);
  return Object.assign({}, profile, {
    pmtilesCandidates,
    pmtilesSource: pmtilesCandidates[0],
    labelsSource: profile.dataDir + '/BDDR-labels.geojson',
    geojsonSource: profile.dataDir + '/BDDR.geojson'
  });
}

function getKMLCacheKey() {
  return KML_CACHE_KEY_PREFIX + ':' + (currentDataProfile ? currentDataProfile.folder : 'default');
}

function getAppStateKey() {
  return APP_STATE_KEY_PREFIX + ':' + (currentDataProfile ? currentDataProfile.folder : 'default');
}

async function loadAllowedLoginCodes() {
  const response = await fetch(USERS_SOURCE, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const codes = (await response.text())
    .split(/\r?\n/)
    .map(line => normalizeLoginCode(line.replace(/#.*/, '')))
    .filter(Boolean);

  if (!codes.length) throw new Error('Danh sách đăng nhập trống');
  allowedLoginCodes = new Set(codes);
}

function initLoginUI() {
  const form = $('loginForm');
  const accountBtn = $('accountBtn');

  if (form) form.addEventListener('submit', onLoginSubmit);
  if (accountBtn) accountBtn.addEventListener('click', logoutAndReload);
}

function setLoginError(message) {
  const el = $('loginError');
  if (el) el.textContent = message || '';
}

function setLoginBusy(busy, message) {
  const input = $('loginCodeInput');
  const button = $('loginSubmitBtn');
  if (input) input.disabled = !!busy;
  if (button) button.disabled = !!busy;
  if (message !== undefined) setLoginError(message);
}

function showLoginScreen(message) {
  const screen = $('loginScreen');
  if (screen) {
    screen.hidden = false;
    screen.setAttribute('aria-hidden', 'false');
  }
  setLoginBusy(false, message || '');
  const input = $('loginCodeInput');
  if (input) setTimeout(() => input.focus(), 40);
}

function hideLoginScreen() {
  const screen = $('loginScreen');
  if (!screen) return;
  screen.hidden = true;
  screen.setAttribute('aria-hidden', 'true');
}

function applyDataProfileToUI() {
  if (!currentDataProfile) return;

  const subtitle = $('appSubtitle');
  if (subtitle) subtitle.textContent = currentDataProfile.subtitle;

  const accountLabel = $('accountLabel');
  if (accountLabel) accountLabel.textContent = currentDataProfile.shortLabel;

  const accountBtn = $('accountBtn');
  if (accountBtn) {
    accountBtn.title = 'Đổi đơn vị (' + currentDataProfile.displayName + ')';
    accountBtn.setAttribute('aria-label', 'Đổi đơn vị');
  }
}

function startAppForUser(loginCode) {
  const normalized = normalizeLoginCode(loginCode);
  if (!allowedLoginCodes.has(normalized)) {
    throw new Error('Mã đăng nhập không hợp lệ');
  }

  const profile = resolveDataProfile(normalized);
  if (!profile) {
    throw new Error('Mã đăng nhập chưa có cấu hình dữ liệu');
  }

  currentAuthUser = normalized;
  currentDataProfile = withProfileSources(profile);
  localStorage.setItem(AUTH_STORAGE_KEY, normalized);
  labelsLoaded = false;
  labelFeatures = [];
  applyDataProfileToUI();
  hideLoginScreen();

  if (appStarted) return;
  appStarted = true;
  initMap();
  setTimeout(() => locateUser(!loadAppState()), 80);
}

function onLoginSubmit(event) {
  event.preventDefault();
  const input = $('loginCodeInput');
  const code = normalizeLoginCode(input ? input.value : '');
  if (!code) {
    setLoginError('Vui lòng nhập mã đăng nhập');
    if (input) input.focus();
    return;
  }

  try {
    setLoginBusy(true, '');
    startAppForUser(code);
  } catch (err) {
    setLoginBusy(false, err.message || 'Không thể đăng nhập');
    if (input) input.focus();
  }
}

function logoutAndReload() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.reload();
}

async function bootstrapApp() {
  initLoginUI();
  setLoginBusy(true, 'Đang đọc danh sách đăng nhập...');

  try {
    await loadAllowedLoginCodes();
  } catch (err) {
    console.error('Không thể đọc danh sách đăng nhập', err);
    showLoginScreen('Không đọc được data/users.txt');
    return;
  }

  const savedUser = normalizeLoginCode(localStorage.getItem(AUTH_STORAGE_KEY));
  if (savedUser && allowedLoginCodes.has(savedUser)) {
    try {
      startAppForUser(savedUser);
      return;
    } catch (err) {
      console.warn('Không thể khôi phục đăng nhập', err);
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  showLoginScreen('');
}

// ===== TILE LAYERS =====
const osmLayer = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 21,
    maxNativeZoom: 19,
    minZoom: 2,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 3,
    subdomains: 'abcd'
  }
);

const satelliteLayer = L.tileLayer(
  'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  {
    attribution: 'Imagery &copy; Google',
    maxZoom: 21,
    maxNativeZoom: 21,
    minZoom: 2,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 2
  }
);

// ===== INIT MAP =====
function initMap() {
  const savedState = loadAppState();
  const initialCenter = savedState && savedState.center ? savedState.center : DEFAULT_CENTER;
  const initialZoom = savedState && Number.isFinite(savedState.zoom) ? savedState.zoom : DEFAULT_ZOOM;
  const initialBearing = savedState && Number.isFinite(savedState.bearing) ? savedState.bearing : 0;

  map = L.map('map', {
    center: initialCenter,
    zoom: initialZoom,
    maxZoom: 21,
    zoomControl: true,
    preferCanvas: true,
    renderer: L.canvas({ padding: 0.5, tolerance: FEATURE_CLICK_TOLERANCE_PX }),
    worldCopyJump: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 72,
    inertia: true,
    inertiaDeceleration: 3400,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: true,
    tap: true,
    tapTolerance: FEATURE_CLICK_TOLERANCE_PX,
    rotate: true,
    touchRotate: true,
    bearing: initialBearing,
    rotateControl: {
      closeOnZeroBearing: false,
      position: 'topleft'
    }
  });

  currentBaseLayer = savedState && savedState.baseLayer === 'street' ? osmLayer : satelliteLayer;
  kmlStyleMode = currentBaseLayer === satelliteLayer ? 'satellite' : 'street';
  currentBaseLayer.addTo(map);

  L.control.layers(
    {
      'Đường phố': osmLayer,
      'Vệ tinh': satelliteLayer
    },
    null,
    {
      position: 'bottomright',
      collapsed: true
    }
  ).addTo(map);

  map.on('movestart', cancelKMLRender);
  map.on('zoomstart', onKMLZoomStart);
  map.on('moveend', () => {
    scheduleVisibleKMLRender(140);
    saveAppStateDebounced();
  });
  map.on('zoomend', () => {
    scheduleVisibleKMLRender(320);
    saveAppStateDebounced();
  });
  map.on('baselayerchange', onBaseLayerChange);
  map.on('click', onMapBackgroundClick);
  map.on('rotate', onMapRotate);

  $('locateBtn').addEventListener('click', () => locateUser(true, { userInitiated: true }));
  $('routeBtn').addEventListener('click', promptRoutePick);

  initRouting();
  initPermissionModal();
  initRouteConfirmModal();
  initParcelSearch();
  setOverlayVisible(false);
}

function setOverlayVisible(visible) {
  const ov = $('loadingOverlay');
  if (!ov) return;
  if (visible) ov.classList.remove('hidden');
  else ov.classList.add('hidden');
}


function updateLoadingProgress(percent, message) {
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const overlay = $('loadingOverlay');
  const text = $('loadingText');
  const bar = $('loadingBar');
  const label = $('loadingPercent');
  const progress = overlay ? overlay.querySelector('.loading-progress') : null;

  if (!isInitialKMLLoading) return;
  if (overlay) overlay.classList.remove('hidden');
  if (text && message) text.textContent = message;
  if (bar) bar.style.width = value + '%';
  if (label) label.textContent = value + '%';
  if (progress) progress.setAttribute('aria-valuenow', String(value));
}

function finishLoadingProgress(message) {
  if (!isInitialKMLLoading) return;
  updateLoadingProgress(100, message || 'Hoàn tất');
  clearTimeout(finishLoadingProgress._timer);
  finishLoadingProgress._timer = setTimeout(() => {
    isInitialKMLLoading = false;
    setOverlayVisible(false);
  }, 350);
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

function getCurrentPositionAsync(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function showLocationPermissionBlocked(onRetry) {
  showPermissionModal({
    title: 'Cần quyền vị trí',
    message: 'Trình duyệt đang chặn quyền vị trí nên app chưa lấy được GPS hiện tại.',
    hint: getPlatformPermissionHint('location'),
    cancelLabel: 'Đóng',
    actionLabel: typeof onRetry === 'function' ? 'Thử lại' : '',
    onAction: onRetry || null
  });
}

function showCompassPermissionBlocked(onRetry) {
  showPermissionModal({
    title: 'Cần quyền la bàn',
    message: 'Thiết bị hoặc trình duyệt đang chặn truy cập cảm biến chuyển động/la bàn.',
    hint: getPlatformPermissionHint('compass'),
    cancelLabel: 'Đóng',
    actionLabel: typeof onRetry === 'function' ? 'Thử lại' : '',
    onAction: onRetry || null
  });
}

function showPermissionModal(options) {
  options = options || {};
  const modal = $('permissionModal');
  if (!modal) {
    if (options.message) showToast(options.message, 3200);
    return;
  }

  const titleEl = $('permissionModalTitle');
  const messageEl = $('permissionModalMessage');
  const hintEl = $('permissionModalHint');
  const actionsEl = $('permissionModalActions');
  const cancelBtn = $('permissionModalCancelBtn');
  const actionBtn = $('permissionModalActionBtn');

  permissionModalAction = typeof options.onAction === 'function' ? options.onAction : null;

  if (titleEl) titleEl.textContent = options.title || 'Cần cấp quyền truy cập';
  if (messageEl) messageEl.textContent = options.message || '';
  if (hintEl) {
    hintEl.textContent = options.hint || '';
    hintEl.hidden = !options.hint;
  }
  if (cancelBtn) {
    cancelBtn.textContent = options.cancelLabel || 'Đóng';
  }
  if (actionBtn) {
    const hasAction = !!options.actionLabel && permissionModalAction;
    actionBtn.hidden = !hasAction;
    actionBtn.textContent = hasAction ? options.actionLabel : 'Thử lại';
  }
  if (actionsEl) {
    actionsEl.classList.toggle('modal__actions--single', !(options.actionLabel && permissionModalAction));
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closePermissionModal() {
  const modal = $('permissionModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  permissionModalAction = null;
}

function initPermissionModal() {
  const modal = $('permissionModal');
  if (!modal) return;

  const close = () => closePermissionModal();
  const cancelBtn = $('permissionModalCancelBtn');
  const actionBtn = $('permissionModalActionBtn');
  const closeBtn = $('permissionModalCloseBtn');

  if (cancelBtn) cancelBtn.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (actionBtn) {
    actionBtn.addEventListener('click', () => {
      const action = permissionModalAction;
      closePermissionModal();
      if (typeof action === 'function') action();
    });
  }

  modal.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      close();
    }
  });
}

function getLocationPermissionState() {
  if (!navigator.permissions || !navigator.permissions.query) {
    return Promise.resolve('unknown');
  }
  return navigator.permissions.query({ name: 'geolocation' })
    .then(status => (status && status.state) ? status.state : 'unknown')
    .catch(() => 'unknown');
}

function requestLocationFix(options) {
  const settings = Object.assign({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
    announcePrompt: false
  }, options || {});

  if (!('geolocation' in navigator)) {
    return Promise.reject(Object.assign(new Error('Geolocation unsupported'), { code: 0 }));
  }

  return getLocationPermissionState().then(state => {
    if (settings.announcePrompt && state === 'prompt') {
      showToast('Trình duyệt sẽ hỏi quyền vị trí. Hãy chọn Cho phép.', 2600);
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: settings.enableHighAccuracy,
        timeout: settings.timeout,
        maximumAge: settings.maximumAge
      });
    });
  });
}

function getLocationHelpReason(err) {
  if (!window.isSecureContext) return 'insecure';
  if (!('geolocation' in navigator)) return 'unsupported';
  if (err && err.code === 1) return 'denied';
  return 'unavailable';
}

function showLocationPermissionHelp(options) {
  options = options || {};
  const reason = options.reason || 'denied';
  const ios = isIOSLikeDevice();
  let title = 'Chưa truy cập được vị trí';
  let message = 'Trình duyệt chưa cho app lấy được vị trí hiện tại.';
  let hint = ios
    ? 'Safari: chạm aA > Website Settings > Location > Allow, rồi quay lại app.'
    : 'Chrome/Android: mở biểu tượng ổ khóa hoặc Site settings > Location > Allow, rồi quay lại app.';

  if (reason === 'unsupported') {
    title = 'Trình duyệt không hỗ trợ định vị';
    message = 'Thiết bị hoặc WebView hiện tại không cung cấp Geolocation API cho trang web này.';
    hint = 'Hãy mở app bằng Safari hoặc Chrome hệ thống trên điện thoại.';
  } else if (reason === 'insecure') {
    title = 'Vị trí cần HTTPS';
    message = 'Trang này đang chạy ngoài secure context nên nhiều máy Android/iPhone sẽ chặn vị trí và cảm biến.';
    hint = 'Hãy mở trang bằng HTTPS hoặc localhost để trình duyệt cho phép định vị.';
  } else if (reason === 'unavailable') {
    title = 'GPS chưa sẵn sàng';
    message = 'Thiết bị chưa trả về được tọa độ hiện tại.';
    hint = 'Hãy bật GPS chính xác cao, ra nơi thoáng hơn rồi bấm Thử lại.';
  } else {
    title = 'Quyền vị trí đang bị chặn';
    message = 'Nếu bạn đã bấm Từ chối trước đó, trình duyệt có thể không hiện lại popup hệ thống cho tới khi quyền của trang được bật lại.';
  }

  const canRetry = typeof options.onRetry === 'function' && reason !== 'unsupported' && reason !== 'insecure';
  showPermissionModal({
    title,
    message,
    hint,
    cancelLabel: 'Đóng',
    actionLabel: canRetry ? 'Thử lại' : '',
    onAction: canRetry ? options.onRetry : null
  });
}

function promptRoutePick() {
  if (typeof closeRoutePanel === 'function') closeRoutePanel();
  closeRouteConfirmModal();
  showToast('Chạm điểm bất kỳ trên bản đồ để chỉ đường');
}

// ===== KML =====
async function dataAssetExists(source) {
  if (!source) return false;
  try {
    const response = await fetch(source, { method: 'HEAD', cache: 'no-store' });
    return response.ok;
  } catch (err) {
    return false;
  }
}

async function resolveFirstAvailableSource(sources) {
  for (const source of sources || []) {
    if (await dataAssetExists(source)) return source;
  }
  return '';
}

async function loadGeoJSONFallback(source) {
  const response = await fetch(source, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' khi tải ' + source);
  parseAndIndexGeoJSON(await response.text());
}

async function loadDefaultKML() {
  if (kmlLoaded) {
    scheduleVisibleKMLRender();
    return;
  }

  if (!currentDataProfile) {
    showLoginScreen('Vui lòng đăng nhập lại');
    return;
  }

  isInitialKMLLoading = true;
  updateLoadingProgress(8, 'Đang tải dữ liệu ' + currentDataProfile.displayName + '...');

  try {
    // Ưu tiên 1: tải nhãn (file nhỏ) để search hoạt động ngay.
    updateLoadingProgress(40, 'Đang tải dữ liệu tìm kiếm...');
    await awaitLabelsLoad();

    const resolvedPmtilesSource = await resolveFirstAvailableSource(currentDataProfile.pmtilesCandidates);
    if (resolvedPmtilesSource && window.protomapsL) {
      currentDataProfile.pmtilesSource = resolvedPmtilesSource;
      // Ưu tiên 2: hiển thị basemap + user marker trước, PMTiles vector load
      // chậm hơn 1 chút qua requestIdleCallback để bản đồ không bị giật khi vừa mở.
      updateLoadingProgress(70, 'Đang tải các lớp vector...');
      const schedulePMTiles = () => loadPMTilesLayer();
      if ('requestIdleCallback' in window) {
        requestIdleCallback(schedulePMTiles, { timeout: 1500 });
      } else {
        setTimeout(schedulePMTiles, 220);
      }

      kmlLoaded = true;
      kmlFeatures = [];
      kmlActiveFeatures = new Set();
      kmlFeatureGrid = new Map();
      kmlLargeFeatures = [];
      ctyCodeLabelBounds = [];
      buildParcelSearchIndex();

      finishLoadingProgress('Đã sẵn sàng');
      showToast('Đã tải bản đồ ' + currentDataProfile.displayName);
      return;
    }

    const geojsonReady = await dataAssetExists(currentDataProfile.geojsonSource);
    if (geojsonReady) {
      updateLoadingProgress(70, 'Đang tải GeoJSON...');
      await loadGeoJSONFallback(currentDataProfile.geojsonSource);
      return;
    }

    throw new Error('Chưa có BDDR.pmtiles hoặc BDDR.geojson cho ' + currentDataProfile.folder);
  } catch (err) {
    console.error(err);
    isInitialKMLLoading = false;
    showToast('Không thể tải bản đồ');
    setOverlayVisible(false);
  }
}

// ===== PMTILES SYMBOLIZER =====
// Định nghĩa 1 lần. Tối ưu:
// - Batch fill/stroke: gộp tất cả ring vào 1 path → 1 fill/stroke thay vì N lần.
// - Simplify path: giảm điểm thừa bằng Douglas-Peucker khi đang zoom.
// - Skip tiny: bỏ qua polygon có tổng diện tích < 4px² (không thấy được).
class BDDRVectorSymbolizer {
  draw(context, geom, z, feature) {
    if (!geom || !geom.length) return;

    const props = feature && feature.props ? feature.props : {};
    const isDetailLabel = props.level === 4 || props.level === '4';
    const isLine = feature && (feature.geomType === 2 || feature.type === 2);

    // Giữ feel hiển thị cũ cho phần polygon/text:
    // - fill/stroke mặc định theo basemap
    // - chỉ dùng màu layer cho nét line của Ranh*
    // - TruSo vẫn là ngoại lệ màu đỏ như cũ
    const group = String(props.group || '');
    const visual = getVectorFeatureVisualStyle(group, isLine, isDetailLabel);

    // Vẽ polygon: mỗi ring 1 path riêng để fill đúng even-odd
    if (!isLine) {
      context.fillStyle = visual.fillColor;
      context.strokeStyle = visual.strokeColor;
      context.lineWidth = visual.strokeWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.globalAlpha = visual.fillOpacity;
      for (let r = 0; r < geom.length; r++) {
        const ring = geom[r];
        if (!ring || ring.length < 3) continue;
        context.beginPath();
        context.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) {
          context.lineTo(ring[i].x, ring[i].y);
        }
        context.closePath();
        context.fill();
        if (visual.isTruSo) {
          context.globalAlpha = 1;
          context.stroke();
          context.globalAlpha = visual.fillOpacity;
        }
      }
      context.globalAlpha = 1;
    }

    // Vẽ line: tất cả rings gộp vào 1 path → 1 stroke duy nhất
    if (isLine) {
      context.strokeStyle = visual.strokeColor;
      context.lineWidth = visual.strokeWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.globalAlpha = visual.strokeOpacity;
      context.beginPath();
      for (let r = 0; r < geom.length; r++) {
        const ring = geom[r];
        if (!ring || ring.length < 2) continue;
        context.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) {
          context.lineTo(ring[i].x, ring[i].y);
        }
      }
      context.stroke();
      context.globalAlpha = 1;
    }
  }
}

// PMTiles đã có internal cache - không cần thêm fetch cache
// Để tile không reload khi zoom, dùng browser cache headers

function loadPMTilesLayer() {
  if (pmtilesLayer || !window.protomapsL || !currentDataProfile) return;

  const rotateParent = map.getPane('rotatePane') || map.getPane('mapPane');
  if (!map.getPane('pmtilesPane')) {
    map.createPane('pmtilesPane', rotateParent);
  }
  const pmtilesPaneEl = map.getPane('pmtilesPane');
  if (rotateParent && pmtilesPaneEl.parentNode !== rotateParent) {
    rotateParent.appendChild(pmtilesPaneEl);
  }
  pmtilesPaneEl.style.zIndex = '420';
  pmtilesPaneEl.style.pointerEvents = 'none';
  pmtilesPaneEl.style.background = 'transparent';

  pmtilesLayer = protomapsL.leafletLayer({
    url: currentDataProfile.pmtilesSource,
    pane: 'pmtilesPane',
    backgroundColor: 'rgba(0,0,0,0)',
    paintRules: [{ dataLayer: 'bddr', symbolizer: new BDDRVectorSymbolizer() }],
    labelRules: [],
    maxDataZoom: 16,
    noWrap: true
  });
  
  pmtilesLayer.addTo(map);
}

function openKMLCacheDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(KML_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KML_CACHE_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadCachedKMLText() {
  const db = await openKMLCacheDB();
  if (!db) return null;

  return new Promise((resolve) => {
    const tx = db.transaction(KML_CACHE_STORE, 'readonly');
    const request = tx.objectStore(KML_CACHE_STORE).get(getKMLCacheKey());
    request.onsuccess = () => {
      const record = request.result;
      resolve(record && record.version === GEOJSON_DATA_VERSION ? record.text : null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function saveCachedKMLText(xml) {
  let db;
  try {
    db = await openKMLCacheDB();
  } catch (err) {
    console.warn('Không thể mở cache IndexedDB', err);
    return false;
  }
  if (!db) return false;

  return new Promise((resolve) => {
    const tx = db.transaction(KML_CACHE_STORE, 'readwrite');
    tx.objectStore(KML_CACHE_STORE).put({
      key: getKMLCacheKey(),
      version: GEOJSON_DATA_VERSION,
      text: xml,
      savedAt: Date.now()
    });
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  });
}

function loadAppState() {
  try {
    const state = JSON.parse(localStorage.getItem(getAppStateKey()) || 'null');
    if (!state || !Array.isArray(state.center) || state.center.length !== 2) return null;
    if (!state.center.every(Number.isFinite)) return null;
    return state;
  } catch (err) {
    return null;
  }
}

function saveAppStateDebounced() {
  clearTimeout(saveAppStateDebounced._timer);
  saveAppStateDebounced._timer = setTimeout(saveAppState, 350);
}

function saveAppState() {
  if (!map) return;
  const center = map.getCenter();
  const bearing = (typeof map.getBearing === 'function') ? map.getBearing() : 0;
  localStorage.setItem(getAppStateKey(), JSON.stringify({
    center: [center.lat, center.lng],
    zoom: map.getZoom(),
    bearing: Number.isFinite(bearing) ? bearing : 0,
    baseLayer: currentBaseLayer === satelliteLayer ? 'satellite' : 'street'
  }));
}
function parseAndIndexGeoJSON(geoJsonText) {
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

    updateLoadingProgress(52, 'Đang đọc dữ liệu GeoJSON...');
    const geojson = JSON.parse(geoJsonText);
    const sourceFeatures = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
    let count = 0;

    sourceFeatures.forEach((feature, index) => {
      if (!feature || feature.type !== 'Feature' || !feature.geometry) return;
      const properties = feature.properties || {};
      const name = properties.name || ('Thửa ' + (index + 1));
      const desc = properties.description || '';
      const level = Number.isFinite(Number(properties.level)) ? Number(properties.level) : null;
      const group = String(properties.group || '');
      count += addGeoJSONGeometry(feature.geometry, name, desc, level, group, properties);
    });

    kmlLoaded = true;
    updateLoadingProgress(72, 'Đang gom nhãn và lập chỉ mục...');
    classifyCtyCodeLabelClusters();
    buildKMLSpatialIndex();
    buildParcelSearchIndex();
    finishLoadingProgress('Đã sẵn sàng');
    scheduleVisibleKMLRender(360);
    showToast('Đã sẵn sàng ' + count + ' đối tượng');
  } catch (err) {
    console.error(err);
    isInitialKMLLoading = false;
    setOverlayVisible(false);
    showToast('Lỗi phân tích GeoJSON');
  }
}

function addGeoJSONGeometry(geometry, name, desc, level, group, properties) {
  if (!geometry) return 0;

  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).reduce((total, child) => {
      return total + addGeoJSONGeometry(child, name, desc, level, group, properties);
    }, 0);
  }

  if (geometry.type === 'Polygon') {
    const latlngs = geoJSONPolygonToLatLngs(geometry.coordinates);
    if (!latlngs.length) return 0;
    kmlFeatures.push(createFeatureRecord('polygon', latlngs, name, desc, level, group, properties));
    return 1;
  }

  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).reduce((total, polygon) => {
      const latlngs = geoJSONPolygonToLatLngs(polygon);
      if (!latlngs.length) return total;
      kmlFeatures.push(createFeatureRecord('polygon', latlngs, name, desc, level, group, properties));
      return total + 1;
    }, 0);
  }

  if (geometry.type === 'LineString') {
    const latlngs = geoJSONLineToLatLngs(geometry.coordinates);
    if (!latlngs.length) return 0;
    kmlFeatures.push(createFeatureRecord('line', latlngs, name, desc, level, group, properties));
    return 1;
  }

  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates || []).reduce((total, line) => {
      const latlngs = geoJSONLineToLatLngs(line);
      if (!latlngs.length) return total;
      kmlFeatures.push(createFeatureRecord('line', latlngs, name, desc, level, group, properties));
      return total + 1;
    }, 0);
  }

  if (geometry.type === 'Point') {
    const latlng = geoJSONPositionToLatLng(geometry.coordinates);
    if (!latlng) return 0;
    kmlFeatures.push(createFeatureRecord('point', latlng, name, desc, level, group, properties));
    return 1;
  }

  if (geometry.type === 'MultiPoint') {
    return (geometry.coordinates || []).reduce((total, point) => {
      const latlng = geoJSONPositionToLatLng(point);
      if (!latlng) return total;
      kmlFeatures.push(createFeatureRecord('point', latlng, name, desc, level, group, properties));
      return total + 1;
    }, 0);
  }

  return 0;
}

function geoJSONPolygonToLatLngs(rings) {
  return (rings || [])
    .map(geoJSONLineToLatLngs)
    .filter(ring => ring.length);
}

function geoJSONLineToLatLngs(coordinates) {
  return (coordinates || [])
    .map(geoJSONPositionToLatLng)
    .filter(Boolean);
}

function geoJSONPositionToLatLng(position) {
  if (!Array.isArray(position) || position.length < 2) return null;
  const lng = Number(position[0]);
  const lat = Number(position[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
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

    updateLoadingProgress(52, 'Đang đọc dữ liệu thửa đất...');
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
    updateLoadingProgress(72, 'Đang gom nhãn và lập chỉ mục...');
    classifyCtyCodeLabelClusters();
    buildKMLSpatialIndex();
    buildParcelSearchIndex();
    finishLoadingProgress('Đã sẵn sàng');
    scheduleVisibleKMLRender(360);
    showToast('Đã sẵn sàng ' + count + ' đối tượng');
  } catch (err) {
    console.error(err);
    isInitialKMLLoading = false;
    setOverlayVisible(false);
    showToast('Lỗi phân tích KML');
  }
}

function createFeatureRecord(type, latlngs, name, desc, level, group, properties) {
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
    group,
    properties: properties || {},
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
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1600);
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

  if (!pending.length) {
    if (!kmlLayer._initialRenderDone) {
      kmlLayer._initialRenderDone = true;
      finishLoadingProgress('Đã sẵn sàng');
    }
    return;
  }

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
    } else if (!kmlLayer._initialRenderDone) {
      kmlLayer._initialRenderDone = true;
      finishLoadingProgress('Đã sẵn sàng');
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
  const style = getKMLFeatureStyle(feature);
  const options = {
    color: style.color,
    weight: style.weight,
    opacity: style.opacity,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
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

function onBaseLayerChange(event) {
  currentBaseLayer = event.layer;
  kmlStyleMode = currentBaseLayer === satelliteLayer ? 'satellite' : 'street';
  updatePMTilesLayerStyles();
  updateKMLLayerStyles();
  saveAppState();
}

function updatePMTilesLayerStyles() {
  if (!pmtilesLayer) return;
  // Chỉ redraw, KHÔNG remove/re-add để tránh reload tiles
  if (typeof pmtilesLayer.redraw === 'function') {
    pmtilesLayer.redraw();
  }
  // Không remove/re-add nữa - gây reload không cần thiết
}

function getKMLFeatureStyle(feature) {
  const groupColor = getGroupColor(feature && feature.group);
  const defaultColor = getDefaultFeatureColor();
  const isTruSo = feature && feature.group === 'TruSo';
  const isLine = feature && feature.type === 'line';
  if (isTruSo) {
    return {
      color: groupColor,
      fillColor: groupColor,
      opacity: 0.95,
      fillOpacity: kmlStyleMode === 'satellite' ? 0.4 : 0.32,
      weight: TRUSO_KML_STROKE_WEIGHT[kmlStyleMode]
    };
  }

  if (groupColor && isLine) {
    return {
      color: groupColor,
      fillColor: defaultColor,
      opacity: 0.95,
      fillOpacity: 0.08,
      weight: kmlStyleMode === 'satellite' ? 1.5 : 1.8
    };
  }

  if (kmlStyleMode === 'satellite') {
    return { color: defaultColor, fillColor: defaultColor, opacity: 0.95, fillOpacity: 0.08, weight: 1.5 };
  }
  // Street mode (CartoDB Voyager - nen sang) - mau xanh duong dam noi tren nen sang
  return { color: defaultColor, fillColor: defaultColor, opacity: 0.95, fillOpacity: 0.08, weight: 1.8 };
}

function updateKMLLayerStyles() {
  kmlActiveFeatures.forEach(feature => {
    if (feature.layer && typeof feature.layer.setStyle === 'function') {
      feature.layer.setStyle(getKMLFeatureStyle(feature));
    }
  });
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

function initParcelSearch() {
  const input = $('parcelSearchInput');
  const suggestions = $('parcelSearchSuggestions');
  const clearBtn = $('parcelSearchClearBtn');
  if (!input || !suggestions) return;

  const syncClearButton = () => input.closest('.app-search')?.classList.toggle('has-value', input.value.trim().length > 0);

  input.addEventListener('input', () => {
    syncClearButton();
    showParcelSearchSuggestions(input.value);
  });
  input.addEventListener('focus', () => showParcelSearchSuggestions(input.value));
  input.addEventListener('keydown', onParcelSearchKeyDown);
  if (clearBtn) {
    clearBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      syncClearButton();
      hideParcelSearchSuggestions();
      input.focus();
    });
  }
  syncClearButton();

  document.addEventListener('click', (event) => {
    if (!event.target.closest || !event.target.closest('.app-search')) hideParcelSearchSuggestions();
  });
}


async function awaitLabelsLoad() {
  if (labelsLoaded) return;
  if (!currentDataProfile) return;
  try {
    const response = await fetch(currentDataProfile.labelsSource, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    parseLabelsGeoJSON(await response.json());
    labelsLoaded = true;
    buildParcelSearchIndex();
    const input = $('parcelSearchInput');
    if (input && input.value.trim()) showParcelSearchSuggestions(input.value);
  } catch (err) {
    console.warn('Không thể tải label GeoJSON', currentDataProfile.labelsSource, err);
    labelsLoaded = true;
  }
}

function parseLabelsGeoJSON(geojson) {
  labelFeatures = [];
  const features = geojson && geojson.type === 'FeatureCollection' ? geojson.features : [];
  features.forEach(feature => {
    if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return;
    const coordinates = feature.geometry.coordinates || [];
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const props = feature.properties || {};
    const label = String(props.label || '').trim();
    if (!label) return;

    const rawProps = {};
    for (const key of Object.keys(props)) {
      const val = props[key];
      if (val !== null && val !== undefined) rawProps[key] = String(val).trim();
    }

    labelFeatures.push({
      label,
      code:    String(props.code    || '').trim(),
      unit:    String(props.unit    || '').trim(),
      number:  String(props.number  || '').trim(),
      center:  [lat, lng],
      properties: rawProps,
      layer:   null
    });
  });
}

function buildParcelSearchIndex() {
  const polygonItems = kmlFeatures
    .filter(feature => feature.clickable && feature.type === 'polygon')
    .map((feature, index) => {
      const name = cleanDestinationName(feature.name || ('Lô ' + (index + 1)));
      const desc = String(feature.desc || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const fallbackLabel = 'Lô gần ' + formatLatLng({ lat: feature.centerLat, lng: feature.centerLng });
      const label = name === 'Điểm đã chọn' ? (desc || fallbackLabel) : name;
      return {
        type: 'parcel',
        feature,
        label,
        desc,
        center: [feature.centerLat, feature.centerLng],
        searchMeta: buildParcelSearchMeta([name, desc, fallbackLabel, feature.group], label)
      };
    });

  const labelItems = labelFeatures.map(labelFeature => {
    const isParcelCode = Boolean(labelFeature.code);
    const displayCode = labelFeature.code || [labelFeature.unit, labelFeature.number].filter(Boolean).join(' ') || labelFeature.label;
    const areaText = isParcelCode && labelFeature.number ? 'Diện tích: ' + labelFeature.number + ' ha' : '';
    const searchableNumber = isParcelCode ? '' : labelFeature.number;
    return {
      type: 'label',
      feature: null,
      label: displayCode,
      desc: areaText,
      center: labelFeature.center,
      searchMeta: buildParcelSearchMeta([
        labelFeature.label,
        labelFeature.code,
        labelFeature.unit,
        searchableNumber,
        labelFeature.properties.layer
      ], displayCode)
    };
  });

  parcelSearchIndex = polygonItems.concat(labelItems)
    .filter(item => item.searchMeta && item.searchMeta.text.length > 0);
}


function renderVisibleLabels() {
  // Vector PMTiles đã hiển thị các lô/thửa đất -> không vẽ thêm nhãn DOM
  // đè lên để tránh rối mắt. Dữ liệu label vẫn được dùng cho tìm kiếm.
  if (labelLayer && labelLayer.getLayers().length) {
    labelLayer.clearLayers();
    labelFeatures.forEach(f => { f.layer = null; });
  }
}

function selectLabelFeature(labelFeature) {
  const latlng = L.latLng(labelFeature.center[0], labelFeature.center[1]);
  showSelectedLandmark(latlng);
  showRouteChoicePopup({
    latlng: labelFeature.center,
    name: labelFeature.code || [labelFeature.unit, labelFeature.number].filter(Boolean).join(' ') || labelFeature.label,
    desc: labelFeature.code && labelFeature.number ? 'Diện tích: ' + labelFeature.number + ' ha' : labelFeature.label
  });
}

function normalizeParcelSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\/]+/g, ' ')
    .trim();
}

function normalizeParcelSearchToken(value) {
  const normalized = normalizeParcelSearchText(value);
  if (!normalized) return '';
  if (/^\d+$/.test(normalized)) {
    const stripped = normalized.replace(/^0+/, '');
    return stripped || '0';
  }
  return normalized;
}

function tokenizeParcelSearchText(value) {
  return normalizeParcelSearchText(value)
    .split(/\s+/)
    .map(normalizeParcelSearchToken)
    .filter(Boolean);
}

function buildParcelSearchMeta(parts, label) {
  const rawText = parts.filter(Boolean).join(' ');
  const text = normalizeParcelSearchText(rawText);
  const labelText = normalizeParcelSearchText(label);
  const tokens = Array.from(new Set(
    tokenizeParcelSearchText(text).concat(tokenizeParcelSearchText(labelText))
  ));

  return {
    text,
    labelText,
    tokens,
    tokenSet: new Set(tokens),
    fuzzyText: String(rawText || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]/g, '')
  };
}

function buildParcelSearchQuery(value) {
  const tokens = tokenizeParcelSearchText(value);
  return {
    text: tokens.join(' '),
    tokens
  };
}

function isParcelSearchBoundaryChar(char) {
  return !char || char === ' ' || char === '/';
}

function findParcelSearchPhraseIndex(text, phrase) {
  if (!text || !phrase) return -1;

  let start = text.indexOf(phrase);
  while (start !== -1) {
    const prev = start === 0 ? '' : text.charAt(start - 1);
    const next = text.charAt(start + phrase.length);
    if (isParcelSearchBoundaryChar(prev) && isParcelSearchBoundaryChar(next)) {
      return start;
    }
    start = text.indexOf(phrase, start + 1);
  }

  return -1;
}

function scoreParcelSearchItem(item, query) {
  const meta = item && item.searchMeta;
  if (!meta || !meta.text || !query || !query.tokens.length) return null;

  const phrase = query.text;
  const labelPhraseIndex = findParcelSearchPhraseIndex(meta.labelText, phrase);
  const textPhraseIndex = findParcelSearchPhraseIndex(meta.text, phrase);
  const phraseIndex = labelPhraseIndex >= 0 ? labelPhraseIndex : textPhraseIndex;

  if (meta.labelText === phrase || meta.text === phrase) {
    return { tier: 5, score: 140000 };
  }
  if (phraseIndex === 0) {
    return { tier: 4, score: 120000 };
  }

  let exactMatches = 0;

  for (const term of query.tokens) {
    if (meta.tokenSet.has(term)) {
      exactMatches++;
      continue;
    }
    return null;
  }

  const tier = exactMatches === query.tokens.length ? 3 : 1;
  let score = exactMatches * 5000;

  if (phraseIndex > 0) {
    score += Math.max(400, 2200 - (phraseIndex * 40));
  }
  if (meta.labelText.startsWith(query.tokens[0])) {
    score += 900;
  }

  return { tier, score };
}

function getCurrentParcelSearchLatLng() {
  if (currentUserLatLng) return currentUserLatLng;
  if (userMarker && typeof userMarker.getLatLng === 'function') return userMarker.getLatLng();
  return null;
}

function getParcelSearchDistanceMeters(center) {
  const currentLatLng = getCurrentParcelSearchLatLng();
  if (!currentLatLng || !Array.isArray(center) || center.length < 2) return Infinity;
  return currentLatLng.distanceTo(L.latLng(center[0], center[1]));
}

function compareParcelSearchResults(a, b) {
  if (b.match.tier !== a.match.tier) return b.match.tier - a.match.tier;

  const aDistance = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Infinity;
  const bDistance = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Infinity;
  if (aDistance !== bDistance) return aDistance - bDistance;

  if (b.match.score !== a.match.score) return b.match.score - a.match.score;
  return a.item.label.localeCompare(b.item.label, 'vi');
}

function formatParcelSearchDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return '';
  if (distanceMeters < 1000) return Math.round(distanceMeters) + ' m';
  if (distanceMeters < 10000) return (distanceMeters / 1000).toFixed(1) + ' km';
  return (distanceMeters / 1000).toFixed(0) + ' km';
}

function showParcelSearchSuggestions(query) {
  const suggestions = $('parcelSearchSuggestions');
  if (!suggestions) return;

  const searchQuery = buildParcelSearchQuery(query);
  parcelSearchActiveIndex = -1;

  if (!searchQuery.tokens.length) {
    suggestions.hidden = true;
    suggestions.innerHTML = '';
    parcelSearchResults = [];
    return;
  }

  if (!kmlLoaded || !parcelSearchIndex.length) {
    parcelSearchResults = [];
    suggestions.hidden = false;
    suggestions.innerHTML = '<div class="search-suggestion--empty">Dữ liệu lô đang tải...</div>';
    return;
  }

  parcelSearchResults = parcelSearchIndex
    .map(item => {
      const match = scoreParcelSearchItem(item, searchQuery);
      if (!match) return null;
      return {
        item,
        match,
        distanceMeters: getParcelSearchDistanceMeters(item.center)
      };
    })
    .filter(Boolean)
    .sort(compareParcelSearchResults)
    .map(result => Object.assign({}, result.item, { distanceMeters: result.distanceMeters }));

  suggestions.hidden = false;
  if (!parcelSearchResults.length) {
    suggestions.innerHTML = '<div class="search-suggestion--empty">Không tìm thấy lô phù hợp</div>';
    return;
  }

  suggestions.innerHTML = parcelSearchResults.map((item, index) =>
    (() => {
      const secondaryParts = [];
      if (item.desc) secondaryParts.push(item.desc);
      const distanceText = formatParcelSearchDistance(item.distanceMeters);
      if (distanceText) secondaryParts.push(distanceText);
      if (!secondaryParts.length) secondaryParts.push(formatLatLng({ lat: item.center[0], lng: item.center[1] }));
      return '<button type="button" class="search-suggestion" data-search-index="' + index + '">' +
        '<strong>' + escapeHtml(item.label) + '</strong>' +
        '<span>' + escapeHtml(secondaryParts.join(' • ')) + '</span>' +
      '</button>';
    })()
  ).join('');

  suggestions.querySelectorAll('[data-search-index]').forEach(button => {
    button.addEventListener('click', () => selectParcelSearchResult(Number(button.dataset.searchIndex)));
  });
}

function onParcelSearchKeyDown(event) {
  const suggestions = $('parcelSearchSuggestions');
  if (!suggestions || suggestions.hidden) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!parcelSearchResults.length) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    parcelSearchActiveIndex = (parcelSearchActiveIndex + delta + parcelSearchResults.length) % parcelSearchResults.length;
    updateParcelSearchActiveItem();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    selectParcelSearchResult(parcelSearchActiveIndex >= 0 ? parcelSearchActiveIndex : 0);
  } else if (event.key === 'Escape') {
    hideParcelSearchSuggestions();
  }
}

function updateParcelSearchActiveItem() {
  const suggestions = $('parcelSearchSuggestions');
  if (!suggestions) return;
  suggestions.querySelectorAll('.search-suggestion').forEach((button, index) => {
    button.classList.toggle('is-active', index === parcelSearchActiveIndex);
  });
}

function hideParcelSearchSuggestions() {
  const suggestions = $('parcelSearchSuggestions');
  if (!suggestions) return;
  suggestions.hidden = true;
}

function selectParcelSearchResult(index) {
  const item = parcelSearchResults[index];
  if (!item) return;

  const input = $('parcelSearchInput');
  if (input) input.value = item.label;
  hideParcelSearchSuggestions();

  const latlng = L.latLng(item.center[0], item.center[1]);
  showSelectedLandmark(latlng);
  if (item.feature && item.feature.bounds && map) {
    map.fitBounds(item.feature.bounds, { padding: [70, 70], maxZoom: 18 });
  } else if (map) {
    map.setView(latlng, Math.max(map.getZoom(), 17));
  }

  if (typeof beginDirectRoute === 'function') {
    beginDirectRoute(item.center, item.label);
  } else {
    showRouteChoicePopup({ latlng: item.center, name: item.label, desc: item.desc });
  }
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

  if (!map.getPane('routeChoicePane')) {
    map.createPane('routeChoicePane');
    map.getPane('routeChoicePane').style.zIndex = '1200';
  }

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
    pane: 'routeChoicePane',
    className: 'route-choice-popup',
    closeButton: true,
    autoPan: true,
    autoPanPaddingTopLeft: L.point(24, 96),
    autoPanPaddingBottomRight: L.point(24, 24),
    offset: L.point(0, -28),
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
// Theo doi vi tri lien tuc theo mac dinh (khong the tat) - cap nhat marker
// va accuracy circle theo thoi gian thuc khi user di chuyen.
let geoWatchId = null;

function stopGeoWatch() {
  if (geoWatchId !== null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

function startGeoWatch(forceRestart) {
  if (forceRestart) stopGeoWatch();
  if (geoWatchId !== null) return;
  if (!('geolocation' in navigator)) return;
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy, heading, speed } = pos.coords;
      const latlng = [latitude, longitude];
      // Heading tu GPS chi tin cay khi user dang di chuyen (speed > 0.5 m/s).
      const gpsHeading = (Number.isFinite(heading) && Number.isFinite(speed) && speed > 0.5)
        ? heading
        : (Number.isFinite(heading) ? heading : null);
      setUserPosition(latlng, accuracy, false, gpsHeading, false);
    },
    (err) => {
      console.warn('watchPosition error', err);
      if (err && err.code === 1) stopGeoWatch();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function locateUser(pan, options) {
  if (pan === undefined) pan = true;
  options = options || {};
  if (options.userInitiated && typeof requestDeviceHeading === 'function') {
    try {
      await requestDeviceHeading(true);
    } catch (err) {
      console.warn(err);
    }
  }
  if (!('geolocation' in navigator)) {
    showToast('Trình duyệt không hỗ trợ định vị');
    if (options.userInitiated) {
      showLocationPermissionHelp({ reason: 'unsupported' });
    }
    setUserPosition(DEFAULT_CENTER, null, pan);
    scheduleKMLLoad();
    return null;
  }
  showToast('Đang lấy vị trí...');
  try {
    const pos = await requestLocationFix({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
      announcePrompt: !!options.userInitiated
    });
    const { latitude, longitude, accuracy, heading, speed } = pos.coords;
    const latlng = [latitude, longitude];
    const gpsHeading = (Number.isFinite(heading) && Number.isFinite(speed) && speed > 0.5)
      ? heading
      : (Number.isFinite(heading) ? heading : null);
    setUserPosition(latlng, accuracy, pan, gpsHeading, false);
    startGeoWatch(true);
    scheduleKMLLoad();
    if (typeof endPoint !== 'undefined' && endPoint && typeof tryAutoRoute === 'function') {
      tryAutoRoute();
    }
    return pos;
  } catch (err) {
    console.warn(err);
    const msg = err.code === 1
      ? 'Bạn đã từ chối cấp vị trí'
      : err.code === 3
        ? 'GPS phản hồi chậm, hãy thử lại'
        : 'Không lấy được vị trí';
    showToast(msg);
    if (options.userInitiated) {
      const reason = getLocationHelpReason(err);
      showLocationPermissionHelp({
        reason,
        onRetry: (reason === 'unsupported' || reason === 'insecure')
          ? null
          : () => locateUser(pan, Object.assign({}, options, { userInitiated: true }))
      });
    }
    const c = map.getCenter();
    setUserPosition([c.lat, c.lng], null, pan);
    scheduleKMLLoad();
    if (typeof endPoint !== 'undefined' && endPoint && typeof tryAutoRoute === 'function') {
      tryAutoRoute();
    }
    return null;
  }
}

// ===== MAP ROTATION (2-finger rotate like Google Maps) =====
function onMapRotate() {
  // Update heading arrow immediately, compensating for map bearing (no lag).
  updateUserMarkerRotation(true);
  // Nếu xoay bản đồ bằng tay (2 ngón / la bàn), tắt bám hướng để user tự do định hướng.
  if (typeof programmaticBearing !== 'undefined' && !programmaticBearing) {
    if (typeof followHeading !== 'undefined' && followHeading) {
      followHeading = false;
      if (typeof updateDriveHeadingStatus === 'function') updateDriveHeadingStatus();
    }
  }
  scheduleRotateTileRefresh();
  saveAppStateDebounced();
}

function scheduleRotateTileRefresh() {
  if (rotateTileRefreshTimer) return;
  rotateTileRefreshTimer = setTimeout(() => {
    rotateTileRefreshTimer = null;
    try {
      if (currentBaseLayer && typeof currentBaseLayer._onMoveEnd === 'function') {
        currentBaseLayer._onMoveEnd();
      }
    } catch (e) { /* ignore */ }
  }, 180);
}

// Rotate the heading arrow in place (no marker rebuild) -> smooth + continuous.
// When the map is rotated, the arrow compensates for bearing to point the true heading.
function updateUserMarkerRotation(instant) {
  if (!userMarker) return;
  const el = userMarker.getElement();
  if (!el) return;
  const wrap = el.querySelector('.user-marker-wrap');
  const dot = el.querySelector('.user-marker');
  if (!wrap || !dot) return;

  const hasHeading = Number.isFinite(currentUserHeading);
  dot.classList.toggle('user-marker--heading', hasHeading);

  if (!hasHeading) {
    wrap.style.transition = '';
    wrap.style.transform = '';
    appliedMarkerAngle = null;
    return;
  }

  const bearing = (typeof map !== 'undefined' && map && typeof map.getBearing === 'function')
    ? map.getBearing()
    : 0;
  const target = (((currentUserHeading - bearing) % 360) + 360) % 360;

  if (appliedMarkerAngle === null) {
    appliedMarkerAngle = target;
  } else {
    let delta = ((target - appliedMarkerAngle) % 360 + 540) % 360 - 180;
    appliedMarkerAngle += delta;
  }

  wrap.style.transition = instant ? 'none' : 'transform 0.18s ease-out';
  wrap.style.transform = 'rotate(' + appliedMarkerAngle.toFixed(2) + 'deg)';
}
function setUserPosition(latlng, accuracy, pan, heading, navigationMode) {
  currentUserLatLng = L.latLng(latlng[0], latlng[1]);

  // Ưu tiên la bàn thiết bị khi đã bật: mũi tên xoay mượt và chính xác hơn GPS.
  // GPS heading chỉ dùng khi chưa có la bàn (fallback cho thiết bị không có).
  if (typeof deviceOrientationActive !== 'undefined' && deviceOrientationActive
      && Number.isFinite(currentUserHeading)) {
    // giữ nguyên currentUserHeading đang được cập nhật bởi compass loop
  } else if (Number.isFinite(heading)) {
    currentUserHeading = heading;
  } else {
    currentUserHeading = null;
  }

  if (userMarker) {
    // During navigation with follow on, the smooth rAF follow loop owns the
    // blue dot (so it stays centered with the camera). Otherwise place it here
    // instantly at the real GPS fix.
    const followOwnsMarker = (typeof navFollowActive !== 'undefined' && navFollowActive)
      && (typeof followUser !== 'undefined' && followUser);
    if (!followOwnsMarker) userMarker.setLatLng(latlng);
  } else {
    const icon = L.divIcon({
      className: '',
      html: '<div class="user-marker-wrap"><div class="user-marker"></div></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    userMarker = L.marker(latlng, { icon, interactive: false }).addTo(map);
  }

  if (accuracy && accuracy > 0) {
    if (userAccuracyCircle) {
      userAccuracyCircle.setLatLng(latlng);
      userAccuracyCircle.setRadius(accuracy);
    } else {
      userAccuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: '#4f8cff',
        weight: 1,
        fillColor: '#4f8cff',
        fillOpacity: 0.1,
        interactive: false
      }).addTo(map);
    }
  } else if (userAccuracyCircle) {
    map.removeLayer(userAccuracyCircle);
    userAccuracyCircle = null;
  }

  updateUserMarkerRotation();

  if (typeof startPoint !== 'undefined') {
    startPoint = latlng;
  }
  if (typeof updateRouteBtnState === 'function') {
    updateRouteBtnState();
  }
  const startInput = $('startAddress');
  if (startInput) startInput.value = formatLatLng({ lat: latlng[0], lng: latlng[1] });
  const parcelSearchInput = $('parcelSearchInput');
  const parcelSearchSuggestions = $('parcelSearchSuggestions');
  if (
    parcelSearchInput &&
    parcelSearchSuggestions &&
    !parcelSearchSuggestions.hidden &&
    parcelSearchInput.value.trim()
  ) {
    showParcelSearchSuggestions(parcelSearchInput.value);
  }

  if (pan && navigationMode) {
    // During navigation the camera is driven by the smooth requestAnimationFrame
    // follow loop (startNavFollowLoop in routing.js). Animating panTo on every GPS
    // fix queues animations and makes the map lag behind the user; the rAF loop
    // glides to the latest position with effectively zero delay instead.
  } else if (pan) {
    map.flyTo(latlng, Math.max(map.getZoom(), 15), { animate: true, duration: 0.6 });
  }
}

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', () => {
  bootstrapApp();
});








