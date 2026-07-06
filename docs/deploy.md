# Hướng dẫn deploy log đăng nhập miễn phí

Bạn đang deploy web bằng GitHub Pages qua .github/workflows/pages.yml. GitHub Pages chỉ host file tĩnh nên **không thể tự ghi file log**. Cách free ổn nhất là giữ GitHub Pages cho web, thêm Cloudflare Worker + D1 làm API lưu log và quản lý danh sách user/đội.

## Kiến trúc sau khi tích hợp

- Web tĩnh: GitHub Pages, workflow hiện có .github/workflows/pages.yml.
- API ghi log: Cloudflare Worker, file worker/src/index.js.
- Database: Cloudflare D1, schema ở worker/schema.sql, dữ liệu mẫu ở worker/seed-users.sql.
- Client gọi API: script.js dùng LOGIN_LOG_ENDPOINT và USERS_API_URL.

## Bước 1: Tạo Cloudflare D1

Cài Wrangler nếu chưa có:

```powershell
npm install
npx wrangler login
npx wrangler d1 create bddr_logs
```

Sau lệnh tạo DB, Cloudflare sẽ trả về database_id. Copy ID đó vào worker/wrangler.toml:

```toml
database_id = "ID_CUA_BAN"
```

## Bước 2: Tạo bảng log + bảng users

Chạy schema (tạo bảng login_logs + bảng users lưu danh sách mã đăng nhập / mapping folder) lên D1 remote:

```powershell
npx wrangler d1 execute bddr_logs --file worker/schema.sql --remote
```

Sau đó chèn sẵn 100 user mặc định (1 tài khoản tổng + 99 đội):

```powershell
npx wrangler d1 execute bddr_logs --file worker/seed-users.sql --remote
```

Bạn có thể sửa / thêm user trực tiếp trên Cloudflare Dashboard hoặc bằng Wrangler, không cần đẩy code.

## Bước 3: Deploy Worker thử từ máy local

```powershell
npx wrangler deploy --config worker/wrangler.toml
```

Sau khi deploy xong, Wrangler sẽ in URL dạng:

```text
https://bddr-tong-log.<ten-account>.workers.dev
```

API ghi log là:

```text
https://bddr-tong-log.<ten-account>.workers.dev/api/login-log
```

Trang xem log HTML:

```text
https://bddr-tong-log.<ten-account>.workers.dev/
```

## Bước 4: Gắn URL Worker vào web

Mở script.js, tìm dòng:

```js
const LOGIN_LOG_ENDPOINT = '';
```

Đổi thành URL Worker của bạn:

```js
const LOGIN_LOG_ENDPOINT = 'https://bddr-tong-log.<ten-account>.workers.dev/api/login-log';
```

Commit và push lên GitHub. Workflow GitHub Pages hiện tại sẽ deploy web như cũ.

## Bước 5: Tự động deploy Worker bằng GitHub Actions

Repo đã có thêm workflow .github/workflows/worker.yml.

Bạn cần tạo GitHub secret:

1. Vào GitHub repo → Settings → Secrets and variables → Actions.
2. New repository secret.
3. Name: CLOUDFLARE_API_TOKEN.
4. Value: API token Cloudflare.

Token Cloudflare cần quyền deploy Worker và D1. Sau đó mỗi lần sửa file trong worker/**, GitHub Actions sẽ deploy Worker.

## Bước 6: Xem log

Xem 100 log mới nhất:

```powershell
npx wrangler d1 execute bddr_logs --command "SELECT * FROM login_logs ORDER BY id DESC LIMIT 100" --remote
```

Xem theo tài khoản:

```powershell
npx wrangler d1 execute bddr_logs --command "SELECT time, account, ip, browser, latitude, longitude FROM login_logs WHERE account = 'cty75doi01' ORDER BY id DESC LIMIT 50" --remote
```

Hoặc mở trang HTML: <https://bddr-tong-log.<ten-account>.workers.dev/>

## Dữ liệu đang lưu

- 	ime: thời gian đăng nhập ISO UTC.
- ccount: mã tài khoản đăng nhập.
- display_name: tên hiển thị, ví dụ đội 1.
- ip: IP do Cloudflare lấy từ request.
- user_agent: chuỗi trình duyệt đầy đủ.
- rowser, platform, language: thông tin client gửi lên.
- latitude, longitude, ccuracy: vị trí nếu trình duyệt cấp quyền.
- location_status: vailable hoặc unavailable.

## Lưu ý quan trọng

- GitHub Pages vẫn free và giữ nguyên.
- Cloudflare Worker + D1 có free tier đủ rộng cho log đăng nhập nội bộ.
- Không lưu được file .log trên GitHub Pages vì đó là host tĩnh.
- Nếu user không cấp quyền vị trí, log vẫn có tài khoản, thời gian, IP, trình duyệt nhưng tọa độ sẽ null.
- Log được ghi **ngay khi user đăng nhập thành công** (kể cả khi chưa cấp quyền vị trí). Nếu sau đó user cấp quyền, hệ thống sẽ tự ghi thêm một dòng log kèm tọa độ trong cùng phiên đăng nhập.
- Danh sách mã đăng nhập và mapping folder lưu trong bảng users của D1. Sửa user không cần đẩy code.

