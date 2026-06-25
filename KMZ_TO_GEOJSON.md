# Convert KMZ sang GeoJSON

Tài liệu này ghi lại cách chuyển file `data/BDDR.kmz` sang `data/BDDR.geojson` bằng script có sẵn trong thư mục `data`.

## File liên quan

- Input mặc định: `data/BDDR.kmz`
- Output mặc định: `data/BDDR.geojson`
- Script convert: `data/convert-kmz-to-geojson.js`
- Lệnh npm: `convert:kmz`

## Cách chạy nhanh

```powershell
npm run convert:kmz
```

Lệnh này sẽ đọc `data/BDDR.kmz` và ghi đè/tạo mới `data/BDDR.geojson`.

## Chạy với file tùy chọn

Có thể truyền đường dẫn input/output trực tiếp cho script:

```powershell
node data/convert-kmz-to-geojson.js data/BDDR.kmz data/BDDR.geojson
```

Ví dụ đổi tên output:

```powershell
node data/convert-kmz-to-geojson.js data/BDDR.kmz data/BDDR-new.geojson
```

## Kết quả đã kiểm tra

Script đã chạy thành công với file hiện tại:

```text
Da tao data/BDDR.geojson (21 features)
```

File GeoJSON tạo ra nằm tại:

```text
data/BDDR.geojson
```

## Ghi chú kỹ thuật

- Script dùng Node.js sẵn có trong máy, không cần cài thêm package npm.
- KMZ được giải nén tạm bằng PowerShell/.NET rồi tự xóa thư mục tạm sau khi convert xong.
- Script hỗ trợ các geometry thường gặp trong KML: `Point`, `LineString`, `Polygon`, `MultiGeometry`.
- Các thuộc tính `name`, `description`, `styleUrl`, `ExtendedData/Data`, `SchemaData/SimpleData` được đưa vào `properties` của GeoJSON.

## Dự án đang dùng GeoJSON

Ứng dụng hiện nạp trực tiếp file:

```text
data/BDDR.geojson
```

Khi cần cập nhật dữ liệu, hãy chạy lại:

```powershell
npm run convert:kmz
```

Sau đó tải lại trang web để app đọc dữ liệu GeoJSON mới.

## Export label từ DXF MicroStation

File `data/BDDR Tong Final.dxf` có text thật nằm trong các block `INSERT`, nên đã có thể xuất label ra GeoJSON riêng:

```powershell
npm run convert:dxf-labels
```

Lệnh này tạo/cập nhật:

```text
data/BDDR-labels.geojson
```

File label này chứa các point có thuộc tính như `label`, `code`, `unit`, `number`, ví dụ `C2 13/2024`, `CT75 305`, diện tích `8,27`.
