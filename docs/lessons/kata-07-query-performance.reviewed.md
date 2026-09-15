# Kata 07 — Query performance

- **Week:** 7
- **Status:** reviewed
- **Branch (when you start):** `kata-07-query-performance`  (off `main`)
- **Spec:** `test/katas/kata-07-query-performance.e2e-spec.ts`  *(the contract — do NOT edit)*

---

## Concept brief

**The anchor.** A user activity feed: "give me the newest N events for one user."
Trivial on 100 rows, a fire on 1M. This kata is two fixes that always travel
together — **index the hot query** and **page it by keyset, not OFFSET**.

**Failure mode 1 — the slow query.** `SELECT ... WHERE user_id = $1 ORDER BY
created_at DESC LIMIT n` with no matching index makes Postgres **Seq Scan** the
whole table to find the user's rows, **Sort** them all, then throw away all but
`n`. The fix is a **covering composite index** whose columns are, in order, the
equality filter then the sort keys: `(user_id, created_at DESC, id DESC)`. Now
the planner *walks* the index in the exact order you asked for and stops after
`n` — no scan, no sort. `EXPLAIN` is how you prove it took the index instead of
trusting that it did.

**Failure mode 2 — OFFSET paging is not stable.** `... ORDER BY created_at DESC
OFFSET 50 LIMIT 50` assumes nothing below you moves. Insert **one** newer event
between page 1 and page 2 and every row shifts down one slot — so page 2
re-serves the last row of page 1. The user sees a duplicate; a job paging to the
end processes a row twice. **Keyset (cursor)** paging remembers *where you were*
— "rows strictly older than `(created_at, id) = X`" — so head inserts never
shift the window. Bonus: keyset stays O(log n) deep into the list, while `OFFSET
1000000` still reads and discards a million rows.

**Why `id` is in the sort key.** `created_at` alone isn't unique — two events in
the same millisecond make the order ambiguous, and an ambiguous order breaks
keyset paging (you can't say "strictly after" a tie). Adding `id` as the
tiebreaker makes the ordering **total**, and the cursor encodes both.

**Spring/JPA parallel.** This is exactly why `Pageable` + `Page<T>` (LIMIT/
OFFSET) is a trap on hot, growing tables — Spring Data's own docs push you to
keyset via `ScrollPosition` / `Window<T>` (`scrollByKeyset()`) for this reason.
The composite `@Index(columnList = "userId, createdAt DESC")` is the same lever
as the migration you write here, and `EXPLAIN (ANALYZE)` is the same tool you'd
reach for behind Hibernate to confirm the plan — an annotation declaring an index
doesn't prove the planner *uses* it.

Docs: https://use-the-index-luke.com/no-offset ·
https://www.postgresql.org/docs/current/using-explain.html

---

## The contract (mirrors the spec — spec wins if they disagree)

```
GET /events?userId=<int>&limit=<int>&cursor=<opaque?>
  -> 200 {
       items: Array<{ id, userId, createdAt, kind }>,   // NEWEST first
       nextCursor: string | null
     }
```

- **Ordering:** strictly by `(created_at DESC, id DESC)` — newest first, `id` the
  tiebreaker so the order is total.
- **Filter:** only rows for `userId`.
- **cursor:** OPAQUE. Comes from a previous response's `nextCursor`; the client
  passes it back verbatim. It encodes the position of the LAST row returned, so
  the next page is the rows **strictly after** it in the ordering (keyset). It
  must **not** be a numeric OFFSET.
- **nextCursor:** token to fetch the page after this one, or `null` at the end.

The test seeds ~60k noise rows + 2 000 rows for the graded user and `ANALYZE`s,
so the planner has real stats. If setup fails with `relation "events" does not
exist`, run your CreateEvents migration first (on Codespace).

---

## Acceptance criteria (what the spec asserts)

1. **Correct first page** — `limit` items, all for `userId`, strictly descending
   by `createdAt`, and item[0] is genuinely the freshest event for that user;
   `nextCursor` is a non-empty string (more to fetch).
2. **Cursor advances cleanly** — page 2 (via `nextCursor`) is disjoint from page
   1, starts strictly older than page 1 ended, and the two pages form one
   unbroken descending run (no overlap, no gap).
3. **Stable under insert (nasty case)** — after fetching page 1, a brand-new
   *newest* event is inserted for the user; page 2 (with page 1's cursor) must
   **not** contain that new row and must **not** duplicate any page-1 row. This
   is the exact case OFFSET gets wrong.
4. **Served by an index** — `EXPLAIN (FORMAT JSON)` of the feed query has an
   `Index Scan` / `Index Only Scan`, **no** `Seq Scan`, and **no** `Sort` node.
   That's what forces the covering composite index (not just any index on
   `user_id`, which would still leave a `Sort`).

---

## What to build in `src/`

- A new **migration** adding the covering index to `events`, e.g.
  `CREATE INDEX ... ON events (user_id, created_at DESC, id DESC);`. The scaffold
  migration (`db/migrations/*-CreateEvents.ts`) ships the table with its primary
  key only — the index is the lesson, so it's yours. Run it on Codespace.
- An **`EventsModule`** with:
  - a **controller**: `GET /events`.
  - a **service** that runs the keyset query. First page: `WHERE user_id = $1
    ORDER BY created_at DESC, id DESC LIMIT $2`. Next page: add
    `AND (created_at, id) < ($cursorCreatedAt, $cursorId)` — Postgres supports
    the **row-value comparison** `(a, b) < (x, y)` directly, which maps exactly
    onto the composite index. Build `nextCursor` from the last row's
    `(created_at, id)` (encode it — e.g. base64 JSON — so it's opaque); return
    `null` when the page came back short of `limit`.
  - the `Event` entity is already scaffolded (`src/events/event.entity.ts`).
- Register `EventsModule` in `src/app.module.ts`.

Run: `npm run test:kata -- test/katas/kata-07-query-performance.e2e-spec.ts`

---

## Parking lot (revisit in review)

- Why does `(created_at, id) < ($t, $id)` beat `created_at < $t OR (created_at =
  $t AND id < $id)`? (Same result; the row-value form is one index range scan,
  the OR form can defeat the index.)
- Descending index vs. `ORDER BY ... DESC` on an ASC index — when does Postgres
  do a **Backward Index Scan** and does it matter here?
- `EXPLAIN` vs `EXPLAIN (ANALYZE, BUFFERS)` — estimated plan vs. actual rows/
  timing/heap reads. When is the estimate a lie?
- The N+1 the roadmap also names: if each event later needs its user's name,
  don't fetch it per row in a loop — one `IN (...)` / join. Optional extension.
- Index write cost: every index you add slows every INSERT/UPDATE. When is a
  composite index *not* worth it?

---

## Review outcome (2026-09-15) — reviewed, green

**Landed the whole lesson.** `CREATE INDEX idx_event_feed ON events (user_id,
created_at DESC, id DESC)` — equality column leads, then the two `ORDER BY` keys
in order with matching directions ⇒ `EXPLAIN` shows Index Scan, no Seq Scan, no
Sort. The service's three column lists finally agree (ORDER BY = keyset predicate
= cursor payload = `(created_at, id)`), and `nextCursor` is `null` at the end.

**The journey (what broke, in order):** (1) first keyset compared only
`created_at` — no tiebreaker; (2) then compared `(created_at, userId)` — `userId`
is the *filter*, constant across a feed, so it can never break a tie; the correct
tiebreaker is the unique `id`; (3) cursor encode/decode key-name mismatch left
the second tuple element `undefined` — masked because the graded spec seeds
unique 1-second-apart timestamps. Caught (1)–(3) with a supplemental diagnostic
that seeds **equal** timestamps: `test/katas/kata-07-tiebreaker.e2e-spec.ts`
(safe to delete).

**Reviewer notes for next time (none blocked):** `down()` should be `DROP INDEX
IF EXISTS`; unguarded `JSON.parse(cursor)` → 500 on a bad token (should be 400);
`limit` unbounded in the controller (`Number('abc')`→NaN, and a DoS lever — clamp
1..100). Optional: `INCLUDE (kind)` for an Index Only Scan.

**Parking-lot answers that came up:**
- *Row-value `(a,b) < (x,y)` vs the OR form* — same result set, but the row-value
  form is a single index range scan that maps straight onto the composite index;
  the `created_at < t OR (created_at = t AND id < id)` form can confuse the
  planner into not using the index as one range.
- *Backward Index Scan* — a plain ASC `(user_id, created_at, id)` would also kill
  the Sort (Postgres reads the index backward for `DESC`). Declaring the index
  `DESC` is the explicit, self-documenting form and the habit that pays off the
  day the sort directions are mixed (where a backward scan can't serve both).
