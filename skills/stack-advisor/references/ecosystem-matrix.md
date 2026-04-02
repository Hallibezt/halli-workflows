# Library Ecosystem Reality Check

Rate each capability across five alternative languages.
✅ = mature and feature-complete
🟡 = adequate with limitations
🔴 = missing or poor

| Capability | Elixir | Go | Rust | Gleam | Svelte/JS |
|---|---|---|---|---|---|
| OCR | 🟡 CLI wrapper | 🟡 CGo binding | 🟡 FFI binding | 🔴 | ✅ tesseract.js |
| Bluetooth/BLE | 🔴 | 🟡 tinygo-bluetooth | ✅ btleplug | 🔴 | 🟡 Web Bluetooth |
| Image processing | ✅ libvips via Vix | ✅ imaging/bimg | ✅ image crate | 🔴 | ✅ sharp |
| PDF generation | 🟡 Chrome wrappers | ✅ fpdf/maroto | 🟡 printpdf | 🔴 | ✅ pdfkit/puppeteer |
| Email sending | ✅ Swoosh | ✅ go-simple-mail | ✅ lettre | 🟡 early | ✅ nodemailer |
| Stripe/payments | ✅ stripity_stripe | ✅ official SDK | 🟡 community | 🔴 | ✅ official SDK |
| OAuth/auth | ✅ Ueberauth + gen.auth | ✅ x/oauth2 + casbin | ✅ oauth2 crate | 🔴 | ✅ Auth.js |
| Database ORM | ✅ Ecto (best-in-class) | ✅ GORM/sqlc/ent | ✅ Diesel/SeaORM | 🟡 pog | ✅ Prisma/Drizzle |
| Testing | ✅ ExUnit + StreamData | ✅ testing + testify | ✅ built-in + proptest | 🟡 gleeunit | ✅ Vitest + Playwright |
| Mobile apps | 🟡 LiveView Native (beta) | 🔴 | 🟡 Tauri v2 | 🔴 | 🟡 Capacitor/Tauri |
| ML/data science | ✅ Nx/Bumblebee/Axon | 🟡 gorgonia | ✅ candle/burn/ort | 🔴 | 🟡 TensorFlow.js |
| Geolocation | 🟡 geo/topo | ✅ golang/geo/S2 | ✅ geo crate | 🔴 | ✅ Leaflet/turf.js |
| WebSockets | ✅ Phoenix Channels (native) | ✅ gorilla/websocket | ✅ tungstenite | 🟡 via Erlang | ✅ Socket.io/ws |
| GraphQL | ✅ Absinthe | ✅ gqlgen | ✅ async-graphql | 🔴 | ✅ Apollo/urql |
| HTTP client | ✅ Req/Finch | ✅ net/http (stdlib) | ✅ reqwest | 🟡 gleam_http | ✅ fetch/axios |

## FFI Escape Hatches

| Language | Escape to... | How | Production proof |
|---|---|---|---|
| Elixir | Rust | Rustler (safe NIFs) | Discord uses this in production |
| Elixir | C | Ports (isolated process) | Safe but slower than NIFs |
| Go | C | CGo | Breaks cross-compilation, slows builds |
| Rust | C | Native FFI | Zero overhead |
| Rust | Python | PyO3 | Mature, widely used |
| Gleam | Elixir/Erlang | Direct Hex deps | First-class but loses type safety at boundary |

## Package Registry Sizes (approximate)

| Registry | Packages | Notes |
|---|---|---|
| npm | ~2,000,000+ | Largest by far. Quality varies wildly |
| PyPI | ~500,000+ | Strong in ML/data science |
| crates.io | ~150,000+ | High quality, strong typing |
| Hex.pm | ~15,000+ | Small but curated. Elixir + Erlang |
| pkg.go.dev | ~300,000+ | Go standard library covers a lot |
| pub.dev | ~58,000+ | Dart/Flutter. Growing fast |
