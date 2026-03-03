# Infrastructure — {{PROJECT_NAME}}

> Single source of truth for all external services. UPDATE when anything changes.

## Monthly Cost Summary

| Service | Plan | Cost/month |
|---------|------|-----------|
| {{SERVICE_1}} | {{PLAN}} | $XX |
| {{SERVICE_2}} | {{PLAN}} | $XX |
| **Total** | | **$XX** |

## Services

### {{SERVICE_1}}
- **Plan**: {{PLAN}}
- **Region**: {{REGION}}
- **Dashboard**: {{URL}}
- **Limits**: {{LIMITS}}
- **Env vars**:
  - `{{ENV_VAR_1}}` — {{DESCRIPTION}}
  - `{{ENV_VAR_2}}` — {{DESCRIPTION}}

### {{SERVICE_2}}
...

## Environment Variables

All env vars should be validated in a central env module (e.g., `src/lib/env.ts` with Zod).

```
# .env.example
{{ENV_VAR_1}}=
{{ENV_VAR_2}}=
```

## Monitoring

- **Error tracking**: {{SERVICE}} — {{URL}}
- **Uptime**: {{SERVICE}} — {{URL}}
- **Analytics**: {{SERVICE}} — {{URL}}

## Scale Triggers

| Metric | Current | Trigger | Action |
|--------|---------|---------|--------|
| Database size | {{CURRENT}} | {{LIMIT}} | Upgrade to {{NEXT_PLAN}} |
| Auth users | {{CURRENT}} | {{LIMIT}} | Upgrade to {{NEXT_PLAN}} |
| Storage | {{CURRENT}} | {{LIMIT}} | Switch to {{ALTERNATIVE}} |
