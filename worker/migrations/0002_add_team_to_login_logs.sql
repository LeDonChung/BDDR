-- Migration: add team column to login_logs
-- Run: wrangler d1 execute <db-name> --file=migrations/0002_add_team_to_login_logs.sql --local / --remote
ALTER TABLE login_logs ADD COLUMN team TEXT;
