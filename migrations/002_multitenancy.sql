-- Migration 002: nhiều phòng độc lập (multi-tenancy) trong một D1.
--
-- Cách làm: mọi bảng dựng lại qua <bang>_v2 rồi RENAME, KHÔNG dùng ALTER ADD COLUMN,
-- vì SQLite gốc (miniflare local) không hỗ trợ "ADD COLUMN IF NOT EXISTS" -> file phải
-- chạy được 2 lần trên cả D1 lẫn local.
--
-- RUIRO: các câu KHÔNG atomic (D1 chạy từng câu một). Nếu file chết giữa DROP và RENAME,
-- restore từ backup pre-migration rồi chạy lại từ đầu.
--
-- Sau migration, code CU (route.js) chỉ còn chạy được với đúng 1 phòng 'phong-2a':
-- ON CONFLICT(key) (settings), ON CONFLICT(id) (periods) và INSERT member_shares(id,...)
-- đều không còn khóa tương ứng. Vì vậy migration phải deploy CÙNG CỬA SỔ với code PR2/PR3.

CREATE TABLE IF NOT EXISTS rooms (
  room_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  owner_member_id TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1. settings: PK (room_id, key) -- SQLite không ALTER được PK nên bắt buộc rebuild.
CREATE TABLE IF NOT EXISTS settings_v2 (
  room_id TEXT NOT NULL DEFAULT 'phong-2a',
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (room_id, key)
);
INSERT OR IGNORE INTO settings_v2 (room_id, key, value)
  SELECT 'phong-2a', key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_v2 RENAME TO settings;

-- 2. rooms: ghi danh phòng cũ, giữ tên đang có trong settings.
INSERT OR IGNORE INTO rooms (room_id, name, owner_member_id)
  SELECT 'phong-2a', COALESCE(MAX(value), 'Phòng 2A'), NULL
    FROM settings WHERE room_id = 'phong-2a' AND key = 'room_name';

-- 3. members: PK vẫn là id toàn cục (mem_<timestamp>), thêm room_id.
CREATE TABLE IF NOT EXISTS members_v2 (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL DEFAULT 'phong-2a',
  name       TEXT NOT NULL,
  nickname   TEXT,
  phone      TEXT,
  is_active  INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO members_v2 (id, room_id, name, nickname, phone, is_active, created_at)
  SELECT id, 'phong-2a', name, nickname, phone, is_active, created_at FROM members;
DROP TABLE members;
ALTER TABLE members_v2 RENAME TO members;

-- 4. periods: id vẫn là 'YYYY-MM' nhưng PK ghép (room_id, id) -- đây là chỗ diệt
-- xung đột kỳ giữa hai phòng.
CREATE TABLE IF NOT EXISTS periods_v2 (
  room_id    TEXT NOT NULL DEFAULT 'phong-2a',
  id         TEXT NOT NULL,
  title      TEXT NOT NULL,
  due_date   TEXT,
  status     TEXT DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, id)
);
INSERT OR IGNORE INTO periods_v2 (room_id, id, title, due_date, status, created_at)
  SELECT 'phong-2a', id, title, due_date, status, created_at FROM periods;
DROP TABLE periods;
ALTER TABLE periods_v2 RENAME TO periods;

-- 5. expenses: PK vẫn là id toàn cục, thêm room_id.
CREATE TABLE IF NOT EXISTS expenses_v2 (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL DEFAULT 'phong-2a',
  period_id        TEXT NOT NULL,
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  note             TEXT,
  expense_date     TEXT,
  target_member_id TEXT,
  quantity         INTEGER,
  unit_price       INTEGER,
  split_config     TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO expenses_v2
  (id, room_id, period_id, category, title, amount, note, expense_date,
   target_member_id, quantity, unit_price, split_config, created_at)
  SELECT id, 'phong-2a', period_id, category, title, amount, note, expense_date,
         target_member_id, quantity, unit_price, split_config, created_at
    FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_v2 RENAME TO expenses;

-- 6. member_shares: bỏ id ghép dẫn xuất '${period_id}_${member_id}' (nguồn ghi đè
-- im lặng giữa hai phòng), PK thành (room_id, period_id, member_id).
CREATE TABLE IF NOT EXISTS member_shares_v2 (
  room_id     TEXT NOT NULL DEFAULT 'phong-2a',
  period_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  is_paid     INTEGER DEFAULT 0,
  paid_at     DATETIME,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  PRIMARY KEY (room_id, period_id, member_id)
);
INSERT OR IGNORE INTO member_shares_v2
  (room_id, period_id, member_id, amount, is_paid, paid_at, paid_amount, note)
  SELECT 'phong-2a', period_id, member_id, amount, is_paid, paid_at, paid_amount, note
    FROM member_shares;
DROP TABLE member_shares;
ALTER TABLE member_shares_v2 RENAME TO member_shares;

-- 7. Xác thực: link mời + phiên thu hồi được. Chỉ lưu hash, không lưu token thô.
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  uses_left  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL,
  member_id    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME,
  last_seen_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_invites_room_member ON invites(room_id, member_id);
CREATE INDEX IF NOT EXISTS ix_sessions_room       ON sessions(room_id, member_id);

-- 8. Chỉ số đọc theo phòng.
CREATE INDEX IF NOT EXISTS ix_exp_room_period ON expenses(room_id, period_id);
CREATE INDEX IF NOT EXISTS ix_exp_room_date   ON expenses(room_id, expense_date);
CREATE INDEX IF NOT EXISTS ix_mem_room_active ON members(room_id, is_active);
-- periods không cần index riêng: PK (room_id, id) đã đảm bảo tra/đọc theo phòng.

-- 9. Nội dung chuyển khoản: phòng cũ nhét luôn tên phòng vào transfer_prefix
-- ('TIEN PHONG 2a'). Từ khi có transfer_code đứng TRƯỚC tên người, phần đó phải
-- tách ra, nếu không QR ra 'TIEN PHONG 2a 2A AN T10'. Chạy trước UPDATE bên dưới.
INSERT OR IGNORE INTO settings (room_id, key, value)
  SELECT 'phong-2a', 'transfer_code',
         upper(replace(substr(value, length('TIEN PHONG ') + 1), ' ', ''))
    FROM settings
   WHERE room_id = 'phong-2a' AND key = 'transfer_prefix'
     AND upper(value) LIKE 'TIEN PHONG %'
     AND length(value) > length('TIEN PHONG ');

UPDATE settings
   SET value = 'TIEN PHONG'
 WHERE room_id = 'phong-2a' AND key = 'transfer_prefix'
   AND upper(value) LIKE 'TIEN PHONG %'
   AND length(value) > length('TIEN PHONG ');

-- 10. Cờ version đặt cuối: hàm API chỉ coi schema là sẵn sàng khi đọc được dòng này.
CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_meta (version) VALUES (2);
