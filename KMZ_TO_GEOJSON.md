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

## Tô màu luân phiên cho line/polygon

Mục tiêu: các line/polygon kề nhau được tô **2 màu xen kẽ** (kiểu checkerboard), giúp mắt dễ phân biệt ranh giới từng lô/thửa khi nhìn bản đồ.

Cách làm chia 2 phần: (1) gán level trong MicroStation, (2) sửa `script.js` để render 2 màu luân phiên.

### Phần 1 - Trong MicroStation

Quy tắc đặt tên folder rất quan trọng, parser bám theo regex `Level <số>` nên phải đặt đúng.

1. Mở file DGN trong MicroStation.
2. Trong cửa sổ **References** hoặc **Explorer**, tìm các line/polygon cần tô màu.
3. Chọn tất cả line/polygon thuộc **nhóm 1** (các thửa xen kẽ nhau theo thứ tự bạn muốn). Có thể dùng **Fence** kéo một vùng rồi `Ctrl+A` trong Fence để chọn nhanh.
4. Vào **File > Models** hoặc dùng lệnh `Create Folder` để gom vào folder mới.
5. Đặt tên folder là `Level 1` (đúng chữ "Level", 1 khoảng trắng, rồi số 1).
6. Lặp lại cho **nhóm 2**: chọn các line/polygon còn lại, gom vào folder đặt tên `Level 2`.
7. Folder `Level 4` (đang chứa các label chi tiết kiểu `Style10` cluster) **giữ nguyên**, không dồn vào Level 1/2 để tránh vỡ label.

> Mẹo chọn nhanh các line kề nhau theo pattern xen kẽ:
> - Dùng lệnh `Select by Attribute` để chọn theo `Color` (MicroStation element color) nếu trước đó đã gán màu khác nhau cho từng nhóm.
> - Hoặc `Select by Level` chọn tất cả rồi bỏ vào Fence, di chuyển nhóm 1 sang Level 1, nhóm 2 sang Level 2 bằng lệnh `Change Level` (Element > Levels).

### Phần 2 - Export và chạy lại pipeline

Sau khi dồn xong folder trong MicroStation, export ra KMZ như cũ rồi chạy:

```powershell
npm run convert:all
```

Lệnh này sẽ chạy `convert:kmz` → `convert:dxf-labels` → `convert:pmtiles` tuần tự. Upload file `data\BDDR.pmtiles` mới lên Cloudflare R2 (đang ở `https://pub-2562e381abc44f8a928e9a2b16c6c633.r2.dev/bddr/BDDR.pmtiles`) để web đọc bản mới.

### Phần 3 - Sửa `script.js` để tô 2 màu

File `BDDRVectorSymbolizer` hiện hard-code màu `#ffd84d`. Mở `script.js` tìm đoạn:

```268:312:script.js
class BDDRVectorSymbolizer {
  draw(context, geom, z, feature) {
    ...
    context.fillStyle = '#ffd84d';
    ...
    context.strokeStyle = '#ffd84d';
    ...
  }
}
```

Thay bằng:

```javascript
class BDDRVectorSymbolizer {
  draw(context, geom, z, feature) {
    if (!geom || !geom.length) return;

    const props = feature && feature.props ? feature.props : {};
    const lvl = Number(props.level);
    const isDetailLabel = lvl === 4;
    const isLine = feature && (feature.geomType === 2 || feature.type === 2);

    // 2 màu luân phiên cho nhóm 1 và nhóm 2 (Level 1, Level 2)
    const palette = {
      1: '#ff5b5b', // nhóm 1 - đỏ
      2: '#4f8cff', // nhóm 2 - xanh dương
      4: '#ffd84d'  // label chi tiết - giữ vàng
    };
    const color = palette[lvl] || '#9aa6bd'; // fallback xám cho level lạ

    if (!isLine) {
      context.fillStyle = color;
      context.globalAlpha = isDetailLabel ? 0.95 : 0.75;
      for (let r = 0; r < geom.length; r++) {
        const ring = geom[r];
        if (!ring || ring.length < 3) continue;
        context.beginPath();
        context.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) context.lineTo(ring[i].x, ring[i].y);
        context.closePath();
        context.fill();
      }
    }

    if (isLine) {
      context.strokeStyle = color;
      context.lineWidth = isDetailLabel ? 1.15 : 1.6;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.globalAlpha = isDetailLabel ? 0.95 : 1;
      context.beginPath();
      for (let r = 0; r < geom.length; r++) {
        const ring = geom[r];
        if (!ring || ring.length < 2) continue;
        context.moveTo(ring[0].x, ring[0].y);
        for (let i = 1; i < ring.length; i++) context.lineTo(ring[i].x, ring[i].y);
      }
      context.stroke();
    }
  }
}
```

### Lưu ý

- Tên folder trong MicroStation **phải** đúng `Level 1`, `Level 2`, `Level 4` (đúng chữ, đúng khoảng trắng). Sai 1 ký tự là parser bỏ qua, ra màu fallback xám.
- Sau khi sửa MicroStation, kiểm tra nhanh trước khi build PMTiles: mở `data\BDDR.geojson` tìm `"level":1` và `"level":2` xem đã xuất hiện đầy đủ chưa.
- Khi đổi sang nền vệ tinh hay nền đường, 2 màu đỏ/xanh dương vẫn nổi rõ trên cả hai. Có thể đổi sang cặp màu khác trong `palette` nếu cần (ví dụ `#22c55e` xanh lá + `#f59e0b` cam).

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
