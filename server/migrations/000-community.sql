-- Baseline existing community schema.
CREATE TABLE IF NOT EXISTS community_users (
    github_id VARCHAR(24) PRIMARY KEY, login VARCHAR(39) NOT NULL UNIQUE,
    avatar_url VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS community_sessions (
    token_hash CHAR(64) PRIMARY KEY, github_id VARCHAR(24) NOT NULL, expires_at BIGINT NOT NULL,
    INDEX (expires_at), FOREIGN KEY (github_id) REFERENCES community_users(github_id));

CREATE TABLE IF NOT EXISTS community_oauth (
    state_hash CHAR(64) PRIMARY KEY, verifier VARCHAR(128) NOT NULL, expires_at BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS community_reports (
    github_id VARCHAR(24) PRIMARY KEY, account VARCHAR(39) NOT NULL, score INT NOT NULL,
    eligible INT NOT NULL, completed_at BIGINT NOT NULL, report JSON NOT NULL,
    INDEX ranking (score DESC, account), FOREIGN KEY (github_id) REFERENCES community_users(github_id));

CREATE TABLE IF NOT EXISTS community_report_history (
    id CHAR(36) PRIMARY KEY, github_id VARCHAR(24) NOT NULL, completed_at BIGINT NOT NULL,
    report JSON NOT NULL, INDEX (github_id, completed_at));

CREATE TABLE IF NOT EXISTS community_jobs (
    github_id VARCHAR(24) PRIMARY KEY, state JSON, lease CHAR(36), locked_until BIGINT NOT NULL DEFAULT 0,
    last_request BIGINT NOT NULL DEFAULT 0, failure VARCHAR(40) NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS community_legacy_reports (
    account VARCHAR(39) PRIMARY KEY, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, report JSON NOT NULL);
