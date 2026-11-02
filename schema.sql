-- Cloudflare D1 - schema cho DB dựng mới, đã bao gồm toàn bộ migration (002 đa phòng,
-- 003 link mời, 004 tài khoản và 005 Google Auth/duyệt thành viên).
-- DB đang có dữ liệu thì chạy migrations/00N_*.sql theo thứ tự,
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

-- Phiên theo phòng của PR7: code từ 004 không còn đọc/ghi bảng này. Để nguyên cho đường
-- rollback; một lần dọn sau khi tài khoản đã chạy ổn định.
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

-- Version 5: tài khoản Google và duyệt thành viên. Phải khớp migrations/005_google_auth_and_join_approval.sql.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  firebase_uid  TEXT,
  email         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME,
  last_seen_at DATETIME
);

CREATE TABLE IF NOT EXISTS memberships (
  room_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer','member','manager')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, member_id)
);

CREATE TABLE IF NOT EXISTS auth_throttle (
  key          TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME
);

CREATE TABLE IF NOT EXISTS join_requests (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer','member','manager')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME
);

CREATE INDEX IF NOT EXISTS ix_invites_room_member ON invites(room_id, member_id);
CREATE INDEX IF NOT EXISTS ix_usession_user       ON user_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_firebase_uid ON users(firebase_uid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_room_user ON memberships(room_id, user_id);
CREATE INDEX IF NOT EXISTS ix_membership_user     ON memberships(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_join_requests_pending_member
  ON join_requests(room_id, member_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_join_requests_room_status
  ON join_requests(room_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_join_requests_user_status
  ON join_requests(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_sessions_room       ON sessions(room_id, member_id);
CREATE INDEX IF NOT EXISTS ix_exp_room_period     ON expenses(room_id, period_id);
CREATE INDEX IF NOT EXISTS ix_exp_room_date       ON expenses(room_id, expense_date);
CREATE INDEX IF NOT EXISTS ix_mem_room_active     ON members(room_id, is_active);

CREATE TABLE IF NOT EXISTS schema_meta (
  version    INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- DB dựng mới đã có sẵn hình dạng version 5, stamp các version trước để MAX(version)
-- khớp prod đi đường migration (002 -> 003 -> 004 -> 005).
INSERT OR IGNORE INTO schema_meta (version) VALUES (2);
INSERT OR IGNORE INTO schema_meta (version) VALUES (3);
INSERT OR IGNORE INTO schema_meta (version) VALUES (4);
INSERT OR IGNORE INTO schema_meta (version) VALUES (5);

-- Seed phòng mặc định cho DB mới tinh.
INSERT OR IGNORE INTO rooms (room_id, name) VALUES ('phong-2a', 'Phòng Trọ 2A');

INSERT OR IGNORE INTO settings (room_id, key, value) VALUES
  ('phong-2a', 'room_name',        'Phòng Trọ 2A'),
  ('phong-2a', 'bank_id',          'MB'),
  ('phong-2a', 'account_no',       '9999999999'),
  ('phong-2a', 'account_name',     'NGUYEN VAN QUAN TRI'),
  ('phong-2a', 'transfer_prefix',  'TIEN PHONG'),
  ('phong-2a', 'transfer_code',    'P2A'),
  ('phong-2a', 'join_approval',    '1');

-- Hash của "123456". CHỈ cho D1 local: DB production phải đổi mã khôi phục ngay sau
-- deploy (Khôi phục chủ phòng bằng PIN -> đặt PIN mới), nếu không ai biết PIN là chiếm được phòng.
INSERT OR IGNORE INTO settings (room_id, key, value) VALUES
  ('phong-2a', 'admin_pin_hash',   '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
