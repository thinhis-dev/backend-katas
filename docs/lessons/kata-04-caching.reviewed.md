# Kata 04 — Caching

- **Week:** 4
- **Status:** reviewed (green 4/4 + senior review, 2026-09-12)
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

---

## Deep dive: defeating the stampede (assertion 4)

The scenario: 20 requests hit a **cold** key in the same instant. All 20 miss the
cache, and there's a window between "miss" and "wrote to cache" where nothing is
cached yet — so all 20 dive into Postgres. The test pins `dbReads` to exactly
**1**. This is single-flight: only the first miss loads; the rest must *wait for*
that load and then read the cached value — never run their own query.

### The scoping fact that decides the tool

- **This test = ONE Node process.** `Test.createTestingModule` boots a single app
  in a single process; all 20 requests share one `ProductsService` heap. So an
  **in-memory guard is sufficient here.**
- **A JS `Map` is per-process, never shared across processes.** If you truly ran
  N pods, each has its own heap — the `Map` wouldn't be shared at all. Cross-pod
  shared state is what Redis is *for*.

| Scope | "Only one loader" primitive | Spring/JPA analog |
|---|---|---|
| One process, N concurrent requests | in-memory **in-flight promise map** `Map<id, Promise>` | Caffeine `LoadingCache` / `@Cacheable(sync=true)` |
| N processes / pods | **Redis lock** (`SET NX PX`) | Redisson `RLock` |

### The event-loop trap (the bug I hit first)

My first attempt spun on the diagnostic counter:

```ts
while (this.countDbRead.get(id)) { continue }          // ✗ two bugs
const product = await this.productsRepo.findOne(...)
this.countDbRead.set(id, ...)                          // flag set AFTER the await
```

1. **The guard is set *after* `await`.** Node is single-threaded; callers only
   arrive at this code after an earlier caller *yields at an `await`*. Anything
   you set after the await is invisible to the 19 who already sailed past — so on
   a cold key all 20 fall through and all 20 query. **The claim must be planted
   synchronously, before the first `await` yields.**
2. **`while (cond) continue` never yields.** A synchronous loop with no `await`
   freezes the *only* thread — including the DB callback that would set the flag.
   To wait in async-land you `await` something (a promise, a timer), you never
   spin.

### Approach A — in-flight promise map (simplest; enough for this test)

```
inflight = new Map<string, Promise>()          // service field
...after cache miss:
if inflight.has(id): return await inflight.get(id)   // join the winner's load
p = loadFromDbAndCache(id)                     // starts exactly ONE db read
inflight.set(id, p)                            // planted synchronously, pre-await
try:    return await p
finally: inflight.delete(id)                   // so the NEXT cold read can load again
```

Race-proof because `set()` happens in the synchronous tick before any `await`
hands control on. No polling, no TTL, no Lua. Losers `await` the winner's own
promise. (Forget the `finally` delete → the map keeps a resolved promise forever
→ after an invalidation the next read replays the *stale* promise and never
reloads.)

### Approach B — Redis lock (the multi-pod pattern; heavier)

Flow inside `findOne` after the miss:

```
token = randomUUID()
if await acquireLock(id, token, ttlMs):        // I'm the single loader
  try:
    product = await db.findOne(id)             // the ONE db read → bump dbReads HERE
    if !product: throw NotFound
    await cache.set(id, JSON.stringify(product))
    return { ...product, source: 'db' }
  finally:
    await releaseLock(id, token)               // token-checked, atomic
else:                                           // loser: MUST NOT touch the db
  return await waitForCache(id)                 // bounded poll of redis.get(id)
```

**Acquire** — `SET key token NX PX ttl` (ioredis: `redis.set(`lock:${id}`, token,
'PX', ttlMs, 'NX')` → `'OK'` won / `null` lost):
- `NX` = atomic "only if absent" → exactly one winner, server-side, one round-trip.
- `PX ttlMs` (ms, not `EX` seconds) = crash safety net; set it comfortably longer
  than a DB read so the lock can't expire mid-load. Not your timing knob.
- `token` = `crypto.randomUUID()`, unique to this acquisition — needed for release.

**Loser wait** — the async way to wait (contrast the frozen `while` above):

```
sleep = (ms) => new Promise(r => setTimeout(r, ms))
waitForCache(id):
  for i in 0..MAX_TRIES:            // BOUNDED — e.g. 100 × 20ms = 2s ceiling
    await sleep(POLL_MS)            // yields the loop so the winner can populate
    cached = await redis.get(id)
    if cached: return { ...parse(cached), source: 'cache' }
  // timed out → see pitfall 3
```

**Safe release** — token-checked compare-and-delete, atomic via Lua (a plain
`GET`-then-`DEL` reintroduces the race). Straight from the Redis docs:

```
RELEASE = "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end"
releaseLock(id, token): await redis.eval(RELEASE, 1, `lock:${id}`, token)
```

Why unconditional `del` is wrong: if your TTL expired mid-load, another process
legitimately holds the lock now — a blind `del` deletes *their* lock.

### Pitfalls that silently turn `dbReads` back into N

1. **A loser falls through to the DB.** On the happy path losers return *only*
   from cache. A "just in case" DB read defeats the whole thing.
2. **`dbReads` bumped outside the winner branch.** The increment sits next to the
   single winner's `db.findOne`, nowhere else.
3. **Winner-died fallback re-stampedes.** If the winner throws (DB down) and
   `finally` releases the lock, all 19 loser polls time out together — don't let
   them all pile back onto Postgres. Simplest safe choice: on timeout throw a
   503-ish error rather than reading the DB. Get the *happy* path to exactly 1;
   don't let a defensive fallback quietly make it 20.

### Spring parallel

The whole hand-rolled dance — `SET NX PX` + token + Lua release + TTL — is what
**Redisson `RLock`** (`lock.lock()` / `lock.unlock()`) does for you, and what
`@Cacheable(sync = true)` hides entirely. Building it once is how you learn what
those annotations buy under load.

---

## Redis — review notes & parking lot (ask me later)

_Kata green (4/4) + reviewed 2026-09-12. The lock primitive is correct; the notes
below are the "not just pass the tests" layer — each is a real gap, not a nit._

### What's solid (keep doing this)

- `SET NX PX` + unique token + Lua compare-and-delete release = the canonical
  distributed lock. Correct and safe.
- Chose a **Redis** lock over an in-process `Map` → single-flight still holds
  across multiple pods (a `Map` wouldn't be shared).
- Invalidation is **awaited** and happens **after** the transaction commits.

### Open questions to raise later (anchors for a future session)

1. **Lock TTL vs. load time.** TTL is 200ms. If a DB read exceeds it, the lock
   expires mid-load and a second caller becomes a second loader → `dbReads > 1`.
   → *Ask: lock extension / watchdog (Redisson lease renewal); how to pick a TTL.*
2. **Loser timeout returns 404.** `waitForCache` exhausting throws `NotFound` for
   a product that EXISTS. → *Ask: why this must be a 503 + `Retry-After`, not a
   404 (ties to Week 6 rate limiting).*
3. **No TTL on the cached value.** `SET id json` never expires; explicit
   invalidation is the only eviction, so any out-of-band write = permanent stale.
   → *Ask: TTL as a backstop; the delete-then-repopulate-stale race and its fixes
   (TTL, delayed double-delete, write-through).*
4. **Key namespacing.** Value under raw `id`, lock under `lock:id`. → *Ask: a
   `product:<id>` scheme and why bare-UUID collisions bite in a shared Redis DB.*
5. **Cache ↔ DB are two systems (no 2-phase commit).** There's always a window
   where one is updated and the other isn't. → *Ask: when invalidation needs the
   **outbox** (kata-03) vs. when a TTL is good enough; commit-then-invalidate
   ordering and `@TransactionalEventListener(AFTER_COMMIT)`.*
6. **`countDbRead` Map grows unbounded.** Diagnostic-only here. → *Ask: the prod
   shape (a metrics counter / Prometheus, not a per-id in-memory Map).*
7. **Invalidation-failure policy.** If `redis.del` throws after a committed
   purchase, the client sees 500 on a successful write. → *Ask: log-and-continue
   vs. fail; how the TTL backstops a missed `del`.*

### Redis command cheat-sheet (for reference)

| Command | Meaning |
|---|---|
| `SET k v EX <s>` / `PX <ms>` | set with a TTL (seconds / milliseconds) |
| `SET k v NX` | set only if absent — the atomic claim behind locks & idempotency keys |
| `GET k` / `DEL k` | read / evict |
| `EVAL <lua> <numkeys> k … arg …` | run a multi-step op atomically (our token-checked release) |
| `TTL k` / `PTTL k` | inspect remaining TTL (s / ms) |
| `EXPIRE k <s>` | add/replace a TTL on an existing key |

**Spring parallels:** the lock dance ≈ Redisson `RLock`; cache-aside ≈
`@Cacheable` + `@CacheEvict`; single-flight ≈ `@Cacheable(sync = true)`;
commit-then-invalidate ≈ `@TransactionalEventListener(phase = AFTER_COMMIT)`.
