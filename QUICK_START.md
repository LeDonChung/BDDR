# ⚡ Bắt Đầu Nhanh

## 3 Cách Chạy Trong 30 Giây

### 🎯 Cách 1: Nhấp Đúp (Dễ Nhất)
1. Tìm file `index.html`
2. Nhấp đúp
3. **XONG!** ✅

### 🎯 Cách 2: Kéo Vào Trình Duyệt
1. Mở trình duyệt (Chrome, Firefox, Safari, Edge)
2. Kéo `index.html` vào
3. **XONG!** ✅

### 🎯 Cách 3: Terminal
```bash
# Windows PowerShell
cd D:\CTY75\BDDR-Tong-Viewer
.\index.html

# macOS/Linux
cd /path/to/BDDR-Tong-Viewer
open index.html
```

---

## 📱 Sử Dụng

| Thao Tác | Kết Quả |
|---------|---------|
| Mở trang | Bản đồ vệ tinh tự động load ✅ |
| Di chuột | Xem tọa độ Lat/Lon |
| Cuộn chuột | Zoom in/out |
| Kéo chuột | Di chuyển bản đồ |
| Nhấp nút **Vệ Tinh/Bình Thường** | Đổi loại bản đồ |
| Nhấp **M** trên bàn phím | Chuyển map type |
| Nhấp **R** trên bàn phím | Quay về vị trí cũ |

---

## 🚀 Lên GitHub Pages (5 Phút)

### Bước 1: Tạo Repo

Vào https://github.com/new:
- Name: `bddr-tong-viewer`
- Public: ✅
- Create

### Bước 2: Setup Git

```bash
cd D:\CTY75\BDDR-Tong-Viewer

git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### Bước 3: Push Code

```bash
git init
git add .
git commit -m "BDDR Tong Map"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/bddr-tong-viewer.git
git push -u origin main
```

Khi yêu cầu password, nhập token GitHub (không phải password):
1. Vào https://github.com/settings/tokens
2. Generate token (check: `repo`, `workflow`)
3. Copy và paste

### Bước 4: Kích Hoạt Pages

1. Repo Settings
2. Pages (bên trái)
3. Branch: `main`
4. Folder: `/ (root)`
5. Save

### Bước 5: Đợi & Truy Cập

⏳ Chờ 2-3 phút

✅ Truy cập: `https://YOUR-USERNAME.github.io/bddr-tong-viewer`

---

## ❓ Gặp Vấn Đề?

### ❌ File KML không hiển thị
```
→ Làm mới: Ctrl+F5
→ Mở console: F12 → Console
→ Kiểm tra file BDDR Tong.kml có tồn tại
```

### ❌ Bản đồ chậm/lag
```
→ Kiểm tra kết nối internet
→ Tắt browser extension
→ Thử browser khác
```

### ❌ Git push error
```
→ Kiểm tra token GitHub
→ Kiểm tra internet
→ Kiểm tra URL repo
```

---

## 🛠️ Muốn Tùy Chỉnh?

### Đổi file KML
Sửa `script.js`:
```javascript
fetch('your-file.kml')  // Đổi tên file
```

### Đổi vị trí mặc định
Sửa `script.js`:
```javascript
center: [LAT, LON],  // Tọa độ
zoom: 8,             // Mức zoom
```

### Thêm công cụ khác
Sửa `index.html`, thêm button, sửa `script.js` thêm logic

---

## 📚 Tài Liệu Đầy Đủ

- **README.md** - Tài liệu chi tiết
- **DEPLOY.md** - Hướng dẫn GitHub Pages chi tiết

---

## ✅ Hoàn Thành!

🎉 Bạn đã có bản đồ chuyên nghiệp:
- Hiển thị file KML
- Vệ tinh + bình thường
- Trên GitHub Pages
- Miễn phí forever

**Chia sẻ URL với mọi người!** 📤

---

*Cần giúp? Xem README.md hoặc DEPLOY.md*
