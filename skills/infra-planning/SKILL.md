---
name: infra-planning
description: Infrastructure planning knowledge — service comparisons, pricing tiers, scale matrices, and migration paths. Used by infra-planner agent.
---

# Infrastructure Planning Guide

## Scale Tiers

| Tier | Users | Monthly Budget | Characteristics |
|------|-------|---------------|----------------|
| **Hobby** | <100 | $0-20 | Free tiers, single region, no monitoring |
| **Startup** | 100-1K | $20-100 | Basic paid, monitoring, single region |
| **Growth** | 1K-100K | $100-500 | Proper infra, caching, CDN, multi-region prep |
| **Scale** | 100K-1M+ | $500-5000+ | Enterprise, multi-region, CDN, load balancing |

## Service Recommendations by Category

### Hosting / Compute

| Tier | Web (Next.js) | Mobile Backend | API Service |
|------|--------------|----------------|-------------|
| Hobby | Vercel Free | Supabase Free | Railway Hobby ($5) |
| Startup | Vercel Pro ($20) | Supabase Pro ($25) | Railway Pro ($20) |
| Growth | Vercel Pro + Edge | Supabase Pro | Railway Pro / Fly.io |
| Scale | Vercel Enterprise / AWS | Supabase Team / AWS | AWS ECS / K8s |

### Database

| Tier | Recommendation | Cost | Limits |
|------|---------------|------|--------|
| Hobby | Supabase Free | $0 | 500MB, 50K auth users |
| Startup | Supabase Pro | $25/mo | 8GB, unlimited auth |
| Growth | Supabase Pro + read replicas | $25-100/mo | Connection pooling |
| Scale | Supabase Team / RDS / PlanetScale | $100-500/mo | Dedicated compute |

**Alternatives**: Neon (serverless Postgres), PlanetScale (MySQL), Turso (edge SQLite)

### Auth

| Tier | Recommendation | Cost |
|------|---------------|------|
| Hobby | Supabase Auth Free | $0 (50K MAU) |
| Startup | Supabase Auth | Included in Pro |
| Growth | Supabase Auth / Clerk | $25-100/mo |
| Scale | Clerk / Auth0 | $100-500/mo |

### Storage (Files/Images)

| Tier | Recommendation | Cost |
|------|---------------|------|
| Hobby | Supabase Storage Free | $0 (1GB) |
| Startup | Supabase Storage Pro | $25/mo (100GB) |
| Growth | Cloudflare R2 | $0.015/GB (no egress fees) |
| Scale | Cloudflare R2 + CDN | Variable |

### Payments

| Tier | Web | Mobile |
|------|-----|--------|
| All tiers | Stripe | RevenueCat ($0-$99/mo) + Stripe |

Stripe: 2.9% + $0.30 per transaction. RevenueCat: free for <$2.5K MTR.

### Monitoring

| Tier | Recommendation | Cost |
|------|---------------|------|
| Hobby | Sentry Free | $0 (5K events) |
| Startup | Sentry Team | $26/mo |
| Growth | Sentry Business + UptimeRobot | $80+/mo |
| Scale | Datadog / Grafana Cloud | $200+/mo |

**Always have monitoring**, even at Hobby tier. Sentry Free is enough to start.

### Email (Transactional)

| Tier | Recommendation | Cost |
|------|---------------|------|
| Hobby | Resend Free | $0 (100/day) |
| Startup | Resend Pro | $20/mo |
| Growth | Resend / Postmark | $20-50/mo |
| Scale | AWS SES | Variable (cheap) |

### CI/CD

| Tier | Recommendation | Cost |
|------|---------------|------|
| All | GitHub Actions | Free (2000 min/mo) |

## Decision Trees

### When to add Redis
- API response time > 200ms for repeated queries
- Session management needed across instances
- Rate limiting at scale (> 1K RPM)
- Pub/sub needed between services

### When to add a CDN
- Media-heavy content (images, videos)
- Global user base
- Static assets > 100MB
- > 10K MAU

### When to leave Supabase free tier
- Database > 500MB
- > 50K auth users
- Need connection pooling
- Need database backups

### When to add caching layer
- Same data requested > 100 times per minute
- External API rate limits being hit
- Page load > 3 seconds
- Database CPU > 50%

## Migration Path Template

| From | To | Trigger | Effort | Downtime |
|------|-----|---------|--------|----------|
| Supabase Free | Supabase Pro | 500MB DB / 50K users | Easy (toggle) | None |
| Vercel Free | Vercel Pro | Need analytics / team | Easy (toggle) | None |
| Railway Hobby | Railway Pro | Need more memory/CPU | Easy (toggle) | None |
| Single region | Multi-region | >50ms latency complaints | Medium | Planned |
| No CDN | Cloudflare CDN | Media performance | Medium | None |
| In-memory cache | Redis | Multiple instances | Medium | None |

## Cost Estimation Template

```
Monthly Infrastructure Cost Estimate

Tier: [Hobby/Startup/Growth/Scale]

| Service | Plan | Cost |
|---------|------|------|
| Hosting | [service] [plan] | $XX |
| Database | [service] [plan] | $XX |
| Auth | [service] [plan] | $XX |
| Storage | [service] [plan] | $XX |
| Monitoring | [service] [plan] | $XX |
| Email | [service] [plan] | $XX |
| CI/CD | [service] [plan] | $XX |
| Domain | [registrar] | $XX |
| ----------------------------------|
| TOTAL | | $XX/month |

Annual estimate: $XXX
```
