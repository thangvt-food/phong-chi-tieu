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

3. **Một tài khoản, quyền riêng theo từng phòng**:
   - Đăng nhập bằng Google một lần; tài khoản được tạo tự động ở lần đăng nhập đầu và có thể nhận lời mời vào nhiều phòng.
   - Mỗi phòng có một hồ sơ thành viên và vai trò riêng cho tài khoản đó. Bạn có thể là chủ phòng này, manager hoặc member ở phòng khác.
   - Chủ phòng là một thành viên riêng của từng phòng. Tạo thêm phòng sẽ tạo thêm hồ sơ chủ phòng; thành viên, khoản chi, cài đặt và PIN khôi phục không dùng chung giữa các phòng.
   - `viewer` chỉ xem; `member` có thể tự cập nhật phần đã nộp; `manager` được ghi sổ và quản thành viên cấp thấp hơn; `owner` quản cả cài đặt phòng.

4. **Mời thành viên vào đúng một phòng**:
   - Chủ phòng mở **Cài đặt -> Thành viên -> Link mời**, chọn hồ sơ thành viên và vai trò ban đầu (`member` mặc định), rồi gửi link riêng.
   - Người nhận đăng nhập Google rồi nhận lời mời. Link chỉ dùng một lần và mặc định hết hạn sau 7 ngày.
   - Duyệt thành viên bật mặc định: link tạo yêu cầu chờ chủ phòng duyệt. Chủ phòng có thể tắt duyệt trong tab Thành viên; khi đó link được phát hành sẽ vào phòng ngay. Không thể tham gia chỉ bằng mã phòng.
   - Lời mời gắn với một hồ sơ thành viên trong một phòng. Một tài khoản chỉ liên kết với tối đa một hồ sơ thành viên trong mỗi phòng; cùng tài khoản vẫn có thể nhận lời mời ở các phòng khác.
   - Phiên tài khoản có hạn 90 ngày. Chủ phòng có thể thu hồi quyền của thành viên; request tiếp theo của họ sẽ bị từ chối.

5. **1-Chạm cập nhật trạng thái thanh toán**:
   - Khi có bạn trong phòng chuyển khoản, Admin bấm toggle đổi trạng thái "Chưa nộp" -> "Đã nộp" (kèm hiệu ứng pháo hoa chúc mừng 🎉).
   - Hỗ trợ **trả góp từng phần**: bấm icon 💰 trên thẻ thành viên để ghi nhận số đã thu mỗi đợt, app tự tính còn thiếu và sinh QR đúng số còn lại.

6. **Nhiều phòng trọ độc lập, một tài khoản quản lý**:
   - Dữ liệu app lưu trong Firestore, trong collection gốc `phongthuchi`; mỗi hồ sơ mang mã loại dữ liệu và ID ổn định. Tài khoản dùng chung được nối vào từng phòng qua membership.
   - Mỗi phòng là một sổ riêng (thành viên, kỳ, khoản chi, PIN, sao kê); tạo phòng mới không gộp hay chia sẻ dữ liệu với phòng hiện tại.
   - URL theo phòng: `https://.../?p=phong-2a`. Thiếu `?p` = phòng `phong-2a` (URL cũ không hỏng).
   - Bấm tên phòng trên header để xem danh sách **Phòng của bạn** và chuyển phòng mà không cần đăng xuất. Vai trò được kiểm tra riêng cho phòng đang chọn.
   - **Tạo phòng mới** sẽ thêm phòng vào cùng tài khoản, với hồ sơ chủ phòng và PIN khôi phục riêng; **Nhận link mời** sẽ thêm membership vào phòng được mời.
   - Khi mở app, phòng hợp lệ ghi trong `?p` được ưu tiên; nếu không có thì app khôi phục phòng dùng gần nhất trên thiết bị, rồi chọn phòng đầu tiên trong danh sách.
   - Dữ liệu được khóa theo phòng và kỳ nên hai phòng cùng tạo kỳ `2026-11` không ghi đè nhau.

7. **Hoạt động kép (Dual Mode)**:
   - Chạy với Cloudflare: dữ liệu và mọi thao tác ghi đi qua **Pages Functions** tới **Firestore**; trình duyệt không truy cập Firestore trực tiếp.
   - Khi mất mạng, app chỉ đọc cache của phòng đã tải trước đó; thao tác ghi bị khóa cho tới khi kết nối lại.

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

   > Frontend local proxy `/api` sang server Functions local tại `localhost:8788`; chạy `npm run dev:server` hoặc `npm run dev:full` trước khi đăng nhập.

3. Dev full-stack local (frontend + backend Functions):
   ```bash
   # Tạo file .dev.vars (được gitignore) với FIRESTORE_SERVICE_ACCOUNT là JSON
   # service account dùng cho môi trường dev và FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>.
   npm run dev:full      # chạy web :3000 + server API local :8788 cùng lúc
   ```
   Mở trình duyệt tại `http://localhost:3000`; mọi `/api` đi vào server local. Không dùng credential production trong máy chia sẻ hoặc môi trường không tin cậy.

   | Lệnh | Tác dụng |
   | ---- | -------- |
   | `npm run dev` | Web local, `/api` proxy sang server local (:8788) — không còn bắn thẳng production |
   | `VITE_API_TARGET=https://<PAGES_PROJECT>.pages.dev npm run dev` | Chủ đích cho dev bắn lên production |
   | `npm run dev:server` | Chỉ chạy server API local (:8788, cần `.dev.vars`) |
   | `npm run dev:full` | Web local + server API local cùng lúc |
   | `npm test` | Chạy unit tests xác minh Google token và Firestore REST client |
   | `npm run db:firestore:dry-run` | Đọc D1 production, chỉ in số lượng bản ghi; không ghi Firestore |
   | `npm run db:firestore:copy` | Sao chép D1 production vào Firestore; chỉ chạy một lần sau khi xem dry-run |
   | `npm run db:pull` | Công cụ legacy để lấy bản D1 dự phòng về local |
   | `bash scripts/smoke.sh` | Smoke test legacy cho backend D1 cũ; không dùng để xác nhận API Firestore |

   Dữ liệu hiện tại đã được sao chép vào collection `phongthuchi`. Script migration giữ nguyên D1; nếu lần chạy bị ngắt giữa chừng, chỉ tiếp tục bằng `node scripts/migrate-d1-to-firestore.mjs --apply --resume` sau khi xác nhận các document hiện có là của lần copy đó.

   Nếu cần nâng D1 backup từ version 4 lên version 5, chỉ thao tác trên bản backup và không chạy lại để khởi động app:
   ```bash
   MIGRATION=migrations/005_google_auth_and_join_approval.sql TO_VERSION=5 bash scripts/pr6-deploy.sh
   MIGRATION=migrations/005_google_auth_and_join_approval.sql TO_VERSION=5 bash scripts/pr6-deploy.sh --yes
   ```
   Lệnh đầu chỉ xem kế hoạch; lệnh thứ hai thay đổi D1 production. Không chạy nếu D1 đang ở version khác 4.

---

## ☁️ Deploy Cloudflare Pages và Firestore

> `<FIREBASE_PROJECT_ID>` và `<PAGES_PROJECT>` là giá trị thật khai trong
> [`wrangler.toml`](./wrangler.toml) và `.firebaserc` — README cố ý không ghi lại.

### Cách 1: Deploy trực tiếp bằng Wrangler CLI

1. **Đăng nhập Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Tạo Firestore database** trong Firebase Console của project `<FIREBASE_PROJECT_ID>` (Firestore Native, region `asia-southeast1`). Collection gốc của ứng dụng là `phongthuchi`.

3. **Cấp quyền cho Cloudflare Pages**:
   - Tạo service account runtime riêng với quyền `roles/datastore.user`.
   - Lưu JSON key vào Pages project `<PAGES_PROJECT>` dưới secret `FIRESTORE_SERVICE_ACCOUNT` bằng `npx wrangler pages secret put FIRESTORE_SERVICE_ACCOUNT --project-name=<PAGES_PROJECT>`.
   - Biến `FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>` đã khai báo trong [`wrangler.toml`](./wrangler.toml).
   - Quyền Datastore User áp dụng cho toàn Firestore của project, không chỉ collection `phongthuchi`; giữ credential bí mật và không đưa vào Git.

4. **Sao chép D1 hiện hữu (nếu chưa copy)**:
   ```bash
   npm run db:firestore:dry-run
   npm run db:firestore:copy
   ```
   Cần đăng nhập `gcloud` và Wrangler đúng project/account. Script mặc định chỉ đọc; `--apply` mới ghi vào Firestore. D1 không bị xóa hay sửa.

5. **Build dự án**:
   ```bash
   npm run build
   ```

6. **Deploy lên Cloudflare Pages** (thiếu `--branch=production` là code chỉ lên Preview,
   `<PAGES_PROJECT>.pages.dev` vẫn chạy bản cũ):
   ```bash
   npx wrangler pages deploy dist --project-name=<PAGES_PROJECT> --branch=production
   ```

---

### Deploy qua giao diện Cloudflare Dashboard

1. Đẩy code lên GitHub repository của bạn.
2. Truy cập [dash.cloudflare.com](https://dash.cloudflare.com) -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
3. Cài đặt thông số build:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Tạo secret `FIRESTORE_SERVICE_ACCOUNT` trong Pages -> **Settings** -> **Variables and Secrets**.
5. Đảm bảo Firestore database của Firebase project `<FIREBASE_PROJECT_ID>` đã tồn tại và `FIREBASE_PROJECT_ID` được đặt là `<FIREBASE_PROJECT_ID>`.
6. Bấm **Redeploy** sau khi cập nhật secret.

---

## 🔐 Google Auth, duyệt thành viên và PIN phòng

- Bật **Google** provider trong Firebase Authentication -> Sign-in method. Thêm các host cần dùng (localhost, Pages production và preview domain) vào Authorized domains.
- Firebase project phải là `<FIREBASE_PROJECT_ID>`; `FIREBASE_PROJECT_ID` được cấu hình trong [`wrangler.toml`](./wrangler.toml).
- Google xác thực danh tính; API xác minh Firebase ID token rồi tạo phiên ứng dụng opaque. Hồ sơ tài khoản, membership, vai trò, sổ chi tiêu, PIN và yêu cầu duyệt lưu trong collection Firestore `phongthuchi`. Firebase Web API key là cấu hình client, không dùng làm bí mật server.
- Pages Functions truy cập Firestore bằng secret `FIRESTORE_SERVICE_ACCOUNT`; không đưa JSON key vào repo. Service account có quyền `roles/datastore.user` cấp ở project nên có thể đọc/ghi toàn Firestore của `<FIREBASE_PROJECT_ID>`, dù app chỉ dùng collection `phongthuchi`.
- Người mới đăng nhập Google được tạo tài khoản tự động nhưng chưa có quyền vào phòng. Họ cần link mời riêng từ chủ phòng; vai trò ban đầu là `member` và chủ phòng có thể đổi sau khi vào phòng. Duyệt bật mặc định cho phòng cũ lẫn phòng mới; chủ phòng có thể tắt/bật ở tab Thành viên.
- Từ version 5, đăng nhập username/mật khẩu cũ bị tắt và các hash mật khẩu cũ đã được xóa khỏi D1 trước khi copy. Chủ phòng dùng PIN để gắn tài khoản Google mới vào ghế chủ; với thành viên khác, chủ phòng cần gỡ liên kết tài khoản cũ rồi gửi link mời tới tài khoản Google mới. Membership, phòng và lịch sử chi tiêu được giữ lại trong Firestore.
- PIN chỉ để khôi phục quyền `owner` của đúng phòng. Người dùng phải đăng nhập Google trước, nhập mã phòng, PIN hiện tại và PIN mới; PIN mới được lưu băm riêng trong Firestore. PIN không cấp quyền `manager`/`member` và không thay thế đăng nhập Google.
- D1 production được giữ nguyên làm bản dự phòng sau khi copy; dữ liệu chính của ứng dụng hiện ở Firestore. Không chạy migration D1 v5 để sử dụng app.
- Quên mật khẩu Google thì dùng quy trình khôi phục tài khoản của Google; ứng dụng không lưu hoặc đặt lại mật khẩu Google.
