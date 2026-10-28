-- PostgreSQL community schema. Applied only by the explicit migration CLI.
CREATE TABLE community_users (
  github_id varchar(24) PRIMARY KEY, login varchar(39) NOT NULL UNIQUE,
  avatar_url varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE community_sessions (
  token_hash char(64) PRIMARY KEY, github_id varchar(24) NOT NULL REFERENCES community_users(github_id),
  expires_at bigint NOT NULL
);
CREATE INDEX ix_session_expiry ON community_sessions(expires_at);
CREATE TABLE community_oauth (
  state_hash char(64) PRIMARY KEY, verifier varchar(128) NOT NULL, expires_at bigint NOT NULL
);
CREATE INDEX ix_oauth_expiry ON community_oauth(expires_at);
CREATE TABLE community_reports (
  github_id varchar(24) PRIMARY KEY REFERENCES community_users(github_id),
  account varchar(39) NOT NULL, score integer NOT NULL, eligible integer NOT NULL,
  completed_at bigint NOT NULL, report jsonb NOT NULL
);
CREATE INDEX ix_ranking ON community_reports(score DESC,account);
CREATE TABLE community_report_history (
  id uuid PRIMARY KEY, github_id varchar(24) NOT NULL, completed_at bigint NOT NULL, report jsonb NOT NULL
);
CREATE INDEX ix_report_history ON community_report_history(github_id,completed_at);
CREATE TABLE community_jobs (
  github_id varchar(24) PRIMARY KEY, state jsonb, lease uuid,
  locked_until bigint NOT NULL DEFAULT 0, last_request bigint NOT NULL DEFAULT 0,
  failure varchar(40) NOT NULL DEFAULT ''
);
CREATE TABLE community_legacy_reports (
  account varchar(39) PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT clock_timestamp(), report jsonb NOT NULL
);
