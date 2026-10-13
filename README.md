# Ứng Dụng Quản Lý Chi Tiêu Phòng Trọ (React + Cloudflare Pages + VietQR)

Webapp dành riêng cho việc quản lý và công khai chi phí phòng trọ/căn hộ (tiền nhà, tiền điện, tiền nước, internet, rác, chi phí chung...) và tự động sinh **mã VietQR** thanh toán chuẩn xác từng đồng cho từng thành viên.

---

## 🌟 Tính Năng Nổi Bật

1. **Hiển thị thông tin chi tiêu minh bạch**:
   - Thống kê chi tiết: Tổng tiền, tiền điện, tiền nước, internet, rác...
   - Tự động chia đều cho các thành viên trong phòng.
   - Thống kê tiến độ: Đã thu bao nhiêu người, còn thiếu bao nhiêu tiền.

2. **Tự động sinh mã VietQR theo chuẩn Napas247**:
   - Mỗi thành viên bấm vào tên mình sẽ hiện ngay mã QR cá nhân hóa.
   - Quét mã bằng bất kỳ app ngân hàng nào (MB, VCB, Techcombank, MoMo...) là tự động điền sẵn:
     - Số tài khoản người thu tiền
     - Tên ngân hàng thụ hưởng
     - Số tiền chính xác cần đóng
     - Cú pháp nội dung chuyển khoản (VD: `TIEN PHONG AN T10`)
   - Hỗ trợ nút sao chép 1 chạm cho STK, Số tiền, Nội dung.

3. **Bảo mật Admin bằng mã Hash (Không cần đăng ký/đăng nhập phức tạp)**:
   - Thành viên chỉ xem dữ liệu và quét mã QR.
   - Người thu tiền (Admin) bấm nút **Admin** và nhập mã PIN.
   - Hệ thống tự động băm **SHA-256** và so khớp với mã hash được cấu hình.
   - Mã PIN mặc định: `123456`
   - Mã SHA-256 Hash mặc định: `8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92`
   - Cho phép đổi mã PIN trực tiếp trên giao diện Admin và hiển thị mã hash để bạn copy/hardcode.

4. **1-Chạm cập nhật trạng thái thanh toán**:
   - Khi có bạn trong phòng chuyển khoản, Admin bấm toggle đổi trạng thái "Chưa nộp" -> "Đã nộp" (kèm hiệu ứng pháo hoa chúc mừng 🎉).
   - Hỗ trợ **trả góp từng phần**: bấm icon 💰 trên thẻ thành viên để ghi nhận số đã thu mỗi đợt, app tự tính còn thiếu và sinh QR đúng số còn lại.

5. **Hoạt động kép (Dual Mode)**:
   - Chạy offline/local: Tự động lưu vào `LocalStorage`, mở web là chạy ngay không cần cài đặt database.
   - Deploy Cloudflare: Tự động kết nối với **Cloudflare D1 SQL Database** qua **Cloudflare Pages Functions** (`/api/*`).

---

## 🚀 Hướng Dẫn Chạy Thử Trên Máy (Local)

1. Cài đặt các thư viện (đã cài sẵn):
   ```bash
   npm install
   ```

2. Khởi chạy môi trường phát triển:
   ```bash
   npm run dev
   ```
   Mở trình duyệt tại: `http://localhost:3000`

   > Chế độ này dùng frontend local + API production (qua proxy trong `vite.config.js`).

3. Dev full-stack local (frontend + backend Functions + D1 riêng, không đụng production):
   ```bash
   npm run db:pull   # 1 lần: copy dữ liệu production về D1 local (chỉ đọc, an toàn)
   npm run dev:full  # chạy web :3000 + server API local :8788 cùng lúc
   ```
   Mở trình duyệt tại: `http://localhost:3000` (mọi `/api` lúc này đi vào server local).

   | Lệnh | Tác dụng |
   | ---- | -------- |
   | `npm run dev` | Web local + API production |
   | `npm run dev:server` | Chỉ chạy server API local (:8788, D1 local) |
   | `npm run dev:full` | Web local + server API local cùng lúc |
   | `npm run db:pull` | Copy dữ liệu production về D1 local |

---

## ☁️ Hướng Dẫn Deploy Lên Cloudflare Pages & Tạo D1 Database

### Cách 1: Deploy trực tiếp bằng Wrangler CLI

1. **Đăng nhập Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Tạo Database Cloudflare D1**:
   ```bash
   npx wrangler d1 create phong_chi_tieu_db
   ```
   Lệnh trên sẽ in ra thông tin cấu hình, ví dụ:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "phong_chi_tieu_db"
   database_id = "xxxx-xxxx-xxxx-xxxx"
   ```
   👉 Hãy mở file [wrangler.toml](file:///data/Projects/2a/wrangler.toml) và dán `database_id` của bạn vào.

3. **Khởi tạo bảng và dữ liệu mẫu vào Cloudflare D1**:
   ```bash
   npx wrangler d1 execute phong_chi_tieu_db --file=./schema.sql --remote
   ```

4. **Build dự án**:
   ```bash
   npm run build
   ```

5. **Deploy lên Cloudflare Pages**:
   ```bash
   npx wrangler pages deploy dist --project-name=phong-chi-tieu
   ```

---

### Cách 2: Deploy qua giao diện Cloudflare Dashboard (Khuyên dùng nếu liên kết GitHub)

1. Đẩy code lên GitHub repository của bạn.
2. Truy cập [dash.cloudflare.com](https://dash.cloudflare.com) -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
3. Cài đặt thông số build:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Tạo D1 Database:
   - Vào menu bên trái: **Storage & Databases** -> **D1** -> **Create database** đặt tên `phong_chi_tieu_db`.
   - Vào mục **Console** của database đó, dán toàn bộ nội dung file [schema.sql](file:///data/Projects/2a/schema.sql) vào và ấn **Execute**.
5. Liên kết D1 với Pages:
   - Vào Pages project vừa tạo -> **Settings** -> **Functions** -> **D1 database bindings**.
   - Bấm **Add binding**:
     - Variable name: `DB`
     - D1 database: chọn `phong_chi_tieu_db`
6. Bấm **Redeploy** là ứng dụng đã online 100%!

---

## 🔐 Cấu Trúc Mã Hash Admin

- Thuật toán băm: **SHA-256**
- Nếu muốn hardcode mã PIN của riêng bạn (ví dụ PIN là `999888`):
  1. Vào web -> bấm **Admin** -> nhập `123456`
  2. Mở tab **Mã Hash / PIN** -> nhập mã mới của bạn -> copy mã SHA-256 hash hiển thị ở dưới.
  3. Bạn có thể dán mã hash này vào dòng `admin_pin_hash` trong [schema.sql](file:///data/Projects/2a/schema.sql) hoặc file cấu hình Cloudflare D1.
