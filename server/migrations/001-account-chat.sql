-- Account profile and persistent chat schema.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

CREATE TABLE account_profiles (
    github_id VARCHAR(24) NOT NULL,
    github_name VARCHAR(255) NULL,
    github_bio VARCHAR(512) NULL,
    github_company VARCHAR(255) NULL,
    github_location VARCHAR(255) NULL,
    github_blog VARCHAR(2048) NULL,
    github_created_at DATETIME(6) NULL,
    github_synced_at DATETIME(6) NULL,
    display_name VARCHAR(80) NULL,
    locale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (github_id),
    CONSTRAINT fk_profile_user FOREIGN KEY (github_id) REFERENCES community_users(github_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_conversations (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    github_id VARCHAR(24) NOT NULL,
    title VARCHAR(160) NOT NULL DEFAULT '新对话',
    state ENUM('active', 'archived') NOT NULL DEFAULT 'active',
    next_turn_no BIGINT UNSIGNED NOT NULL DEFAULT 1,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    INDEX ix_conversation_list (github_id, deleted_at, state, updated_at DESC, id DESC),
    INDEX ix_conversation_purge (deleted_at, id),
    CONSTRAINT fk_conversation_user FOREIGN KEY (github_id) REFERENCES community_users(github_id) ON DELETE RESTRICT,
    CONSTRAINT ck_conversation_counters CHECK (next_turn_no > 0 AND revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_turns (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    turn_no BIGINT UNSIGNED NOT NULL,
    client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input_hash BINARY(32) NOT NULL,
    status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    active_slot TINYINT GENERATED ALWAYS AS
        (CASE WHEN status IN ('pending', 'running') THEN 1 ELSE NULL END) STORED,
    attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
    lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(6) NULL,
    provider VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    model VARCHAR(120) NOT NULL,
    prompt_version VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    context_through_turn_no BIGINT UNSIGNED NOT NULL DEFAULT 0,
    generation_options JSON NOT NULL,
    input_tokens INT UNSIGNED NULL,
    output_tokens INT UNSIGNED NULL,
    latency_ms INT UNSIGNED NULL,
    finish_reason VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    started_at DATETIME(6) NULL,
    finished_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_turn_order (conversation_id, turn_no),
    UNIQUE KEY uq_turn_request (conversation_id, client_request_id),
    UNIQUE KEY uq_turn_active (conversation_id, active_slot),
    INDEX ix_turn_recovery (status, lease_until, id),
    INDEX ix_turn_queue (status, created_at, id),
    CONSTRAINT fk_turn_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
    CONSTRAINT ck_turn_counters CHECK (turn_no > 0 AND attempt_no > 0 AND context_through_turn_no < turn_no),
    CONSTRAINT ck_turn_options CHECK (JSON_TYPE(generation_options) = 'OBJECT'),
    CONSTRAINT ck_turn_lease CHECK (
        (status = 'running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
        (status <> 'running' AND lease_token IS NULL AND lease_until IS NULL)),
    CONSTRAINT ck_turn_finished CHECK (
        (status IN ('pending', 'running') AND finished_at IS NULL) OR
        (status IN ('completed', 'failed', 'cancelled') AND finished_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ai_messages (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    turn_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content MEDIUMTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_message_role (turn_id, role),
    CONSTRAINT fk_message_turn FOREIGN KEY (turn_id) REFERENCES ai_turns(id) ON DELETE CASCADE,
    CONSTRAINT ck_message_content CHECK (OCTET_LENGTH(content) BETWEEN 1 AND 65536)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
