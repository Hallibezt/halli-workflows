---
name: stack-presets
description: Proven stack combinations with configuration templates, dependency lists, and setup instructions. Used during /kickoff to scaffold projects with battle-tested stacks.
---

# Stack Presets

## Preset: Web App (Next.js + Supabase)

**Best for**: SaaS apps, dashboards, content platforms, multi-tenant apps

| Component | Choice | Why |
|-----------|--------|-----|
| Framework | Next.js 15+ (App Router) | Server Components, file-based routing, Vercel deployment |
| Language | TypeScript (strict mode) | Type safety, better tooling |
| Styling | Tailwind CSS v4 | Utility-first, design system friendly |
| Database | Supabase (Postgres) | RLS, Realtime, Auth, Storage in one |
| ORM | Prisma (migrations ONLY) | Schema management. Runtime queries via Supabase client |
| Auth | Supabase Auth | JWT, row-level security, social providers |
| Storage | Supabase Storage | Integrated with auth, RLS on buckets |
| Hosting | Vercel | Edge functions, preview deploys, analytics |
| Validation | Zod | Runtime type checking at API boundaries |
| Testing | Vitest + Playwright | Fast unit tests + E2E |
| Icons | Lucide React | Tree-shakeable, consistent |
| i18n | next-intl | Server Component compatible |

**Key pattern**: Server Components fetch data → pass as props to Client Components. Never fetch from client unless Realtime needed.

**Critical rule**: Prisma = schema + migrations ONLY. Supabase client = ALL runtime queries (respects RLS).

**Directory structure**:
```
src/
  app/                    # Next.js App Router
    api/                  # API routes
      CLAUDE.md           # API patterns context
    (guest)/              # Guest-facing pages
    (dashboard)/          # Owner dashboard
  components/             # React components
    CLAUDE.md             # Component patterns context
  hooks/                  # Custom hooks
  lib/                    # Utilities, clients
    utils/                # Helper functions
    env.ts                # Validated env vars (Zod)
  types/                  # TypeScript interfaces
docs/
  plans/                  # Roadmap, backlog, tasks
  design/                 # Design docs
  adr/                    # Architecture decisions
  prd/                    # Product requirements
```

**Dependencies** (package.json):
```json
{
  "dependencies": {
    "next": "^15.0.0",
    "@supabase/supabase-js": "^2.0.0",
    "@supabase/ssr": "^0.5.0",
    "zod": "^3.0.0",
    "lucide-react": "^0.400.0",
    "next-intl": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tailwindcss": "^4.0.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.0.0",
    "prisma": "^6.0.0"
  }
}
```

---

## Preset: Mobile App (Expo + React Native)

**Best for**: iOS/Android apps, consumer apps, location-based services

| Component | Choice | Why |
|-----------|--------|-----|
| Framework | Expo (SDK 52+) | Managed workflow, EAS Build, OTA updates |
| Language | TypeScript (strict) | Same as web, shared types possible |
| Navigation | Expo Router (file-based) | Consistent with Next.js mental model |
| State | Zustand + React Query | Light, performant, query caching |
| Maps | Mapbox GL (react-native-mapbox-gl) | Better customization than Google Maps |
| Payments | RevenueCat | Cross-platform subscriptions |
| Auth | Supabase Auth | Consistent with web stack |
| Push | Expo Notifications | FCM/APNS abstraction |
| i18n | Custom hook + JSON | CJK-aware (character width measurement) |
| Testing | Jest + Detox | Unit + E2E |
| Build | EAS Build + EAS Submit | Cloud builds, store submission |

**Key patterns**:
- Offline-first (AsyncStorage queue, sync on reconnect)
- Battery-conscious (batch requests, reduce GPS polling)
- Optimistic mutations (update UI → send to server → rollback on error)
- Platform-specific code via `Platform.OS` and `Platform.select()`

**Directory structure**:
```
app/                      # Expo Router file-based routes
  (tabs)/                 # Tab navigation
  (auth)/                 # Auth screens
src/
  components/             # React Native components
  hooks/                  # Custom hooks
  stores/                 # Zustand stores
  services/               # API clients
  utils/                  # Helpers
  i18n/                   # Translation files
  types/                  # TypeScript types
```

---

## Preset: API Service (Hono)

**Best for**: REST APIs, microservices, serverless functions, data APIs

| Component | Choice | Why |
|-----------|--------|-----|
| Framework | Hono | Ultra-light, multi-runtime (Node, Bun, Edge) |
| Language | TypeScript | Type safety |
| Hosting | Railway or Fly.io | Easy deploy, auto-scaling, affordable |
| Auth | API key + rate limiting | Simple, stateless |
| Caching | node-cache or Redis | In-memory for small, Redis for distributed |
| Validation | Zod | Same as web stack |
| Testing | Vitest | Fast, compatible |
| Docs | OpenAPI/Swagger | Auto-generated from Zod schemas |

**Key patterns**:
- Middleware chain: CORS → auth → rate limit → validate → handler
- Response envelope: `{ data: T, error: null }` or `{ data: null, error: { code, message } }`
- Health check endpoint: `GET /status`
- Version prefix: `/v1/`

**Directory structure**:
```
src/
  routes/                 # Route handlers
  middleware/             # Auth, rate limit, CORS
  services/              # Business logic
  types/                 # TypeScript types
  utils/                 # Helpers
  index.ts               # Entry point
```

---

## Preset: Monorepo (Turborepo)

**Best for**: Multiple apps sharing code (web + mobile + API + shared packages)

| Component | Choice | Why |
|-----------|--------|-----|
| Build | Turborepo | Parallel builds, caching, task orchestration |
| Workspaces | npm workspaces | Native Node.js, no extra tooling |
| Structure | apps/ + packages/ | Clear separation |

**Directory structure**:
```
apps/
  web/                    # Next.js app
  mobile/                 # Expo app
  api/                    # Hono API
packages/
  shared-types/           # Shared TypeScript types
  config/                 # Shared configs (tsconfig, eslint)
  ui/                     # Shared UI components (if applicable)
turbo.json               # Turborepo config
package.json             # Root workspace config
```

**Key patterns**:
- Workspace dependencies: `"@myproject/shared-types": "workspace:*"`
- Shared tsconfig extends
- Root-level scripts: `turbo run build`, `turbo run test`

---

## Choosing a Preset

| If you're building... | Use |
|----------------------|-----|
| Web app only | Web (Next.js) |
| Mobile app only | Mobile (Expo) |
| Backend API only | API (Hono) |
| Web + API | Monorepo or Web with API routes |
| Mobile + API | Monorepo (mobile + api) |
| Web + Mobile + API | Monorepo (all three) |
