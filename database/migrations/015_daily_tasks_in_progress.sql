-- Migration 015: Add in_progress status to daily_tasks
ALTER TABLE daily_tasks DROP CONSTRAINT IF EXISTS daily_tasks_status_check;
ALTER TABLE daily_tasks ADD CONSTRAINT daily_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'done'));
