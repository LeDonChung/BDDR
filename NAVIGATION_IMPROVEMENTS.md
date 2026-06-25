# Tong hop cac cai thien navigation

Cap nhat gan nhat: 2026-06-23

## Huong phat trien hien tai

- Bo phan Google Maps API/version rieng.
- Giu Leaflet lam nen ban do chinh.
- Lam trai nghiem chi duong giong Google Maps: tap trung vao route, vi tri hien tai, buoc tiep theo, ETA va trang thai GPS.

## Da cai thien

### 1. Che do dan duong toan man hinh

- Khi bam `Bat dau dan duong`, app an header va mo giao dien dan duong phu tren ban do.
- Hien the chi dan lon mau xanh o phia tren.
- Hien khoang cach toi buoc tiep theo.
- Hien ETA/khoang cach con lai o the phia duoi.
- Co nut `Dung` noi ro.
- Co nut can giua vi tri noi tren ban do.

### 2. Route tien trinh theo vi tri that

- Route duoc tach thanh 3 lop:
  - nen route mo,
  - doan con lai noi bat,
  - doan da di qua mo hon.
- Moi lan GPS cap nhat, app tinh diem gan nhat tren route va cap nhat doan da di/con lai.
- Danh sach buoc chi duong tu highlight va cuon toi buoc dang active.

### 3. Di theo dinh vi realtime

- Dung `navigator.geolocation.watchPosition()` khi bat dau dan duong.
- Marker nguoi dung cap nhat theo GPS lien tuc.
- Ban do tu bam theo vi tri khi dang follow.
- Neu nguoi dung keo ban do, app tam dung follow.
- Bam nut can giua de bat lai follow.
- Nut can giua co trang thai active khi app dang bam theo vi tri.

### 4. Huong xoay cho dien thoai va laptop

- Uu tien `coords.heading` tu GPS.
- Tren dien thoai, thu lay huong tu `DeviceOrientationEvent`.
- Tren laptop hoac thiet bi khong co compass, app tinh huong theo 2 vi tri GPS lien tiep khi nguoi dung di chuyen.
- Giao dien hien nguon huong dang dung:
  - GPS,
  - la ban dien thoai,
  - theo chieu di chuyen,
  - dang cho tin hieu.

### 5. Giu man hinh sang khi dan duong

- Thu dung Screen Wake Lock API khi bat dau dan duong.
- Neu trinh duyet ho tro, man hinh se duoc giu sang trong luc navigation.
- Khi dung dan duong, app giai phong wake lock.
- Neu tab quay lai foreground, app thu xin wake lock lai.

### 6. Kiem tra va bao trang thai quyen GPS

- Thu kiem tra quyen `geolocation` bang Permissions API.
- Neu quyen bi chan, app bao ro can cap lai quyen dinh vi.
- Neu trinh duyet dang hoi quyen, app bao nguoi dung chon cho phep.
- Loi GPS duoc tach thong bao ro hon:
  - tu choi quyen,
  - GPS phan hoi cham,
  - GPS chua on dinh.

### 7. Reroute it bi nhieu hon

- App khong tinh lai route ngay khi GPS lech mot lan.
- Khi lech qua nguong 60m, app doi xac nhan trong 5 giay.
- Sau khi lech on dinh moi goi reroute.
- Van co cooldown 20 giay de tranh goi routing API qua nhieu.

### 8. Routing API on dinh hon

- Goi OSRM public API co timeout 12 giay.
- Neu HTTP loi hoac OSRM tra ma loi, app fallback ve route tham khao.
- Route tham khao van hien duoc khoang cach va co the dung trong navigation co ban.

## Luu y khi test that

- Dien thoai nen test qua HTTPS de GPS, compass va wake lock hoat dong dung.
- Laptop thuong khong co compass, nen huong xoay chi on khi GPS co heading hoac khi nguoi dung di chuyen du xa.
- OSRM public API chi nen dung de test/demo, neu dung lau dai nen chot routing server rieng hoac dich vu routing co SLA.
