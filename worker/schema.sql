CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  account TEXT,
  display_name TEXT,
  team TEXT,
  ip TEXT,
  user_agent TEXT,
  browser TEXT,
  platform TEXT,
  language TEXT,
  latitude REAL,
  longitude REAL,
  accuracy REAL,
  location_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_logs_time ON login_logs(time);
CREATE INDEX IF NOT EXISTS idx_login_logs_account ON login_logs(account);

-- Bảng users: danh sách mã đăng nhập + mapping folder dữ liệu (data/doi01, capstone/bddr/doi01/...)
CREATE TABLE IF NOT EXISTS users (
    code          TEXT PRIMARY KEY,        -- mã đăng nhập ngẫu nhiên, không đoán được
  team          TEXT NOT NULL,           -- tên đội / đơn vị, vd: Đội 1, Công ty 75
  folder        TEXT NOT NULL,           -- folder dữ liệu tương ứng (local + R2), vd: doi01, main
  short_label   TEXT,                    -- tên ngắn hiển thị, vd: Đ�1
  subtitle      TEXT,                    -- mô tả phụ cho header
  is_active     INTEGER NOT NULL DEFAULT 1,  -- 1 = cho phép đăng nhập, 0 = tạm khoá
  notes         TEXT,                    -- ghi chú nội bộ
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Bảng sessions: phiên đăng nhập do Worker cấp, mỗi token TTL 60 phút, có thể gia hạn khi user còn dùng
CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,        -- 32 byte base64url
  code          TEXT NOT NULL,           -- mã user (FK logic tới users.code)
  ip            TEXT,                    -- IP lúc đăng nhập
  user_agent    TEXT,                    -- UA lúc đăng nhập
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,           -- ISO UTC, mặc định +60 phút
  last_seen_at  TEXT                     -- lần cuối verify (dùng cho sliding TTL)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);

