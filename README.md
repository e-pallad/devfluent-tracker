<div align="center">

<img src="public/readme/banner.svg" alt="Devfluent — ADHD-friendly developer learning tracker" width="100%"/>

# Devfluent

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-purple?style=flat-square)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-7.6-2D3748?style=flat-square&logo=prisma)](https://prisma.io)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e?style=flat-square&logo=supabase)](https://supabase.com)

**[Live Demo](https://devfluent.de) · [Quick Start](#quick-start) · [Contributing](CONTRIBUTING.md)**

</div>

---

You've started 4 courses. Finished zero. Devfluent fixes that.

> Built by a developer with ADHD who abandoned three Udemy courses and needed a system that actually worked.
> This is the tool that didn't exist.

**The only open-source, ADHD-optimized developer learning tracker.**

No 47-hour video libraries. No decision paralysis. Just: open it, do the next block, close it — and watch the XP stack up.

---

<img src="public/readme/features-grid.svg" alt="Devfluent dashboard — streak, XP, daily goal, and your next learning block" width="100%"/>

*Dashboard: streak counter, XP progress bar, daily goal, and one clear next step.*

---

## Why Devfluent?

- **Structured, not overwhelming.** A 12-month curriculum broken into 30–90-minute blocks. Always know what's next.
- **Dopamine on demand.** XP, levels, streaks, and achievement badges give your brain immediate feedback — not "you'll appreciate this in 6 months."
- **ADHD-first design.** Pomodoro timer with a visual shrinking-pie, transition warnings, body-double mode, focus sounds, and streak freezes. Not bolted on — designed in.
- **Your code counts.** GitHub sync automatically converts your real pushes and PRs into XP. Learning and building are the same loop.
- **Fully open source.** AGPL-3.0. Self-host it, fork it, contribute to it. No vendor lock-in. No "we own your data."

---

## Features

<img src="public/readme/gamification.svg" alt="XP, levels, streaks and achievements" width="100%"/>

### Core

| | |
|---|---|
| **12-month curriculum** | JavaScript path (Month 1 fully populated); Python track stub; community-extensible via JSON PRs |
| **Roadmap tracker** | Browse and track any [roadmap.sh](https://roadmap.sh) roadmap directly in the app, earn XP per topic |
| **External courses** | Log Udemy, Frontend Masters, YouTube — anything — with progress tracking in one place |
| **Monthly projects** | One build project per month; 100 XP on completion |
| **Knowledge quizzes** | Per-block quizzes with tiered XP: attempt (3) → pass ≥ 70% (+12) → perfect 100% (+25) |

### Gamification

| Action | XP |
|---|---|
| Complete learning block | 10 |
| Complete block with Pomodoro | 15 |
| Daily login | 5 |
| 7-day streak bonus | 10 |
| 30-day streak bonus | 25 |
| Complete a course | 50 |
| Complete a project | 100 |
| GitHub push | 5 |
| GitHub PR opened | 10 |
| GitHub PR merged | 20 |

- **10 levels** from Newcomer → Fluent Dev (0 → 18,000 XP)
- **Streak tracking** with consecutive-day bonuses and a weekly streak freeze
- **Achievements** — unlockable badges, concurrent-safe (no double-award)
- **30-day activity heatmap**

### ADHD-Specific

| Feature | Why it matters |
|---|---|
| **Pomodoro timer** | Shrinking-pie visual timer; 2-min transition warning; 4 focus sounds (Web Audio API) |
| **Body-double mode** | Anonymous Supabase Realtime presence — see how many people are studying right now |
| **Streak freeze** | Use once per week to protect a streak after a missed day. All-or-nothing demotivation, gone. |
| **Quick-start / resume** | One button back to your last open block. Zero navigation friction. |
| **Progress replay** | See every block you've completed. Makes invisible progress visible. |
| **Celebration animations** | Opt-in confetti and sound on level-ups and achievements. Immediate positive reinforcement. |
| **AI Coach** | Personalized next-step recommendations via Claude (Anthropic), cached 24h. Kills decision paralysis. |
| **Accountability partner** | Link up with another learner; see each other's streak and weekly goal progress. |
| **PWA** | Installable, offline-ready. No browser tab friction. |
| **Dark mode + i18n** | EN/DE; dark mode for long sessions. |

---

## Quick Start

**Prerequisites:** Node.js 24+, a [Supabase](https://supabase.com) project (free tier works)

```bash
# 1. Clone and install
git clone https://github.com/e-pallad/adhs-learning
cd adhs-learning
npm install

# 2. Configure environment
cp .env.production.example .env.local
# Edit .env.local — fill in your Supabase URL, anon key, and DATABASE_URL at minimum

# 3. Generate the Prisma client
npx prisma generate

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with a magic link email.

> **GitHub Activity Sync and AI Coaching are optional.** The app runs fully without `GITHUB_CLIENT_ID` or `ANTHROPIC_API_KEY` — those widgets degrade gracefully.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon/public key |
| `DATABASE_URL` | yes | Pooled connection string (pgbouncer, port 6543) — runtime |
| `DIRECT_URL` | yes | Session connection string (port 5432) — migrations only |
| `ANTHROPIC_API_KEY` | optional | Claude API key for AI coaching recommendations |
| `GITHUB_CLIENT_ID` | optional | GitHub OAuth app client ID (GitHub Activity Sync) |
| `GITHUB_CLIENT_SECRET` | optional | GitHub OAuth app client secret |
| `NEXT_PUBLIC_APP_URL` | optional | Full app URL, e.g. `https://devfluent.de` (OAuth callback) |
| `STRIPE_SECRET_KEY` | optional | Stripe secret key (Pro tier billing) |
| `STRIPE_WEBHOOK_SECRET` | optional | Stripe webhook signing secret |
| `STRIPE_PRICE_MONTHLY_ID` | optional | Stripe Price ID for monthly Pro plan |
| `STRIPE_PRICE_ANNUAL_ID` | optional | Stripe Price ID for annual Pro plan |
| `STRIPE_PRICE_LIFETIME_ID` | optional | Stripe Price ID for the one-time lifetime plan |
| `ENCRYPTION_KEY` | optional | 64 hex chars (32 bytes, e.g. `openssl rand -hex 32`) — encrypts stored GitHub tokens at rest |

<details>
<summary><strong>Why two database URLs?</strong></summary>

Supabase provides two connection modes:

- **`DATABASE_URL`** uses pgbouncer (port 6543) — connection pooling, suited for high-concurrency runtime requests.
- **`DIRECT_URL`** uses a session-mode connection (port 5432) — required for Prisma migrations, which need a persistent session.

Prisma 7 reads these from `prisma.config.ts` via `defineConfig` rather than from `schema.prisma` — this is a deliberate breaking change in Prisma 7 that decouples runtime config from schema definition.

Similarly, `proxy.ts` replaces `middleware.ts` — Next.js 16 deprecated the middleware API in favour of a `proxy` export convention.

</details>

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Database | Supabase PostgreSQL |
| ORM | Prisma 7.6 with `@prisma/adapter-pg` |
| Auth | Supabase magic link (passwordless email OTP) |
| AI | Anthropic Claude SDK (`claude-haiku-4-5-20251001`) |
| Payments | Stripe (freemium — Free forever / Pro tier) |

---

## Project Structure

```
app/
  (auth)/login/         # Magic link login
  (landing)/            # Public landing page
  (dashboard)/          # All authenticated routes
    dashboard/          # Main dashboard
    learning/           # Curriculum + Pomodoro timer
    roadmap/            # roadmap.sh tracker
    training/           # External courses
    projects/           # Monthly build projects
    progress/           # XP history & achievements
    settings/           # Profile & account
  api/
    progress/           # block, course, project, roadmap, quiz
    ai/recommendations/ # Claude-powered suggestions (24h cache)
    github/sync/        # GitHub event ingestion → XP
    auth/github/        # GitHub OAuth initiation + callback
    accountability/     # Accountability partner linking
    user/               # stats, profile, api-key
lib/
  xp.ts                 # XP values, levels, achievements — single source of truth
  user.ts               # getCurrentUser, awardXP, updateStreak, checkAchievements
  prisma.ts             # PrismaClient singleton (driver adapter)
  roadmap.ts            # roadmap.sh API + 24h cache + local fallback
content/
  curriculum/tracks/
    javascript/         # month-01.json … month-12.json
    python/             # month-01.json (stub — contributions welcome)
proxy.ts                # Auth guard (replaces Next.js middleware)
prisma.config.ts        # Prisma 7 datasource config (defineConfig)
```

---

## Contributing

Contributions are very welcome. The curriculum lives in plain JSON — you can add blocks, fix content, or build an entire new language track with just a text editor and a PR.

**Getting started:**
1. Read [CONTRIBUTING.md](CONTRIBUTING.md) — it covers track structure, block format, quiz format, and the PR process.
2. Run `node scripts/validate-curriculum.js` locally before opening a PR.
3. Look for issues labeled **`good first issue`** on GitHub for starter tasks.

For code contributions (features, bug fixes): open an issue first for anything non-trivial so we can align before you invest time.

---

## Roadmap

| Phase | Focus |
|---|---|
| **Phase 1** (current) | Core curriculum, gamification, GitHub sync, AI coach, PWA, Dark mode, i18n |
| **Phase 2** | VS Code extension (API key foundation already shipped), community challenges, URL-prefix i18n routing |
| **Phase 3** | Mentor matching, mobile app, browser extension, additional language tracks |

---

## Self-Hosting

Docker images are provided. For a one-server deployment (nginx + TLS):

```bash
git clone https://github.com/e-pallad/adhs-learning /opt/devfluent
cd /opt/devfluent
cp .env.production.example .env.production  # fill in all values
./scripts/deploy-netcup.sh your.domain.com  # obtains TLS cert, builds, starts
```

See `compose.netcup.yml` and `nginx/netcup.conf` for full configuration. A TrueNAS-compatible compose file (`compose.truenas.yml`) is also included.

---

## License

[AGPL-3.0](LICENSE) — free to use, modify, and self-host. If you distribute a modified version, the source must remain open under the same license.

---

<div align="center">

[Live Demo](https://devfluent.de) · [GitHub](https://github.com/e-pallad/adhs-learning) · [Contributing](CONTRIBUTING.md) · [AGPL-3.0 License](LICENSE)

*Built for the developers who've been told they just need more discipline. They don't.*

</div>
