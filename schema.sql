-- Cloudflare D1 Database Schema for Shared Room Expense Tracker
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS periods (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  expense_date TEXT,
  target_member_id TEXT,
  quantity INTEGER,
  unit_price INTEGER,
  split_config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_shares (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  is_paid INTEGER DEFAULT 0,
  paid_at DATETIME,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

-- Seed initial default settings if not exists
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('room_name', 'Phòng Trọ 2A'),
  ('bank_id', 'MB'),
  ('account_no', '9999999999'),
  ('account_name', 'NGUYEN VAN QUAN TRI'),
  ('transfer_prefix', 'TIEN PHONG'),
  ('admin_pin_hash', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
