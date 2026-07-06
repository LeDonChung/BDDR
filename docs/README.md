# Tài liệu BDDR Tong Viewer

Mục lục tài liệu dự án. Tất cả file `.md` phục vụ phát triển, vận hành và nghiệp vụ đều nằm trong thư mục này.

## Triển khai & vận hành

- [`deploy.md`](deploy.md) – Hướng dẫn deploy web lên GitHub Pages và tích hợp Cloudflare Worker + D1 để ghi log đăng nhập.
- [`deploy-notes.md`](deploy-notes.md) – Ghi chú cấu hình log: endpoint, biến môi trường phía client, domain Cloudflare.
- [`cloudflare-worker.md`](cloudflare-worker.md) – Tài liệu kỹ thuật Cloudflare Worker + D1: kiến trúc, mã nguồn, schema, workflow CI/CD, mở rộng.

## Dữ liệu

- [`kmz-to-geojson.md`](kmz-to-geojson.md) – Quy trình chuyển `data/BDDR.kmz` sang `data/BDDR.geojson`.

## Nghiệp vụ

- [`khao-sat.md`](khao-sat.md) – Biểu mẫu khảo sát thử nghiệm hệ thống.
- [`thong-bao.md`](thong-bao.md) – Mẫu thông báo nội bộ của Phòng Kế hoạch – Kinh doanh.

## Quy ước đặt tên

- Tên file dùng kebab-case, chữ thường, không dấu, không viết hoa trừ khi cần thiết.
- Mỗi file là một chủ đề độc lập, liên kết chéo bằng đường dẫn tương đối.
