# GitHub Actions CI/CD Pipeline

> **Language / 语言:** English | [中文](github-actions.zh-CN.md)

The AIDevOps CI/CD pipeline is defined in `.github/workflows/agent-ci.yml`. It runs on every push to `main`, `claude/**`, `feat/**`, and `fix/**` branches that touch `enterprise/**` files.

**Updated in v0.4.0:** Added `load-test` stage (k6, 50 VU/60s), automated production rollback on smoke failure, and three new secrets for distributed features.

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Trigger: push / pull_request / workflow_dispatch                     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
               ┌────────────────▼──────────────────┐
               │   Stage 1: validate               │  TypeScript typecheck
               │   (always runs)                   │  DevKit build
               └──────┬────────────────┬───────────┘  DSL validate
                      │                │
           ┌──────────▼──┐   ┌─────────▼──────────┐
           │ dify-compat  │   │    test-unit        │
           │ ([dify-      │   │    security         │
           │  upgrade])   │   │    (parallel)       │
           └─────────────┘   └──────────┬───────────┘
                                        │
                             ┌──────────▼──────────┐
                             │   Stage 4: build     │  Docker multi-platform
                             │                      │  Push to ghcr.io
                             └──────────┬───────────┘
                                        │
                    ┌───────────────────┼────────────────────┐
                    │                   │                    │
         ┌──────────▼──────┐  ┌─────────▼─────────┐         │
         │ container-      │  │  deploy-staging    │         │
         │ security        │  │  (main branch)     │         │
         │ (Trivy + SBOM)  │  └─────────┬──────────┘         │
         └─────────────────┘            │                    │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │   load-test  ★NEW   │  k6     │
                             │   50 VU / 60s       │  p99<500│
                             └──────────┬───────────┘         │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │ integration-tests    │         │
                             └──────────┬───────────┘         │
                                        │                    │
                             ┌──────────▼──────────┐         │
                             │ deploy-production    │  HITL   │
                             │ + smoke + rollback★  │  gated  │
                             └─────────────────────┘         │
```

---

## Stage Reference

### Stage 1 — `validate`

**Runs on:** every triggering commit  
**Timeout:** 10 minutes

| Step | Description |
|---|---|
| TypeScript typecheck | `npm run typecheck` — fails hard on type errors |
| Build DevKit | Compiles `enterprise/dev-kit` TypeScript to `dist/` |
| Validate components | `node dist/cli.js validate --all --level 2 --verbose` |

Artifact on failure: `typecheck-results`

---

### Stage 1b — `dify-compat`

**Runs on:** commits containing `[dify-upgrade]` in message/title, or manual dispatch  
**Needs:** `validate`  
**Timeout:** 10 minutes  
**Services:** PostgreSQL 15 (in-runner)

| Step | Description |
|---|---|
| Verify DIFY_VERSION | Checks `DIFY_VERSION` file matches actual submodule SHA |
| Contract tests | `bash scripts/check-dify-compat.sh` — version bounds + API contract |

**How to trigger:** include `[dify-upgrade]` in your commit message when updating the Dify submodule.

---

### Stage 2 — `test-unit`

**Runs on:** all commits (unless `skip_tests=true`)  
**Needs:** `validate`  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Start Ollama | Pulls `llama3.2:3b` for local LLM (no cloud cost) |
| Run tests | Jest with `--coverage`, `USE_LOCAL_LLM=true` |
| Coverage gate | Fails if statement coverage < 60% |

Artifact: `coverage-report` (LCOV + JSON)

**Local equivalent:**
```bash
USE_LOCAL_LLM=true make devkit-test
```

---

### Stage 3 — `security`

**Runs on:** all commits  
**Needs:** `validate`  
**Timeout:** 10 minutes

| Step | Description |
|---|---|
| npm audit (DevKit) | High-severity dependency vulnerabilities |
| npm audit (tool-service) | High-severity dependency vulnerabilities |
| TruffleHog | Secret scanning (verified secrets only) |
| CodeQL SAST | Static analysis (javascript-typescript) |
| License check | Blocks GPL-2.0, GPL-3.0, AGPL-3.0 |
| .env.example hygiene | Fails if hardcoded secrets detected |

Artifact: `license-report` (30-day retention)

> All security steps use `continue-on-error: true` to collect results without blocking.

---

### Stage 3b — `container-security`

**Runs on:** non-PR pushes (after `build`)  
**Needs:** `build`  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Trivy (tool-service) | CRITICAL/HIGH CVE scan → SARIF |
| Trivy (mcp-wechat) | CRITICAL/HIGH CVE scan → SARIF |
| Upload SARIF | Uploaded to GitHub Security tab |
| Syft SBOM (tool-service) | Generates SPDX-JSON SBOM |

Artifact: `sbom-<sha>` (90-day GitHub retention)

> **Note:** 90-day GitHub artifact retention is a known limitation for compliance use cases. For long-term SBOM storage, export artifacts to S3/GCS via a post-build step. This is tracked as a v0.5.0 improvement.

---

### Stage 4 — `build`

**Runs on:** non-PR pushes  
**Needs:** `test-unit`, `security`  
**Timeout:** 20 minutes  
**Registry:** `ghcr.io/<org>/<repo>/`

Images built:
- `tool-service` — `linux/amd64`, `linux/arm64`
- `mcp-wechat` — `linux/amd64`, `linux/arm64`

**Image tags:**

| Pattern | Example |
|---|---|
| SHA prefix | `sha-abc1234` |
| Branch name | `main` |
| Semver (on tags) | `1.2.3` |
| `latest` (main only) | `latest` |

**Required secrets:** `GITHUB_TOKEN` (auto-provided)

---

### Stage 5 — `deploy-staging`

**Runs on:** push to `main`, or manual dispatch with `deploy_env=staging`  
**Needs:** `build`  
**Environment:** `staging` (URL: `https://staging.dify.internal`)  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Build DevKit | Fresh build for deployment |
| Deploy components | Validate (level 3) + deploy all `enterprise/components/*.yml` |
| ArgoCD sync | Syncs `aidevops-staging` app (optional) |
| Record event | Posts to Harness webhook (optional) |

**Environment variables set:**
```
OTEL_SAMPLE_RATIO=0.1
PROMPT_GUARD_MODE=balanced
```

**Required secrets:**

| Secret | Purpose |
|---|---|
| `STAGING_DIFY_BASE_URL` | Staging Dify API endpoint |
| `STAGING_DIFY_API_KEY` | Staging Dify API key |
| `REDIS_URL` | Redis for token blacklist + rate limit (optional) |
| `JWKS_URI` | OIDC JWKS endpoint for RS256 JWT (optional) |
| `PROMPT_GUARD_CLASSIFIER_URL` | Tier-3 LLM classifier URL (optional) |
| `ARGOCD_TOKEN` | ArgoCD auth (optional) |
| `ARGOCD_SERVER` | ArgoCD server address (optional) |
| `HARNESS_WEBHOOK_URL` | Harness CD webhook (optional) |

---

### Stage 5b — `load-test` ★ NEW in v0.4.0

**Runs on:** after `deploy-staging` (non-PR, main branch)  
**Needs:** `deploy-staging`  
**Timeout:** 10 minutes

Runs a k6 smoke load test against the staging Tool Service using `.github/k6/smoke.js`.

**Test parameters:**

| Parameter | Value |
|---|---|
| Virtual Users (VUs) | 50 |
| Duration | 60 seconds |
| Endpoints tested | `GET /health`, `POST /tools/summarize` |
| p99 latency threshold | < 500 ms |
| Error rate threshold | < 1% |
| HTTP failure rate threshold | < 1% |

**Pass/fail logic:**
- `GET /health` must return HTTP 200
- `POST /tools/summarize` without auth must return < 500 (401 is expected and acceptable)
- Pipeline fails if either threshold is breached

**Local equivalent:**
```bash
k6 run --env TARGET_URL=http://localhost:3100 .github/k6/smoke.js
```

**k6 script location:** `.github/k6/smoke.js`

---

### Stage 6 — `integration-tests`

**Runs on:** after `load-test` (or `deploy-staging` if load-test skipped)  
**Needs:** `deploy-staging`  
**Timeout:** 20 minutes

Runs integration test suite (`npm run test:integration`) against the staging Dify instance.

> Currently graceful — outputs a warning if integration tests are not yet configured.

Artifact: `integration-test-results`

---

### Stage 7 — `deploy-production` ★ Updated in v0.4.0

**Runs on:** `main` branch + `deploy_env=production` manual trigger only  
**Needs:** `integration-tests`  
**Environment:** `production` (URL: `https://dify.internal`) — **requires GitHub environment approval**  
**Timeout:** 20 minutes

| Step | Description |
|---|---|
| Build DevKit | Fresh build for deployment |
| Deploy components | Validate (level 3) + deploy all components |
| Update lock file | Saves `registry.lock.json` via component registry API |
| Commit lock file | Auto-commits `[skip ci]` to `main` |
| Production smoke test | `GET /health` must return 200 within 30s |
| **Rollback on failure ★** | `helm rollback aidevops-production` if smoke test fails |
| **Slack alert on rollback ★** | Posts failure notice to `#deployments` |
| Slack success notification | Posts deployment summary to `#deployments` |

**Automated rollback flow:**

```
deploy-production
       │
       ▼
  smoke test (GET /health, 30s timeout)
       │
   ┌───┴───────────────┐
   │ PASS              │ FAIL
   ▼                   ▼
Slack: success    helm rollback aidevops-production
                       │
                       ▼
                  Slack: ":rotating_light: rollback triggered"
                       │
                       ▼
                  Pipeline exits 1 (marks run as failed)
```

**Required secrets:**

| Secret | Purpose |
|---|---|
| `PROD_DIFY_BASE_URL` | Production Dify API endpoint |
| `PROD_DIFY_API_KEY` | Production Dify API key |
| `REDIS_URL` | Redis for distributed features (optional) |
| `JWKS_URI` | OIDC JWKS endpoint (optional) |
| `PROMPT_GUARD_CLASSIFIER_URL` | Tier-3 classifier URL (optional) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook (optional) |
| `KUBECONFIG` | Kubernetes credentials for helm rollback (optional) |

> **HITL Gate:** The `production` GitHub environment must have required reviewers configured. The workflow pauses for approval before executing deployment steps.

---

## Manual Trigger (workflow_dispatch)

Navigate to **Actions → Agent Workflow CI/CD → Run workflow**.

| Input | Type | Default | Description |
|---|---|---|---|
| `deploy_env` | choice | `staging` | Target environment (`staging` or `production`) |
| `skip_tests` | boolean | `false` | Skip unit + integration tests (emergency deploys only) |

**Deploy to production:**
1. Ensure changes are merged to `main`
2. Trigger workflow with `deploy_env=production`
3. Approve the deployment in the GitHub environment gate

---

## Required Repository Secrets

Configure in **Settings → Secrets and variables → Actions**:

### Core Secrets

| Secret | Required For | Notes |
|---|---|---|
| `STAGING_DIFY_BASE_URL` | deploy-staging | e.g. `https://staging.dify.internal` |
| `STAGING_DIFY_API_KEY` | deploy-staging | Dify console API key for staging |
| `PROD_DIFY_BASE_URL` | deploy-production | e.g. `https://dify.internal` |
| `PROD_DIFY_API_KEY` | deploy-production | Dify console API key for production |

### v0.4.0 New Secrets

| Secret | Required For | Notes |
|---|---|---|
| `REDIS_URL` | staging + production | Enables token blacklist, WeChat token cache, rate limiting. Format: `redis://:password@host:6379` |
| `JWKS_URI` | staging + production | OIDC JWKS endpoint for RS256 JWT verification. Falls back to HS256 if unset. |
| `PROMPT_GUARD_CLASSIFIER_URL` | staging + production | Tier-3 LLM classifier for prompt injection. Optional; pipeline uses regex+heuristics if unset. |

### Optional Secrets

| Secret | Required For | Notes |
|---|---|---|
| `CI_POSTGRES_PASSWORD` | dify-compat | Defaults to `ci-only-test-password` if unset |
| `ARGOCD_TOKEN` | deploy-staging | ArgoCD authentication token |
| `ARGOCD_SERVER` | deploy-staging | ArgoCD server address |
| `HARNESS_WEBHOOK_URL` | deploy-staging | Harness CD deployment event webhook |
| `SLACK_WEBHOOK_URL` | deploy-production | Slack incoming webhook for alerts |
| `KUBECONFIG` | deploy-production | K8s credentials for automated helm rollback |

---

## Trigger Conditions

| Event | validate | dify-compat | test-unit | security | build | deploy-staging | load-test | deploy-production |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| PR → main | ✓ | — | ✓ | ✓ | — | — | — | — |
| PR + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| push → main | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → main + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → claude/\*\* | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| manual (staging) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| manual (production) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manual + skip_tests | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |

---

## Artifacts Summary

| Artifact | Stage | Retention |
|---|---|---|
| `typecheck-results` | validate (on failure) | default (90d) |
| `coverage-report` | test-unit | default (90d) |
| `license-report` | security | 30 days |
| `sbom-<sha>` | container-security | 90 days |
| `k6-results` | load-test | default (90d) |
| `integration-test-results` | integration-tests | default (90d) |

> **SBOM retention note:** 90-day GitHub artifact retention may not satisfy compliance requirements. For long-term storage, configure a post-build upload to S3/GCS. See v0.5.0 roadmap.

---

## Local Development Equivalents

```bash
# Stage 1: validate
cd enterprise/dev-kit
npm run typecheck && npm run build
node dist/cli.js validate --all --level 2

# Stage 2: unit tests
USE_LOCAL_LLM=true npm test -- --coverage

# Stage 3: security
npm audit --audit-level=high
npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-3.0"

# Stage 5b: load test (requires k6 installed)
k6 run --env TARGET_URL=http://localhost:3100 .github/k6/smoke.js

# Stage 5: deploy to staging
DIFY_BASE_URL=<url> DIFY_API_KEY=<key> node dist/cli.js deploy <component>
```

---

## Troubleshooting

**validate fails — typecheck errors**
- Download `typecheck-results` artifact for the full log
- Run `npm run typecheck` locally and fix before pushing

**test-unit fails — Ollama not ready**
- Ollama needs ~15s startup; the pipeline `sleep 15` accounts for this
- If `llama3.2:3b` pull fails, tests fall back to mock LLM (non-blocking)

**Coverage below 60%**
- Check `coverage-report` artifact for line-level details
- Add tests for new code paths before merging

**load-test fails — p99 threshold breached**
- Check staging service logs for slow queries or upstream timeouts
- Common causes: cold Redis connection, Dify API latency spikes
- If staging environment is under-resourced, adjust `LOAD_TEST_TARGET` thresholds

**deploy-production triggered rollback**
- The pipeline posts to `#deployments` Slack with the exact sha
- Investigate with: `kubectl logs -n aidevops-production -l app=tool-service --since=10m`
- Re-deploy after fix: trigger manual workflow with `deploy_env=production`

**deploy-staging fails — ArgoCD sync timeout**
- ArgoCD sync is non-blocking (`|| echo "ArgoCD not configured, skipping"`)
- Check ArgoCD dashboard at `$ARGOCD_SERVER` separately

**deploy-production stuck on approval**
- Go to **Actions → (run) → deploy-production → Review deployments**
- Approve or reject from the GitHub UI
