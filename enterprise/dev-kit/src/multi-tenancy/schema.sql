-- Multi-tenancy data model (P3-5)
-- Run once against the enterprise operations DB

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  namespace   VARCHAR(63)  NOT NULL UNIQUE,  -- maps to K8s namespace
  settings    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS components (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        VARCHAR(50)  NOT NULL,   -- Tool | Agent | Workflow | Chatflow | Orchestration
  name        VARCHAR(100) NOT NULL,
  spec        JSONB        NOT NULL,
  deployed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, kind, name)
);

CREATE INDEX IF NOT EXISTS idx_components_tenant ON components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_components_kind   ON components(kind);

-- Seed a default tenant for single-tenant deployments
INSERT INTO tenants (name, namespace)
VALUES ('default', 'aidevops-default')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE tenants    IS 'Tenant registry — one row per isolated deployment unit';
COMMENT ON TABLE components IS 'Component catalogue scoped per tenant';
