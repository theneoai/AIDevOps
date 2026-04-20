## Summary

<!-- 1-3 bullet points describing what this PR does -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI/CD
- [ ] Dependencies

## Test Plan

- [ ] Unit tests pass (`make devkit-test`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Component YAML validates (`dify-dev validate --all`)
- [ ] Manually tested the affected flow

## Security Checklist

- [ ] No secrets or credentials in code or `.env.example`
- [ ] New endpoints protected by `requireRole()` middleware
- [ ] New user inputs pass through `promptGuard`
- [ ] Docker images use non-root user

## Related Issues

Closes #
