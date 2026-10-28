CREATE TABLE account_profiles (
  github_id varchar(24) PRIMARY KEY REFERENCES community_users(github_id) ON DELETE CASCADE,
  github_name varchar(255), github_bio varchar(512), github_company varchar(255),
  github_location varchar(255), github_blog varchar(2048), github_created_at timestamptz,
  github_synced_at timestamptz, display_name varchar(80), locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY, github_id varchar(24) NOT NULL REFERENCES community_users(github_id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL DEFAULT '新对话',
  state varchar(16) NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  next_turn_no bigint NOT NULL DEFAULT 1, revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), deleted_at timestamptz,
  CONSTRAINT ck_conversation_counters CHECK (next_turn_no > 0 AND revision > 0)
);
CREATE INDEX ix_conversation_list ON ai_conversations(github_id,state,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_conversation_purge ON ai_conversations(deleted_at,id) WHERE deleted_at IS NOT NULL;
CREATE TABLE ai_turns (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  turn_no bigint NOT NULL, client_request_id uuid NOT NULL, input_hash bytea NOT NULL CHECK (octet_length(input_hash)=32),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
  active_slot smallint GENERATED ALWAYS AS (CASE WHEN status IN ('pending','running') THEN 1 ELSE NULL END) STORED,
  attempt_no integer NOT NULL DEFAULT 1, lease_token uuid, lease_until timestamptz,
  provider varchar(40) NOT NULL, model varchar(120) NOT NULL, prompt_version varchar(40) NOT NULL,
  context_through_turn_no bigint NOT NULL DEFAULT 0, generation_options jsonb NOT NULL,
  input_tokens integer CHECK (input_tokens >= 0), output_tokens integer CHECK (output_tokens >= 0),
  latency_ms integer CHECK (latency_ms >= 0), finish_reason varchar(40), error_code varchar(40),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz, finished_at timestamptz,
  UNIQUE (conversation_id,turn_no), UNIQUE (conversation_id,client_request_id), UNIQUE (conversation_id,active_slot),
  CONSTRAINT ck_turn_counters CHECK (turn_no>0 AND attempt_no>0 AND context_through_turn_no>=0 AND context_through_turn_no<turn_no),
  CONSTRAINT ck_turn_options CHECK (jsonb_typeof(generation_options)='object'),
  CONSTRAINT ck_turn_lease CHECK (
    (status='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
    (status<>'running' AND lease_token IS NULL AND lease_until IS NULL)),
  CONSTRAINT ck_turn_finished CHECK (
    (status IN ('pending','running') AND finished_at IS NULL) OR
    (status IN ('completed','failed','cancelled') AND finished_at IS NOT NULL))
);
CREATE INDEX ix_turn_recovery ON ai_turns(status,lease_until,id);
CREATE INDEX ix_turn_queue ON ai_turns(status,created_at,id);
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY, turn_id uuid NOT NULL REFERENCES ai_turns(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (turn_id,role),
  CONSTRAINT ck_message_content CHECK (octet_length(content) BETWEEN 1 AND 65536)
);
