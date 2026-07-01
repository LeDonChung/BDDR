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

## Deploy với Cloudflare R2

Để tránh GitHub bị nặng và vượt giới hạn 100 MB/file, file lớn `data/BDDR.geojson` không được commit lên GitHub.

Workflow hiện tại:

1. Chạy convert ở máy local:

```powershell
npm run convert:kmz
```

2. Upload file vừa tạo lên Cloudflare R2 tại đường dẫn public:

```text
https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/bddr/BDDR.geojson
```

3. GitHub Pages chỉ tải app tĩnh, còn dữ liệu lớn được fetch từ R2.

Lưu ý cho người dùng mạng 5G: file GeoJSON rất lớn, lần tải đầu có thể lâu. App có cache IndexedDB nên các lần sau sẽ đỡ tải lại nếu version dữ liệu không đổi.

## Tô màu theo folder MicroStation (RanhOne / RanhTwo / TruSo)

Mục tiêu: các line/polygon kề nhau được tô **màu theo nhóm** để mắt dễ phân biệt ranh giới từng lô/thửa, riêng trụ sở (TruSo) tô đỏ.

Bảng màu hiện tại (xem `BDDRVectorSymbolizer` trong `script.js`):

| Folder KMZ  | Thuộc tính GeoJSON | Màu      | Ghi chú                         |
|-------------|--------------------|----------|---------------------------------|
| `RanhOne`   | `properties.group = "RanhOne"` | `#ffd84d` (vàng) | nhóm 1, như màu cũ mặc định     |
| `RanhTwo`   | `properties.group = "RanhTwo"` | `#22d3ee` (cyan) | nhóm 2, nổi trên nền vệ tinh, tách biệt với vàng |
| `TruSo`     | `properties.group = "TruSo"`   | `#ff3b3b` (đỏ)   | fill trụ sở (alpha 0.6 để vẫn thấy vệ tinh) |
| (còn lại)   | không có `group` (label chi tiết `Level 4` v.v.) | `#ffd84d` (vàng) | mặc định                        |

Pipeline: MicroStation folder → export KMZ → `convert-kmz-to-geojson.js` gán `properties.group` → tippecanoe giữ nguyên thuộc tính vào PMTiles → `BDDRVectorSymbolizer` đọc `feature.props.group` để chọn màu.

### Phần 1 - Trong MicroStation

Parser bám theo **tên folder** xuất hiện trong KMZ, nên đặt tên đúng 1 trong 3 tên: `RanhOne`, `RanhTwo`, `TruSo` (đúng chữ hoa, không khoảng trắng). Folder `Level 4` (label chi tiết kiểu `Style10` cluster) **giữ nguyên**.

1. Mở file DGN trong MicroStation.
2. Chọn các line/polygon thuộc **nhóm ranh giới 1**, gom vào folder đặt tên `RanhOne`.
3. Chọn các line/polygon thuộc **nhóm ranh giới 2** (kề xen nhóm 1), gom vào folder `RanhTwo`.
4. Chọn các polygon **trụ sở**, gom vào folder `TruSo`.
5. Các label chi tiết (`Level 4` / `Style10`...) giữ nguyên folder, không dồn vào 3 nhóm trên.

> Mẹo chọn nhanh: dùng `Select by Attribute` chọn theo `Color` hoặc `Select by Level`, rồi `Change Level` / `Create Folder` để gom.

### Phần 2 - Export và chạy lại pipeline

Sau khi gom folder trong MicroStation, export ra KMZ như cũ rồi chạy:

```powershell
npm run convert:all
```

Lệnh này chạy `convert:kmz` → `convert:dxf-labels` → `convert:pmtiles` tuần tự. Upload `data\BDDR.pmtiles` mới lên Cloudflare R2 (`https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/bddr/BDDR.pmtiles`) để web đọc bản mới.

### Phần 3 - Symbolizer trong `script.js`

`BDDRVectorSymbolizer.draw()` chọn màu theo `feature.props.group`:

```javascript
const group = String(props.group || '');
let color = '#ffd84d';          // mặc định: vàng
let fillAlpha = isDetailLabel ? 0.95 : 1;
if (group === 'RanhTwo') { color = '#22d3ee'; }              // nhóm 2: cyan
else if (group === 'TruSo') { color = '#ff3b3b'; fillAlpha = 0.6; } // trụ sở: đỏ
```

Đổi cặp màu khác thì sửa trực tiếp các mã màu trong block này (ví dụ `RanhTwo` sang `#f59e0b` cam, hoặc `TruSo` sang `#ef4444`).

### Lưu ý

- Tên folder trong MicroStation **phải** đúng `RanhOne` / `RanhTwo` / `TruSo` (chữ hoa y hệt, không khoảng trắng). Sai 1 ký tự là parser bỏ qua, feature ra màu vàng mặc định.
- Sau khi sửa MicroStation, kiểm tra nhanh trước khi build PMTiles: mở `data\BDDR.geojson` tìm `"group":"RanhOne"`, `"group":"RanhTwo"`, `"group":"TruSo"` xem đã đủ chưa.
- Khi đổi sang nền vệ tinh hay nền đường, vàng + cyan + đỏ đều nổi rõ. Nếu nền vùng nào trùng màu, đổi mã màu trong symbolizer.
- `convert:pmtiles` cần Docker Desktop đang chạy (dùng tippecanoe + go-pmtiles container). Dữ liệu hiện tạo ~970k feature sau khi tippecanoe cắt tile, build mất vài phút.

GeoJSON lớn không phù hợp với iPhone vì Safari phải tải và parse toàn bộ file vào RAM. Dự án hiện đã chuyển runtime sang PMTiles:

```text
https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/bddr/BDDR.pmtiles
```

Quy trình tạo dữ liệu mới:

```powershell
npm run convert:all
```

Hoặc chạy từng bước:

```powershell
npm run convert:kmz
npm run convert:dxf-labels
npm run convert:pmtiles
```

Sau đó upload file sau lên R2:

```text
data/BDDR.pmtiles
```

Lưu ý: `convert:pmtiles` cần Docker Desktop đang chạy vì script dùng tippecanoe container. File `data/BDDR.geojson` và `data/BDDR.pmtiles` là file build local, không commit lên GitHub.
