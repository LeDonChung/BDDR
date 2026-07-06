# Ghi chú cấu hình log

## File log local (không áp dụng khi deploy Cloudflare)
- Vị trí dự kiến: `logs/login-access.log`
- Schema lưu: mỗi dòng một JSON object.
- Trường: time, account, displayName, ip, userAgent, browser, platform, language, latitude, longitude, accuracy, locationStatus.
- Cách dùng: chỉ chạy được khi bạn dùng `npm run start` (Node server) ở máy của bạn. Còn GitHub Pages là host tĩnh, không cho ghi file.

## Log lưu Cloudflare D1 khi deploy production
- Database: `bddr_logs` trên Cloudflare D1.
- Bảng: `login_logs` (định nghĩa trong `worker/schema.sql`).
- Truy cập: Cloudflare Dashboard → Storage & databases → D1 → chọn `bddr_logs` → tab Console.

## API endpoint
- URL mẫu (cloudflare workers):
```
https://bddr-tong-log.<ten-account>.workers.dev/api/login-log
```
- Thay `<ten-account>` bằng tên account Cloudflare của bạn.
- API lắng nghe method `POST`, payload JSON giống các trường trong bảng.

## Domain Cloudflare
- Worker default host: `bddr-tong-log.<ten-account>.workers.dev`.
- Có thể gắn domain riêng để có host đẹp hơn.
- Cloudflare cho gắn domain miễn phí qua Workers Routes hoặc Custom Domains.

## Biến env phía client
- File `script.js` có dòng:
```js
const LOGIN_LOG_ENDPOINT = '';
```
- Khi deploy, sửa thành:
```js
const LOGIN_LOG_ENDPOINT = 'https://bddr-tong-log.<ten-account>.workers.dev/api/login-log';
```
- Nếu trống thì tự fallback về `/api/login-log` (chỉ chạy đúng khi dùng Node server local).

## Lưu log thật tế
1. Vào Cloudflare Dashboard → API Tokens.
2. Tạo API token có quyền Workers Scripts Edit và D1 Edit.
3. Vào D1 → Create database tên `bddr_logs` rồi copy `database_id` dán vào `worker/wrangler.toml`.
4. Vào GitHub repo → Settings → Secrets and variables → Actions → New secret:
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: token Cloudflare vừa tạo.
5. Push code lên GitHub nhánh `main`.
6. Workflow `.github/workflows/worker.yml` sẽ tự deploy Worker.
7. Sau khi deploy, lấy URL Worker gán vào `LOGIN_LOG_ENDPOINT` và commit lại.
