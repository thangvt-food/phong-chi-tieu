-- Migration 004: tài khoản người dùng (username + mật khẩu) và liên kết tài khoản ↔ thành viên.
--
-- THUẦN BỔ SUNG: chỉ CREATE TABLE / CREATE INDEX / INSERT schema_meta. Không rebuild bảng
-- nào, nên chạy hai lần liên tiếp là vô hại (khác 002/003 - rebuild mà chạy lần hai có thể
-- ghi đè dữ liệu đã sinh ra giữa hai lần).
--
-- Liên kết tài khoản nằm ở `memberships`, KHÔNG thêm cột vào `members`: `members` là con người
-- trong sổ cái (bất biến, giữ cả người đã ngưng), còn `memberships` là "tài khoản nào đăng nhập
-- được vào dòng đó với quyền gì". Người chưa nhận tài khoản thì không có dòng nào.
--
-- `sessions` (phiên theo phòng của PR7) và `invites` KHÔNG bị đổi: `invites` được dùng lại làm
-- link claim (cột role từ 003 chính là role thành viên); `sessions` thành bảng chết - code mới
-- không đọc/ghi, để nguyên cho đường rollback và dọn ở lần sau.
--
-- Sau migration này code CU vẫn ghi được: nó chỉ chạm các cột/bảng cũ, và guard schema của nó
-- xét "có dòng version 3" - dòng đó vẫn còn. Vì vậy phải migrate trước rồi deploy sau.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  -- UNIQUE COLLATE NOCASE: 'Thang' và 'thang' là một người. Server vẫn lưu lowercase.
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  -- pbkdf2$<iter>$<salt_b64url>$<hash_b64url> - iter nằm trong chuỗi để nâng/hạ không cần migrate.
  password_hash TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Phiên thuộc TÀI KHOẢN, không thuộc phòng: một tài khoản vào được nhiều phòng, và "ngưng
-- hoạt động" chặn bằng members.is_active chứ không thu phiên (thu phiên sẽ đá khỏi phòng khác).
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME,
  last_seen_at DATETIME
);
CREATE INDEX IF NOT EXISTS ix_usession_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS memberships (
  room_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- viewer  : chỉ xem sổ
  -- member  : xem + tự tick "đã nộp" phần mình
  -- manager : như member + ghi khoản/kỳ + quản thành viên cấp thấp hơn (không đụng cài đặt/PIN)
  -- owner KHÔNG phải một role ở đây: chủ phòng vẫn là rooms.owner_member_id.
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer','member','manager')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, member_id)
);
-- Một tài khoản chỉ giữ MỘT dòng thành viên trong một phòng.
CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_room_user ON memberships(room_id, user_id);
CREATE INDEX IF NOT EXISTS ix_membership_user ON memberships(user_id);

-- Chống dò mật khẩu/PIN. key = 'login:<username>' hoặc 'pin:<room_id>'.
CREATE TABLE IF NOT EXISTS auth_throttle (
  key          TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME
);

-- Cờ version đặt cuối, đúng quy ước 003: scripts/pr6-deploy.sh chặn nếu DB chưa đạt.
INSERT OR IGNORE INTO schema_meta (version) VALUES (4);
