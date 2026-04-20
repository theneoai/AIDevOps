# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| 0.2.x   | No        |
| < 0.2   | No        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities by emailing: **security@theneoai.com**

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

You will receive an acknowledgement within 48 hours. We aim to release a fix within 14 days for critical issues.

## Security Design

### Secrets Management

- All credentials are stored as Docker Secrets (`/run/secrets/`) in production
- Environment variables are accepted as a fallback for local development only
- `.env` files must never be committed (enforced via `.gitignore`)
- CI checks for hardcoded secrets in `.env.example`

### Authentication & Authorization

- All API endpoints require JWT Bearer token authentication
- RBAC enforced with 4 roles: `platform_admin > project_owner > developer > viewer`
- Tokens are verified on every request — no session storage

### Prompt Injection Prevention

The `promptGuard` middleware blocks 10 known injection patterns including:
- "ignore previous instructions"
- "DAN mode" jailbreaks
- Role-play escape attempts
- System prompt exfiltration

Input is limited to 4000 characters at the tool-service boundary.

### PII Protection

- Chinese PII (身份证, 手机号, 银行卡) is detected and anonymized before LLM processing
- Microsoft Presidio handles global PII (names, emails, credit cards)
- Anonymization degrades gracefully if Presidio is unavailable (regex-only mode)

### Supply Chain

- Dify submodule is pinned to a specific SHA (see `DIFY_VERSION`)
- Container images are scanned with Trivy on every CI run
- SBOM generated with Syft and retained for 90 days
- License check blocks GPL/AGPL dependencies

### Network Security

- Kubernetes NetworkPolicy restricts inter-pod traffic to same namespace
- MCP servers expose only `/sse`, `/messages`, `/health`, `/metrics`
- SSE connections use ClientIP session affinity — no cross-session data leakage

## Known Limitations

- The `dify.adapter=db` mode is deprecated and bypasses the API auth layer. Do not use it in production.
- WeChat `access_token` is cached in memory — a process restart requires re-authentication.
