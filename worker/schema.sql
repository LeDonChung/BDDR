CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  account TEXT,
  display_name TEXT,
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
