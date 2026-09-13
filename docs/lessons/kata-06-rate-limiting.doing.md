# Kata 06 — Rate limiting

- **Week:** 6
- **Status:** doing (assignment handed off 2026-09-13; spec is RED 0/4)
- **Branch:** `kata-06-rate-limiting`  (off `main`)
- **Spec:** `test/katas/kata-06-rate-limiting.e2e-spec.ts`  (the contract — do NOT edit)
- **Run:** `npm run test:kata -- test/katas/kata-06-rate-limiting.e2e-spec.ts`

---

## Anchor kata (input → required behavior)

Token-bucket per user in Redis → 100 req/min/user → `429` + `Retry-After`.

**New infra it forces:** — (Redis, already wired via the `REDIS` token). No table.

---

## Concept brief

A **rate limiter** caps how much traffic one caller sends in a window. The
**token bucket** is the workhorse: each user owns a bucket of `capacity` tokens
that refills at a steady rate. Every request spends one token; empty bucket →
reject with **`429 Too Many Requests`** + a **`Retry-After`** header (seconds
until a token frees up). Unlike a fixed window it tolerates short bursts (spend
the whole bucket at once) while still bounding the long-run rate, and it's cheap
to store: `(tokens, lastRefill)` per user in Redis.

**Why it matters — the failure mode:** without it, one client — a runaway retry
loop, a scraper, credential-stuffing, a noisy neighbor — saturates the DB pool
and starves every other user. Rate limiting is the blast-radius fuse on a shared
backend.

**The nasty case (the real lesson):** the naive limiter is two round-trips —
`n = GET key; if (n < LIMIT) INCR key`. That's **check-then-act**, the same race
as kata-02, now in Redis. Fire 120 concurrent requests at a limit of 100 and
they all read a count below 100 before anyone increments → **over-admission**.
Fix: make the decision and the state change **one atomic step** — a single
`INCR` (reject when the returned value exceeds `LIMIT`), or a Lua script for a
true token bucket. Redis is single-threaded → one command = one atomic decision.

**Spring/JPA parallel:** a servlet `Filter` or AOP `@Around` advice (or Bucket4j
over Redis / Spring Cloud Gateway `RequestRateLimiter`). In Nest the seam is a
**Guard** (`CanActivate`) or an interceptor that runs before the handler and
rejects early. `@nestjs/throttler` is the off-the-shelf version — you hand-roll
it once to see the atomics it hides.

Docs: [Redis rate limiting](https://redis.io/glossary/rate-limiting/)
· [Stripe — scaling with rate limiters](https://stripe.com/blog/rate-limiters)
· [Nest Guards](https://docs.nestjs.com/guards)

---

## Contract

- `GET /limited`  header `X-User-Id: <string>` (the rate-limit subject)
  - `200 { ok: true }` while the caller still has budget in the current window.
  - `429` once the caller has spent `LIMIT` requests in the window. The 429
    MUST carry a `Retry-After` header — an integer number of seconds until
    budget frees up, in `(0, WINDOW]`.
  - The limit is **per `X-User-Id`**: one user exhausting their budget must not
    affect another. Independent buckets.
- Tunables the spec assumes (match them exactly as constants in your limiter):
  - `LIMIT = 100` requests
  - `WINDOW_SECONDS = 60`

---

## Acceptance criteria (the 4 spec assertions)

1. **Has budget → allowed.** A fresh user's request is `200 { ok: true }`.
2. **Over the limit → 429 + Retry-After.** After `LIMIT` allowed requests, the
   next is `429` with an integer `Retry-After` in `(0, 60]`.
3. **Per-user isolation.** Exhaust user A → A gets `429`; user B still `200`.
4. **No over-admission (nasty case).** A concurrent burst of `LIMIT + 25` for one
   user admits **exactly** `LIMIT` (200) and rejects the rest (429) — no third
   status, nothing lost.

Done = all 4 green **and** the senior-review pass (`/kata-review`).

---

## Where to work (all `src/` — learner's code)

- `src/rate-limit/` — new module:
  - a controller exposing `GET /limited` (trivial handler → `{ ok: true }`).
  - the enforcement in a **Guard** (`CanActivate`) or interceptor: read
    `X-User-Id`, consult Redis (inject the existing `REDIS` token from
    `src/redis/redis.module.ts`). On reject, set `Retry-After` and throw so Nest
    emits `429` (`HttpException`/`ThrottlerException` with status 429).
- `src/app.module.ts` — wire the new module in.
- No migration/table: this kata's state lives entirely in Redis.

## The decision that IS the lesson

**How do you make "read the count and decide" a single atomic step?** Options to
weigh:

- **Fixed-window counter:** `INCR user:<id>` then, if it's the first hit in the
  window, `EXPIRE` it to `WINDOW_SECONDS`; reject when the returned value `> LIMIT`.
  One atomic `INCR` decides admission — but watch the `EXPIRE`-after-`INCR` race
  (set the TTL only when `INCR` returns 1, ideally in one `SET NX` / Lua step).
  `Retry-After` = the key's remaining `TTL`. Cheap; boundary-doubling is its known
  flaw (up to 2×LIMIT across a window edge).
- **Token bucket (Lua):** store `(tokens, lastRefill)`, refill by elapsed time,
  decrement if ≥ 1 — all inside one `EVAL` so the whole read-refill-decide-write
  is atomic. Smoother, closer to the contract's name; more moving parts.

Either satisfies the spec. The trap to avoid in **both**: any version where the
check and the mutation are separate round-trips (assertion 4 will catch it).

---

## Request flow — fixed-window counter (the simplest correct model)

A step-by-step walkthrough of the fixed-window approach, keyed per user. This is
the "count up and let it expire" model — the simplest thing that satisfies the
spec.

1. **Each user has his own bucket** — a Redis key `ratelimit:<userId>` holding a
   single integer counter. No key yet = a fresh, empty bucket.
2. **Every request increments that user's counter by 1.** Use one atomic `INCR`,
   which *returns the new value* — so you decide from what it returns, never a
   separate `GET` first (that would be the check-then-act race).
3. **A limit is defined** — `LIMIT = 100` for the window.
4. **When the counter exceeds the limit, further requests → `429`** with a
   `Retry-After` header = the seconds left until the bucket resets.
5. **The bucket "resets" by EXPIRING, not by a manual timer.** The correction to
   your original step: when the counter is *first created* (the `INCR` returns 1),
   attach a TTL of `WINDOW_SECONDS = 60` with `EXPIRE`. Redis then deletes the key
   on its own after 60s. The next request finds no key → `INCR` starts again at 1
   → the window has reset. You never write a reset loop; the TTL is the reset.
   - *Not milliseconds* — the reset interval **is** the window (60s here).
   - Set the TTL **only when the counter is created** (when `INCR` returns 1),
     and ideally atomically with the create — otherwise a crash between `INCR`
     and `EXPIRE` leaves an immortal counter, or a later `EXPIRE` keeps sliding
     the window and it never resets.
6. **`Retry-After` = the key's remaining TTL** (`TTL`/`PTTL`), rounded up to an
   integer ≥ 1 second.
7. **Continue like that** — each window is an independent 60s counter that fills
   up and expires.

**The known trade-off (why the roadmap names it "token bucket" instead):** this
hard reset has a **boundary-doubling** seam — 100 requests in the last second of
one window + 100 in the first second of the next = ~200 in ~2s, both windows
individually legal. A token bucket avoids the seam by refilling gradually instead
of resetting (count *down* from capacity, add back `elapsed × rate` tokens per
request, all inside one Lua `EVAL`). Either passes this kata; pick deliberately.

---

## Watch out (predicted pitfalls)

- **`EXPIRE` set after a non-atomic `INCR`, or never** → key lives forever, the
  window never resets, or a crash between `INCR` and `EXPIRE` leaves an immortal
  counter. Tie the TTL to the counter's creation atomically.
- **`Retry-After: 0` or float.** Spec wants an **integer in `(0, 60]`**. If
  `PTTL` rounds to 0, floor to at least 1; convert ms→s with `Math.ceil`.
- **Header vs. body.** The 429 assertion reads the `Retry-After` *header*, not the
  JSON body — set it on the response.
- **Global vs. scoped guard.** If you register the guard globally it throttles
  every route (health, products…), breaking other katas. Scope it to `/limited`.
- **Key hygiene.** Namespace per user + window (`ratelimit:<userId>`), value is a
  string. Don't collide with cache/lock keys from kata-04.

---

## When to reach for a rate limiter — and when it's over-engineering

Rate limiting is a fuse, not a default. It adds a Redis round-trip on the hot
path, a shared-state failure mode (Redis down → do you fail open or closed?), and
a support surface (users hitting 429s legitimately). Add it where abuse is cheap
for the attacker and expensive for you; skip it where a simpler guard already
bounds the cost.

**Reach for it (real cases):**

- **Public/unauthenticated endpoints exposed to the internet** — login, signup,
  password-reset, OTP/SMS send, "contact us". These are the classic abuse
  targets: credential-stuffing, enumeration, and SMS-pumping (each SMS costs you
  real money). Often keyed by IP *and* by account.
- **Expensive or third-party-billed operations** — anything that calls a paid API
  (LLM tokens, email/SMS, geocoding, payment retries) or runs a heavy query/
  export. Here the limit protects your **wallet**, not just your CPU.
- **Shared-tenant fairness** — a multi-tenant API where one customer's burst must
  not starve the others (the "noisy neighbor" fuse). Per-API-key quotas.
- **A published API contract** — when "100 req/min" is a documented tier your
  customers pay for. Then the limiter *is* the product boundary.

**Don't (YAGNI — a simpler control already covers it):**

- **Internal service-to-service calls behind your own network/mesh.** Callers are
  known and finite; use timeouts, connection-pool caps, circuit breakers, and
  backpressure instead. A per-user token bucket models the wrong thing.
- **Already-bounded work.** An admin-only endpoint behind auth+RBAC, a cron job, a
  webhook from a single trusted provider (verify its signature instead), or an
  endpoint whose concurrency is already capped by a DB lock (kata-02) or a queue's
  worker count (kata-05). Adding a limiter on top is a second fuse for a circuit
  that can't overload.
- **Cheap, idempotent reads with a cache in front.** If kata-04's cache already
  makes the read ~free, you're rate-limiting a Redis GET — protecting nothing.
- **Before you have a threat or a bill.** A brand-new internal tool with 5 users
  doesn't need a distributed token bucket "for scale". Ship without it; add it
  when a real abuse vector or cost signal appears. Premature limiting = latency +
  ops burden + false-positive 429s for no defended failure mode.

**The 30-second test before adding one:** *Who is the untrusted caller, what
specific resource does a burst exhaust, and is there already a cheaper bound
(auth, cache, pool cap, queue, circuit breaker) on that resource?* If you can't
name the caller and the resource, you're guarding a hypothetical — don't.

> Layer, don't stack: a good architecture usually has **one** rate limiter at the
> edge (gateway/CDN, per-IP) plus **targeted** per-user/per-key limits on the few
> endpoints that actually warrant them — not a limiter bolted onto every route.

---

> This board is the **forward** view. `LOG.md` (repo root) is the backward view —
> fill its row in on review with what broke and the one idea that stuck. The
> **spec is the source of truth**; if this note ever disagrees, the spec wins.
