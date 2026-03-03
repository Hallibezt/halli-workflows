---
name: api-patterns
description: API service development patterns — REST design, middleware chains, auth strategies, rate limiting, caching, response envelopes, versioning.
---

# API Development Patterns

## REST API Design

### Resource Naming
- Nouns, not verbs: `/users` not `/getUsers`
- Plural: `/users` not `/user`
- Nested for relationships: `/users/:id/posts`
- Query params for filtering: `/users?role=admin&active=true`

### HTTP Methods
| Method | Purpose | Idempotent | Response |
|--------|---------|-----------|----------|
| GET | Read | Yes | 200 + data |
| POST | Create | No | 201 + created item |
| PATCH | Partial update | Yes | 200 + updated item |
| PUT | Full replace | Yes | 200 + replaced item |
| DELETE | Remove | Yes | 204 no content |

### Status Codes
| Code | When |
|------|------|
| 200 | Success |
| 201 | Created |
| 204 | Deleted (no content) |
| 400 | Bad request (validation) |
| 401 | Not authenticated |
| 403 | Not authorized |
| 404 | Not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited |
| 500 | Server error (never expose details) |

## Response Envelope Pattern

**ALWAYS use a consistent envelope:**

```typescript
// Success
{ "data": T, "error": null }

// Error
{ "data": null, "error": { "code": "VALIDATION_ERROR", "message": "Email is required" } }
```

**Helper functions:**
```typescript
function apiSuccess<T>(data: T, status = 200) {
  return Response.json({ data, error: null }, { status });
}

function apiError(code: string, message: string, status = 400) {
  return Response.json({ data: null, error: { code, message } }, { status });
}
```

**Rules:**
- NEVER return raw database errors to clients
- NEVER return stack traces in production
- Log errors server-side BEFORE returning safe message

## Middleware Chain Pattern

```
Request → CORS → Auth → Rate Limit → Validate → Handler → Response
```

### Auth Middleware
```typescript
async function authMiddleware(req, next) {
  const apiKey = req.header('X-API-Key');
  if (!apiKey || !isValidKey(apiKey)) {
    return apiError('UNAUTHORIZED', 'Invalid API key', 401);
  }
  return next();
}
```

### Rate Limiting
```typescript
// Token bucket or sliding window
const rateLimiter = {
  windowMs: 60 * 1000,  // 1 minute
  max: 100,              // 100 requests per window
};
```

### Validation (Zod)
```typescript
const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

// In handler
const result = schema.safeParse(body);
if (!result.success) {
  return apiError('VALIDATION_ERROR', result.error.issues[0].message, 400);
}
```

## Auth Strategies

| Strategy | Best For | Complexity |
|----------|---------|-----------|
| **API Key** | Server-to-server, simple APIs | Low |
| **JWT** | User sessions, multi-device | Medium |
| **OAuth 2.0** | Third-party integrations | High |
| **Session cookies** | Web apps (same origin) | Low |

### When to Use What
- Public API for developers → API Key
- Mobile app users → JWT (Supabase Auth handles this)
- "Login with Google/GitHub" → OAuth
- Server-side web app → Session cookies

## Caching Strategies

| Strategy | Where | Best For |
|----------|-------|---------|
| **In-memory** (node-cache) | App process | Small datasets, single instance |
| **Redis** | External service | Large datasets, multi-instance |
| **CDN** (Cloudflare) | Edge | Static/semi-static content |
| **HTTP headers** | Client | Browser caching |

### Cache-Control Headers
```
# Immutable assets (images, fonts)
Cache-Control: public, max-age=31536000, immutable

# API responses (short cache)
Cache-Control: public, max-age=60, stale-while-revalidate=300

# Private data (user-specific)
Cache-Control: private, no-cache
```

### Cache Invalidation
- **TTL-based**: Set expiry, accept staleness within window
- **Event-based**: Invalidate on write (more complex, more accurate)
- **Version-based**: Include version in cache key

## Error Handling

### Log, Then Respond
```typescript
try {
  const result = await doSomething();
  return apiSuccess(result);
} catch (error) {
  console.error('[route-name] Error:', error);  // Log WITH context
  return apiError('INTERNAL_ERROR', 'Something went wrong', 500);  // Safe message
}
```

### NEVER Expose
- Database error messages
- File paths
- Stack traces
- Internal service names
- Environment variable values

## API Versioning

| Strategy | URL | Header |
|----------|-----|--------|
| URL prefix | `/v1/users` | Simple, visible, easy to route |
| Header | `Accept: application/vnd.api.v1+json` | Clean URLs, harder to test |

**Recommendation**: URL prefix (`/v1/`) for simplicity. Most APIs use this.

## Health Check Endpoint

Every API should have:
```
GET /status → { "status": "ok", "version": "1.0.0", "uptime": 12345 }
```

Optional deeper health check:
```
GET /health → { "database": "ok", "cache": "ok", "external_api": "degraded" }
```

## CORS Configuration

```typescript
// Be specific about origins in production
cors({
  origin: ['https://myapp.com', 'https://admin.myapp.com'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
});
```

**Never use `origin: '*'` in production** if you need credentials.
