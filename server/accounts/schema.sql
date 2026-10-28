-- Explicit website integration migration. The shared account schema is owned by manage.
BEGIN;
SELECT pg_advisory_xact_lock(67903301);
CREATE TABLE website_account_schema (version integer PRIMARY KEY CHECK (version=1));
CREATE TABLE website_accounts (
  github_id varchar(24) PRIMARY KEY CHECK (github_id ~ '^[0-9]+$'),
  user_id uuid NOT NULL UNIQUE REFERENCES account_users(id),
  login varchar(39) NOT NULL,
  avatar_url text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  profile jsonb CHECK (profile IS NULL OR jsonb_typeof(profile)='object')
);
INSERT INTO account_platforms(code,name) VALUES ('lavamilk-web','lavamilk.club')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO website_account_schema VALUES (1);
COMMIT;
