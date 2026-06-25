# Ke hoach nang cap chuc nang chi duong

Muc tieu: khi nguoi dung chon mot dia diem/thua dat, popup hien nut chi duong; sau do app lay vi tri hien tai, ve tuyen duong, bam theo vi tri nguoi dung va huong dan theo tung buoc gan voi cach Google Maps hoat dong.

## Giai doan 1: Popup chon diem va ve route dung hon

### Muc tieu

- Bam vao dia diem/thua dat tren ban do thi popup hien thong tin ro rang.
- Popup co nut `Chi duong toi day`.
- Khi bam nut, app lay vi tri hien tai cua nguoi dung.
- App tinh tuyen duong tu vi tri hien tai den diem dich.
- Ve route len ban do thay vi noi duong thang qua loa.

### Viec can lam

- Chuan hoa du lieu diem dich tu popup:
  - Lay toa do diem duoc chon.
  - Lay ten/ma thua neu co.
  - Luu destination hien tai trong state cua app.
- Dung `navigator.geolocation.getCurrentPosition()` de lay vi tri ban dau.
- Tach logic chi duong trong `routing.js`:
  - `setDestination(point)`
  - `getCurrentLocation()`
  - `calculateRoute(origin, destination)`
  - `renderRoute(route)`
- Tich hop routing engine:
  - Phuong an nhanh: OSRM public API de test.
  - Phuong an on dinh hon: GraphHopper/Valhalla/OSRM self-host neu can dung lau dai.
  - Neu khong co du lieu duong phu hop, can fallback sang duong thang va thong bao ro.
- Cap nhat UI panel chi duong:
  - Diem xuat phat.
  - Diem den.
  - Tong khoang cach.
  - Uoc tinh thoi gian.
  - Danh sach buoc di chuyen.
  - Nut xoa route/dung chi duong.

### Ket qua mong doi

- Nguoi dung chon diem tren ban do va bam `Chi duong toi day`.
- Ban do ve duoc route theo duong that neu routing engine co du lieu.
- Panel chi duong khong con hien noi dung loi font hoac thong tin mo ho.

### Rui ro

- Routing API public co gioi han toc do va khong nen dung cho production lau dai.
- Du lieu duong o khu vuc nong thon/dat rung co the thieu, lam route van chua chinh xac.
- Trinh duyet chi cho lay vi tri tren HTTPS hoac localhost.

## Giai doan 2: Navigation mode realtime

### Muc tieu

- Sau khi co route, app chuyen sang che do dan duong.
- Marker vi tri nguoi dung cap nhat lien tuc khi nguoi dung di chuyen.
- Ban do tu dong di theo nguoi dung.
- App hien buoc tiep theo, khoang cach con lai va trang thai dang di dung/lechetuyen.

### Viec can lam

- Dung `navigator.geolocation.watchPosition()` thay vi chi lay vi tri mot lan.
- Tao navigation state:
  - `isNavigating`
  - `currentPosition`
  - `destination`
  - `activeRoute`
  - `currentStepIndex`
  - `distanceRemaining`
  - `offRoute`
- Moi khi co vi tri moi:
  - Cap nhat marker nguoi dung.
  - Pan ban do theo vi tri moi.
  - Tinh khoang cach toi route gan nhat.
  - Tinh buoc chi duong hien tai.
  - Cap nhat UI panel.
- Neu nguoi dung lech route qua nguong, vi du 30-50 met:
  - Hien canh bao `Ban dang lech tuyen`.
  - Goi lai routing engine de tinh route moi tu vi tri hien tai.
- Them nut `Bat dau`, `Dung`, `Can giua vi tri cua toi`.
- Them trang thai loi:
  - Khong cap quyen vi tri.
  - Tin hieu GPS yeu.
  - Khong tinh duoc route.

### Ket qua mong doi

- Khi nguoi dung di chuyen, cham xanh/mui ten tren ban do di theo.
- Panel chi duong cap nhat theo vi tri moi.
- App co the tu tinh lai route khi nguoi dung di lech tuyen.

### Rui ro

- Laptop thuong lay vi tri kem chinh xac hon dien thoai.
- GPS trong trinh duyet co do tre, khong muot bang app native.
- Can tranh goi routing API qua nhieu, nen debounce/throttle reroute.

## Giai doan 3: Huong di, xoay theo thiet bi va trai nghiem giong Google Maps hon

### Muc tieu

- Marker nguoi dung co mui ten chi huong di.
- Tren dien thoai, mui ten xoay theo heading cua GPS hoac cam bien huong.
- Ban do co the xoay theo huong di neu nen tang ban do ho tro tot.
- Trai nghiem dan duong gan voi Google Maps: tu dong follow, huong buoc tiep theo noi bat, route con lai ro rang.

### Viec can lam

- Xac dinh nguon heading:
  - Uu tien `coords.heading` tu Geolocation API neu co.
  - Tren mobile co the thu `DeviceOrientationEvent` neu trinh duyet cho phep.
  - Fallback: tinh heading tu 2 vi tri gan nhat.
- Xoay marker/mui ten nguoi dung theo heading.
- Them che do follow:
  - `North up`: ban do giu huong bac.
  - `Heading up`: huong di nam phia tren man hinh.
- Voi Leaflet:
  - Co the xoay marker on dinh.
  - Xoay toan bo ban do can plugin va co the phat sinh loi voi tile/layer.
- Neu can xoay ban do muot va lau dai:
  - Danh gia chuyen tu Leaflet sang MapLibre GL.
  - MapLibre GL ho tro bearing, pitch, camera follow tot hon.
- Cai thien UI navigation:
  - Hien buoc tiep theo lon, de doc.
  - Hien khoang cach den lan re tiep theo.
  - Lam route da di qua mo di, route con lai noi bat.
  - Them nut tat/bat tu dong xoay.

### Ket qua mong doi

- Tren dien thoai, mui ten vi tri xoay theo huong nguoi dung dang di.
- Ban do tu dong bam theo vi tri hien tai.
- Neu chon `Heading up`, trai nghiem giong dieu huong Google Maps hon.

### Rui ro

- Browser tren iOS/Android co cach xin quyen cam bien khac nhau.
- Laptop gan nhu khong co compass dang tin cay.
- Xoay ca ban do trong Leaflet khong phai huong toi uu neu muon lam nghiem tuc.

## Thu tu uu tien de lam

1. Sua popup va flow `Chi duong toi day`.
2. Ket noi routing engine de lay route that.
3. Lam navigation mode bang `watchPosition()`.
4. Them reroute khi lech tuyen.
5. Xoay marker theo heading.
6. Chi danh gia xoay ca ban do sau khi 5 buoc tren da chay tot.

## Cap nhat 2026-06-23

Bo phan Google Maps API/version rieng. Huong tiep theo la giu app Leaflet hien tai, nhung thiet ke trai nghiem chi duong giong Google Maps nhat co the.

Da lam tiep:

- Ve route thanh 3 lop: nen route mo, doan con lai noi bat, doan da di qua mo hon.
- Khi `watchPosition()` cap nhat vi tri, app cat route theo vi tri gan nhat tren tuyen va cap nhat doan da di/con lai.
- Thu lay heading tu `DeviceOrientationEvent` tren mobile, uu tien sau `coords.heading` va truoc fallback tinh tu 2 vi tri.
- Khi buoc dan duong hien tai thay doi, danh sach buoc tu cuon toi buoc dang active.
- Them che do giao dien dang dan duong: an header, hien the huong dan lon mau xanh tren ban do, the trang thai/ETA phia duoi, nut can giua va nut dung noi ro.
- Hien trang thai nguon huong xoay: GPS, la ban dien thoai, theo chieu di chuyen hoac dang cho tin hieu.
- Laptop khong co compass dang tin cay nen huong xoay se dua vao heading GPS neu co, hoac tinh theo 2 vi tri lien tiep khi nguoi dung di chuyen.
- Xem tong hop chi tiet cac cai thien trong `NAVIGATION_IMPROVEMENTS.md`.

Con lai nen lam sau:

- Kiem thu thuc te tren dien thoai qua HTTPS de xac nhan GPS, compass va quyen cam bien.
- Giam tan suat goi reroute neu di ngoai thuc dia lau hon du kien.
- Chi xem xet xoay ca ban do sau khi marker heading va navigation realtime on dinh.

## Quyet dinh ky thuat can chot

- Dung routing API nao cho ban production?
- Co can route theo duong bo cong khai, hay theo duong noi bo cua du lieu dia chinh?
- App deploy bang HTTPS o dau?
- Co chap nhan Leaflet tiep tuc hay muon chuyen MapLibre GL neu uu tien navigation nang cao?
- Muc chinh xac toi thieu mong doi la bao nhieu met?
