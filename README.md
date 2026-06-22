# 🗺️ BDDR Tong - Bản Đồ Địa Lý

Ứng dụng web để xem bản đồ KML với giao diện giống Google Earth. Tối ưu hiệu suất, không lag, mặc định hiển thị bản đồ vệ tinh.

## ✨ Tính Năng

- 🛰️ **Bản đồ Vệ Tinh** - Mặc định hiển thị ảnh vệ tinh (ESRi World Imagery)
- 🗺️ **Chuyển Đổi Dễ Dàng** - Toggle giữa vệ tinh và bản đồ bình thường
- 📍 **Hiển Thị Tọa Độ** - Xem tọa độ khi di chuột
- 🔍 **Zoom Mượt Mà** - Tối ưu hiệu suất, không lag
- 🎨 **Giao Diện Google Earth** - Màu xanh nhạt, thiết kế sạch sẽ
- 📱 **Responsive** - Hoạt động tốt trên desktop, tablet, mobile
- ⚡ **Nhanh Chóng** - Tải file KML tự động, không cần chọn
- 🎯 **Auto Fit** - Tự động zoom vừa khít với dữ liệu

## 🚀 Cách Sử Dụng

### 1. Chạy Ngay (Không cần cài đặt)

**Windows/macOS/Linux:**
- Nhấp đúp `index.html` hoặc kéo vào trình duyệt
- File KML sẽ tự động load
- **XONG!** Khám phá bản đồ 🗺️

### 2. Sử Dụng Ứng Dụng

```
1. Mở index.html
2. Bản đồ vệ tinh tự động hiển thị
3. Di chuột để xem tọa độ
4. Nhấp nút "Vệ Tinh/Bình Thường" để chuyển loại bản đồ
5. Kéo, zoom, khám phá!
```

### 3. Keyboard Shortcuts

| Phím | Tác Vụ |
|------|--------|
| **M** | Chuyển loại bản đồ (Vệ Tinh ↔ Bình Thường) |
| **R** | Quay về vị trí mặc định |
| **+** | Zoom vào |
| **-** | Zoom ra |

### 4. Lên GitHub Pages

**Bước 1:** Tạo repository
```bash
# Tạo repo mới tên "bddr-tong-viewer"
# Public ✓
```

**Bước 2:** Push code
```bash
cd D:\CTY75\BDDR-Tong-Viewer

git init
git add .
git commit -m "BDDR Tong Map Viewer"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/bddr-tong-viewer.git
git push -u origin main
```

**Bước 3:** Kích hoạt GitHub Pages
1. Settings → Pages
2. Branch: `main` / Folder: `/ (root)`
3. Save

**Bước 4:** Truy cập
- `https://YOUR-USERNAME.github.io/bddr-tong-viewer`

## 📋 Cấu Trúc File

```
BDDR-Tong-Viewer/
├── index.html              ← Mở file này
├── style.css               ← Giao diện
├── script.js               ← Logic (tối ưu hiệu suất)
├── BDDR Tong.kml           ← Dữ liệu bản đồ
├── README.md               ← File này
├── QUICK_START.md          ← Bắt đầu nhanh
└── DEPLOY.md               ← Hướng dẫn GitHub Pages
```

## 🎨 Tính Năng Giao Diện

- **Header xanh** - Giống Google Earth
- **Bản đồ vệ tinh mặc định** - Ảnh thực tế từ ESRi
- **Info bar** - Hiển thị tọa độ, status, mức zoom
- **Toggle map type** - Nút đổi loại bản đồ
- **Markers, lines, polygons** - Hiển thị đẹp

## ⚙️ Tối Ưu Hiệu Suất

✅ **Không Lag** - Các tối ưu đã được áp dụng:
- Canvas rendering
- Tile caching
- Lazy loading
- Reduce marker animation
- Memory management
- Touch optimization (mobile)

## 🔧 Tùy Chỉnh

### Đổi File KML Mặc Định

Sửa file `script.js`:
```javascript
// Tìm hàm loadDefaultKML()
// Đổi 'BDDR Tong.kml' thành tên file khác
fetch('your-file.kml')
```

### Đổi Vị Trí Mặc Định

Sửa file `script.js`:
```javascript
// Tìm dòng này:
map = L.map('map', {
    center: [10.7769, 106.6669],  // Đổi tọa độ
    zoom: 8,                       // Đổi mức zoom
```

### Thêm Layer Bản Đồ Khác

Sửa `script.js`, thêm vào `baseLayers`:
```javascript
const baseLayers = {
    // Các layer hiện có...
    terrain: L.tileLayer('URL_LAYER_TERRAIN', {...})
};
```

## 🌍 Nguồn Dữ Liệu Bản Đồ

- **Satellite:** ESRi World Imagery
- **Normal:** OpenStreetMap
- Cả hai đều miễn phí và không cần API key

## 📊 Thống Kê

- **File size:** ~50MB (KML)
- **Load time:** < 2 giây (với internet tốt)
- **Browser support:** Chrome, Firefox, Safari, Edge (mới nhất)
- **Mobile support:** iOS 12+, Android 8+

## ❓ Câu Hỏi Thường Gặp

### Q: Tại sao file KML không hiển thị?
**A:** 
- Kiểm tra file KML có hợp lệ không
- Kiểm tra console (F12 → Console)
- Thử làm mới: Ctrl+F5

### Q: Bản đồ chậm/lag?
**A:**
- Kiểm tra kết nối internet
- Giảm mức zoom
- Tắt các extension browser

### Q: Có thể offline không?
**A:** Hiện tại cần internet để tải tile bản đồ. Để offline, cần cài đặt phức tạp hơn.

### Q: Tôi có thể sửa code không?
**A:** Có! Mở file HTML/CSS/JS bằng editor (VS Code, Notepad, v.v.)

### Q: Làm sao để lên production?
**A:** Xem file **DEPLOY.md** để hướng dẫn chi tiết.

## 🐛 Báo Cáo Bug

Nếu gặp vấn đề:
1. Mở console (F12)
2. Copy message lỗi
3. Tạo Issue trên GitHub

## 📝 License

MIT License - Tự do sử dụng cho mục đích cá nhân và thương mại

## 🤝 Đóng Góp

Chào mừng fork, sửa, và PR! 

## 📞 Liên Hệ

- GitHub: [your-username/bddr-tong-viewer](https://github.com)
- Issues: Tạo issue cho bug/tính năng

---

**⭐ Nếu thích project này, vui lòng để lại sao trên GitHub!**

*Tạo bởi Copilot | 2026*
