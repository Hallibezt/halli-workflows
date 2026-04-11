# Complexity Smell Patterns

Patterns that identify when bolting on infrastructure layers signals the wrong
foundational choice. Each smell represents compounding cost that the right foundation
would have eliminated.

## Infrastructure Smells

### Adding Redis for pub/sub
In Node/Python/Ruby, broadcasting across server instances requires Redis.
In Elixir, Phoenix.PubSub distributes natively using Erlang's `:pg` module.
Just add `libcluster` for node discovery. No Redis, no config, no failure mode.

### Adding Redis for caching
BEAM provides ETS (in-memory concurrent KV store, millions of ops/sec, zero network).
Go offers `sync.Map` and `groupcache`. Any language with true parallelism can do
safe in-process caches. Redis IS correct when cache must survive restarts, span
language boundaries, or exceed available RAM.

### Adding RabbitMQ/Kafka for message queues
BEAM processes ARE message queues — each has a mailbox with selective receive and
natural backpressure. WhatsApp handles 100B+ messages daily on native Erlang message
passing. External brokers are correct for durable replay (Kafka), cross-language
communication, or genuinely different scaling requirements.

### Adding Celery/Bull/Sidekiq for background jobs
In Rails/Django/Node this means adding Redis as infrastructure. Elixir's Oban uses
your existing PostgreSQL — zero new infra. GenServers handle fire-and-forget natively.
Go goroutines with channel-based queues cover most cases.

### Adding WebSocket libraries + Redis scaling
Socket.io/ActionCable + Redis broadcasting + connection state management.
Phoenix Channels handles this natively with clustering. Phoenix Presence tracks
connected users across a cluster using CRDTs — no external state store.

### Adding PM2/systemd for process management
Acknowledges that Node.js processes crash and don't recover. OTP Supervisors restart
child processes in microseconds with configurable strategies.

### Adding Kubernetes for a solo project
AWS EKS control plane alone costs $73/month before worker nodes. A Hetzner CX22
VPS (2 vCPU, 4GB RAM) costs ~€5/month. K8s restarts entire containers (losing state);
OTP restarts individual processes (preserving caches, connections).

## Codebase Smells

### Docker-compose with 5+ services
Each service = another process to monitor, another failure point, another config file.
1-2 services (app + database) is healthy. 3-4 warrants questioning. 5+ demands
re-evaluation of whether a simpler runtime could consolidate.

### Configuration files outnumbering application code
If a typical feature requires changes to 3+ config files (Docker, CI, env vars, K8s
manifests), the infrastructure-to-feature ratio is inverted.

### >30% time on infrastructure
When deploying a simple feature requires building Docker images, pushing to registry,
updating K8s manifests, waiting for rolling updates — and deployment takes 15 minutes
while the code change took 5 — the pipeline has grown disproportionate.

### Codebase exceeding AI comprehension
When AI tools lose context mid-session on your codebase (~50K+ lines), this signals
either need for better organization or that the architecture has grown too coupled.

## Runtime Smells

### Concurrency bugs in single-threaded runtimes
Event loop blocking in Node.js, Python GIL limitations. Writing `worker_threads`
or multiprocessing pools = fighting the runtime. Go/Elixir/Rust handle this natively.

### Memory issues from runtime overhead
JVM baseline 200-500MB, Node.js heap pauses, Python per-object overhead.
Go: ~5MB baseline. Rust: ~1MB. Elixir: ~30-50MB.

### Build times exceeding 5 minutes
Causes context-switching and focus loss. Evaluate whether the language itself is the
bottleneck (Rust compile times are a known pain point).

## Data Modeling Smells

### Adding GraphQL to solve REST over-fetching
Often a data modeling problem, not a protocol problem. Consider sparse fieldsets,
view-specific endpoints, or JSON:API before adding schema management complexity.
GraphQL IS correct when multiple client types have genuinely different data needs.

### Adding TypeScript to fix JavaScript
TypeScript's typing is unsound by design. Microsoft ported the TS compiler from
TypeScript to Go for 10x performance. If starting fresh, a natively typed language
(Go, Rust, Gleam) eliminates the problem at the source. TS IS correct for browser
code and teams already in the JS ecosystem.
