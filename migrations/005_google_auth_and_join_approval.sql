-- Migration 005: liên kết tài khoản Google và duyệt thành viên theo từng phòng.
-- Không rebuild bảng hiện có để bảo toàn users, memberships và lịch sử sổ.

ALTER TABLE users ADD COLUMN firebase_uid TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_firebase_uid ON users(firebase_uid);

-- Force sign-in with Google after deployment; memberships and room data stay untouched.
UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
UPDATE users SET password_hash = 'google-auth-only' WHERE firebase_uid IS NULL;

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
CREATE UNIQUE INDEX IF NOT EXISTS ux_join_requests_pending_member
  ON join_requests(room_id, member_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_join_requests_room_status
  ON join_requests(room_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_join_requests_user_status
  ON join_requests(user_id, status, created_at);

-- Các phòng hiện tại cũng bật duyệt theo mặc định. Mỗi phòng có thể đổi trong giao diện.
INSERT OR IGNORE INTO settings (room_id, key, value)
SELECT room_id, 'join_approval', '1' FROM rooms;

INSERT OR IGNORE INTO schema_meta (version) VALUES (5);
