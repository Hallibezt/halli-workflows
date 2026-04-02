# Infrastructure and Deployment Alternatives

## Deployment Platforms for Solo Developers

| Platform | Best for | Cost | Key feature |
|---|---|---|---|
| **Fly.io** | Elixir/Phoenix, edge apps | ~$3.15/mo per VM | Native Phoenix clustering |
| **Hetzner VPS** | Single binary (Go/Rust) | ~€5/mo | Raw VPS, maximum control |
| **Railway** | Fast git-push deploys | $5 trial then pay | Best DX, no free tier |
| **Render** | Predictable billing | $7/mo web services | Generous free tier |
| **Coolify** | Self-hosted PaaS | Free + VPS cost | Heroku alternative, 35K+ stars |
| **Kamal** | Docker on any VPS | Free + VPS cost | 37signals' deployment tool |
| **Cloudflare Workers** | Edge compute, APIs | Free 100K req/day | Sub-5ms cold starts |
| **Vercel** | Next.js, SvelteKit | Free tier available | Best DX for JS frameworks |

## The $6/month Production Stack

For Go or Rust single-binary projects:
- Hetzner CX22 (2 vCPU, 4GB RAM): ~€5/month
- Caddy (auto-TLS, zero config): included
- SQLite + Litestream (continuous S3 backup): ~$0.50/month R2 storage
- Total: **~€5.50/month** for production with backups

Compare: AWS EKS control plane alone = $73/month before worker nodes.

## Caddy vs Nginx

**Caddy** replaces Nginx with auto-TLS in 3 lines:
```
example.com {
    reverse_proxy localhost:3000
}
```

Equivalent Nginx: 30+ lines (Certbot, SSL paths, cipher suites, renewal cron).
Caddy manages 50M+ certificates in production. Automatic Let's Encrypt provisioning,
renewal, and OCSP stapling with zero configuration.

## Tailscale

Mesh VPN on WireGuard. Install on any device, authenticate, encrypted peer-to-peer
tunnels. No port forwarding, no firewall rules. SSH into VPS without exposing port 22.
Free for up to 100 devices.

## Database Alternatives

| Database | Best for | Free tier | Key advantage |
|---|---|---|---|
| **SQLite + Litestream** | Solo projects, budget | $0.50/mo backup | Microsecond latency, zero infra |
| **Turso** | Edge-distributed SQLite | 5GB, 500M reads | Best free tier |
| **Supabase** | Full-stack with auth | 2 projects, 500MB | Postgres + auth + storage + realtime |
| **Neon** | Serverless Postgres | 20 projects, 0.5GB | True scale-to-zero, branch cloning |
| **PocketBase** | Prototyping, indie apps | Self-hosted | Single Go binary, admin UI |

**SQLite is not a toy.** Processes more queries/day than every other DB engine combined.
Microsecond latency (local function call). WAL mode for concurrent readers.
Tens of thousands of write TPS on NVMe.

**Use Postgres when**: concurrent multi-server writes, PostGIS, complex distributed
transactions, row-level security, pgvector for AI features.

## SaaS Services

### Email
- **Resend**: 3K emails/month free. Best DX. SDKs for Node, Python, Go, Elixir.
- **Amazon SES**: $0.10/1K emails. 10x cheaper at scale but build your own dashboard.
- SendGrid retired free tier May 2025.

### Auth
- **Better Auth**: Open-source, Y Combinator backed, 26K+ stars. Free forever.
- **Clerk**: Best zero-config. $25/month after 10K MAUs.
- **Logto**: Enterprise-grade (SSO, SAML). Free self-hosted.
- ⚠️ Lucia Auth deprecated March 2025 — do not use for new projects.

### Analytics
- **Plausible**: Elixir + ClickHouse, €9/month, no cookie consent needed.
- **Umami**: Next.js + Postgres, MIT, free self-hosted, lightest option.

### Background Jobs
- **Trigger.dev**: Open-source, 5K runs/month free.
- **Inngest**: 50K runs/month free, not open-source.
- **Upstash QStash**: HTTP-based, no SDK needed.

### Dev Environments
- **Devbox**: Nix wrapper with JSON interface. No Nix language required.
  `devbox add python@3.10 nodejs@20` — exact tools, native performance, no container.
  80K+ packages. Use for local dev, Docker for deployment.
