-- Cloudflare D1 - schema cho DB dựng mới, đã bao gồm toàn bộ migration (002 đa phòng,
-- 003 link mời phân quyền). DB đang có dữ liệu thì chạy migrations/00N_*.sql theo thứ tự,
-- KHÔNG chạy file này (nó DROP/CREATE lại từ đầu qua npm run db:schema:local).
-- Hình dạng cuối của từng bảng phải khớp file migration tương ứng — smoke.sh chạy trên
-- DB dựng từ file này nên lệch là test không còn phản ánh prod.
--
-- Mặc định room_id = 'phong-2a' chỉ là cầu nối cho code cũ (route.js chưa truyền
-- room_id). PR2 ghi room_id tường minh ở mọi câu INSERT.

CREATE TABLE IF NOT EXISTS rooms (
  room_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  owner_member_id TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  room_id TEXT NOT NULL DEFAULT 'phong-2a',
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (room_id, key)
);

CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL DEFAULT 'phong-2a',
  name       TEXT NOT NULL,
  nickname   TEXT,
  phone      TEXT,
  is_active  INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- id vẫn là 'YYYY-MM', nhưng khóa là (room_id, id) nên hai phòng dùng chung kỳ không đè nhau.
CREATE TABLE IF NOT EXISTS periods (
  room_id    TEXT NOT NULL DEFAULT 'phong-2a',
  id         TEXT NOT NULL,
  title      TEXT NOT NULL,
  due_date   TEXT,
  status     TEXT DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, id)
);

CREATE TABLE IF NOT EXISTS expenses (
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

-- Không còn cột id dẫn xuất '${period_id}_${member_id}': nó là nguồn ghi đè
-- im lặng giữa hai phòng có cùng kỳ.
CREATE TABLE IF NOT EXISTS member_shares (
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

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  -- xem migrations/003_invite_roles.sql: DB dựng mới phải KHỚP HÊT prod đã migrate,
  -- nếu không smoke.sh chạy trên local sẽ không phản ánh đúng prod.
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer', 'member', 'manager')),
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
CREATE INDEX IF NOT EXISTS ix_exp_room_period     ON expenses(room_id, period_id);
CREATE INDEX IF NOT EXISTS ix_exp_room_date       ON expenses(room_id, expense_date);
CREATE INDEX IF NOT EXISTS ix_mem_room_active     ON members(room_id, is_active);

CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- DB dựng mới đã có sẵn hình dạng của version 3, stamp cả hai để MAX(version) khớp
-- prod đi đường migration (002 -> 003).
INSERT OR IGNORE INTO schema_meta (version) VALUES (2);
INSERT OR IGNORE INTO schema_meta (version) VALUES (3);

-- Seed phòng mặc định cho DB mới tinh.
INSERT OR IGNORE INTO rooms (room_id, name) VALUES ('phong-2a', 'Phòng Trọ 2A');

INSERT OR IGNORE INTO settings (room_id, key, value) VALUES
  ('phong-2a', 'room_name',        'Phòng Trọ 2A'),
  ('phong-2a', 'bank_id',          'MB'),
  ('phong-2a', 'account_no',       '9999999999'),
  ('phong-2a', 'account_name',     'NGUYEN VAN QUAN TRI'),
  ('phong-2a', 'transfer_prefix',  'TIEN PHONG'),
  ('phong-2a', 'transfer_code',    'P2A');

-- Hash của "123456". CHỈ cho D1 local: DB production phải đổi PIN ngay khi migrate
-- (Cài đặt > PIN & Mời người), nếu không ai biết URL là ghi được vào sổ.
INSERT OR IGNORE INTO settings (room_id, key, value) VALUES
  ('phong-2a', 'admin_pin_hash',   '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
