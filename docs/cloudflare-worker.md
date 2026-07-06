# BDDR Tong Viewer – Tài liệu Cloudflare Worker & D1

Tài liệu này tổng hợp mọi thứ liên quan tới việc tích hợp ghi log đăng nhập bằng **Cloudflare Worker + Cloudflare D1** cho repo **BDDR-Tong-Viewer**.

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

## 11. Đề xuất mở rộng sau này

- Tạo API `/api/login-log/recent` để dashboard xem các lần đăng nhập gần nhất.
- Thêm rate limit bằng Cloudflare Rate Limiting Rules.
- Gắn domain riêng thay `workers.dev` cho URL.
- Đẩy log cũ hơn sang R2 / KV để giảm chi phí D1.
- Cron Trigger dọn log cũ trên 90 ngày.
- Workers AI gán nhãn log (phát hiện bất thường) – free tier.
