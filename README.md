# BDDR Tong

Hệ thống website bản đồ số phục vụ quản lý vườn cây và các lô đất của các đơn vị sản xuất thuộc Công ty 75.

## Chức năng chính

- Tra cứu, xem và chọn các lô/thửa đất của từng đơn vị sản xuất
- Hỗ trợ bản đồ nền vệ tinh
- Xem vị trí hiện tại và hỗ trợ chỉ đường
- Khi đăng nhập, mỗi đơn vị chỉ xem được bản đồ lô riêng của mình

## Ghi log đăng nhập

Chạy `npm run start` để khởi chạy ứng dụng và ghi log đăng nhập vào `logs/login-access.log`.

Mỗi dòng log có dạng JSON, ghi lại tài khoản đăng nhập, thời gian, địa chỉ IP, thông tin trình duyệt và tọa độ vị trí khi trình duyệt cấp quyền.

Nếu cần chạy kiểu web tĩnh không ghi log, dùng `npm run start:legacy`.

## Tài liệu chi tiết

Xem thư mục [`docs/`](docs/) để biết chi tiết về:

- [`docs/deploy.md`](docs/deploy.md) – Hướng dẫn deploy web + Worker + D1.
- [`docs/cloudflare-worker.md`](docs/cloudflare-worker.md) – Tài liệu kỹ thuật Cloudflare Worker & D1.
- [`docs/deploy-notes.md`](docs/deploy-notes.md) – Ghi chú cấu hình log.
- [`docs/kmz-to-geojson.md`](docs/kmz-to-geojson.md) – Quy trình chuyển KMZ sang GeoJSON.
- [`docs/khao-sat.md`](docs/khao-sat.md) – Biểu mẫu khảo sát thử nghiệm.
- [`docs/thong-bao.md`](docs/thong-bao.md) – Mẫu thông báo nội bộ.
