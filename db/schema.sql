BEGIN;

CREATE SCHEMA IF NOT EXISTS todo;

CREATE TABLE IF NOT EXISTS todo.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_login text NOT NULL CHECK (char_length(owner_login) > 0),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  done boolean NOT NULL DEFAULT false,
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_owner_run_created
  ON todo.tasks (owner_login, run_id, created_at, id);

COMMIT;
