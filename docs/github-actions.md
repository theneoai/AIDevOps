# GitHub Actions CI/CD Pipeline

> **Language / 语言:** English | [中文](github-actions.zh-CN.md)

The AIDevOps CI/CD pipeline is defined in `.github/workflows/agent-ci.yml`. It runs 7 stages for every push to `main`, `claude/**`, `feat/**`, and `fix/**` branches that touch `enterprise/**` files.

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Trigger: push / pull_request / workflow_dispatch                 │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────▼──────────────────┐
              │   Stage 1: validate               │  TypeScript typecheck
              │   (always runs)                   │  DevKit build
              └──────┬─────────────────┬──────────┘  Component DSL validate
                     │                 │
          ┌──────────▼──┐    ┌─────────▼──────────┐
          │ dify-compat  │    │    test-unit        │
          │ (upgrade     │    │    security         │
          │  commits)    │    │    (parallel)       │
          └──────────────┘    └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   Stage 4: build     │  Docker multi-platform
                              │                      │  Push to ghcr.io
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ container-security   │  Trivy + SBOM (Syft)
                              │ deploy-staging       │  Auto on main branch
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ integration-tests    │  Against staging Dify
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼──────────┐
                              │ deploy-production    │  HITL gated
                              │ (manual trigger)     │  Slack notification
                              └─────────────────────┘
```

---

## Stage Reference

### Stage 1 — `validate`: DSL Component Validation

**Runs on:** every triggering commit  
**Timeout:** 10 minutes

| Step | Description |
|---|---|
| TypeScript typecheck | `npm run typecheck` — fails hard on type errors |
| Build DevKit | Compiles `enterprise/dev-kit` TypeScript to `dist/` |
| Validate components | `node dist/cli.js validate --all --level 2 --verbose` |

Artifact on failure: `typecheck-results` (typecheck log)

---

### Stage 1b — `dify-compat`: Dify Compatibility Check

**Runs on:** commits containing `[dify-upgrade]` in push message or PR title, or manual dispatch  
**Needs:** `validate`  
**Timeout:** 10 minutes  
**Services:** PostgreSQL 15 (in-runner)

| Step | Description |
|---|---|
| Verify DIFY_VERSION | Checks `DIFY_VERSION` file matches actual submodule SHA; exits 1 if they differ |
| Version-bounds + contract tests | `bash scripts/check-dify-compat.sh` — runs version range checks and contract tests against live Postgres |

**How to trigger:** include `[dify-upgrade]` in your commit message (push) or PR title when updating the Dify submodule.

---

### Stage 2 — `test-unit`: Unit Tests

**Runs on:** all commits (unless `skip_tests=true`)  
**Needs:** `validate`  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Start Ollama | Pulls `llama3.2:3b` for local LLM testing (no OpenAI cost) |
| Run tests | Jest with `--coverage`, `USE_LOCAL_LLM=true` |
| Coverage check | Fails if statement coverage < 60% |

Artifact: `coverage-report` (LCOV + JSON summary)

**Local equivalent:**
```bash
USE_LOCAL_LLM=true make devkit-test
```

---

### Stage 3 — `security`: Security Scan

**Runs on:** all commits  
**Needs:** `validate`  
**Timeout:** 10 minutes

| Step | Description |
|---|---|
| npm audit (DevKit) | High-severity dependency vulnerabilities |
| npm audit (tool-service) | High-severity dependency vulnerabilities |
| TruffleHog | Secret scanning (verified secrets only) |
| CodeQL SAST | Static analysis (javascript-typescript) |
| License check | Blocks GPL-2.0, GPL-3.0, AGPL-3.0 dependencies |
| .env.example hygiene | Fails if hardcoded secrets detected |

Artifact: `license-report` (30-day retention)

> All security steps use `continue-on-error: true` to collect results without blocking; failures are surfaced as warnings in the security events tab.

---

### Stage 3b — `container-security`: Container Scan + SBOM

**Runs on:** non-PR pushes only (after `build`)  
**Needs:** `build`  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Trivy (tool-service) | CRITICAL/HIGH CVE scan → SARIF |
| Trivy (mcp-wechat) | CRITICAL/HIGH CVE scan → SARIF |
| Upload SARIF | Uploaded to GitHub Security tab |
| Syft SBOM (tool-service) | Generates SPDX-JSON SBOM |

Artifact: `sbom-<sha>` (90-day retention)

---

### Stage 4 — `build`: Build Docker Images

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

**Outputs:**
- `tool-service-image` — full image tag
- `mcp-wechat-image` — full image tag
- `image-digest` — tool-service digest (for container-security stage)

**Required secrets:** `GITHUB_TOKEN` (auto-provided)

---

### Stage 5 — `deploy-staging`: Deploy to Staging

**Runs on:** push to `main`, or manual dispatch with `deploy_env=staging`  
**Needs:** `build`  
**Environment:** `staging` (URL: `https://staging.dify.internal`)  
**Timeout:** 15 minutes

| Step | Description |
|---|---|
| Build DevKit | Fresh build for deployment |
| Deploy components | Validate (level 3) + deploy all `enterprise/components/*.yml` |
| ArgoCD sync | Syncs `aidevops-staging` app (optional, skips if not configured) |
| Record event | Posts to Harness webhook (optional) |

**Required secrets:**
| Secret | Purpose |
|---|---|
| `STAGING_DIFY_BASE_URL` | Staging Dify API endpoint |
| `STAGING_DIFY_API_KEY` | Staging Dify API key |
| `ARGOCD_TOKEN` | ArgoCD authentication (optional) |
| `ARGOCD_SERVER` | ArgoCD server address (optional) |
| `HARNESS_WEBHOOK_URL` | Harness deployment event webhook (optional) |

---

### Stage 6 — `integration-tests`: Integration Tests

**Runs on:** after `deploy-staging` (unless `skip_tests=true`)  
**Needs:** `deploy-staging`  
**Timeout:** 20 minutes

Runs integration test suite (`npm run test:integration`) against the staging Dify instance.

> Currently graceful — outputs a warning if integration tests are not yet configured.

Artifact: `integration-test-results`

---

### Stage 7 — `deploy-production`: Deploy to Production

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
| Slack notification | Posts success/failure to `#deployments` channel |

**Required secrets:**
| Secret | Purpose |
|---|---|
| `PROD_DIFY_BASE_URL` | Production Dify API endpoint |
| `PROD_DIFY_API_KEY` | Production Dify API key |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook (optional) |

> **HITL Gate:** The `production` GitHub environment must have required reviewers configured. The workflow pauses for approval before executing deployment steps.

---

## Manual Trigger (workflow_dispatch)

Navigate to **Actions → Agent Workflow CI/CD → Run workflow**.

| Input | Type | Default | Description |
|---|---|---|---|
| `deploy_env` | choice | `staging` | Target environment (`staging` or `production`) |
| `skip_tests` | boolean | `false` | Skip unit + integration tests for emergency deploys |

**To deploy to production:**
1. Ensure changes are on `main` branch
2. Trigger workflow with `deploy_env=production`
3. Approve the deployment in the GitHub environment gate

**Emergency deploy (skip tests):**
```
deploy_env=staging, skip_tests=true
```

---

## Required Repository Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Required For | Notes |
|---|---|---|
| `STAGING_DIFY_BASE_URL` | deploy-staging | e.g. `https://staging.dify.internal` |
| `STAGING_DIFY_API_KEY` | deploy-staging | Dify console API key for staging |
| `PROD_DIFY_BASE_URL` | deploy-production | e.g. `https://dify.internal` |
| `PROD_DIFY_API_KEY` | deploy-production | Dify console API key for production |
| `CI_POSTGRES_PASSWORD` | dify-compat | Optional — defaults to `ci-only-test-password` if not set |
| `ARGOCD_TOKEN` | deploy-staging | Optional — ArgoCD auth token |
| `ARGOCD_SERVER` | deploy-staging | Optional — ArgoCD server address |
| `HARNESS_WEBHOOK_URL` | deploy-staging | Optional — Harness CD webhook |
| `SLACK_WEBHOOK_URL` | deploy-production | Optional — Slack notifications |

---

## Trigger Conditions

| Event | validate | dify-compat | test-unit | security | build | deploy-staging | deploy-production |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| PR → main | ✓ | — | ✓ | ✓ | — | — | — |
| PR → main + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| push → main | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| push → main + `[dify-upgrade]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| push → claude/\*\* | ✓ | — | ✓ | ✓ | ✓ | — | — |
| manual (staging) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| manual (production) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| manual + skip_tests | ✓ | ✓ | — | ✓ | ✓ | ✓ | — |

---

## Artifacts Summary

| Artifact | Stage | Retention |
|---|---|---|
| `typecheck-results` | validate (on failure) | default |
| `coverage-report` | test-unit | default |
| `license-report` | security | 30 days |
| `sbom-<sha>` | container-security | 90 days |
| `integration-test-results` | integration-tests | default |

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

# Stage 5: deploy to staging
DIFY_BASE_URL=<url> DIFY_API_KEY=<key> node dist/cli.js deploy <component>
```

---

## Troubleshooting

**Validate fails — typecheck errors**
- Download the `typecheck-results` artifact for the full log
- Run `npm run typecheck` locally and fix errors before pushing

**test-unit fails — Ollama not ready**
- Ollama needs ~15s startup; the pipeline `sleep 15` accounts for this
- If `llama3.2:3b` pull fails, tests fall back to mock LLM (non-blocking)

**Coverage below 60%**
- Add tests covering new code paths
- Check `coverage-report` artifact for line-level coverage details

**deploy-staging fails — ArgoCD sync timeout**
- ArgoCD sync is non-blocking (`|| echo "ArgoCD not configured, skipping"`)
- Check ArgoCD dashboard separately at `$ARGOCD_SERVER`

**deploy-production stuck on approval**
- Go to **Actions → (run) → deploy-production → Review deployments**
- Approve or reject from the GitHub UI
