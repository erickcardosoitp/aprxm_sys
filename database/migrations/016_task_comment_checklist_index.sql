ALTER TABLE daily_task_comments
  ADD COLUMN IF NOT EXISTS checklist_index INTEGER;
