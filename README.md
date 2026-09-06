# backend-katas

A zero-setup backend gym. Every night you branch off a ready-to-run NestJS +
TypeORM + Postgres + Redis app, an AI teacher hands you a **failing test as an
assignment**, and you implement `src/` until it passes. No scaffolding, no "where
was I" — just the real problem.

Built for a fullstack dev going deep on the backend "hard middle": idempotency,
concurrency/locking, transactions, caching, queues, rate limiting, query
performance, observability. Stack chosen to mirror Kotlin/Spring so night
practice sharpens the day job.

---

## How to use your hour

- **Weeks 1–3:** isolated katas, one per night. Goal = build the *habit*. Low
  activation energy: branch, get an assignment, pass it, commit.
- **Week 4+:** start branching katas onto one long-lived service instead of
  throwing them away, so caching/idempotency/queues start interacting — that
  interaction is the senior-level lesson.
- Read theory during the day (you have time then); **build the kata at night.**

---

## Run it

The app needs Postgres + Redis. Two ways:

### Option A — GitHub Codespaces (cloud, zero local setup)
1. Push this repo to GitHub → **Code ▸ Codespaces ▸ Create codespace**.
2. Wait for first boot. The devcontainer auto-runs install + migrate + seed
   (`.devcontainer/devcontainer.json`). Postgres and Redis start automatically.
3. `npm run start:dev`, then open the forwarded port and hit `/health` → expect
   `{ "status": "ok", "db": "ok", "redis": "ok" }`.
4. **Stop the codespace when you're done** — free tier is ~120 core-hours/month.

Inside the devcontainer the app reaches the DBs by service name (`postgres`,
`redis`), already set in the compose env.

### Option B — Local / WSL2 (unlimited, same files)
```bash
cp .env.example .env            # local defaults already match docker-compose
docker compose up -d postgres redis
npm install
npm run migration:run
npm run seed
npm run start:dev               # http://localhost:3000/health
```
> Port 5432 already taken (you run a local Postgres)? Start the DB on another
> port and point the app at it:
> ```bash
> PG_HOST_PORT=5433 docker compose up -d postgres redis
> # then set DB_PORT=5433 in your .env
> ```

Health check should return all `ok`. You now have 100 seeded `products`.

---

## Daily workflow

```bash
git checkout seed                       # the clean baseline (never commit katas here)
git checkout -b kata-01-idempotency     # one branch per kata
# → ask the teacher to start the kata (prompt below)
# → implement in src/ until the assignment passes:
npm run test:kata -- test/katas/kata-01-idempotency.e2e-spec.ts
# → on green, ask for review, then log it:
#   (edit LOG.md — one row per night)
git add -A && git commit -m "kata-01: idempotent orders"
```

`npm run test:e2e` runs the baseline health check. `npm run test:kata -- <path>`
runs one kata assignment. Kata specs live in `test/katas/`; **you don't edit
them** — the spec is the contract you implement against.

---

## The roadmap

One theme per week — see the full table with the Spring/JPA parallels in
[`CLAUDE.md`](./CLAUDE.md). Where you are is the last row of [`LOG.md`](./LOG.md).
`kata-01-idempotency` is written and waiting (RED).

---

## Lesson prompts (copy-paste to the AI)

**Start / continue a kata** (the teacher writes the failing tests, not the solution):
```
Act as my backend teacher per CLAUDE.md. Start the next kata: topic <idempotency>.
Give me the concept brief (with the Spring parallel), then write the failing e2e
tests as my assignment plus the acceptance criteria. Do NOT write any src/ solution
— I'll implement it. Then stop.
```
Or just run the skill: `/kata idempotency` (see `.claude/skills/kata/`).

**Get a hint (escalating, never the answer):**
```
I'm stuck on <the failing assertion>. Give me hint tier <1..4> only.
```

**Submit for review:**
```
Done. Run the tests. If green, review my src/ changes as a demanding senior
reviewer — what breaks under load, what a PR reviewer would flag.
```

**Resume next session:**
```
Read LOG.md and my current branch, tell me where I am and what to do tonight.
```

---

## Rules that keep this a gym, not Netflix

- The teacher **never writes your `src/` solution.** If you ask it to "just write
  it," it will refuse and give a hint instead — by design. The struggle is the workout.
- A kata is **done only when its test is green *and* you've had the review.**
- Don't edit kata specs to make them pass. That's cheating on your own behalf.
- Keep old kata branches — in 8 weeks the history + `LOG.md` is your interview
  story bank.
