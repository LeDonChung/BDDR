const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, If-None-Match, If-Modified-Since',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, ETag',
  'Access-Control-Max-Age': '86400'
};

const DEFAULT_DATA_R2_PREFIX = 'bddr/data';
const DATA_ROUTE_PREFIX = '/api/data/';
const DATA_PUBLIC_ROUTE_PREFIX = '/capstone/bddr/data/';
const ALLOWED_DATA_FILES = new Set([
  'BDDR.pmtiles',
  'BDDR-labels.geojson',
  'BDDR.geojson',
  'info.txt'
]);
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 500;
const SESSION_TTL_MS = 60 * 60 * 1000;          // 60 phút
const SESSION_REFRESH_WINDOW_MS = 10 * 60 * 1000; // nếu còn < 10 phút thì gia hạn
const SESSION_TOKEN_BYTES = 32;
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_TIME_SUFFIX = 'GMT+7';
const VIETNAM_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;
let vietnamTimeFormatter = null;

function json(body, status = 200, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, extraHeaders || {}, CORS_HEADERS)
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, digits) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return Number(value).toFixed(digits);
}

function formatLocation(row) {
  if (row.latitude == null || row.longitude == null) return '';
  return formatNumber(row.latitude, 6) + ', ' + formatNumber(row.longitude, 6);
}

function parsePage(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parsePageSize(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(n, PAGE_SIZE_MAX);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLength);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function generateToken(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, b => b.toString(16).padStart(2, '0')).join('');
}

function isoFromNow(deltaMs) {
  return new Date(Date.now() + deltaMs).toISOString();
}

function parseIsoUtc(value) {
  if (!value) return null;
  let s = String(value).trim();
  // Chuẩn hoá: nếu có dấu cách giữa ngày-giờ, đổi thành 'T'
  s = s.replace(' ', 'T');
  // Nếu chưa có timezone indicator, coi như UTC
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function getVietnamTimeFormatter() {
  if (!vietnamTimeFormatter) {
    vietnamTimeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: VIETNAM_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23'
    });
  }
  return vietnamTimeFormatter;
}

function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function formatVietnamTimeFallback(ms) {
  const d = new Date(ms + VIETNAM_TIME_OFFSET_MS);
  return padTimePart(d.getUTCDate()) + '/' +
    padTimePart(d.getUTCMonth() + 1) + '/' +
    d.getUTCFullYear() + ' ' +
    padTimePart(d.getUTCHours()) + ':' +
    padTimePart(d.getUTCMinutes()) + ':' +
    padTimePart(d.getUTCSeconds()) + ' ' +
    VIETNAM_TIME_SUFFIX;
}

function formatVietnamTime(value) {
  const ms = parseIsoUtc(value);
  if (ms == null) return value || '';
  try {
    const parts = {};
    for (const part of getVietnamTimeFormatter().formatToParts(new Date(ms))) {
      if (part.type !== 'literal') parts[part.type] = part.value;
    }
    return parts.day + '/' + parts.month + '/' + parts.year + ' ' +
      parts.hour + ':' + parts.minute + ':' + parts.second + ' ' +
      VIETNAM_TIME_SUFFIX;
  } catch (err) {
    return formatVietnamTimeFallback(ms);
  }
}

async function findUserByCode(env, code) {
  if (!code) return null;
  const row = await env.DB.prepare(
    'SELECT code, team, folder, short_label, subtitle, is_active, notes, updated_at ' +
    'FROM users WHERE code = ? AND is_active = 1 LIMIT 1'
  ).bind(code).first();
  return row ? rowToUser(row) : null;
}

async function findAnyUserByCode(env, code) {
  if (!code) return null;
  const row = await env.DB.prepare(
    'SELECT code, team, folder, short_label, subtitle, is_active, notes, updated_at ' +
    'FROM users WHERE code = ? LIMIT 1'
  ).bind(code).first();
  return row ? rowToUser(row) : null;
}

async function listAllUsers(env) {
  const result = await env.DB.prepare(
    'SELECT code, team, folder, short_label, subtitle, is_active, notes, updated_at ' +
    'FROM users ORDER BY code ASC'
  ).all();
  return ((result && result.results) || []).map(rowToUser);
}

async function createUser(env, payload) {
  const code = cleanText(payload.code, 80).toLowerCase();
  if (!code) throw new Error('Thiếu mã');
  if (!/^[a-z0-9_-]{1,80}$/.test(code)) throw new Error('Mã không hợp lệ (chỉ a-z, 0-9, _, -)');
  const team = cleanText(payload.team, 120);
  const folder = cleanText(payload.folder, 80);
  if (!team) throw new Error('Thiếu tên đội');
  if (!folder) throw new Error('Thiếu folder');
  const shortLabel = cleanText(payload.shortLabel || team, 120);
  const subtitle = cleanText(payload.subtitle || '', 200);
  const isActive = payload.isActive === false || payload.isActive === 0 || payload.isActive === '0' ? 0 : 1;
  const notes = cleanText(payload.notes || '', 500);
  await env.DB.prepare(
    "INSERT INTO users (code, team, folder, short_label, subtitle, is_active, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(code, team, folder, shortLabel, subtitle, isActive, notes).run();
  return await findAnyUserByCode(env, code);
}

async function updateUser(env, code, payload) {
  const normalized = cleanText(code, 80).toLowerCase();
  const current = await findAnyUserByCode(env, normalized);
  if (!current) throw new Error('Không tìm thấy user');
  const team = payload.team !== undefined ? cleanText(payload.team, 120) : current.team;
  const folder = payload.folder !== undefined ? cleanText(payload.folder, 80) : current.folder;
  if (!team) throw new Error('Thiếu tên đội');
  if (!folder) throw new Error('Thiếu folder');
  const shortLabel = payload.shortLabel !== undefined ? cleanText(payload.shortLabel, 120) : current.shortLabel;
  const subtitle = payload.subtitle !== undefined ? cleanText(payload.subtitle, 200) : current.subtitle;
  const notes = payload.notes !== undefined ? cleanText(payload.notes, 500) : current.notes;
  let isActive = current.isActive ? 1 : 0;
  if (payload.isActive !== undefined) {
    isActive = payload.isActive === false || payload.isActive === 0 || payload.isActive === '0' ? 0 : 1;
  }
  await env.DB.prepare(
    "UPDATE users SET team = ?, folder = ?, short_label = ?, subtitle = ?, is_active = ?, notes = ?, updated_at = datetime('now') WHERE code = ?"
  ).bind(team, folder, shortLabel, subtitle, isActive, notes, normalized).run();
  return await findAnyUserByCode(env, normalized);
}

async function deleteUser(env, code) {
  const normalized = cleanText(code, 80).toLowerCase();
  const adminCode = getAdminCode(env);
  if (adminCode && normalized === adminCode) {
    throw new Error('Không thể xoá tài khoản admin');
  }
  // Xoá sessions của user trước
  await env.DB.prepare('DELETE FROM sessions WHERE code = ?').bind(normalized).run();
  await env.DB.prepare('DELETE FROM users WHERE code = ?').bind(normalized).run();
  return { ok: true, code: normalized };
}

async function listSessions(env, code) {
  const result = await env.DB.prepare(
    'SELECT token, code, ip, user_agent, created_at, expires_at, last_seen_at ' +
    'FROM sessions WHERE code = ? ORDER BY created_at DESC LIMIT 200'
  ).bind(code).all();
  return ((result && result.results) || []).map(r => ({
    token: r.token.slice(0, 8) + '…' + r.token.slice(-4),
    code: r.code,
    ip: r.ip || '',
    userAgent: r.user_agent || '',
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at || '',
    createdAtVietnam: formatVietnamTime(r.created_at),
    expiresAtVietnam: formatVietnamTime(r.expires_at),
    lastSeenAtVietnam: formatVietnamTime(r.last_seen_at || '')
  }));
}

async function destroySessionsByCode(env, code) {
  const normalized = cleanText(code, 80).toLowerCase();
  const result = await env.DB.prepare('DELETE FROM sessions WHERE code = ?').bind(normalized).run();
  return { ok: true, code: normalized, deleted: (result && result.meta && result.meta.changes) || 0 };
}

function getAdminCode(env) {
  return cleanText(env.ADMIN_CODE || '', 80).toLowerCase();
}

function isAdminUser(user, env) {
  const adminCode = getAdminCode(env);
  return !!(adminCode && user && user.code === adminCode);
}

function getRequestToken(request) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const url = new URL(request.url);
  return cleanText(url.searchParams.get('token') || '', 512);
}

async function getAuthenticatedUserFromRequest(request, env) {
  const token = getRequestToken(request);
  if (!token) return null;
  const session = await loadSession(env, token);
  if (!session) return null;
  const user = await findAnyUserByCode(env, session.code);
  if (!user) return null;
  return { user, session };
}

async function getUserFromRequest(request, env) {
  const auth = await getAuthenticatedUserFromRequest(request, env);
  return auth ? auth.user : null;
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: 'Cần đăng nhập admin', status: 401 };
  if (!isAdminUser(user, env)) return { error: 'Chỉ tài khoản admin mới có quyền admin', status: 403 };
  return { user };
}

function cleanDataPathPart(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(text)) return '';
  if (text.includes('..')) return '';
  return text;
}

function parseDataAssetPath(pathname) {
  let rest = '';
  if (pathname.startsWith(DATA_ROUTE_PREFIX)) {
    rest = pathname.slice(DATA_ROUTE_PREFIX.length);
  } else if (pathname.startsWith(DATA_PUBLIC_ROUTE_PREFIX)) {
    rest = pathname.slice(DATA_PUBLIC_ROUTE_PREFIX.length);
  } else {
    return null;
  }

  const parts = rest.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch (err) { return ''; }
  });
  if (parts.length !== 2) {
    return { error: 'Đường dẫn data không hợp lệ', status: 400 };
  }

  const folder = cleanDataPathPart(parts[0]).toLowerCase();
  const file = cleanDataPathPart(parts[1]);
  if (!folder || !file || !ALLOWED_DATA_FILES.has(file)) {
    return { error: 'File data không được phép truy cập', status: 403 };
  }

  return { folder, file };
}

function getDataR2Prefix(env) {
  return cleanText(env.DATA_R2_PREFIX || DEFAULT_DATA_R2_PREFIX, 200)
    .replace(/^\/+|\/+$/g, '');
}

function getDataObjectKey(env, folder, file) {
  const prefix = getDataR2Prefix(env);
  return (prefix ? prefix + '/' : '') + folder + '/' + file;
}

function canUserAccessDataFolder(user, folder, env) {
  if (!user || !user.isActive) return false;
  if (isAdminUser(user, env)) return true;
  const userFolder = cleanDataPathPart(user.folder || '').toLowerCase();
  return userFolder === 'main' || userFolder === folder;
}

function getDataContentType(file) {
  if (file.endsWith('.pmtiles')) return 'application/octet-stream';
  if (file.endsWith('.geojson')) return 'application/geo+json; charset=utf-8';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function getObjectRangeInfo(object) {
  const range = object && object.range;
  if (!range) return null;

  if (typeof range.offset === 'number') {
    const start = range.offset;
    const length = typeof range.length === 'number'
      ? range.length
      : Math.max(0, object.size - start);
    return { start, end: start + Math.max(0, length - 1), length };
  }

  if (typeof range.suffix === 'number') {
    const length = Math.min(range.suffix, object.size);
    const start = Math.max(0, object.size - length);
    return { start, end: object.size - 1, length };
  }

  return null;
}

async function serveDataAsset(request, env, asset) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (asset.error) return json({ ok: false, error: asset.error }, asset.status || 400);
  if (!env.DATA_BUCKET) {
    return json({ ok: false, error: 'DATA_BUCKET chưa được cấu hình' }, 500);
  }

  const auth = await getAuthenticatedUserFromRequest(request, env);
  if (!auth || !auth.user || !auth.user.isActive) {
    return json({ ok: false, error: 'Cần đăng nhập để tải dữ liệu' }, 401);
  }
  const reqFp = sessionFingerprint(request, getClientIp(request), request.headers.get('user-agent'));
  const sessFp = sessionFingerprint(request, auth.session.ip, auth.session.ua);
  if (reqFp !== sessFp) {
    return json({ ok: false, error: 'Phiên không hợp lệ' }, 401);
  }

  if (!canUserAccessDataFolder(auth.user, asset.folder, env)) {
    return json({ ok: false, error: 'Không có quyền truy cập dữ liệu này' }, 403);
  }

  const key = getDataObjectKey(env, asset.folder, asset.file);
  const hasRangeRequest = !!request.headers.get('range');
  const getOptions = hasRangeRequest ? { range: request.headers } : {};
  const object = await env.DATA_BUCKET.get(key, getOptions);
  if (!object) return json({ ok: false, error: 'Không tìm thấy dữ liệu' }, 404);

  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', getDataContentType(asset.file));
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=300');

  const rangeInfo = hasRangeRequest ? getObjectRangeInfo(object) : null;
  const status = rangeInfo ? 206 : 200;
  if (rangeInfo) {
    headers.set('Content-Range', 'bytes ' + rangeInfo.start + '-' + rangeInfo.end + '/' + object.size);
    headers.set('Content-Length', String(rangeInfo.length));
  } else {
    headers.set('Content-Length', String(object.size));
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}

function renderDashboardPage() {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BDDR Tong - Dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b1220;
    --panel: #111a2c;
    --panel-2: #18233a;
    --line: rgba(255,255,255,.08);
    --line-strong: rgba(148,163,184,.22);
    --text: #e8eef7;
    --muted: #9aa6bd;
    --accent: #ffd84d;
    --primary: #4f8cff;
    --danger: #ff5b5b;
    --ok: #22c55e;
    --shadow: 0 18px 50px rgba(0,0,0,.34);
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    font-family: Arial, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }
  [hidden] { display: none !important; }
  .login-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .login-card {
    width: min(420px, 100%);
    display: grid;
    gap: 14px;
    padding: 24px;
    background: rgba(17,26,44,.98);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  .brand-mark {
    width: 42px;
    height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #101827;
    background: var(--accent);
    border-radius: 11px;
    font-weight: 800;
  }
  .login-card h1, .page-title h1 { margin: 0; font-size: 20px; line-height: 1.2; }
  .login-card p, .page-title p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .field { display: grid; gap: 6px; }
  .field span, .check-row span { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
  input, select, textarea {
    width: 100%;
    color: var(--text);
    background: rgba(255,255,255,.06);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    outline: none;
  }
  input, select { height: 38px; padding: 0 11px; }
  textarea { min-height: 76px; padding: 10px 11px; resize: vertical; }
  input:focus, select:focus, textarea:focus {
    border-color: rgba(79,140,255,.75);
    background: rgba(255,255,255,.1);
  }
  .error-text { min-height: 18px; color: #ffb4b4; font-size: 13px; }
  .btn {
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 13px;
    color: var(--text);
    background: rgba(255,255,255,.07);
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn:hover { background: rgba(255,255,255,.12); }
  .btn.primary { color: #101827; background: var(--accent); border-color: transparent; font-weight: 800; }
  .btn.danger { color: #fff; background: rgba(255,91,91,.18); border-color: rgba(255,91,91,.4); }
  .btn.icon { width: 38px; padding: 0; }
  .dashboard {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 236px minmax(0, 1fr);
  }
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 14px;
    background: rgba(15,23,42,.96);
    border-right: 1px solid var(--line);
  }
  .side-brand { display: flex; align-items: center; gap: 10px; padding: 4px 4px 12px; border-bottom: 1px solid var(--line); }
  .side-brand strong { display: block; font-size: 15px; }
  .side-brand span { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
  .side-nav { display: grid; gap: 6px; }
  .side-nav button {
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 11px;
    color: var(--muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 10px;
    text-align: left;
  }
  .side-nav button:hover { color: #fff; background: rgba(255,255,255,.06); }
  .side-nav button.active {
    color: #101827;
    background: var(--accent);
    border-color: transparent;
    font-weight: 800;
  }
  .side-bottom { margin-top: auto; display: grid; gap: 10px; }
  .who { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .content { min-width: 0; padding: 20px; }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 16px;
  }
  .panel { display: none; }
  .panel.active { display: block; }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
    margin-bottom: 12px;
  }
  .search { flex: 1 1 260px; max-width: 460px; }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(320px, .9fr);
    gap: 14px;
    align-items: start;
  }
  .surface {
    background: rgba(17,26,44,.96);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.18);
    overflow: hidden;
  }
  .surface-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  .surface-head h2 { margin: 0; font-size: 15px; line-height: 1.25; }
  .surface-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
  .table-wrap { overflow: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 760px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
  th { color: #cbd5e1; background: rgba(255,255,255,.04); font-weight: 800; position: sticky; top: 0; z-index: 1; }
  tr[data-code] { cursor: pointer; }
  tr:hover td { background: rgba(255,255,255,.04); }
  tr.selected td { background: rgba(255,216,77,.08); }
  code { color: #e8eef7; background: rgba(255,255,255,.07); border: 1px solid var(--line); padding: 2px 6px; border-radius: 6px; font-size: 12px; }
  .pill { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 800; }
  .pill.on { color: #052e16; background: #86efac; }
  .pill.off { color: #450a0a; background: #fca5a5; }
  .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .row-actions .btn { min-height: 30px; padding: 0 9px; font-size: 12px; }
  .empty { padding: 28px; color: var(--muted); text-align: center; }
  .detail-body { padding: 14px; display: grid; gap: 14px; }
  .detail-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .detail-title h3 { margin: 0; font-size: 18px; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .meta-item { padding: 10px; background: rgba(255,255,255,.045); border: 1px solid var(--line); border-radius: 9px; }
  .meta-item span { display: block; color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; }
  .meta-item strong { display: block; margin-top: 5px; overflow-wrap: anywhere; font-size: 13px; }
  .notes { color: #cbd5e1; font-size: 13px; line-height: 1.5; }
  .session-table table { min-width: 680px; }
  .session-block { display: grid; gap: 10px; padding-top: 4px; }
  .session-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .session-head h2 { margin: 0; font-size: 15px; }
  .session-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
  .log-table table { min-width: 1120px; }
  .pagination { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
  .pagination .btn { min-height: 32px; }
  .modal-back {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(4,8,16,.66);
    backdrop-filter: blur(4px);
  }
  .modal-back.open { display: flex; }
  .modal {
    width: min(560px, 100%);
    max-height: calc(100vh - 36px);
    overflow: auto;
    padding: 18px;
    background: rgba(17,26,44,.99);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  .modal h3 { margin: 0 0 12px; font-size: 18px; }
  .form-grid { display: grid; gap: 11px; }
  .check-row { display: flex; align-items: center; gap: 8px; }
  .check-row input { width: 18px; height: 18px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 14px; }
  .toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 80;
    max-width: min(420px, calc(100% - 36px));
    padding: 11px 14px;
    background: #0f172a;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    color: #fff;
    box-shadow: var(--shadow);
    opacity: 0;
    transform: translateY(14px);
    pointer-events: none;
    transition: opacity .18s ease, transform .18s ease;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.err { border-color: rgba(255,91,91,.5); background: #3b1117; }
  .toast.ok { border-color: rgba(34,197,94,.5); background: #0f2f1b; }
  @media (max-width: 980px) {
    .grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .dashboard { display: block; }
    .sidebar {
      position: sticky;
      top: 0;
      z-index: 20;
      height: auto;
      padding: 10px;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
    .side-brand { display: none; }
    .side-nav { grid-template-columns: 1fr 1fr auto; }
    .side-nav button { justify-content: center; min-height: 38px; padding: 0 9px; }
    .side-nav button span.label { display: inline; }
    .side-bottom { display: none; }
    .content { padding: 14px 10px 18px; }
    .topbar { align-items: flex-start; }
    .page-title h1 { font-size: 18px; }
    .surface-head, .detail-title { align-items: flex-start; flex-direction: column; }
    .meta-grid { grid-template-columns: 1fr; }
    .toolbar input, .toolbar select, .toolbar .btn { flex: 1 1 100%; }
    table { min-width: 720px; }
    .log-table table { min-width: 1080px; }
    .toast { left: 10px; right: 10px; bottom: 10px; max-width: none; }
  }
</style>
</head>
<body>
  <section id="loginShell" class="login-shell">
    <form id="loginCard" class="login-card" autocomplete="off">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="brand-mark">BD</div>
        <div>
          <h1>Dashboard quản trị</h1>
          <p>Đăng nhập bằng tài khoản tổng để quản lý người dùng và log truy cập.</p>
        </div>
      </div>
      <label class="field">
        <span>Mã đăng nhập</span>
        <input id="loginCode" type="text" autocomplete="username" spellcheck="false" />
      </label>
      <button id="loginBtn" class="btn primary" type="submit">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>
        Đăng nhập
      </button>
      <div id="loginErr" class="error-text" role="alert"></div>
    </form>
  </section>

  <section id="app" class="dashboard" hidden>
    <aside class="sidebar">
      <div class="side-brand">
        <div class="brand-mark">BD</div>
        <div>
          <strong>BDDR Tong</strong>
          <span>Dashboard quản trị</span>
        </div>
      </div>
      <nav class="side-nav" aria-label="Điều hướng dashboard">
        <button type="button" data-view="users">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="label">Người dùng</span>
        </button>
        <button type="button" data-view="logs">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
          <span class="label">Logs</span>
        </button>
        <button id="sidebarLogout" type="button">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
          <span class="label">Đăng xuất</span>
        </button>
      </nav>
      <div class="side-bottom">
        <div id="who" class="who"></div>
      </div>
    </aside>

    <main class="content">
      <div class="topbar">
        <div class="page-title">
          <h1 id="pageTitle">Người dùng</h1>
          <p id="pageSubtitle">Quản lý mã đăng nhập, trạng thái và phiên hoạt động.</p>
        </div>
      </div>

      <section id="panel-users" class="panel">
        <div class="toolbar">
          <input id="userSearch" class="search" type="search" placeholder="Tìm theo mã, tên đội, folder..." />
          <button id="userAdd" class="btn primary" type="button">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            Thêm user
          </button>
          <button id="userReload" class="btn" type="button">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            Tải lại
          </button>
        </div>
        <div class="grid">
          <section class="surface">
            <div class="surface-head">
              <div>
                <h2>Danh sách người dùng</h2>
                <p id="userSummary">Đang tải...</p>
              </div>
            </div>
            <div class="table-wrap">
              <table id="userTable">
                <thead><tr>
                  <th>Mã</th><th>Tên đội</th><th>Folder</th><th>Short label</th><th>Trạng thái</th><th>Cập nhật</th><th></th>
                </tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </section>

          <section class="surface" id="userDetail">
            <div class="surface-head">
              <div>
                <h2>Chi tiết người dùng</h2>
                <p>Thông tin cấu hình và session của user được chọn.</p>
              </div>
            </div>
            <div id="userDetailBody" class="detail-body"></div>
          </section>
        </div>
      </section>

      <section id="panel-logs" class="panel">
        <div class="toolbar">
          <select id="logSelect" aria-label="Lọc người dùng"></select>
          <input id="logLimit" type="number" min="1" max="500" value="100" aria-label="Số dòng" />
          <button id="logReload" class="btn" type="button">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
            Tải lại
          </button>
          <button id="logClearPage" class="btn danger" type="button">Xóa log đang hiển thị</button>
        </div>
        <section class="surface">
          <div class="surface-head">
            <div>
              <h2>Logs đăng nhập</h2>
              <p id="logSummary">Thời gian hiển thị theo giờ Việt Nam (GMT+7).</p>
            </div>
            <div class="pagination">
              <button id="logPrev" class="btn" type="button">Trước</button>
              <span id="logPageInfo">Trang 1 / 1</span>
              <button id="logNext" class="btn" type="button">Sau</button>
            </div>
          </div>
          <div class="table-wrap log-table">
            <table id="logTable">
              <thead><tr>
                <th>#</th><th>Thời gian</th><th>Mã</th><th>Đơn vị</th><th>Tên hiển thị</th><th>IP</th><th>Trình duyệt</th><th>HĐH</th><th>Ngôn ngữ</th><th>Tọa độ</th><th>Sai số</th><th>Trạng thái</th>
              </tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  </section>

  <div class="modal-back" id="modal">
    <div class="modal">
      <h3 id="modalTitle">Thêm user</h3>
      <form id="userForm" class="form-grid">
        <label class="field"><span>Mã đăng nhập *</span><input name="code" required pattern="[a-z0-9_-]{1,80}" /></label>
        <label class="field"><span>Tên đội / đơn vị *</span><input name="team" required maxlength="120" /></label>
        <label class="field"><span>Folder dữ liệu *</span><input name="folder" required maxlength="80" placeholder="vd: doi01, main" /></label>
        <label class="field"><span>Short label</span><input name="shortLabel" maxlength="120" /></label>
        <label class="field"><span>Subtitle</span><input name="subtitle" maxlength="200" /></label>
        <label class="field"><span>Ghi chú</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
        <label class="check-row"><input type="checkbox" name="isActive" checked /> <span>Đang hoạt động</span></label>
        <div class="modal-actions">
          <button type="button" class="btn" data-close>Hủy</button>
          <button type="submit" class="btn primary" id="modalSave">Lưu</button>
        </div>
      </form>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
const BASE = location.origin;
let currentAdminCode = '';
const TOKEN_KEY = 'bddr-admin-token';
let adminToken = localStorage.getItem(TOKEN_KEY) || null;
let allUsers = [];
let selectedUserCode = '';
let currentView = location.pathname === '/logs' ? 'logs' : 'users';
let currentLogIds = [];
let logPage = 1;
let logTotalPages = 1;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, kind) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.className = 'toast ' + (kind || ''), 2400);
}

async function api(path, options) {
  options = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
  const response = await fetch(BASE + path, Object.assign({}, options, { headers }));
  const ct = response.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok || body.ok === false) throw new Error((body && body.error) || ('HTTP ' + response.status));
  return body;
}

function setLoggedInUI(token, userCode) {
  adminToken = token;
  currentAdminCode = userCode || '';
  if (token) localStorage.setItem(TOKEN_KEY, token);
  $('#loginShell').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = 'Đăng nhập: ' + userCode;
  loadAll().then(() => setView(currentView));
}

function setLoggedOutUI() {
  adminToken = null;
  currentAdminCode = '';
  localStorage.removeItem(TOKEN_KEY);
  $('#loginShell').hidden = false;
  $('#app').hidden = true;
  $('#loginErr').textContent = '';
}

function setView(view) {
  currentView = view === 'logs' ? 'logs' : 'users';
  $$('.panel').forEach(panel => panel.classList.remove('active'));
  $('#panel-' + currentView).classList.add('active');
  $$('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === currentView));
  if (currentView === 'logs') {
    $('#pageTitle').textContent = 'Logs';
    $('#pageSubtitle').textContent = 'Theo dõi lịch sử đăng nhập, vị trí và thiết bị truy cập.';
    if (!$('#logTable tbody').dataset.loaded) loadLogs(true);
  } else {
    $('#pageTitle').textContent = 'Người dùng';
    $('#pageSubtitle').textContent = 'Quản lý mã đăng nhập, trạng thái và phiên hoạt động.';
  }
}

async function trySession() {
  if (!adminToken) return setLoggedOutUI();
  try {
    const r = await api('/api/session');
    if (r.ok && r.user) {
      setLoggedInUI(adminToken, r.user.code);
    } else {
      toast('Tài khoản không có quyền admin', 'err');
      setLoggedOutUI();
    }
  } catch (err) {
    setLoggedOutUI();
  }
}

async function doLogin(event) {
  if (event) event.preventDefault();
  $('#loginErr').textContent = '';
  const code = $('#loginCode').value.trim();
  if (!code) { $('#loginErr').textContent = 'Nhập mã đăng nhập'; return; }
  try {
    const response = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || ('HTTP ' + response.status));
    setLoggedInUI(body.token, body.user.code);
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
}

async function logout() {
  try { await api('/api/session/logout', { method: 'POST' }); } catch (err) {}
  setLoggedOutUI();
}

async function loadAll() {
  await loadUsers();
  populateLogSelect();
}

async function loadUsers() {
  try {
    const r = await api('/api/admin/users');
    allUsers = r.users || [];
    if (!selectedUserCode || !allUsers.some(u => u.code === selectedUserCode)) {
      selectedUserCode = allUsers.length ? allUsers[0].code : '';
    }
    renderUsers();
    renderUserDetail();
  } catch (err) {
    toast('Lỗi tải users: ' + err.message, 'err');
  }
}

function renderUsers() {
  const q = ($('#userSearch').value || '').toLowerCase();
  const list = allUsers.filter(u => !q || (u.code + ' ' + u.team + ' ' + u.folder + ' ' + (u.shortLabel || '')).toLowerCase().includes(q));
  const activeCount = allUsers.filter(u => u.isActive).length;
  $('#userSummary').textContent = allUsers.length + ' user, ' + activeCount + ' đang hoạt động';
  const tb = $('#userTable tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">Không có user nào</td></tr>';
    return;
  }
  tb.innerHTML = list.map(u =>
    '<tr data-code="' + esc(u.code) + '" class="' + (u.code === selectedUserCode ? 'selected' : '') + '">' +
    '<td><code>' + esc(u.code) + '</code></td>' +
    '<td>' + esc(u.team) + '</td>' +
    '<td><code>' + esc(u.folder) + '</code></td>' +
    '<td>' + esc(u.shortLabel || '') + '</td>' +
    '<td><span class="pill ' + (u.isActive ? 'on' : 'off') + '">' + (u.isActive ? 'active' : 'inactive') + '</span></td>' +
    '<td style="color:var(--muted);font-size:12px">' + esc(u.updatedAtVietnam || u.updatedAt || '') + '</td>' +
    '<td><div class="row-actions">' +
      '<button class="btn" data-act="edit" data-code="' + esc(u.code) + '">Sửa</button>' +
      '<button class="btn" data-act="toggle" data-code="' + esc(u.code) + '" data-active="' + (u.isActive ? '1' : '0') + '">' + (u.isActive ? 'Khóa' : 'Mở') + '</button>' +
      (u.code === currentAdminCode ? '' : '<button class="btn danger" data-act="delete" data-code="' + esc(u.code) + '">Xóa</button>') +
    '</div></td>' +
    '</tr>'
  ).join('');
}

function getSelectedUser() {
  return allUsers.find(u => u.code === selectedUserCode) || null;
}

function selectUser(code) {
  selectedUserCode = code;
  renderUsers();
  renderUserDetail();
}

function renderUserDetail() {
  const body = $('#userDetailBody');
  const user = getSelectedUser();
  if (!user) {
    body.innerHTML = '<div class="empty">Chọn một user để xem chi tiết và session.</div>';
    return;
  }
  body.innerHTML =
    '<div class="detail-title">' +
      '<div><h3>' + esc(user.team || user.code) + '</h3><p class="notes"><code>' + esc(user.code) + '</code></p></div>' +
      '<span class="pill ' + (user.isActive ? 'on' : 'off') + '">' + (user.isActive ? 'active' : 'inactive') + '</span>' +
    '</div>' +
    '<div class="meta-grid">' +
      '<div class="meta-item"><span>Folder</span><strong>' + esc(user.folder) + '</strong></div>' +
      '<div class="meta-item"><span>Short label</span><strong>' + esc(user.shortLabel || '') + '</strong></div>' +
      '<div class="meta-item"><span>Subtitle</span><strong>' + esc(user.subtitle || '') + '</strong></div>' +
      '<div class="meta-item"><span>Cập nhật</span><strong>' + esc(user.updatedAtVietnam || user.updatedAt || '') + '</strong></div>' +
    '</div>' +
    '<div class="notes">' + (user.notes ? esc(user.notes) : 'Không có ghi chú.') + '</div>' +
    '<div class="row-actions">' +
      '<button id="detailEdit" class="btn primary" type="button">Sửa user</button>' +
      '<button id="detailToggle" class="btn" type="button">' + (user.isActive ? 'Khóa user' : 'Mở user') + '</button>' +
      '<button id="detailKillSessions" class="btn danger" type="button">Hủy sessions</button>' +
      (user.code === currentAdminCode ? '' : '<button id="detailDelete" class="btn danger" type="button">Xóa user</button>') +
    '</div>' +
    '<section class="session-block session-table">' +
      '<div class="session-head"><div><h2>Sessions</h2><p id="sessionSummary">Đang tải...</p></div><button id="sessionReload" class="btn" type="button">Tải lại</button></div>' +
      '<div class="table-wrap"><table id="userSessionTable"><thead><tr><th>Token</th><th>IP</th><th>User-Agent</th><th>Tạo</th><th>Hết hạn</th><th>Lần cuối</th></tr></thead><tbody></tbody></table></div>' +
    '</section>';

  $('#detailEdit').addEventListener('click', () => openModal(user));
  $('#detailToggle').addEventListener('click', () => toggleUser(user.code, user.isActive));
  $('#detailKillSessions').addEventListener('click', () => killSessions(user.code));
  const deleteBtn = $('#detailDelete');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteUser(user.code));
  $('#sessionReload').addEventListener('click', () => loadUserSessions(user.code));
  loadUserSessions(user.code);
}

async function loadUserSessions(code) {
  const table = $('#userSessionTable tbody');
  if (!table || !code) return;
  table.innerHTML = '<tr><td colspan="6" class="empty">Đang tải sessions...</td></tr>';
  try {
    const r = await api('/api/admin/sessions?code=' + encodeURIComponent(code));
    const sessions = r.sessions || [];
    $('#sessionSummary').textContent = sessions.length + ' session gần nhất';
    if (!sessions.length) {
      table.innerHTML = '<tr><td colspan="6" class="empty">User này chưa có session.</td></tr>';
      return;
    }
    table.innerHTML = sessions.map(s =>
      '<tr>' +
      '<td><code>' + esc(s.token) + '</code></td>' +
      '<td>' + esc(s.ip) + '</td>' +
      '<td style="max-width:260px;word-break:break-all;color:var(--muted)">' + esc(s.userAgent) + '</td>' +
      '<td>' + esc(s.createdAtVietnam || s.createdAt) + '</td>' +
      '<td>' + esc(s.expiresAtVietnam || s.expiresAt) + '</td>' +
      '<td>' + esc(s.lastSeenAtVietnam || s.lastSeenAt) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    table.innerHTML = '<tr><td colspan="6" class="empty">Lỗi tải sessions: ' + esc(err.message) + '</td></tr>';
  }
}

function populateLogSelect() {
  const select = $('#logSelect');
  select.innerHTML = '<option value="">Tất cả người dùng</option>' +
    allUsers.map(u => '<option value="' + esc(u.code) + '">' + esc(u.code) + ' - ' + esc(u.team) + '</option>').join('');
}

async function loadLogs(resetPage) {
  if (resetPage) logPage = 1;
  const account = $('#logSelect').value || '';
  const pageSize = Math.min(500, Math.max(1, parseInt($('#logLimit').value, 10) || 100));
  const query = '?page=' + logPage + '&pageSize=' + pageSize + (account ? '&account=' + encodeURIComponent(account) : '');
  try {
    const r = await api('/api/login-log/recent' + query);
    const rows = r.rows || [];
    currentLogIds = rows.map(row => row.id).filter(Boolean);
    logTotalPages = Math.max(1, Number(r.totalPages || 1));
    logPage = Math.min(Math.max(1, Number(r.page || logPage)), logTotalPages);
    $('#logSummary').textContent = 'Tổng ' + (r.total || 0) + ' dòng. Thời gian hiển thị theo giờ Việt Nam (GMT+7).';
    $('#logPageInfo').textContent = 'Trang ' + logPage + ' / ' + logTotalPages;
    $('#logPrev').disabled = logPage <= 1;
    $('#logNext').disabled = logPage >= logTotalPages;
    $('#logClearPage').disabled = !currentLogIds.length;
    $('#logTable tbody').dataset.loaded = '1';
    if (!rows.length) {
      $('#logTable tbody').innerHTML = '<tr><td colspan="12" class="empty">Chưa có log nào.</td></tr>';
      return;
    }
    $('#logTable tbody').innerHTML = rows.map(row =>
      '<tr>' +
      '<td>' + esc(row.id) + '</td>' +
      '<td>' + esc(row.timeVietnam || row.time) + '</td>' +
      '<td><code>' + esc(row.account) + '</code></td>' +
      '<td>' + esc(row.team || '') + '</td>' +
      '<td>' + esc(row.display_name || '') + '</td>' +
      '<td>' + esc(row.ip) + '</td>' +
      '<td>' + esc(row.browser) + '</td>' +
      '<td>' + esc(row.platform) + '</td>' +
      '<td>' + esc(row.language) + '</td>' +
      '<td>' + (row.latitude != null && row.longitude != null ? esc(Number(row.latitude).toFixed(5)) + ', ' + esc(Number(row.longitude).toFixed(5)) : '') + '</td>' +
      '<td>' + (row.accuracy != null ? esc(Math.round(Number(row.accuracy))) + ' m' : '') + '</td>' +
      '<td><span class="pill ' + (row.location_status === 'available' ? 'on' : 'off') + '">' + esc(row.location_status || '') + '</span></td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    toast('Lỗi tải logs: ' + err.message, 'err');
  }
}

async function clearCurrentLogs() {
  if (!currentLogIds.length) { toast('Không có log nào để xóa', 'err'); return; }
  if (!confirm('Xóa ' + currentLogIds.length + ' dòng log đang hiển thị?')) return;
  try {
    const r = await api('/api/admin/login-logs/clear', { method: 'POST', body: JSON.stringify({ ids: currentLogIds }) });
    toast('Đã xóa ' + r.deleted + ' dòng log', 'ok');
    loadLogs(false);
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

function openModal(user) {
  $('#modalTitle').textContent = user ? 'Sửa user: ' + user.code : 'Thêm user mới';
  const f = $('#userForm');
  f.reset();
  f.elements.code.disabled = !!(user && user.code === currentAdminCode);
  if (user) {
    f.elements.code.value = user.code || '';
    f.elements.team.value = user.team || '';
    f.elements.folder.value = user.folder || '';
    f.elements.shortLabel.value = user.shortLabel || '';
    f.elements.subtitle.value = user.subtitle || '';
    f.elements.notes.value = user.notes || '';
    f.elements.isActive.checked = !!user.isActive;
  }
  f.dataset.editing = user ? user.code : '';
  $('#modal').classList.add('open');
}

function closeModal() {
  $('#modal').classList.remove('open');
  $('#userForm').dataset.editing = '';
}

async function saveUser(event) {
  event.preventDefault();
  const f = event.target;
  const editing = f.dataset.editing;
  const data = {
    code: f.elements.code.value.trim().toLowerCase(),
    team: f.elements.team.value.trim(),
    folder: f.elements.folder.value.trim(),
    shortLabel: f.elements.shortLabel.value.trim(),
    subtitle: f.elements.subtitle.value.trim(),
    notes: f.elements.notes.value.trim(),
    isActive: f.elements.isActive.checked
  };
  try {
    if (editing) {
      await api('/api/users?code=' + encodeURIComponent(editing), { method: 'PUT', body: JSON.stringify(data) });
      selectedUserCode = editing;
      toast('Đã cập nhật ' + editing, 'ok');
    } else {
      const r = await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
      selectedUserCode = r.user ? r.user.code : data.code;
      toast('Đã thêm ' + data.code, 'ok');
    }
    closeModal();
    await loadUsers();
    populateLogSelect();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function deleteUser(code) {
  if (code === currentAdminCode) { toast('Không thể xóa tài khoản admin', 'err'); return; }
  if (!confirm('Xóa user ' + code + ' và toàn bộ session của user này?')) return;
  try {
    await api('/api/users?code=' + encodeURIComponent(code), { method: 'DELETE' });
    toast('Đã xóa ' + code, 'ok');
    if (selectedUserCode === code) selectedUserCode = '';
    await loadUsers();
    populateLogSelect();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function toggleUser(code, currentlyActive) {
  try {
    await api('/api/users?code=' + encodeURIComponent(code), {
      method: 'PUT',
      body: JSON.stringify({ isActive: !currentlyActive })
    });
    toast('Đã cập nhật trạng thái ' + code, 'ok');
    await loadUsers();
    populateLogSelect();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function killSessions(code) {
  if (!code) return;
  if (!confirm('Hủy tất cả session đang hoạt động của ' + code + '?')) return;
  try {
    const r = await api('/api/admin/sessions/kill', { method: 'POST', body: JSON.stringify({ code }) });
    toast('Đã hủy ' + r.deleted + ' session của ' + code, 'ok');
    loadUserSessions(code);
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#loginCard').addEventListener('submit', doLogin);
  $('#sidebarLogout').addEventListener('click', logout);
  $$('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'sidebarLogout') return;
      setView(btn.dataset.view);
    });
  });
  $('#userSearch').addEventListener('input', renderUsers);
  $('#userReload').addEventListener('click', loadUsers);
  $('#userAdd').addEventListener('click', () => openModal(null));
  $('#userTable').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (btn) {
      const code = btn.dataset.code;
      if (btn.dataset.act === 'edit') {
        const user = allUsers.find(u => u.code === code);
        if (user) openModal(user);
      } else if (btn.dataset.act === 'toggle') {
        toggleUser(code, btn.dataset.active === '1');
      } else if (btn.dataset.act === 'delete') {
        deleteUser(code);
      }
      return;
    }
    const row = event.target.closest('tr[data-code]');
    if (row) selectUser(row.dataset.code);
  });
  $('#logSelect').addEventListener('change', () => loadLogs(true));
  $('#logLimit').addEventListener('change', () => loadLogs(true));
  $('#logReload').addEventListener('click', () => loadLogs(false));
  $('#logPrev').addEventListener('click', () => { if (logPage > 1) { logPage--; loadLogs(false); } });
  $('#logNext').addEventListener('click', () => { if (logPage < logTotalPages) { logPage++; loadLogs(false); } });
  $('#logClearPage').addEventListener('click', clearCurrentLogs);
  $$('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
  $('#modal').addEventListener('click', event => { if (event.target.id === 'modal') closeModal(); });
  $('#userForm').addEventListener('submit', saveUser);
  trySession();
});
</script>
</body>
</html>`;
}

function renderAdminPage() {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BDDR Tong – Admin</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f6f8; --card:#fff; --line:#e4e7eb; --ink:#1f2933; --muted:#52606d; --pri:#1f6feb; --pri-ink:#fff; --danger:#b91c1c; --ok:#03543f; --warn:#92400e; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }
  header.top { display:flex; align-items:center; gap:12px; padding:12px 20px; background:#0f172a; color:#fff; }
  header.top h1 { margin:0; font-size:1.1rem; font-weight:600; }
  header.top .right { margin-left:auto; display:flex; gap:8px; align-items:center; }
  header.top a, header.top button { color:#cbd5e1; background:transparent; border:1px solid #334155; padding:4px 10px; border-radius:6px; cursor:pointer; font-size:.85rem; text-decoration:none; }
  header.top a:hover, header.top button:hover { background:#1e293b; }
  main { max-width: 1280px; margin: 16px auto; padding: 0 16px; }
  .login-card { max-width: 420px; margin: 80px auto; padding: 28px; background: var(--card); border:1px solid var(--line); border-radius: 12px; box-shadow:0 2px 8px rgba(15,23,42,.05); }
  .login-card h2 { margin: 0 0 8px; font-size: 1.2rem; }
  .login-card p { margin: 0 0 16px; color: var(--muted); font-size: .9rem; }
  .login-card input { width: 100%; padding: 8px 10px; border: 1px solid #cbd2d9; border-radius: 6px; font-size: 1rem; }
  .login-card button { width: 100%; margin-top: 12px; padding: 8px 12px; background: var(--pri); color: var(--pri-ink); border: 0; border-radius: 6px; font-size: 1rem; cursor: pointer; }
  .login-card .err { color: var(--danger); margin-top: 8px; font-size: .85rem; min-height: 1.2em; }
  nav.tabs { display:flex; gap:4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
  nav.tabs button { padding: 8px 16px; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; font-size: .95rem; color: var(--muted); }
  nav.tabs button.active { color: var(--pri); border-bottom-color: var(--pri); font-weight: 600; }
  .panel { display:none; }
  .panel.active { display:block; }
  .toolbar { display:flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .toolbar input.search { flex: 1; min-width: 200px; padding: 7px 10px; border: 1px solid #cbd2d9; border-radius: 6px; }
  .toolbar button { padding: 6px 12px; background: var(--pri); color: var(--pri-ink); border: 0; border-radius: 6px; cursor: pointer; font-size: .9rem; }
  .toolbar button.ghost { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
  .toolbar button.danger { background: var(--danger); }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 12px; border-bottom: 1px solid var(--line); text-align: left; font-size: .9rem; vertical-align: top; }
  th { background: #eef2f6; font-weight: 600; position: sticky; top: 0; }
  tr:nth-child(even) td { background: #fafbfc; }
  tr:hover td { background: #eef2f6; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .75rem; font-weight: 500; }
  .pill.on { background: #def7ec; color: var(--ok); }
  .pill.off { background: #fde8e8; color: var(--danger); }
  .row-actions { display:flex; gap: 4px; }
  .row-actions button { padding: 3px 8px; font-size: .8rem; background: var(--card); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
  .row-actions button.danger { color: var(--danger); border-color: #fca5a5; }
  .row-actions button:hover { background: #eef2f6; }
  /* Modal */
  .modal-back { position: fixed; inset: 0; background: rgba(15,23,42,.5); display: none; align-items: center; justify-content: center; z-index: 100; }
  .modal-back.open { display: flex; }
  .modal { background: var(--card); border-radius: 12px; max-width: 520px; width: 100%; padding: 20px; box-shadow: 0 10px 40px rgba(15,23,42,.2); }
  .modal h3 { margin: 0 0 12px; font-size: 1.1rem; }
  .modal label { display: block; font-size: .85rem; color: var(--muted); margin-top: 8px; }
  .modal input, .modal textarea { width: 100%; padding: 7px 10px; border: 1px solid #cbd2d9; border-radius: 6px; font-size: .95rem; font-family: inherit; }
  .modal .row { display:flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
  .modal button { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); cursor: pointer; font-size: .9rem; }
  .modal button.primary { background: var(--pri); color: var(--pri-ink); border-color: var(--pri); }
  .modal button.danger { background: var(--danger); color: #fff; border-color: var(--danger); }
  .empty { padding: 32px; text-align: center; color: var(--muted); }
  .toast { position: fixed; bottom: 20px; right: 20px; background: #0f172a; color: #fff; padding: 10px 16px; border-radius: 8px; opacity: 0; transform: translateY(20px); transition: all .2s; z-index: 200; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.err { background: var(--danger); }
  .toast.ok { background: var(--ok); }
  code { background: #eef2f6; padding: 1px 6px; border-radius: 4px; font-size: .85em; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --ink:#e2e8f0; --muted:#94a3b8; }
    th { background: #243349; }
    tr:nth-child(even) td { background: #18223a; }
    tr:hover td { background: #243349; }
    code { background: #243349; }
  }
</style>
</head>
<body>
<header class="top">
  <h1>🛠 BDDR Tong — Admin</h1>
  <div class="right">
    <span id="who" style="font-size:.85rem;color:#94a3b8"></span>
    <a href="/" target="_blank">Xem log ↗</a>
    <button id="logout">Đăng xuất</button>
  </div>
</header>

<main>
  <!-- Login card (hiện khi chưa có token) -->
  <div id="loginCard" class="login-card">
    <h2>Đăng nhập admin</h2>
        <p>Chỉ tài khoản admin mới có quyền truy cập trang này.</p>
    <input id="loginCode" type="text" placeholder="Nhập mã đăng nhập" autocomplete="off" />
    <button id="loginBtn">Đăng nhập</button>
    <div class="err" id="loginErr"></div>
  </div>

  <!-- App (hiện khi đã đăng nhập admin) -->
  <div id="app" style="display:none">
    <nav class="tabs">
      <button data-tab="users" class="active">👥 Users</button>
      <button data-tab="sessions">🔐 Sessions</button>
      <button data-tab="logs">📋 Logs theo user</button>
    </nav>

    <!-- USERS -->
    <section id="panel-users" class="panel active">
      <div class="toolbar">
        <input class="search" id="userSearch" placeholder="Tìm theo mã, tên đội, folder..." />
        <button id="userAdd" class="ghost">+ Thêm user</button>
        <button id="userReload" class="ghost">↻ Tải lại</button>
      </div>
      <table id="userTable">
        <thead><tr>
          <th>Mã</th><th>Tên đội</th><th>Folder</th><th>Short label</th><th>Trạng thái</th><th>Cập nhật (VN)</th><th></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <!-- SESSIONS -->
    <section id="panel-sessions" class="panel">
      <div class="toolbar">
        <label style="font-size:.85rem;color:var(--muted)">User:
          <select id="sessSelect" style="margin-left:6px;padding:6px 8px;border:1px solid #cbd2d9;border-radius:6px"></select>
        </label>
        <button id="sessReload" class="ghost">↻ Tải lại</button>
        <button id="sessKill" class="danger">✕ Huỷ tất cả session của user này</button>
      </div>
      <table id="sessTable">
        <thead><tr>
          <th>Token</th><th>IP</th><th>User-Agent</th><th>Tạo (VN)</th><th>Hết hạn (VN)</th><th>Lần cuối (VN)</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <!-- LOGS -->
    <section id="panel-logs" class="panel">
      <div class="toolbar">
        <label style="font-size:.85rem;color:var(--muted)">User:
          <select id="logSelect" style="margin-left:6px;padding:6px 8px;border:1px solid #cbd2d9;border-radius:6px"></select>
        </label>
        <label style="font-size:.85rem;color:var(--muted)">Số dòng:
          <input id="logLimit" type="number" min="1" max="500" value="100" style="margin-left:6px;padding:6px 8px;border:1px solid #cbd2d9;border-radius:6px;width:80px" />
        </label>
        <button id="logReload" class="ghost">↻ Tải lại</button>
        <button id="logClearPage" class="danger">Xoa log trang hien tai</button>
      </div>
      <table id="logTable">
        <thead><tr>
          <th>#</th><th>Thời gian (VN)</th><th>IP</th><th>Trình duyệt</th><th>HĐH</th><th>Ngôn ngữ</th><th>Tọa độ</th><th>Trạng thái</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </section>
  </div>
</main>

<!-- Modal edit/add user -->
<div class="modal-back" id="modal">
  <div class="modal">
    <h3 id="modalTitle">Thêm user</h3>
    <form id="userForm">
      <label>Mã đăng nhập *<input name="code" required pattern="[a-z0-9_-]{1,80}" /></label>
      <label>Tên đội / đơn vị *<input name="team" required maxlength="120" /></label>
      <label>Folder dữ liệu *<input name="folder" required maxlength="80" placeholder="vd: doi01, main" /></label>
      <label>Short label<input name="shortLabel" maxlength="120" /></label>
      <label>Subtitle<input name="subtitle" maxlength="200" /></label>
      <label>Ghi chú<textarea name="notes" rows="2" maxlength="500"></textarea></label>
      <label style="display:flex;align-items:center;gap:6px;margin-top:12px">
        <input type="checkbox" name="isActive" checked /> Đang hoạt động
      </label>
      <div class="row">
        <button type="button" data-close>Hủy</button>
        <button type="submit" class="primary" id="modalSave">Lưu</button>
      </div>
    </form>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const BASE = location.origin;
let currentAdminCode = '';
const TOKEN_KEY = 'bddr-admin-token';
let adminToken = localStorage.getItem(TOKEN_KEY) || null;
let allUsers = [];
let currentLogIds = [];

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + (kind || '');
  setTimeout(() => t.className = 'toast ' + (kind || ''), 2200);
}

async function api(path, options) {
  options = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
  const r = await fetch(BASE + path, Object.assign({}, options, { headers }));
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && body.error) || ('HTTP ' + r.status));
  return body;
}

function setLoggedInUI(token, userCode) {
  adminToken = token;
  currentAdminCode = userCode || '';
  if (token) localStorage.setItem(TOKEN_KEY, token);
  $('#loginCard').style.display = 'none';
  $('#app').style.display = '';
  $('#who').textContent = '👤 ' + userCode;
  loadAll();
}

function setLoggedOutUI() {
  adminToken = null;
  currentAdminCode = '';
  localStorage.removeItem(TOKEN_KEY);
  $('#loginCard').style.display = '';
  $('#app').style.display = 'none';
  $('#who').textContent = '';
}

async function trySession() {
  if (!adminToken) return setLoggedOutUI();
  try {
    const r = await api('/api/session');
    if (r.ok && r.user) {
      setLoggedInUI(adminToken, r.user.code);
    } else {
      toast('Tài khoản không có quyền admin', 'err');
      setLoggedOutUI();
    }
  } catch (err) {
    setLoggedOutUI();
  }
}

async function doLogin() {
  $('#loginErr').textContent = '';
  const code = $('#loginCode').value.trim();
  if (!code) { $('#loginErr').textContent = 'Nhập mã'; return; }
  try {
    const r = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const body = await r.json();
    if (!r.ok || !body.ok) throw new Error(body.error || ('HTTP ' + r.status));
    setLoggedInUI(body.token, body.user.code);
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
}

async function loadAll() {
  await loadUsers();
  await populateSelects();
}

async function loadUsers() {
  try {
    const r = await api('/api/admin/users');
    allUsers = r.users || [];
    renderUsers();
  } catch (err) {
    toast('Lỗi tải users: ' + err.message, 'err');
  }
}

function renderUsers() {
  const q = ($('#userSearch').value || '').toLowerCase();
  const tb = $('#userTable tbody');
  const list = allUsers.filter(u =>
    !q || (u.code + ' ' + u.team + ' ' + u.folder + ' ' + (u.shortLabel || '')).toLowerCase().includes(q)
  );
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">Không có user nào</td></tr>';
    return;
  }
  tb.innerHTML = list.map(u =>
    '<tr>' +
    '<td><code>' + esc(u.code) + '</code></td>' +
    '<td>' + esc(u.team) + '</td>' +
    '<td><code>' + esc(u.folder) + '</code></td>' +
    '<td>' + esc(u.shortLabel || '') + '</td>' +
    '<td><span class="pill ' + (u.isActive ? 'on' : 'off') + '">' + (u.isActive ? 'active' : 'inactive') + '</span></td>' +
    '<td style="font-size:.8rem;color:var(--muted)">' + esc(u.updatedAtVietnam || u.updatedAt || '') + '</td>' +
    '<td><div class="row-actions">' +
      '<button data-act="edit" data-code="' + esc(u.code) + '">Sửa</button>' +
      '<button data-act="toggle" data-code="' + esc(u.code) + '" data-active="' + (u.isActive ? '1' : '0') + '">' + (u.isActive ? 'Khoá' : 'Mở') + '</button>' +
      (u.code === currentAdminCode ? '' : '<button data-act="delete" data-code="' + esc(u.code) + '" class="danger">Xoá</button>') +
    '</div></td>' +
    '</tr>'
  ).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function populateSelects() {
  const opts = '<option value="">-- chọn user --</option>' +
    allUsers.map(u => '<option value="' + esc(u.code) + '">' + esc(u.code) + ' — ' + esc(u.team) + '</option>').join('');
  $('#sessSelect').innerHTML = opts;
  $('#logSelect').innerHTML = opts;
}

function openModal(user) {
  $('#modalTitle').textContent = user ? 'Sửa user: ' + user.code : 'Thêm user mới';
  const f = $('#userForm');
  f.reset();
  f.elements.code.disabled = !!(user && user.code === currentAdminCode);
  if (user) {
    f.elements.code.value = user.code || '';
    f.elements.team.value = user.team || '';
    f.elements.folder.value = user.folder || '';
    f.elements.shortLabel.value = user.shortLabel || '';
    f.elements.subtitle.value = user.subtitle || '';
    f.elements.notes.value = user.notes || '';
    f.elements.isActive.checked = !!user.isActive;
  }
  f.dataset.editing = user ? user.code : '';
  $('#modal').classList.add('open');
}

function closeModal() {
  $('#modal').classList.remove('open');
  $('#userForm').dataset.editing = '';
}

async function saveUser(ev) {
  ev.preventDefault();
  const f = ev.target;
  const editing = f.dataset.editing;
  const data = {
    code: f.elements.code.value.trim().toLowerCase(),
    team: f.elements.team.value.trim(),
    folder: f.elements.folder.value.trim(),
    shortLabel: f.elements.shortLabel.value.trim(),
    subtitle: f.elements.subtitle.value.trim(),
    notes: f.elements.notes.value.trim(),
    isActive: f.elements.isActive.checked
  };
  try {
    if (editing) {
      await api('/api/users?code=' + encodeURIComponent(editing), { method: 'PUT', body: JSON.stringify(data) });
      toast('Đã cập nhật ' + editing, 'ok');
    } else {
      await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
      toast('Đã thêm ' + data.code, 'ok');
    }
    closeModal();
    loadUsers();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function deleteUser(code) {
  if (code === currentAdminCode) { toast('Không thể xoá tài khoản admin', 'err'); return; }
  if (!confirm('Xoá user ' + code + ' và toàn bộ session của user này? Không thể hoàn tác.')) return;
  try {
    await api('/api/users?code=' + encodeURIComponent(code), { method: 'DELETE' });
    toast('Đã xoá ' + code, 'ok');
    loadUsers();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function toggleUser(code, currentlyActive) {
  try {
    await api('/api/users?code=' + encodeURIComponent(code), {
      method: 'PUT',
      body: JSON.stringify({ isActive: !currentlyActive })
    });
    toast('Đã cập nhật trạng thái ' + code, 'ok');
    loadUsers();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function loadSessions() {
  const code = $('#sessSelect').value;
  if (!code) { $('#sessTable tbody').innerHTML = '<tr><td colspan="6" class="empty">Chọn user để xem session</td></tr>'; return; }
  try {
    const r = await api('/api/admin/sessions?code=' + encodeURIComponent(code));
    const list = r.sessions || [];
    if (!list.length) { $('#sessTable tbody').innerHTML = '<tr><td colspan="6" class="empty">User này chưa có session</td></tr>'; return; }
    $('#sessTable tbody').innerHTML = list.map(s =>
      '<tr>' +
      '<td><code style="font-size:.75rem">' + esc(s.token) + '</code></td>' +
      '<td>' + esc(s.ip) + '</td>' +
      '<td style="max-width:300px;word-break:break-all;font-size:.8rem">' + esc(s.userAgent) + '</td>' +
      '<td style="font-size:.8rem">' + esc(s.createdAtVietnam || s.createdAt) + '</td>' +
      '<td style="font-size:.8rem">' + esc(s.expiresAtVietnam || s.expiresAt) + '</td>' +
      '<td style="font-size:.8rem">' + esc(s.lastSeenAtVietnam || s.lastSeenAt) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function killSessions() {
  const code = $('#sessSelect').value;
  if (!code) return;
  if (!confirm('Huỷ tất cả session đang hoạt động của ' + code + '? Họ sẽ bị đăng xuất ngay.')) return;
  try {
    const r = await api('/api/admin/sessions/kill', { method: 'POST', body: JSON.stringify({ code }) });
    toast('Đã huỷ ' + r.deleted + ' session của ' + code, 'ok');
    loadSessions();
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

async function clearCurrentLogs() {
  const code = $('#logSelect').value;
  if (!code || !currentLogIds.length) { toast('Khong co log nao de xoa', 'err'); return; }
  if (!confirm('Xoa ' + currentLogIds.length + ' dong log dang hien thi cua ' + code + '?')) return;
  try {
    const r = await api('/api/admin/login-logs/clear', { method: 'POST', body: JSON.stringify({ ids: currentLogIds }) });
    toast('Da xoa ' + r.deleted + ' dong log', 'ok');
    loadLogs();
  } catch (err) {
    toast('Loi: ' + err.message, 'err');
  }
}

async function loadLogs() {
  const code = $('#logSelect').value;
  if (!code) { currentLogIds = []; $('#logTable tbody').innerHTML = '<tr><td colspan="8" class="empty">Chọn user để xem log</td></tr>'; return; }
  const limit = Math.min(500, Math.max(1, parseInt($('#logLimit').value) || 100));
  try {
    // Dùng endpoint JSON sẵn có
    const r = await api('/api/login-log/recent?account=' + encodeURIComponent(code) + '&pageSize=' + limit);
    const list = r.rows || [];
    currentLogIds = list.map(row => row.id).filter(Boolean);
    if (!list.length) { $('#logTable tbody').innerHTML = '<tr><td colspan="8" class="empty">User này chưa có log</td></tr>'; return; }
    $('#logTable tbody').innerHTML = list.map(row =>
      '<tr>' +
      '<td>' + esc(row.id) + '</td>' +
      '<td style="font-size:.8rem">' + esc(row.timeVietnam || row.time) + '</td>' +
      '<td>' + esc(row.ip) + '</td>' +
      '<td style="font-size:.8rem">' + esc(row.browser) + '</td>' +
      '<td style="font-size:.8rem">' + esc(row.platform) + '</td>' +
      '<td style="font-size:.8rem">' + esc(row.language) + '</td>' +
      '<td style="font-size:.8rem">' + (row.latitude != null ? esc(row.latitude.toFixed(5)) + ', ' + esc(row.longitude.toFixed(5)) : '') + '</td>' +
      '<td><span class="pill ' + (row.location_status === 'available' ? 'on' : 'off') + '">' + esc(row.location_status) + '</span></td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    toast('Lỗi: ' + err.message, 'err');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#loginBtn').addEventListener('click', doLogin);
  $('#loginCode').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/session/logout', { method: 'POST' }); } catch (e) {}
    setLoggedOutUI();
  });

  $$('nav.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('nav.tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.panel').forEach(p => p.classList.remove('active'));
      const id = 'panel-' + btn.dataset.tab;
      $('#' + id).classList.add('active');
      if (btn.dataset.tab === 'sessions') loadSessions();
      if (btn.dataset.tab === 'logs') loadLogs();
    });
  });

  $('#userSearch').addEventListener('input', renderUsers);
  $('#userReload').addEventListener('click', loadUsers);
  $('#userAdd').addEventListener('click', () => openModal(null));
  $('#userTable').addEventListener('click', ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const code = btn.dataset.code;
    if (btn.dataset.act === 'edit') {
      const u = allUsers.find(x => x.code === code);
      if (u) openModal(u);
    } else if (btn.dataset.act === 'delete') {
      deleteUser(code);
    } else if (btn.dataset.act === 'toggle') {
      toggleUser(code, btn.dataset.active === '1');
    }
  });

  $('#sessSelect').addEventListener('change', loadSessions);
  $('#sessReload').addEventListener('click', loadSessions);
  $('#sessKill').addEventListener('click', killSessions);

  $('#logSelect').addEventListener('change', loadLogs);
  $('#logLimit').addEventListener('change', loadLogs);
  $('#logReload').addEventListener('click', loadLogs);
  $('#logClearPage').addEventListener('click', clearCurrentLogs);

  $$('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  $('#userForm').addEventListener('submit', saveUser);

  trySession();
});
</script>
</body>
</html>`;
}

async function createSession(env, user, request) {
  const token = generateToken(SESSION_TOKEN_BYTES);
  const ip = cleanText(getClientIp(request), 120);
  const ua = cleanText(request.headers.get('user-agent'), 500);
  const expires = isoFromNow(SESSION_TTL_MS);
  await env.DB.prepare(
    'INSERT INTO sessions (token, code, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(token, user.code, ip, ua, expires).run();
  return { token, expiresAt: expires };
}

async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

async function loadSession(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT token, code, ip, user_agent, expires_at FROM sessions WHERE token = ? LIMIT 1'
  ).bind(token).first();
  if (!row) return null;
  const expiresMs = parseIsoUtc(row.expires_at);
  if (!expiresMs || expiresMs < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  return { token: row.token, code: row.code, ip: row.ip, ua: row.user_agent, expiresAt: row.expires_at, expiresMs };
}

function sessionFingerprint(request, ip, ua) {
  return cleanText(ip, 120) + '|' + cleanText(ua, 500);
}

async function refreshSessionIfNeeded(env, session) {
  const remaining = session.expiresMs - Date.now();
  if (remaining > SESSION_REFRESH_WINDOW_MS) return session;
  const newExpires = isoFromNow(SESSION_TTL_MS);
  await env.DB.prepare(
    "UPDATE sessions SET expires_at = ?, last_seen_at = datetime('now') WHERE token = ?"
  ).bind(newExpires, session.token).run();
  session.expiresAt = newExpires;
  session.expiresMs = parseIsoUtc(newExpires);
  return session;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    code: row.code,
    team: row.team,
    folder: row.folder,
    shortLabel: row.short_label || row.team || row.code,
    subtitle: row.subtitle || '',
    isActive: Number(row.is_active) === 1,
    notes: row.notes || '',
    updatedAt: row.updated_at || '',
    updatedAtVietnam: formatVietnamTime(row.updated_at || '')
  };
}

function userToProfile(user) {
  if (!user) return null;
  const folder = user.folder || 'main';
  return {
    userCode: user.code,
    folder,
    displayName: user.team || user.code,
    shortLabel: user.shortLabel || user.team || user.code,
    subtitle: user.subtitle || ''
  };
}

async function fetchActiveUsers(env) {
  const result = await env.DB.prepare(
    'SELECT code, team, folder, short_label, subtitle, is_active, notes, updated_at ' +
    'FROM users WHERE is_active = 1 ORDER BY code ASC'
  ).all();
  const rows = (result && result.results) || [];
  return rows.map(rowToUser);
}

function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return '';
}

async function fetchLogsPage(env, options) {
  const page = options.page;
  const pageSize = options.pageSize;
  const account = options.account;
  const offset = (page - 1) * pageSize;

  const where = [];
  const params = [];
  if (account) {
    where.push('account = ?');
    params.push(account);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM login_logs' + whereSql
  ).bind(...params).first();
  const total = countRow ? Number(countRow.total) : 0;

  const rowsResult = await env.DB.prepare(
    'SELECT id, time, account, display_name, team, ip, browser, platform, language, latitude, longitude, accuracy, location_status ' +
    'FROM login_logs' + whereSql +
    ' ORDER BY id DESC LIMIT ? OFFSET ?'
  ).bind(...params, pageSize, offset).all();

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: ((rowsResult && rowsResult.results) || []).map(row => Object.assign({}, row, {
      timeVietnam: formatVietnamTime(row.time)
    }))
  };
}

async function deleteLoginLogsByIds(env, ids) {
  const cleanIds = Array.from(new Set((ids || [])
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0)))
    .slice(0, PAGE_SIZE_MAX);
  if (!cleanIds.length) return { ok: true, deleted: 0 };
  const placeholders = cleanIds.map(() => '?').join(', ');
  const result = await env.DB.prepare('DELETE FROM login_logs WHERE id IN (' + placeholders + ')').bind(...cleanIds).run();
  const meta = result && result.meta ? result.meta : {};
  return { ok: true, deleted: Number(meta.changes || meta.rows_written || 0) };
}

function renderLogsTable(data, options) {
  const { page, pageSize, total, totalPages, rows } = data;
  const account = options.account || '';
  const baseQuery = account ? '&account=' + encodeURIComponent(account) : '';
  const prevHref = page > 1 ? '?page=' + (page - 1) + '&pageSize=' + pageSize + baseQuery : '';
  const nextHref = page < totalPages ? '?page=' + (page + 1) + '&pageSize=' + pageSize + baseQuery : '';
  const currentPageIds = rows.map(r => r.id).filter(Boolean);

  const head = `
    <tr>
      <th>#</th>
      <th>Thời gian (Việt Nam)</th>
      <th>Mã</th>
      <th>Đơn vị</th>
      <th>Tên hiển thị</th>
      <th>IP</th>
      <th>Trình duyệt</th>
      <th>HĐH</th>
      <th>Ngôn ngữ</th>
      <th>Tọa độ</th>
      <th>Sai số (m)</th>
      <th>Trạng thái</th>
    </tr>`;

  let body = '';
  if (!rows.length) {
    body = '<tr><td colspan="12" class="empty">Chưa có log nào</td></tr>';
  } else {
    for (const r of rows) {
      body += '<tr>' +
        '<td>' + escapeHtml(r.id) + '</td>' +
        '<td>' + escapeHtml(r.timeVietnam || r.time) + '</td>' +
        '<td>' + escapeHtml(r.account) + '</td>' +
        '<td>' + escapeHtml(r.team || '') + '</td>' +
        '<td>' + escapeHtml(r.display_name) + '</td>' +
        '<td>' + escapeHtml(r.ip) + '</td>' +
        '<td>' + escapeHtml(r.browser) + '</td>' +
        '<td>' + escapeHtml(r.platform) + '</td>' +
        '<td>' + escapeHtml(r.language) + '</td>' +
        '<td>' + escapeHtml(formatLocation(r)) + '</td>' +
        '<td>' + escapeHtml(formatNumber(r.accuracy, 0)) + '</td>' +
        '<td><span class="status ' + escapeHtml(r.location_status) + '">' + escapeHtml(r.location_status) + '</span></td>' +
      '</tr>';
    }
  }

  const filterBlock = `
    <form method="get" class="filter">
      <label>Mã đăng nhập:
        <input type="text" name="account" value="${escapeHtml(account)}" placeholder="mã đăng nhập" />
      </label>
      <label>Số dòng/trang:
        <input type="number" name="pageSize" min="1" max="${PAGE_SIZE_MAX}" value="${escapeHtml(pageSize)}" />
      </label>
      <button type="submit">Lọc</button>
      <button type="button" id="clearPageLogsBtn" class="danger"${currentPageIds.length ? '' : ' disabled'}>Xoa log trang hien tai</button>
    </form>`;

  const nav = `
    <div class="nav">
      <a class="btn" href="?page=1&pageSize=${escapeHtml(pageSize)}${baseQuery}">« Đầu</a>
      <a class="btn" href="${escapeHtml(prevHref || '#')}"${prevHref ? '' : ' aria-disabled="true"'}>‹ Trước</a>
      <span>Trang <b>${escapeHtml(page)}</b> / <b>${escapeHtml(totalPages)}</b> — tổng <b>${escapeHtml(total)}</b> dòng</span>
      <a class="btn" href="${escapeHtml(nextHref || '#')}"${nextHref ? '' : ' aria-disabled="true"'}>Sau ›</a>
      <a class="btn" href="?page=${escapeHtml(totalPages)}&pageSize=${escapeHtml(pageSize)}${baseQuery}">Cuối »</a>
    </div>`;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BDDR Tong – Log đăng nhập</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 16px; background: #f4f6f8; color: #1f2933; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  .sub { color: #52606d; margin-bottom: 12px; }
  .filter { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin: 12px 0; padding: 10px 12px; background: #fff; border: 1px solid #e4e7eb; border-radius: 8px; }
  .filter label { display: flex; flex-direction: column; font-size: 0.85rem; color: #52606d; }
  .filter input { padding: 6px 8px; border: 1px solid #cbd2d9; border-radius: 6px; min-width: 180px; }
  .filter button { padding: 6px 14px; background: #1f6feb; color: #fff; border: 0; border-radius: 6px; cursor: pointer; height: 32px; }
  .filter button.danger { background: #c81e1e; }
  .filter button:disabled { opacity: 0.55; cursor: not-allowed; }
  .nav { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 12px; }
  .btn { padding: 4px 10px; background: #fff; border: 1px solid #cbd2d9; border-radius: 6px; text-decoration: none; color: #1f2933; font-size: 0.9rem; }
  .btn[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e7eb; border-radius: 8px; overflow: hidden; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e4e7eb; text-align: left; font-size: 0.9rem; vertical-align: top; }
  th { background: #eef2f6; font-weight: 600; position: sticky; top: 0; }
  tr:nth-child(even) td { background: #fafbfc; }
  td.empty { text-align: center; color: #9aa5b1; padding: 24px; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; }
  .status.available { background: #def7ec; color: #03543f; }
  .status.unavailable { background: #fde8e8; color: #9b1c1c; }
  footer { margin-top: 16px; color: #7b8794; font-size: 0.8rem; }
  code { background: #eef2f6; padding: 1px 4px; border-radius: 4px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #e2e8f0; }
    .filter, table, .btn { background: #1e293b; border-color: #334155; color: #e2e8f0; }
    th { background: #243349; }
    tr:nth-child(even) td { background: #18223a; }
    code { background: #243349; }
  }
</style>
</head>
<body>
  <h1>BDDR Tong – Log đăng nhập</h1>
  <div class="sub">Dữ liệu trong bảng <code>login_logs</code> của Cloudflare D1. Thời gian hiển thị theo giờ Việt Nam (GMT+7).</div>
  ${filterBlock}
  ${nav}
  <table>
    <thead>${head}</thead>
    <tbody>${body}</tbody>
  </table>
  <footer>
    API: <code>GET /api/login-log/recent</code> (JSON) · <code>POST /api/login-log</code> (ghi log) · Cập nhật lúc ${escapeHtml(formatVietnamTime(new Date().toISOString()))}
  </footer>
  <script>
    const CURRENT_PAGE_LOG_IDS = ${JSON.stringify(currentPageIds)};
    const clearBtn = document.getElementById('clearPageLogsBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!CURRENT_PAGE_LOG_IDS.length) return;
        const token = localStorage.getItem('bddr-admin-token');
        if (!token) { alert('Can dang nhap admin truoc khi xoa log. Hay vao /admin dang nhap roi quay lai trang nay.'); return; }
        if (!confirm('Xoa ' + CURRENT_PAGE_LOG_IDS.length + ' dong log dang hien thi?')) return;
        clearBtn.disabled = true;
        try {
          const resp = await fetch('/api/admin/login-logs/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ ids: CURRENT_PAGE_LOG_IDS })
          });
          const body = await resp.json().catch(() => ({}));
          if (!resp.ok || !body.ok) throw new Error(body.error || ('HTTP ' + resp.status));
          alert('Da xoa ' + body.deleted + ' dong log');
          location.reload();
        } catch (err) {
          clearBtn.disabled = false;
          alert('Loi: ' + (err && err.message ? err.message : err));
        }
      });
    }
  </script>
</body>
</html>`;
}

async function writeLoginLog(request, env) {
  const payload = await request.json().catch(() => ({}));
  const row = {
    time: new Date().toISOString(),
    account: cleanText(payload.account, 80),
    displayName: cleanText(payload.displayName, 120),
    team: cleanText(payload.team, 120),
    ip: cleanText(getClientIp(request), 120),
    userAgent: cleanText(request.headers.get('user-agent'), 500),
    browser: cleanText(payload.browser, 160),
    platform: cleanText(payload.platform, 120),
    language: cleanText(payload.language, 40),
    latitude: cleanNumber(payload.latitude),
    longitude: cleanNumber(payload.longitude),
    accuracy: cleanNumber(payload.accuracy),
    locationStatus: cleanText(payload.locationStatus || 'unavailable', 80)
  };

  const result = await env.DB.prepare(
    'INSERT INTO login_logs (time, account, display_name, team, ip, user_agent, browser, platform, language, latitude, longitude, accuracy, location_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    row.time,
    row.account,
    row.displayName,
    row.team,
    row.ip,
    row.userAgent,
    row.browser,
    row.platform,
    row.language,
    row.latitude,
    row.longitude,
    row.accuracy,
    row.locationStatus
  ).run();

  return json({ ok: true, id: result.meta.last_row_id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const dataAsset = parseDataAssetPath(url.pathname);
    if (dataAsset) {
      return serveDataAsset(request, env, dataAsset);
    }

    // Một dashboard duy nhất cho quản trị user và logs.
    if (url.pathname === '/' || url.pathname === '/logs' || url.pathname === '/admin') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      return html(renderDashboardPage());
    }

    if (url.pathname === '/api/login-log') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      return writeLoginLog(request, env);
    }

    if (url.pathname === '/api/login-log/recent') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const data = await fetchLogsPage(env, {
        page: parsePage(url.searchParams.get('page')),
        pageSize: parsePageSize(url.searchParams.get('pageSize')),
        account: cleanText(url.searchParams.get('account'), 80) || null
      });
      return json({ ok: true, ...data });
    }

    if (url.pathname === '/api/admin/login-logs/clear') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      const adminCheck = await requireAdmin(request, env);
      if (adminCheck.error) return json({ ok: false, error: adminCheck.error }, adminCheck.status);
      const payload = await request.json().catch(() => ({}));
      const result = await deleteLoginLogsByIds(env, payload.ids);
      return json(result);
    }

    if (url.pathname === '/api/users') {
      // GET công khai cho client: chỉ trả user active
      if (request.method === 'GET') {
        const includeInactive = url.searchParams.get('includeInactive') === '1';
        const users = await fetchActiveUsers(env);
        const filtered = includeInactive ? users : users.filter(u => u.isActive);
        return json({ ok: true, count: filtered.length, users: filtered }, 200, {
          'Cache-Control': 'public, max-age=60'
        });
      }
      // POST/PUT/DELETE yêu cầu admin session
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
        const adminCheck = await requireAdmin(request, env);
        if (adminCheck.error) return json({ ok: false, error: adminCheck.error }, adminCheck.status);
        try {
          const payload = await request.json().catch(() => ({}));
          if (request.method === 'POST') {
            const user = await createUser(env, payload);
            return json({ ok: true, user });
          }
          if (request.method === 'PUT') {
            const code = url.searchParams.get('code') || payload.code;
            if (!code) return json({ ok: false, error: 'Thiếu code trong query/body' }, 400);
            const user = await updateUser(env, code, payload);
            return json({ ok: true, user });
          }
          if (request.method === 'DELETE') {
            const code = url.searchParams.get('code') || payload.code;
            if (!code) return json({ ok: false, error: 'Thiếu code' }, 400);
            const result = await deleteUser(env, code);
            return json(result);
          }
        } catch (err) {
          return json({ ok: false, error: err.message || String(err) }, 400);
        }
      }
      return json({ ok: false, error: 'Method not allowed' }, 405);
    }

    // Admin: danh sách tất cả user (kể cả đã khoá)
    if (url.pathname === '/api/admin/users') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const adminCheck = await requireAdmin(request, env);
      if (adminCheck.error) return json({ ok: false, error: adminCheck.error }, adminCheck.status);
      const users = await listAllUsers(env);
      return json({ ok: true, count: users.length, users });
    }

    // Admin: danh sách sessions theo user
    if (url.pathname === '/api/admin/sessions') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const adminCheck = await requireAdmin(request, env);
      if (adminCheck.error) return json({ ok: false, error: adminCheck.error }, adminCheck.status);
      const code = url.searchParams.get('code');
      if (!code) return json({ ok: false, error: 'Thiếu code' }, 400);
      const sessions = await listSessions(env, code);
      return json({ ok: true, count: sessions.length, sessions });
    }

    // Admin: xoá toàn bộ session của 1 user
    if (url.pathname === '/api/admin/sessions/kill') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      const adminCheck = await requireAdmin(request, env);
      if (adminCheck.error) return json({ ok: false, error: adminCheck.error }, adminCheck.status);
      try {
        const payload = await request.json().catch(() => ({}));
        const code = payload.code;
        if (!code) return json({ ok: false, error: 'Thiếu code' }, 400);
        const result = await destroySessionsByCode(env, code);
        return json(result);
      } catch (err) {
        return json({ ok: false, error: err.message || String(err) }, 400);
      }
    }

    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const payload = await request.json().catch(() => ({}));
        const code = cleanText(payload.code, 80).toLowerCase();
        if (!code) return json({ ok: false, error: 'Thiếu mã đăng nhập' }, 400);
        const user = await findUserByCode(env, code);
        if (!user) return json({ ok: false, error: 'Mã đăng nhập không hợp lệ' }, 401);
        const session = await createSession(env, user, request);
        return json({ ok: true, user, profile: userToProfile(user), ...session });
      } catch (err) {
        return json({ ok: false, error: 'Login lỗi: ' + (err && err.message ? err.message : String(err)) }, 500);
      }
    }

    if (url.pathname === '/api/session') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const auth = request.headers.get('authorization') || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      const token = m ? m[1].trim() : null;
      if (!token) return json({ ok: false, error: 'Thiếu token' }, 401);
      const session = await loadSession(env, token);
      if (!session) return json({ ok: false, error: 'Phiên hết hạn' }, 401);
      const reqFp = sessionFingerprint(request, getClientIp(request), request.headers.get('user-agent'));
      const sessFp = sessionFingerprint(request, session.ip, session.ua);
      if (reqFp !== sessFp) {
        await destroySession(env, token);
        return json({ ok: false, error: 'Phiên không hợp lệ (IP/UA khác)' }, 401);
      }
      const refreshed = await refreshSessionIfNeeded(env, session);
      const user = await findUserByCode(env, session.code);
      if (!user) {
        await destroySession(env, token);
        return json({ ok: false, error: 'Tài khoản đã bị khoá' }, 401);
      }
      return json({ ok: true, user, profile: userToProfile(user), expiresAt: refreshed.expiresAt });
    }

    if (url.pathname === '/api/session/logout') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      const auth = request.headers.get('authorization') || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      const token = m ? m[1].trim() : null;
      if (token) await destroySession(env, token);
      return json({ ok: true });
    }


    return json({ ok: false, error: 'Not found' }, 404);
  }
};

























