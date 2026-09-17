# Deploying the frontend

This file is a pointer. The frontend is the static build of `frontend/` (`npm run build` → `dist/`); the static host builds it from `main` and no workflow in this repository deploys it. The hosting settings, the manual deploy command (`npm run deploy:pages`), the content-security-policy hash step, release checks and rollback are all in one place:

- [../DEPLOYMENT.md](../DEPLOYMENT.md) — settings, commands, how a release flows
- [../docs/operations.md](../docs/operations.md) — secrets, monitoring, runbooks, rollback

For local development see [README.md](README.md).
