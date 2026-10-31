-- Migration 003: link mời phân quyền (viewer / member / manager).
--
-- Cùng công thức với 002: SQLite gốc (miniflare local) không hỗ trợ
-- "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" -> bảng đổi hình dạng phải dựng lại qua
-- <bang>_v2 rồi RENAME, để file chạy được 2 lần liên tiếp trên cả D1 lẫn local.
-- Các câu KHÔNG atomic: chết giữa DROP và RENAME thì restore từ backup pre-migration
-- rồi chạy lại.
--
-- DROP TABLE mang theo index của bảng, nên ix_invites_room_member được dựng lại bên dưới.
--
-- sessions KHÔNG cần rebuild: cột role đã có từ 002 (mặc định 'member'); từ migration này
-- nó mới thật sự được code đọc tới. Phiên đã cấp trước đây giữ nguyên role='member' nên
-- quyền của người đang dùng không đổi — chỉ siết khi chủ phòng tạo link MỚI có chọn quyền.
--
-- Sau migration này code CU vẫn chạy được (không đọc cột role), nhưng route.js đòi
-- SCHEMA_VERSION=3 cho mọi đường ghi -> phải migrate RỒI MỚI deploy, như 002.

CREATE TABLE IF NOT EXISTS invites_v2 (
  token_hash TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  -- 'viewer'  : chỉ xem sổ
  -- 'member'  : xem + tự tick "đã nộp" cho phần của mình (= hành vi mọi link đã có)
  -- 'manager' : như member, thêm tạo lại link mời + thu hồi phiên; không sửa được sổ
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer', 'member', 'manager')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  uses_left  INTEGER NOT NULL DEFAULT 1
);

-- Link đang tồn tại chưa từng có quyền riêng -> nhận mức mặc định, không làm người đã vào
-- phòng bị tụt quyền giữa chừng.
INSERT OR IGNORE INTO invites_v2 (token_hash, room_id, member_id, role, created_at, expires_at, uses_left)
  SELECT token_hash, room_id, member_id, 'member', created_at, expires_at, uses_left FROM invites;

DROP TABLE invites;
ALTER TABLE invites_v2 RENAME TO invites;

CREATE INDEX IF NOT EXISTS ix_invites_room_member ON invites(room_id, member_id);

-- Cờ version đặt cuối: API chỉ coi schema là sẵn sàng khi đọc được dòng này, và
-- scripts/pr6-deploy.sh chặn nếu migration chạy xong mà DB chưa đạt TO_VERSION.
CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_meta (version) VALUES (3);
