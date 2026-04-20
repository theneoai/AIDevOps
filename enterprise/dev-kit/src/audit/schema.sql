-- Audit log table for SOC 2 compliance
-- Run once against the enterprise operations DB (not Dify DB)

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  VARCHAR(64)  NOT NULL,          -- e.g. 'component.deploy', 'tool.invoke'
  actor_id    VARCHAR(128) NOT NULL,           -- user ID or 'system'
  actor_role  VARCHAR(32),
  tenant_id   VARCHAR(64),
  resource    VARCHAR(256),                    -- e.g. 'tool:wechat-send'
  action      VARCHAR(64)  NOT NULL,
  result      VARCHAR(16)  NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  metadata    JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor   ON audit_logs (actor_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant  ON audit_logs (tenant_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event   ON audit_logs (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_result  ON audit_logs (result,     created_at DESC);

-- Retention: rows older than 1 year for most events (enforced by a scheduled job)
-- credential.change and rbac.change rows are retained permanently (result = 'success' filter)
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for SOC 2 Type I compliance';
