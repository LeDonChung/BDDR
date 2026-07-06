# BDDR Tong Viewer – Tài liệu Cloudflare Worker & D1

Tài liệu này tổng hợp mọi thứ liên quan tới việc tích hợp **ghi log đăng nhập + quản lý danh sách user/đội** bằng **Cloudflare Worker + Cloudflare D1** cho repo **BDDR-Tong-Viewer**.

## 1. Giới thiệu Cloudflare Worker

Cloudflare Worker là chương trình chạy ở **edge** (gần người dùng) trên hạ tầng Cloudflare.

- Không phải máy chủ truyền thống: bạn chỉ cần viết code xử lý request, không cần quản lý máy chủ.
- **Miễn phí**: Workers Free tier có 100.000 requests/ngày, D1 Free 5GB storage, 100.000 rows written/ngày (theo https://developers.cloudflare.com/workers/platform/pricing và https://developers.cloudflare.com/d1/).
- Hỗ trợ JavaScript và các binding: **D1, KV, R2, Queues, Workers AI**.
- Worker tốt cho: API nhỏ, log, proxy, auth, rate limit, redirect, cron task…

## 2. Kiến trúc hiện tại

```
Người dùng đăng nhập
        │
        ▼
GitHub Pages (index.html, script.js)
        │
        ├── dev: fetch('/api/login-log')   → Node server local (logs/login-access.log)
        └── prod: fetch(URL_WORKER)         → Cloudflare Worker
                                                   │
                                                   ▼
                                          Cloudflare D1 (bddr_logs)
                                          bảng login_logs
```

Files đã tạo:
- `worker/src/index.js`: mã Worker.
- `worker/wrangler.toml`: cấu hình Wrangler.
- `worker/schema.sql`: schema cho D1.
- `script.js`: chức năng gửi log.
- `.github/workflows/worker.yml`: GitHub Action tự động deploy Worker.
- `README_DEPLOY.md`: hướng dẫn đầy đủ.

## 3. Mã Worker `worker/src/index.js`

```js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLength);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return '';
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
    row.time, row.account, row.displayName, row.ip, row.userAgent,
    row.browser, row.platform, row.language, row.latitude, row.longitude,
    row.accuracy, row.locationStatus
  ).run();

  return json({ ok: true, id: result.meta.last_row_id });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === '/api/login-log') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      return writeLoginLog(request, env);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  }
};
```

## 4. Cấu hình `worker/wrangler.toml`

```toml
name = "bddr-tong-log"
main = "src/index.js"
compatibility_date = "2026-07-06"

[[d1_databases]]
binding = "DB"
database_name = "bddr_logs"
database_id = "ĐIỀN DATABASE_ID Ở ĐÂY"
```

Lấy `database_id` từ Cloudflare Dashboard → Storage & databases → D1 sau khi tạo database tên `bddr_logs`.

## 5. Schema `worker/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  account TEXT,
  display_name TEXT,
  ip TEXT,
  user_agent TEXT,
  browser TEXT,
  platform TEXT,
  language TEXT,
  latitude REAL,
  longitude REAL,
  accuracy REAL,
  location_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs(time);
CREATE INDEX IF NOT EXISTS idx_login_logs_account ON login_logs(account);
```

## 6. File client `script.js`

- Tại dòng khai báo hằng số:
```js
const LOGIN_LOG_ENDPOINT = '';
```

- Hàm gửi log:
```js
async function writeLoginAccessLog(position) {
  if (!currentAuthUser) return;
  try {
    await fetch(getLoginLogEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      keepalive: true,
      body: JSON.stringify(Object.assign({
        account: currentAuthUser,
        displayName: formatLoginDisplayName(currentAuthUser),
        browser: getBrowserSummary(),
        platform: navigator.platform || '',
        language: navigator.language || ''
      }, getPositionLogPayload(position)))
    });
  } catch (err) {
    console.warn('Không thể ghi log đăng nhập', err);
  }
}
```

- Khi đăng nhập thành công:
```js
const initialPosition = await locateUser(shouldPanToLocation, { userInitiated: true });
await writeLoginAccessLog(initialPosition);
```

## 7. GitHub Action `.github/workflows/worker.yml`

```yaml
name: Deploy Cloudflare Worker
on:
  push:
    branches:
      - main
    paths:
      - 'worker/**'
      - '.github/workflows/worker.yml'
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: worker
          command: deploy
```

## 8. Hướng dẫn deploy chi tiết

### Bước 1: Chuẩn bị Cloudflare
1. Đăng nhập https://dash.cloudflare.com.
2. Vào **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**.
3. Permissions:
   - Account → Cloudflare Workers Scripts → Edit
   - Account → D1 → Edit
4. Account Resources → Include → Specific account (chọn đúng account).
5. Zone Resources → Include → All zones.
6. Bấm **Create Token**, copy token.

Tài liệu: https://developers.cloudflare.com/fundamentals/api/reference/permissions/

### Bước 2: Tạo D1
```powershell
npm install
npx wrangler login
npx wrangler d1 create bddr_logs
```
Copy `database_id` trả về dán vào `worker/wrangler.toml`.

### Bước 3: Chạy schema
```powershell
npx wrangler d1 execute bddr_logs --file worker/schema.sql --remote
```

### Bước 4: Thử deploy từ máy local
```powershell
npx wrangler deploy --config worker/wrangler.toml
```

### Bước 5: Gắn URL Worker vào script.js
Sau khi deploy, Cloudflare trả URL dạng:
```
https://bddr-tong-log.<ten-account>.workers.dev
```

Sửa `script.js`:
```js
const LOGIN_LOG_ENDPOINT = 'https://bddr-tong-log.<ten-account>.workers.dev/api/login-log';
```

Commit và push lên GitHub.

### Bước 6: Cấu hình GitHub Actions
Vào GitHub repo → Settings → Secrets and variables → Actions:
- Name: `CLOUDFLARE_API_TOKEN`
- Value: token đã tạo ở bước 1

### Bước 7: Push code
```powershell
git add .
git commit -m "Integrate Cloudflare Worker + D1 login log"
git push origin main
```
- Workflow `.github/workflows/pages.yml` deploy web GitHub Pages.
- Workflow `.github/workflows/worker.yml` tự động deploy Worker.

## 9. Xem log

### Trên Cloudflare Dashboard
Storage & databases → D1 → `bddr_logs` → Console

### Bằng lệnh Wrangler
```powershell
npx wrangler d1 execute bddr_logs --command "SELECT * FROM login_logs ORDER BY id DESC LIMIT 100" --remote
```

### Lệnh theo tài khoản
```powershell
npx wrangler d1 execute bddr_logs --command "SELECT time, account, ip, browser, latitude, longitude FROM login_logs WHERE account='cty75doi01' ORDER BY id DESC LIMIT 50" --remote
```

## 10. Các trường đang lưu

| Cột | Mô tả |
| --- | --- |
| `time` | ISO UTC thời điểm đăng nhập |
| `account` | Mã đăng nhập |
| `display_name` | Tên hiển thị |
| `ip` | IP Cloudflare lấy từ request |
| `user_agent` | User-Agent đầy đủ |
| `browser` | Tóm tắt trình duyệt |
| `platform` | Hệ điều hành |
| `language` | Ngôn ngữ trình duyệt |
| `latitude` | Vĩ độ GPS (nếu có) |
| `longitude` | Kinh độ GPS (nếu có) |
| `accuracy` | Độ chính xác GPS |
| `location_status` | available / unavailable |

## 11. Bảng `users` và API `/api/users`

Bảng `users` lưu danh sách mã đăng nhập và ánh xạ tới folder dữ liệu (local + R2). Có thể sửa trực tiếp trong D1 mà không cần đẩy code.

### Cấu trúc bảng

| Cột | Kiểu | Mô tả |
| --- | --- | --- |
| `code` | TEXT PRIMARY KEY | Mã đăng nhập, ví dụ `cty75doi01`, `doankinhtecty75` |
| `team` | TEXT NOT NULL | Tên đội / đơn vị, ví dụ `Đội 1`, `Công ty 75` |
| `folder` | TEXT NOT NULL | Folder dữ liệu, ví dụ `doi01`, `main` |
| `short_label` | TEXT | Tên ngắn hiển thị |
| `subtitle` | TEXT | Mô tả phụ cho header |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | 1 = cho phép đăng nhập, 0 = tạm khoá |
| `notes` | TEXT | Ghi chú nội bộ |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime(''now'')) | Thời điểm cập nhật |

### Ánh xạ folder

Web tự build đường dẫn dữ liệu từ `folder`:

- Local: `data/<folder>/BDDR.pmtiles` (vd `data/doi01/BDDR.pmtiles`).
- R2: `<R2_BASE>/capstone/bddr/<folder>/BDDR.pmtiles` (vd `https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/capstone/bddr/doi01/BDDR.pmtiles`).

Đổi `folder` của một user là web sẽ load PMTiles ở folder khác, không cần đụng code.

### Seed dữ liệu mẫu

File `worker/seed-users.sql` chèn sẵn 1 tài khoản tổng (`doankinhtecty75`) và 99 đội (`cty75doi1` … `cty75doi99`, folder `doi01` … `doi99`). Chạy 1 lần sau khi tạo bảng:

```powershell
npx wrangler d1 execute bddr_logs --file worker/seed-users.sql --remote
```

### API

- `GET /api/users` — trả về JSON `{ ok, count, users }`. Chỉ gồm user đang `is_active = 1`. Cache 60s ở Cloudflare.
- `GET /api/users?includeInactive=1` — bao gồm cả user tạm khoá (dùng cho dashboard admin sau này).

### Thêm / sửa user

Dùng Wrangler SQL trực tiếp (không cần đẩy code):

```powershell
npx wrangler d1 execute bddr_logs --command "INSERT INTO users (code, team, folder) VALUES ('cty75doi100', 'Đội 100', 'doi100')" --remote

npx wrangler d1 execute bddr_logs --command "UPDATE users SET team = 'Đội 1 - Tây Nguyên', folder = 'doi01_tay_nguyen' WHERE code = 'cty75doi1'" --remote

npx wrangler d1 execute bddr_logs --command "UPDATE users SET is_active = 0 WHERE code = 'cty75doi5'" --remote
```

Web sẽ nhận thay đổi trong vòng 5 phút (cache localStorage TTL) hoặc ngay lần đăng nhập kế tiếp.

## 12. Phiên đăng nhập (sessions)

Thay vì lưu danh sách user + cache phía client, Worker cấp **session token** có TTL 60 phút, tự gia hạn khi user còn dùng.

### Bảng `sessions`

| Cột | Kiểu | Mô tả |
| --- | --- | --- |
| `token` | TEXT PRIMARY KEY | 32 hex char ngẫu nhiên |
| `code` | TEXT NOT NULL | Mã user (FK logic tới `users.code`) |
| `ip` | TEXT | IP lúc đăng nhập |
| `user_agent` | TEXT | UA lúc đăng nhập |
| `created_at` | TEXT NOT NULL DEFAULT (datetime(''now'')) | |
| `expires_at` | TEXT NOT NULL | ISO UTC, mặc định +60 phút |
| `last_seen_at` | TEXT | Lần cuối verify (dùng cho sliding TTL) |

### API

| Method + Path | Mô tả |
| --- | --- |
| `POST /api/login` | body `{"code":"..."}` → trả `{ ok, user, profile, token, expiresAt }` |
| `GET /api/session` | header `Authorization: Bearer <token>` → trả `{ ok, user, profile, expiresAt }` nếu còn hạn |
| `POST /api/session/logout` | header `Authorization: Bearer <token>` → huỷ session |

### Quy tắc bảo mật

- `GET /api/session` đối chiếu IP + User-Agent với giá trị lưu lúc login; nếu khác → huỷ session (chống token lộ sang thiết bị khác).
- Nếu còn dưới 10 phút trước khi hết hạn, server tự `UPDATE expires_at = now + 60 phút` (sliding window).
- Token random 16 byte hex, không chứa thông tin nhạy cảm.

### Luồng phía client (`script.js`)

1. Khi mở web: nếu có token trong `localStorage[bddr-session-token]` thì gọi `GET /api/session` để khôi phục đăng nhập.
2. Khi submit form: gọi `POST /api/login`, lưu token vào localStorage.
3. Cứ 5 phút `setInterval` gọi `GET /api/session` để giữ phiên sống + kiểm tra còn hạn không.
4. Khi logout: gọi `POST /api/session/logout`, xoá token, reload trang.

### Dọn dẹp session hết hạn

Cloudflare Workers không có cron miễn phí. Có thể dùng:

- Cloudflare Workers Cron Trigger (free tier 5 lần/ngày) — ví dụ mỗi 6 giờ xoá `WHERE expires_at < datetime(''now'')`.
- Hoặc lazy: các API `loadSession` đã tự xoá session hết hạn khi truy cập.

## 13. Trang quản trị `/admin`

Trang SPA tích hợp sẵn trong Worker, dùng để quản lý users, xem sessions, xem log theo user.

### Truy cập

- URL: <https://bddr-tong-log.<ten-account>.workers.dev/admin>
- Đăng nhập bằng tài khoản `doankinhtecty75` (tài khoản tổng). Token lưu `localStorage[bddr-admin-token]`.
- API gọi với `Authorization: Bearer <token>`. Worker kiểm tra session + quyền admin.

### 3 tab chính

1. **Users**: danh sách tất cả user (kể cả đã khoá). Tìm kiếm theo mã/tên/folder. Thêm / sửa / khoá-mở / xoá. Modal xác nhận trước khi xoá.
2. **Sessions**: chọn user → xem danh sách session đang hoạt động (token rút gọn, IP, UA, thời gian tạo/hết hạn/lần cuối). Có nút "Huỷ tất cả session" để đăng xuất hàng loạt.
3. **Logs theo user**: chọn user → xem log đăng nhập tương ứng (dùng lại API `/api/login-log/recent` có sẵn).

### API admin (tất cả cần Bearer token của `doankinhtecty75`)

| Method + Path | Mô tả |
| --- | --- |
| `GET /api/admin/users` | Trả tất cả user (kể cả inactive) |
| `POST /api/users` | Tạo user mới |
| `PUT /api/users?code=...` | Sửa user (chỉ truyền field muốn đổi) |
| `DELETE /api/users?code=...` | Xoá user (kèm toàn bộ session của user) |
| `GET /api/admin/sessions?code=...` | Danh sách session của 1 user (tối đa 200) |
| `POST /api/admin/sessions/kill` body `{"code":"..."}` | Huỷ mọi session của 1 user |

### Quy tắc

- Không thể xoá tài khoản `doankinhtecty75` (bảo vệ admin).
- Xoá user tự động xoá luôn session của user đó.
- Tất cả request admin phải có `Authorization` header và user phải là `doankinhtecty75`. Nếu không sẽ trả 401/403.

## 14. Đề xuất mở rộng sau này

- Tạo API `/api/login-log/recent` để dashboard xem các lần đăng nhập gần nhất.
- Thêm rate limit bằng Cloudflare Rate Limiting Rules.
- Gắn domain riêng thay `workers.dev` cho URL.
- Đẩy log cũ hơn sang R2 / KV để giảm chi phí D1.
- Cron Trigger dọn log cũ trên 90 ngày.
- Workers AI gán nhãn log (phát hiện bất thường) – free tier.



