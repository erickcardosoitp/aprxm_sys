-- Migration 010: add 'reversed' to package_status, add 'conferido'/'cancelled' to cash_session_status
ALTER TYPE package_status ADD VALUE IF NOT EXISTS 'reversed';
ALTER TYPE cash_session_status ADD VALUE IF NOT EXISTS 'conferido';
ALTER TYPE cash_session_status ADD VALUE IF NOT EXISTS 'cancelled';
