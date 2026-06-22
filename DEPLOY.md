# 🚀 Hướng Dẫn GitHub Pages - Chi Tiết

Hướng dẫn hoàn chỉnh để đưa project lên GitHub Pages.

## 📋 Yêu Cầu

- Tài khoản GitHub (miễn phí): https://github.com/signup
- Git cài trên máy: https://git-scm.com/download

## ⚙️ Cài Đặt Sơ Bộ

### 1. Cài Git

**Windows:**
1. Tải: https://git-scm.com/download/win
2. Chạy installer (Click Next)
3. Mở Command Prompt (Win+R → cmd)
4. Kiểm tra: `git --version`

**macOS:**
```bash
brew install git
```

**Linux:**
```bash
sudo apt-get install git
```

### 2. Cấu Hình Git

Mở Terminal/Command Prompt:
```bash
git config --global user.name "Tên của bạn"
git config --global user.email "email@gmail.com"
```

Ví dụ:
```bash
git config --global user.name "Nguyen Van A"
git config --global user.email "nguyenvana@gmail.com"
```

### 3. Tạo GitHub Token

1. Đăng nhập GitHub: https://github.com/login
2. Settings → Developer settings → Personal access tokens → Tokens (classic)
3. Click "Generate new token (classic)"
4. Điền thông tin:
   - Name: "My Computer" (tùy ý)
   - Expiration: 90 days (hoặc No expiration)
   - Scopes: Check `repo` + `workflow`
5. Click "Generate token"
6. **Copy token** (chỉ hiển thị 1 lần!)

## 📁 Tạo Repository

### Bước 1: Tạo Repo Mới

1. Vào https://github.com/new
2. Điền:
   - **Repository name:** `bddr-tong-viewer`
   - **Description:** "BDDR Tong - Map Viewer" (tùy ý)
   - **Public:** ✓ Chọn
   - **Initialize this repository with:** (không chọn)
3. Click "Create repository"
4. **Copy URL** (ví dụ: `https://github.com/username/bddr-tong-viewer.git`)

### Bước 2: Push Code Lên

**Windows (Command Prompt):**

```bash
# Đi tới thư mục project
cd D:\CTY75\BDDR-Tong-Viewer

# Khởi tạo Git
git init

# Thêm tất cả files
git add .

# Tạo commit đầu tiên
git commit -m "Initial commit: BDDR Tong Map Viewer"

# Đổi branch thành main
git branch -M main

# Thêm remote repository (thay URL)
git remote add origin https://github.com/YOUR-USERNAME/bddr-tong-viewer.git

# Push code
git push -u origin main
```

**Khi được hỏi:**
- Username: Nhập username GitHub
- Password: **Dán token** (không phải password!)

**macOS/Linux:**
Tương tự, dùng Terminal thay vì Command Prompt

## 🌐 Kích Hoạt GitHub Pages

### Bước 1: Vào Settings

1. Vào repository: `https://github.com/YOUR-USERNAME/bddr-tong-viewer`
2. Click tab **Settings** (ở trên cùng)

### Bước 2: Tìm Pages

1. Bên trái menu, tìm **"Pages"** (cuộn xuống)
2. Click vào

### Bước 3: Cấu Hình

Trong trang Pages:
- **Source:** "Deploy from a branch"
- **Branch:** `main`
- **Folder:** `/ (root)`
- Click **Save**

### Bước 4: Chờ Deployment

1. GitHub sẽ tự động build
2. Chờ ~2-5 phút
3. Nó sẽ hiển thị URL: `https://YOUR-USERNAME.github.io/bddr-tong-viewer`

## ✅ Kiểm Tra Deployment

1. Vào tab **Actions** (ở repo)
2. Chờ vòng tròn xanh ✓
3. Vào URL: `https://YOUR-USERNAME.github.io/bddr-tong-viewer`

---

## 🔄 Cập Nhật Code (Lần Sau)

Khi muốn update:

```bash
# Chỉnh sửa files...

# Thêm thay đổi
git add .

# Commit
git commit -m "Mô tả thay đổi"

# Push
git push origin main
```

GitHub Pages sẽ tự động cập nhật trong vài phút.

---

## 🆘 Khắc Phục Sự Cố

### ❌ "Permission denied (publickey)"

**Giải pháp:**
```bash
# Kiểm tra SSH key
ssh -T git@github.com

# Hoặc dùng HTTPS thay SSH (cách đơn giản hơn)
git remote set-url origin https://github.com/YOUR-USERNAME/bddr-tong-viewer.git
```

### ❌ "remote: Repository not found"

**Giải pháp:**
- Kiểm tra URL đúng không
- Repository có public không?
- Đã push lên main chưa?

```bash
git remote -v  # Kiểm tra URL
```

### ❌ "fatal: 'origin' does not appear to be a 'git' repository"

**Giải pháp:**
```bash
git remote add origin https://github.com/YOUR-USERNAME/bddr-tong-viewer.git
git push -u origin main
```

### ❌ GitHub Pages không update

**Giải pháp:**
1. Chờ thêm 5 phút
2. Vào Actions tab → Check log
3. Làm mới: Ctrl+Shift+R
4. Xóa cache: Ctrl+Shift+Delete

### ❌ File KML không hiển thị trên GitHub Pages

**Giải pháp:**
1. Kiểm tra file BDDR Tong.kml có tồn tại trong repo
2. Kiểm tra tên file đúng (case-sensitive)
3. Mở console (F12) xem lỗi
4. Thử refresh nhiều lần

---

## 📊 URLs

Sau khi setup:

- **Repo:** `https://github.com/YOUR-USERNAME/bddr-tong-viewer`
- **Live site:** `https://YOUR-USERNAME.github.io/bddr-tong-viewer`
- **Settings:** `https://github.com/YOUR-USERNAME/bddr-tong-viewer/settings`
- **Actions:** `https://github.com/YOUR-USERNAME/bddr-tong-viewer/actions`

---

## 💡 Mẹo Nâng Cao

### Tạo Custom Domain (Tùy Chọn)

1. Mua domain (GoDaddy, Namecheap, v.v.)
2. Repo Settings → Pages
3. "Custom domain": `yourdomain.com`
4. Cấu hình DNS theo hướng dẫn GitHub

### Tạo Custom 404 Page

Tập tin `404.html` sẽ tự động dùng cho trang không tìm thấy.

### Thêm Badge Readme

```markdown
[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue)](https://YOUR-USERNAME.github.io/bddr-tong-viewer)
```

### SSH Keys (Nâng Cao)

Nếu muốn dùng SSH thay HTTPS:
https://docs.github.com/en/authentication/connecting-to-github-with-ssh

---

## 🎉 Hoàn Thành!

Bây giờ bạn có:
- ✅ Repository GitHub
- ✅ Code trên GitHub Pages
- ✅ Live website
- ✅ Miễn phí forever

**Chia sẻ URL với mọi người!** 📤

---

## 📞 Liên Hệ & Hỗ Trợ

Nếu gặp vấn đề:

1. **Google**: `github pages error ...`
2. **GitHub Docs**: https://docs.github.com/en/pages
3. **Stack Overflow**: Tag `github-pages`
4. **GitHub Issues**: Tạo issue trong repo

---

## 📚 Tài Liệu Liên Quan

- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Git Basics](https://git-scm.com/book/en/v2)
- [GitHub CLI](https://cli.github.com/)

---

*Happy deploying! 🚀*
