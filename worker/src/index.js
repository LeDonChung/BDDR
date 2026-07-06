const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 500;
const SESSION_TTL_MS = 60 * 60 * 1000;          // 60 phút
const SESSION_REFRESH_WINDOW_MS = 10 * 60 * 1000; // nếu còn < 10 phút thì gia hạn
const SESSION_TOKEN_BYTES = 32;

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
  // 16 bytes hex là đủ cho session token; tránh crypto.getRandomValues có thể bị lỗi runtime
  let s = '';
  for (let i = 0; i < bytes / 2; i++) {
    s += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return s;
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
  if (normalized === ADMIN_CODE) {
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
    lastSeenAt: r.last_seen_at || ''
  }));
}

async function destroySessionsByCode(env, code) {
  const normalized = cleanText(code, 80).toLowerCase();
  const result = await env.DB.prepare('DELETE FROM sessions WHERE code = ?').bind(normalized).run();
  return { ok: true, code: normalized, deleted: (result && result.meta && result.meta.changes) || 0 };
}

const ADMIN_CODE = 'ledonchung';

function isAdminUser(user) {
  return user && user.code === ADMIN_CODE;
}

async function getUserFromRequest(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const session = await loadSession(env, m[1].trim());
  if (!session) return null;
  return await findAnyUserByCode(env, session.code);
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: 'Cần đăng nhập admin', status: 401 };
  if (!isAdminUser(user)) return { error: 'Chỉ tài khoản ' + ADMIN_CODE + ' mới có quyền admin', status: 403 };
  return { user };
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
    <p>Chỉ tài khoản <code>ledonchung</code> mới có quyền truy cập trang này.</p>
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
          <th>Mã</th><th>Tên đội</th><th>Folder</th><th>Short label</th><th>Trạng thái</th><th>Cập nhật</th><th></th>
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
          <th>Token</th><th>IP</th><th>User-Agent</th><th>Tạo</th><th>Hết hạn</th><th>Lần cuối</th>
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
      </div>
      <table id="logTable">
        <thead><tr>
          <th>#</th><th>Thời gian</th><th>IP</th><th>Trình duyệt</th><th>HĐH</th><th>Ngôn ngữ</th><th>Tọa độ</th><th>Trạng thái</th>
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
const TOKEN_KEY = 'bddr-admin-token';
let adminToken = localStorage.getItem(TOKEN_KEY) || null;
let allUsers = [];

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
  if (token) localStorage.setItem(TOKEN_KEY, token);
  $('#loginCard').style.display = 'none';
  $('#app').style.display = '';
  $('#who').textContent = '👤 ' + userCode;
  loadAll();
}

function setLoggedOutUI() {
  adminToken = null;
  localStorage.removeItem(TOKEN_KEY);
  $('#loginCard').style.display = '';
  $('#app').style.display = 'none';
  $('#who').textContent = '';
}

async function trySession() {
  if (!adminToken) return setLoggedOutUI();
  try {
    const r = await api('/api/session');
    if (r.user && r.user.code === ADMIN_CODE) {
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
    if (body.user.code !== 'doankinhtecty75') {
      $('#loginErr').textContent = 'Chỉ tài khoản tổng mới có quyền admin';
      // vẫn setLoggedInUI để user thấy web vẫn dùng được session, nhưng API admin sẽ 403
      setLoggedInUI(body.token, body.user.code);
      return;
    }
    setLoggedInUI(body.token, body.user.code);
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
}

async function loadAll() {
  await Promise.all([loadUsers(), populateSelects()]);
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
    '<td style="font-size:.8rem;color:var(--muted)">' + esc(u.updatedAt || '') + '</td>' +
    '<td><div class="row-actions">' +
      '<button data-act="edit" data-code="' + esc(u.code) + '">Sửa</button>' +
      '<button data-act="toggle" data-code="' + esc(u.code) + '" data-active="' + (u.isActive ? '1' : '0') + '">' + (u.isActive ? 'Khoá' : 'Mở') + '</button>' +
      (u.code === ADMIN_CODE ? '' : '<button data-act="delete" data-code="' + esc(u.code) + '" class="danger">Xoá</button>') +
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
  f.elements.code.disabled = !!(user && user.code === ADMIN_CODE);
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
  if (code === 'doankinhtecty75') { toast('Không thể xoá tài khoản tổng', 'err'); return; }
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
      '<td style="font-size:.8rem">' + esc(s.createdAt) + '</td>' +
      '<td style="font-size:.8rem">' + esc(s.expiresAt) + '</td>' +
      '<td style="font-size:.8rem">' + esc(s.lastSeenAt) + '</td>' +
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

async function loadLogs() {
  const code = $('#logSelect').value;
  if (!code) { $('#logTable tbody').innerHTML = '<tr><td colspan="8" class="empty">Chọn user để xem log</td></tr>'; return; }
  const limit = Math.min(500, Math.max(1, parseInt($('#logLimit').value) || 100));
  try {
    // Dùng endpoint JSON sẵn có
    const r = await api('/api/login-log/recent?account=' + encodeURIComponent(code) + '&pageSize=' + limit);
    const list = r.rows || [];
    if (!list.length) { $('#logTable tbody').innerHTML = '<tr><td colspan="8" class="empty">User này chưa có log</td></tr>'; return; }
    $('#logTable tbody').innerHTML = list.map(row =>
      '<tr>' +
      '<td>' + esc(row.id) + '</td>' +
      '<td style="font-size:.8rem">' + esc(row.time) + '</td>' +
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
  if (row.expires_at) {
    // eslint-disable-next-line no-console
    console.log('loadSession debug', JSON.stringify({ token: row.token.slice(0,8), raw: row.expires_at, expiresMs, now: Date.now(), diff: expiresMs - Date.now() }));
  }
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
    updatedAt: row.updated_at || ''
  };
}

function userToProfile(user) {
  if (!user) return null;
  const folder = user.folder || 'main';
  return {
    userCode: user.code,
    folder,
    dataDir: 'data/' + folder,
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
    'SELECT id, time, account, display_name, ip, browser, platform, language, latitude, longitude, accuracy, location_status ' +
    'FROM login_logs' + whereSql +
    ' ORDER BY id DESC LIMIT ? OFFSET ?'
  ).bind(...params, pageSize, offset).all();

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    rows: (rowsResult && rowsResult.results) || []
  };
}

function renderLogsTable(data, options) {
  const { page, pageSize, total, totalPages, rows } = data;
  const account = options.account || '';
  const baseQuery = account ? '&account=' + encodeURIComponent(account) : '';
  const prevHref = page > 1 ? '?page=' + (page - 1) + '&pageSize=' + pageSize + baseQuery : '';
  const nextHref = page < totalPages ? '?page=' + (page + 1) + '&pageSize=' + pageSize + baseQuery : '';

  const head = `
    <tr>
      <th>#</th>
      <th>Thời gian (UTC)</th>
      <th>Mã</th>
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
    body = '<tr><td colspan="11" class="empty">Chưa có log nào</td></tr>';
  } else {
    for (const r of rows) {
      body += '<tr>' +
        '<td>' + escapeHtml(r.id) + '</td>' +
        '<td>' + escapeHtml(r.time) + '</td>' +
        '<td>' + escapeHtml(r.account) + '</td>' +
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
        <input type="text" name="account" value="${escapeHtml(account)}" placeholder="vd: cty75doi01" />
      </label>
      <label>Số dòng/trang:
        <input type="number" name="pageSize" min="1" max="${PAGE_SIZE_MAX}" value="${escapeHtml(pageSize)}" />
      </label>
      <button type="submit">Lọc</button>
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
  <div class="sub">Dữ liệu trong bảng <code>login_logs</code> của Cloudflare D1.</div>
  ${filterBlock}
  ${nav}
  <table>
    <thead>${head}</thead>
    <tbody>${body}</tbody>
  </table>
  <footer>
    API: <code>GET /api/login-log/recent</code> (JSON) · <code>POST /api/login-log</code> (ghi log) · Cập nhật lúc ${escapeHtml(new Date().toISOString())}
  </footer>
</body>
</html>`;
}

async function writeLoginLog(request, env) {
  const payload = await request.json().catch(() => ({}));
  const row = {
    time: new Date().toISOString(),
    account: cleanText(payload.account, 80),
    displayName: cleanText(payload.displayName, 120),
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
    'INSERT INTO login_logs (time, account, display_name, ip, user_agent, browser, platform, language, latitude, longitude, accuracy, location_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    row.time,
    row.account,
    row.displayName,
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

    // Trang xem log HTML (mở root hoặc /logs là có bảng)
    if (url.pathname === '/' || url.pathname === '/logs') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const data = await fetchLogsPage(env, {
        page: parsePage(url.searchParams.get('page')),
        pageSize: parsePageSize(url.searchParams.get('pageSize')),
        account: cleanText(url.searchParams.get('account'), 80) || null
      });
      return html(renderLogsTable(data, { account: url.searchParams.get('account') || '' }));
    }

    // Trang admin SPA
    if (url.pathname === '/admin') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      return html(renderAdminPage());
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

























