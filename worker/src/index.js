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

    // Trang HTML xem log (v3-debug) (mở root là có bảng luôn)
    if (url.pathname === '/' || url.pathname === '/logs' || url.pathname === '/admin') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const data = await fetchLogsPage(env, {
        page: parsePage(url.searchParams.get('page')),
        pageSize: parsePageSize(url.searchParams.get('pageSize')),
        account: cleanText(url.searchParams.get('account'), 80) || null
      });
      return html(renderLogsTable(data, { account: url.searchParams.get('account') || '' }));
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
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      const includeInactive = url.searchParams.get('includeInactive') === '1';
      const users = await fetchActiveUsers(env);
      const filtered = includeInactive ? users : users.filter(u => u.isActive);
      return json({ ok: true, count: filtered.length, users: filtered }, 200, {
        'Cache-Control': 'public, max-age=60'
      });
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


















