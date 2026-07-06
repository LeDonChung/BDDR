# H??ng d?n deploy log ??ng nh?p mi?n ph?

B?n ?ang deploy web b?ng GitHub Pages qua `.github/workflows/pages.yml`. GitHub Pages ch? host file t?nh n?n **kh?ng th? t? ghi file log**. C?ch free ?n nh?t l? gi? GitHub Pages cho web, th?m Cloudflare Worker + D1 l?m API l?u log.

## Ki?n tr?c sau khi t?ch h?p

- Web t?nh: GitHub Pages, workflow hi?n c? `.github/workflows/pages.yml`.
- API ghi log: Cloudflare Worker, file `worker/src/index.js`.
- Database log: Cloudflare D1, schema ? `worker/schema.sql`.
- Client g?i API: `script.js` d?ng `LOGIN_LOG_ENDPOINT`.

## B??c 1: T?o Cloudflare D1

C?i Wrangler n?u ch?a c?:

```powershell
npm install
npx wrangler login
npx wrangler d1 create bddr_logs
```

Sau l?nh t?o DB, Cloudflare s? tr? v? `database_id`. Copy ID ?? v?o `worker/wrangler.toml`:

```toml
database_id = "ID_CUA_BAN"
```

## B??c 2: T?o b?ng log

Ch?y schema l?n D1 remote:

```powershell
npx wrangler d1 execute bddr_logs --file worker/schema.sql --remote
```

## B??c 3: Deploy Worker th? t? m?y local

```powershell
npx wrangler deploy --config worker/wrangler.toml
```

Sau khi deploy xong, Wrangler s? in URL d?ng:

```text
https://bddr-tong-log.<ten-account>.workers.dev
```

API ghi log l?:

```text
https://bddr-tong-log.<ten-account>.workers.dev/api/login-log
```

## B??c 4: G?n URL Worker v?o web

M? `script.js`, t?m d?ng:

```js
const LOGIN_LOG_ENDPOINT = '';
```

??i th?nh URL Worker c?a b?n:

```js
const LOGIN_LOG_ENDPOINT = 'https://bddr-tong-log.<ten-account>.workers.dev/api/login-log';
```

Commit v? push l?n GitHub. Workflow GitHub Pages hi?n t?i s? deploy web nh? c?.

## B??c 5: T? ??ng deploy Worker b?ng GitHub Actions

Repo ?? c? th?m workflow `.github/workflows/worker.yml`.

B?n c?n t?o GitHub secret:

1. V?o GitHub repo ? Settings ? Secrets and variables ? Actions.
2. New repository secret.
3. Name: `CLOUDFLARE_API_TOKEN`.
4. Value: API token Cloudflare.

Token Cloudflare c?n quy?n deploy Worker v? D1. Sau ?? m?i l?n s?a file trong `worker/**`, GitHub Actions s? deploy Worker.

## B??c 6: Xem log

Xem 100 log m?i nh?t:

```powershell
npx wrangler d1 execute bddr_logs --command "SELECT * FROM login_logs ORDER BY id DESC LIMIT 100" --remote
```

Xem theo t?i kho?n:

```powershell
npx wrangler d1 execute bddr_logs --command "SELECT time, account, ip, browser, latitude, longitude FROM login_logs WHERE account = 'cty75doi01' ORDER BY id DESC LIMIT 50" --remote
```

## D? li?u ?ang l?u

- `time`: th?i gian ??ng nh?p ISO UTC.
- `account`: m? t?i kho?n ??ng nh?p.
- `display_name`: t?n hi?n th?, v? d? ??i 1.
- `ip`: IP do Cloudflare l?y t? request.
- `user_agent`: chu?i tr?nh duy?t ??y ??.
- `browser`, `platform`, `language`: th?ng tin client g?i l?n.
- `latitude`, `longitude`, `accuracy`: v? tr? n?u tr?nh duy?t c?p quy?n.
- `location_status`: `available` ho?c `unavailable`.

## L?u ? quan tr?ng

- GitHub Pages v?n free v? gi? nguy?n.
- Cloudflare Worker + D1 c? free tier ?? r?ng cho log ??ng nh?p n?i b?.
- Kh?ng l?u ???c file `.log` tr?n GitHub Pages v? ?? l? host t?nh.
- N?u user kh?ng c?p quy?n v? tr?, log v?n c? t?i kho?n, th?i gian, IP, tr?nh duy?t nh?ng t?a ?? s? null.
