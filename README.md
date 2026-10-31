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
     - Cú pháp nội dung chuyển khoản (VD: `TIEN PHONG 2A AN T10`) — mã phòng đứng
       trước tên người để một tài khoản nhận cho nhiều phòng vẫn phân biệt được sao kê.
   - Hỗ trợ nút sao chép 1 chạm cho STK, Số tiền, Nội dung.

3. **Bảo mật Admin theo từng phòng (không đăng ký/đăng nhập)**:
   - Mỗi phòng có một mã PIN riêng; hệ thống băm **SHA-256** và so với hash lưu trong DB của phòng đó.
   - PIN chỉ dùng để lấy "hash mở khoá" lưu trong máy bạn; tab **PIN & Mời người** cho đổi PIN.
   - `schema.sql` seed hash của `123456` **cho D1 local**. DB thật phải đổi PIN ngay sau khi migrate.

4. **Vào phòng bằng link mời (hết hạn 15 phút, dùng 1 lần)**:
   - Admin mở **Cài đặt -> Thành viên -> Link mời**, gửi link cho đúng một người.
   - Người được mời mở link -> nhận phiên 90 ngày trên thiết bị đó, tự tick "đã nộp" cho
     phần của mình mà không cần PIN.
   - Admin thu hồi bất cứ lúc nào (**icon đá người**): request kế tiếp của người đó là 401.
   - Chỉ mã SHA-256 của token được lưu; DB bị lộ cũng không còn phiên sống.

5. **1-Chạm cập nhật trạng thái thanh toán**:
   - Khi có bạn trong phòng chuyển khoản, Admin bấm toggle đổi trạng thái "Chưa nộp" -> "Đã nộp" (kèm hiệu ứng pháo hoa chúc mừng 🎉).
   - Hỗ trợ **trả góp từng phần**: bấm icon 💰 trên thẻ thành viên để ghi nhận số đã thu mỗi đợt, app tự tính còn thiếu và sinh QR đúng số còn lại.

6. **Nhiều phòng trọ độc lập, tự tạo trong app**:
   - Một D1 duy nhất, mọi bảng có `room_id`; phòng là một sổ chi tiêu riêng
     (thành viên, kỳ, khoản chi, PIN, sao kê riêng).
   - URL theo phòng: `https://.../?p=phong-2a`. Thiếu `?p` = phòng `phong-2a` (URL cũ không hỏng).
   - Bấm tên phòng trên header -> **Tạo phòng mới** (mã phòng sinh từ tên, không dấu) hoặc
     dán link mời để vào phòng người khác.
   - Hai phòng cùng tạo kỳ `2026-11` không ghi đè nhau (PK ghép `(room_id, period_id, member_id)`).

7. **Hoạt động kép (Dual Mode)**:
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
   | `npm run dev` | Web local, `/api` proxy sang server local (:8788) — không còn bắn thẳng production |
   | `VITE_API_TARGET=https://phong-chi-tieu.pages.dev npm run dev` | Chủ đích cho dev bắn lên production |
   | `npm run dev:server` | Chỉ chạy server API local (:8788, D1 local) |
   | `npm run dev:full` | Web local + server API local cùng lúc |
   | `npm run db:pull` | Copy dữ liệu production về D1 local |
   | `npm run db:schema:local` | Dựng lại D1 local từ `schema.sql` (bản đã có `room_id`) |
   | `npm run db:migrate:local` | Chạy `migrations/002_multitenancy.sql` trên D1 local |
   | `bash scripts/smoke.sh` | 48 assertion đa phòng qua HTTP, chạy trên D1 local (cần `dev:server`) |
   | `bash scripts/pr6-deploy.sh` | Di cư production (backup → migrate → deploy → verify). Không có `--yes` thì chỉ in lệnh |

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

5. **Deploy lên Cloudflare Pages** (thiếu `--branch=production` là code chỉ lên Preview,
   `phong-chi-tieu.pages.dev` vẫn chạy bản cũ):
   ```bash
   npx wrangler pages deploy dist --project-name=phong-chi-tieu --branch=production
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

- Thuật toán băm: **SHA-256**, lưu theo phòng ở `settings(room_id, 'admin_pin_hash')`.
- Nếu muốn hardcode mã PIN của riêng bạn (ví dụ PIN là `999888`):
  1. Vào web -> bấm **Cài đặt** -> nhập PIN hiện tại của phòng đó
  2. Mở tab **PIN & Mời người** -> nhập mã mới của bạn -> lưu.
  3. Bạn có thể dán mã hash này vào dòng `admin_pin_hash` trong [schema.sql](file:///data/Projects/2a/schema.sql) hoặc file cấu hình Cloudflare D1.
