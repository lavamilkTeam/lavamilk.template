BEGIN;
SELECT pg_advisory_xact_lock(67903301);
CREATE TABLE account_schema (
  version integer PRIMARY KEY CHECK (version = 1),
  installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(80) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES account_users(id),
  provider varchar(64) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]*$'),
  subject varchar(255) NOT NULL CHECK (length(btrim(subject)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX account_identities_user_idx ON account_identities(user_id);
CREATE TABLE account_platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(63) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]*$'),
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_memberships (
  user_id uuid NOT NULL REFERENCES account_users(id),
  platform_id uuid NOT NULL REFERENCES account_platforms(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform_id)
);
CREATE INDEX account_memberships_platform_idx ON account_memberships(platform_id);
INSERT INTO account_schema(version) VALUES (1);
COMMIT;
