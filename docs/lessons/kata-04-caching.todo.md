# Kata 04 — Caching

- **Week:** 4
- **Status:** todo
- **Branch:** `kata-04-caching`  (off `main`)
- **Spec:** `test/katas/kata-04-caching.e2e-spec.ts`  (the contract — do NOT edit)
- **Run:** `npm run test:kata -- test/katas/kata-04-caching.e2e-spec.ts`

---

## Anchor kata (input → required behavior)

Cache-aside product read in Redis → invalidation on write → defend against stampede.

**New infra it forces:** — (Redis, already wired via the `REDIS` token).

---

## Concept brief

**Cache-aside (lazy-loading)** is the default read-caching pattern: the *app*
owns the logic, not the cache. On a read, check the cache first — **miss** → load
from the DB, write it into the cache, return it; **hit** → return the cached copy
and never touch the DB. Same shape as React Query (key, fetch-on-miss,
serve-on-hit), but the cache is **Redis**: a networked, RAM-backed
`Map<string,string>` shared by every API instance, sub-millisecond fast.

**Redis crash-course.** Mostly a few commands: `SET key value [EX <seconds>]`
(EX = TTL / auto-expire), `GET key`, `DEL key` (evict), `SET key val NX` (set
only if not-exists — the atomic claim behind locks/idempotency). Keys are
strings you namespace yourself (`product:<uuid>`); values are strings, so
`JSON.stringify` in / `JSON.parse` out. Client is injectable: `@Inject(REDIS)`.

**Why it matters — the failure modes:**
1. **Stale reads after a write.** Cache a product, someone buys one, readers keep
   seeing old stock until TTL. Caching without **invalidation** = serving wrong
   data quickly.
2. **Cache stampede** (thundering herd). A cold/just-invalidated hot key → N
   concurrent requests all miss at once and all run the expensive query before
   anyone populates the cache. 1 slow query becomes N, exactly when busiest. Fix:
   **single-flight** — only the first miss hits the DB; the rest wait, then read
   the freshly-cached value.

**Spring/JPA parallel:** `@Cacheable("products")` on the read + `@CacheEvict` on
the write (Spring Cache over Redis/Caffeine), done by hand. The stampede guard is
Caffeine's per-key `LoadingCache` lock, or `@Cacheable(sync = true)`.

Docs: [AWS caching best-practices](https://aws.amazon.com/caching/best-practices/)
· [Redis `SET`](https://redis.io/docs/latest/commands/set/)
· [Spring Cache](https://docs.spring.io/spring-framework/reference/integration/cache.html)

---

## Contract

- `GET /products/:id` → `200 { id, name, priceCents, stock, version, source }`
  - `source:"db"` — served from Postgres, value (re)written into Redis as a side effect.
  - `source:"cache"` — served from Redis.
  - Cold read = MISS (`"db"`) and populates the cache; the next read = HIT (`"cache"`), identical data.
- `POST /products/:id/purchase` (exists) — mutates stock. After a successful
  purchase the cached copy is STALE and MUST be invalidated: the next GET shows
  the new stock and is a fresh read (`source:"db"`).
- `GET /products/:id/db-reads` → `200 { dbReads }` — diagnostic load gauge:
  how many times the service actually queried Postgres for THIS id since process
  start. Increment it exactly where you hit the DB for a single product.

---

## Acceptance criteria (the 4 spec assertions)

1. **Miss → hit.** Cold GET is `source:"db"` and populates Redis; next GET is
   `source:"cache"` with identical data.
2. **Per-key isolation.** Two ids cache under their own keys — no global-key collision.
3. **Invalidation on write.** Warm → purchase → next GET shows new stock and is
   `source:"db"` (a stale cache entry is the bug).
4. **No stampede (nasty case).** 20 concurrent cold reads hit Postgres exactly
   once — `dbReads` delta === 1.

Done = all 4 green **and** the senior-review pass (kata-review).

---

## Where to work (all `src/` — learner's code)

- `src/products/products.service.ts` — cache-aside around `findOne` (inject
  `REDIS`); invalidation inside `purchase`; per-id DB-read counter incremented
  only where you query Postgres for one product; single-flight guard for the burst.
- `src/products/products.controller.ts` — `GET /products/:id` returns `source`;
  add `GET /products/:id/db-reads`.

## Two decisions that are the lesson

- **Invalidation:** `DEL`-then-let-the-next-read-repopulate vs. writing the new
  value straight into the cache — which is safer under a concurrent write?
- **Single-flight:** in-process promise-sharing vs. a Redis `SET NX` lock — what
  does each cost, and which one still holds when you run two API instances?
