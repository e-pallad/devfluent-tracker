# CLAUDE.md

> **This is NOT the Next.js you know.** This version has breaking changes — APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3.7 (Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase PostgreSQL (project: `phigbihrgojcyebymwcw`, region: `eu-west-1`) |
| ORM | Prisma 7.6.0 |
| Auth | Supabase magic link (passwordless email OTP) via `@supabase/ssr` |
| Package manager | npm (Bun-compatible locally) |
| Runtime | Node 24 / npm 11 (Dockerfile uses `node:24-alpine`) |

---

## caveman

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current

---

## Breaking Changes

### Next.js 16
- `middleware.ts` is **deprecated** — use `proxy.ts` with `export function proxy(req)` instead
- Dynamic route `params` are **Promises** — always `await params` before accessing fields
- App Router only — no `pages/` directory

### Prisma 7
- `url`/`directUrl` are **NOT** in `prisma/schema.prisma` — they live in `prisma.config.ts` under `datasource.url`
- `prisma.config.ts` uses `defineConfig` from `"prisma/config"`
- Import generated client as `from "@/app/generated/prisma/client"` (not `from "@/app/generated/prisma"`)
- `PrismaClient` **requires** a driver adapter: `new PrismaPg({ connectionString: process.env.DATABASE_URL! })` from `@prisma/adapter-pg`
- Migrations cannot run from WSL against port 5432 — use the `supabase_apply_migration` MCP tool instead

### Supabase DB
- Project ref: `phigbihrgojcyebymwcw`
- `DATABASE_URL` (runtime): pooler pgbouncer `aws-0-eu-west-1.pooler.supabase.com:6543`
- `DIRECT_URL` (migrations): pooler session `aws-0-eu-west-1.pooler.supabase.com:5432`
- DB password in `.env` as `DB_PASSWORD` — **never commit**

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase pooler (pgbouncer, port 6543) — runtime |
| `DIRECT_URL` | Supabase pooler (session, port 5432) — migrations only |
| `DB_PASSWORD` | Raw DB password — never commit |
| `ANTHROPIC_API_KEY` | AI recommendations widget (`claude-haiku-4-5-20251001`) |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `NEXT_PUBLIC_APP_URL` | Full app URL (e.g. `https://devfluent.de`) — used for GitHub OAuth callback |
| `STRIPE_SECRET_KEY` | Stripe secret API key — never commit |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_…`) — never commit |
| `STRIPE_PRICE_MONTHLY_ID` | Stripe Price ID for monthly Pro plan (`price_…`) |
| `STRIPE_PRICE_ANNUAL_ID` | Stripe Price ID for annual Pro plan (`price_…`) |
| `STRIPE_PRICE_LIFETIME_ID` | Stripe Price ID for lifetime plan (optional one-time purchase) |
| `ENCRYPTION_KEY` | Optional, 64 hex chars — AES-256-GCM encryption of stored GitHub tokens (`lib/encryption.ts`); legacy plaintext tokens still work |

---

## Branching & PR Convention

**Always branch from `origin/master` — never from a local branch that may be ahead of origin.**

```bash
# Correct workflow for every new branch/PR:
git fetch origin
git checkout -b feature/my-feature origin/master
# ... make changes and commits ...
git push -u origin feature/my-feature
gh pr create --base master --head feature/my-feature
```

- One feature / fix / chore per branch.
- Branch naming: `feature/`, `fix/`, `chore/`, `docs/` prefix.
- Never commit directly to `master`; all changes go through a PR.

---

## Development Commands

```bash
npm run dev                       # Start dev server (Turbopack) at http://localhost:3000
npm run build                     # Production build
npm run lint                      # ESLint
npm run review                    # Self-review staged changes before committing
npm run review:branch             # Self-review all changes on current branch vs master
npx prisma generate               # Regenerate Prisma client after schema changes
npx prisma migrate dev            # Create + apply migration (requires DIRECT_URL, not from WSL)
node scripts/validate-curriculum.js  # Validate all curriculum JSON files
```

> The `prepare` script installs the pre-push hook — guarded with `[ -d .git ]` so it's skipped in Docker/CI.

---

## App Structure

Route groups under `app/`:
- `(auth)/` — unauthenticated: `/login`, `/offline`
- `(dashboard)/` — protected: `/dashboard`, `/learning`, `/roadmap`, `/training`, `/projects`, `/progress`, `/settings`, `/settings/upgrade`
- `api/` — REST endpoints for progress tracking and user data

Key library files:
- `lib/prisma.ts` — PrismaClient singleton (uses `@prisma/adapter-pg`)
- `lib/user.ts` — `getCurrentUser`, `awardXP`, `revokeXP`, `lockUser`, `updateStreak`, `checkAchievements`
- `lib/http.ts` — `readJson(req)` (null on malformed body → routes return 400)
- `lib/xp.ts` — XP values, level thresholds, achievement definitions (single source of truth)
- `lib/roadmap.ts` — roadmap.sh API integration with 24-hour cache + local JSON fallback
- `lib/supabase/server.ts` / `client.ts` — Supabase SSR/client helpers
- `lib/subscription.ts` — `getUserTier()`, `isPro()`, `getFeatureFlags()`, `isFeatureAvailable()`
- `lib/stripe.ts` — Stripe client singleton (API v2025-03-31.basil)
- `lib/demo.ts` — `DEMO_SESSION_COOKIE`, `DEMO_USER_ID`, `hasDemoSession()`, `isDemoUser()`, `createDemoUser()`
- `lib/i18n/config.ts` — locale list (`en`, `de`), `LOCALE_COOKIE`, `DEFAULT_LOCALE`
- `content/curriculum/index.ts` — Curriculum loader; exports `CURRICULUM`, `TRACKS`, `getTrackById()`
- `content/curriculum/tracks/javascript/month-01..12.json` — Per-month JSON curriculum files
- `content/curriculum/types.ts` — Shared TypeScript interfaces for curriculum data
- `proxy.ts` — Auth guard replacing `middleware.ts`; also sets `NEXT_LOCALE` cookie via `Accept-Language` detection

Generated code: `app/generated/prisma/` — **never edit directly.**

### PUBLIC_PATHS in `proxy.ts`
`/`, `/login`, `/impressum`, `/datenschutz`, `/offline`, `/sw.js`, `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, `/api/auth` (prefix match), `/api/webhooks/stripe` — all must be publicly accessible.

`DEMO_ALLOWED_PATHS`: `/dashboard`, `/learning`, `/api/ai/recommendations`, `/api/accountability`, `/api/progress/block` — demo users are redirected to `/dashboard` if they access any other path.

### API Patterns
- Course/project/profile: action-based POST `{ action: "create"|"update"|"delete", ...data }`
- Quiz: direct POST `{ blockId: string, score: number, answers?: Record<string, number> }`
- AI recommendations: GET (cached, 24h TTL) / POST (force-refresh)
- GitHub sync: POST (sync events + award XP) / DELETE (disconnect)

### API Routes (newer)

| Route | Purpose |
|---|---|
| `api/ai/recommendations` | AI coach (Pro-only, 403 otherwise) — personalised suggestions via `claude-haiku-4-5-20251001`, cached 24h in `AiRecommendation`; failed regeneration serves the previous result |
| `api/accountability` | Pro-only. Mutual consent: POST invites by email (uniform response, no enumeration); GET returns the partner only once both users added each other, plus `incoming` requests; DELETE unlinks all (no Pro check) or `?requestId=` declines one |
| `api/user/api-key` | Generate / regenerate / revoke `df_`-prefixed VS Code extension API keys |
| `api/user/stats` | GET aggregated user stats (blocks, roadmap, courses, achievements, tier, XP progress) |
| `api/auth/github` | GitHub OAuth initiation (CSRF state cookie) |
| `api/auth/github/callback` | GitHub OAuth callback — token exchange + username fetch |
| `api/auth/demo` | POST sets demo session cookie (1-week TTL); DELETE clears it |
| `api/github/sync` | Sync last 30 days of GitHub events + award XP idempotently |
| `api/stripe/checkout` | Create Stripe Checkout session; validates `priceId` against env vars; supports `subscription` and `payment` modes |
| `api/stripe/portal` | Create Stripe Customer Portal session for self-service plan management |
| `api/webhooks/stripe` | Public webhook handler; handles `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`; all DB writes atomic via `prisma.$transaction` |

---

## Database Models (key additions)

| Model | Key fields | Notes |
|---|---|---|
| `User` | `dailyGoalBlocks` (default 3), `weeklyGoalBlocks` (default 10), `track` (default `"javascript"`), `githubUsername`, `githubAccessToken`, `githubLastSyncAt`, `apiKey @unique`, `subscriptionTier` (default `FREE`) | Multi-user ready; `subscriptionTier` is a fallback — prefer `Subscription` row |
| `AiRecommendation` | `userId @unique`, cached JSON, `updatedAt` | 1 row per user; 24h TTL checked at request time |
| `AccountabilityPair` | `userId`, `partnerId` | Bidirectional link |
| `GithubEvent` | `(userId, eventId) @unique` | Deduplication table for idempotent XP awards |
| `Subscription` | `userId @unique`, `tier` (`SubscriptionTier`), `status` (`SubscriptionStatus`), `stripeCustomerId @unique`, `stripeSubId @unique`, `currentPeriodEnd`, `cancelAtPeriodEnd` | Enums: `SubscriptionTier` = FREE/PRO/LIFETIME; `SubscriptionStatus` = ACTIVE/CANCELLED/PAST\_DUE/TRIALING |

---

## XP System

Defined in `lib/xp.ts` — single source of truth.

| Action | XP |
|---|---|
| Complete block | 10 |
| Complete block (with Pomodoro) | 15 |
| Daily login | 5 |
| 7-day streak bonus | 10 |
| 30-day streak bonus | 25 |
| Roadmap topic | 10 |
| Roadmap subtopic | 5 |
| Add course | 10 |
| Complete course | 50 |
| Complete project | 100 |
| Skip block | 1 |
| Quiz attempt (any score) | 3 |
| Quiz pass (score ≥ 70%) | +12 (stacks) |
| Quiz perfect (score 100%) | +25 (stacks) |
| GitHub push | 5 |
| GitHub PR opened | 10 |
| GitHub PR merged | 20 |

### `lib/user.ts` Exports

| Export | Description |
|---|---|
| `getCurrentUser()` | Supabase auth, then demo session; upserts user on first login (race-safe); React `cache`d per request |
| `awardDailyLoginXP(userId)` | Awards 5 XP at most once per calendar day |
| `awardXP(userId, amount, { db? })` | Atomic increment + level update; accepts optional transaction client |
| `revokeXP(userId, amount, { db? })` | Takes XP back (clamped at 0), recalculates level; used when a course is deleted |
| `lockUser(db, userId)` | `SELECT … FOR UPDATE` on the user row — first statement of every check-then-award transaction |
| `updateStreak(userId)` | Updates streak; awards streak bonuses idempotently via achievement records |
| `checkAchievements(userId)` | Unlocks achievements with `createMany({ skipDuplicates: true })` — concurrent-safe |

### Concurrency & Data Integrity
All XP-awarding routes wrap `lockUser` → check → upsert → `awardXP` in a single `prisma.$transaction(...)`. The row lock matters: under READ COMMITTED two concurrent requests would otherwise both pass the "not yet awarded" check. `awardXP` accepts a `db` param (`Omit<PrismaClient, "$connect" | ...>`) to participate in the caller's transaction.

**XP is paid once per item** — toggling status must never re-award:
- Blocks / roadmap nodes / projects / courses: `completedAt` is set on first completion and never cleared; it marks "completion XP paid".
- Block skip XP: only if the block never earned XP. Quiz: try XP on first attempt, pass/perfect bonuses on first pass/perfect per quiz.
- Roadmap: `roadmapId` must be in `AVAILABLE_ROADMAPS`, `nodeId` must exist in the roadmap source; node type comes from the source.
- Course delete revokes the course's `xpEarned`.
- Achievements / GitHub events: `createManyAndReturn({ skipDuplicates })` — only rows actually inserted pay out.

`DailyLog.blocksCompleted` must be incremented **inside** the same `$transaction` when a block is marked COMPLETE — this powers the daily/weekly goal progress bars.

---

## Features

### PWA
- `app/manifest.ts` — web app manifest (standalone mode, indigo theme, shortcuts to `/` and `/learning`)
- `public/sw.js` — service worker; pre-caches `/offline`, intercepts **only** `navigate`-mode requests, falls back to offline page
- `app/offline/page.tsx` — shown when connectivity is lost
- `Cache-Control: no-cache` on `sw.js` so users always get the latest worker

### Multi-track Curriculum
- Curriculum split into per-month JSON files under `content/curriculum/tracks/javascript/`
- `content/curriculum/index.ts` exports `CURRICULUM` (backward compat), `TRACKS`, `getTrackById()`
- `User.track` field selects active track; default `"javascript"`; Python stub track ready for contributions
- Validate with `node scripts/validate-curriculum.js` (checks IDs, quiz structure, duplicates)

### Daily/Weekly Goals
- `User.dailyGoalBlocks` (default 3) and `User.weeklyGoalBlocks` (default 10)
- Dashboard shows progress bars; turns green at goal
- Settings: validated server-side (daily 1–20, weekly 1–100)

### GitHub Activity Sync
- GitHub OAuth app required; set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`
- Syncs last 30 days of push + PR events; idempotent via `GithubEvent` deduplication table
- OAuth CSRF protected via state cookie

### AI Recommendations
- `ANTHROPIC_API_KEY` required; widget renders `null` gracefully when key is absent
- Calls `claude-haiku-4-5-20251001` with user's level, XP, streak, block progress, quiz scores
- Results cached 24h in `AiRecommendation`; POST to force-refresh

### Body-Double Mode
- Supabase Realtime presence on `body-double` channel — anonymous headcount only
- Component cleans up channel on unmount

### Freemium Tier System
- Tiers: FREE, PRO, LIFETIME — resolved by `getUserTier()` in `lib/subscription.ts` (checks `Subscription` row, falls back to `User.subscriptionTier`, defaults to FREE)
- Pro-gated features: Focus sounds, AI recommendations, Accountability partner, Analytics heatmap
- Server-side enforcement: `api/ai/recommendations` and `api/accountability` (except DELETE) return 403 for FREE; their widgets don't fetch for FREE users
- `getUserTier`: a `Subscription` row is authoritative when present; `User.subscriptionTier` is only a fallback when no row exists
- Free for all: Pomodoro timer, Streak freeze, Body-double mode
- UI: `ProBadge` and `ProFeatureGate` components gate UI elements
- `getFeatureFlags(tier)` returns a typed object of booleans for each feature

### Stripe Payments
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY_ID`, `STRIPE_PRICE_ANNUAL_ID`, `STRIPE_PRICE_LIFETIME_ID`, `STRIPE_WEBHOOK_SECRET` all required
- Checkout: POST `/api/stripe/checkout` with `{ priceId }`; sets `metadata.userId` so the webhook can resolve the user without an extra DB lookup
- Portal: POST `/api/stripe/portal` returns a Customer Portal URL for self-service management
- Webhook at `/api/webhooks/stripe` (must remain in `PUBLIC_PATHS`) handles the full subscription lifecycle
- Lifetime checkout (payment mode) sets `customer_creation: "always"` — otherwise `session.customer` is null; existing `stripeCustomerId` is reused on re-checkout
- API version `2025-03-31.basil`: `current_period_end` lives on `subscription.items.data[0]`, not the subscription
- Webhook mirrors the *effective* tier onto `User.subscriptionTier` (FREE while past due/cancelled); LIFETIME rows are never downgraded by subscription events
- Upgrade UI: `/settings/upgrade`; `/settings/upgrade/success` polls for tier activation after checkout

### Demo Mode
- POST `/api/auth/demo` sets a `demo_session=1` cookie (1-week TTL); DELETE clears it
- `lib/demo.ts` exports `hasDemoSession()`, `isDemoUser()`; `getCurrentUser()` checks the demo cookie before Supabase auth
- Demo user has pre-seeded stats (180 XP, Level 2, 4-day streak) for exploring the app without signing up
- Proxy enforces `DEMO_ALLOWED_PATHS` whitelist; all other paths redirect to `/dashboard`

### Hyperfocus Mode
- `components/learning/hyperfocus-mode.tsx` — CSS-only fullscreen; toggles class `"hyperfocus"` on `document.documentElement` to suppress sidebar and nav via CSS
- Opt-in per session; ESC exits; 3-second onboarding hint on first use; no modals, no data loss

### Localisation (i18n)
- Supported locales: `en` (default), `de` — defined in `lib/i18n/config.ts`
- `proxy.ts` detects locale from `Accept-Language` header on first visit and writes a `NEXT_LOCALE` cookie (1-year TTL)
- Dictionaries: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/de.ts`

### Focus Sounds (PomodoroTimer)
- Web Audio API — no external files; 4 sounds: white noise, brown noise, rain, ocean
- Audio suspends/resumes with timer state; rain LFO modulates a tremolo GainNode
- Shrinking pie visual timer replaces/complements the digit countdown
- 2-minute transition warning alert before session ends

---

## Security Patterns

- **Auth callback**: `next` redirect param validated as relative path (starts with `/`, not `//`) — prevents open redirect
- **Block progress**: `status` validated against allowlist; `minutesSpent` sanitized to non-negative integer
- **Roadmap route**: `roadmapId`/`nodeId` validated against the roadmap source; node type taken from the source, never the client
- **Profile PATCH**: `name` enforced as string ≤ 100 characters
- **Streak bonuses**: awarded at most once per milestone via achievement record check
- **Quiz route**: `score` validated as integer 0–100; each XP part paid once per quiz; wrapped in `prisma.$transaction`
- **Accountability**: mutual consent; no partner data or account existence revealed before both users add each other
- **GitHub tokens**: encrypted at rest in both OAuth flows when `ENCRYPTION_KEY` is set
- **GitHub OAuth**: CSRF state cookie validated on callback
- **GitHub sync XP**: idempotent via `(userId, eventId)` unique constraint — no double-XP on re-sync

---

## Pre-push Checks (`scripts/pre-push-check.sh`)

Runs automatically on every push. Blocks on:
1. `awardXP` call outside a `$transaction` — prevents double-XP on concurrent requests
2. `getCurrentUser` without a 401 guard — catches accidentally public API routes
3. Unawaited route `params` — catches Next.js 16 breaking change (`params` is a Promise)

Warns (non-blocking) on:
4. `DailyLog.upsert` that updates `xpEarned` but not `blocksCompleted` — goal bars may not update

---

## Testing

```bash
docker compose -f compose.test.yml up -d   # Start test DB (port 5433)
npm test                                    # Run all tests
npm run test:watch                          # Watch mode
npm run test:coverage                       # Coverage report
docker compose -f compose.test.yml down    # Tear down test DB
```

- Test DB: `devfluent_test` on port **5433**; schema pushed via `prisma db push --force-reset` in `vitest.globalSetup.ts`
- Connection string in `.env.test` (gitignored): `DATABASE_URL=postgresql://postgres:test@localhost:5433/devfluent_test`
- **Isolation**: each test file owns a dedicated test user; `beforeEach` resets mutable fields and related records; `afterAll` deletes the user
- **Auth mock**: `tests/setup.ts` mocks `@/lib/supabase/server`; use `setTestUserId(id)` / `null` (→ 401)

---

## Deployment

### Docker (local / TrueNAS)

```bash
docker compose build   # Build image (node:24-alpine; passes Supabase public keys as build args)
docker compose up -d   # Run on port 30005 → container 3000, using .env.production
```

### Netcup vServer

One-time setup:

```bash
apt install -y docker.io docker-compose-plugin certbot
systemctl enable --now docker
git clone <repo-url> /opt/devfluent && cd /opt/devfluent
cp .env.production.example .env.production  # fill in all values
./scripts/deploy-netcup.sh your.domain.com  # obtains TLS cert, builds, starts app + nginx
```

Update after code push:

```bash
cd /opt/devfluent && git pull
docker compose -f compose.netcup.yml build
docker compose -f compose.netcup.yml up -d
```

Cert auto-renewal (crontab):
```
0 3 * * * certbot renew --quiet && docker compose -f /opt/devfluent/compose.netcup.yml restart nginx
```

Relevant files: `compose.netcup.yml`, `nginx/netcup.conf`, `scripts/deploy-netcup.sh`

---

## Known Non-Critical Warnings

- `lib/roadmap.ts` dynamic import of `@/content/roadmaps/*.json` produces a Turbopack module-not-found warning — intentional, it's a try/catch fallback returning `[]` on failure