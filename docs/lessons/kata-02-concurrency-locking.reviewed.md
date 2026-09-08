# Kata 02 — Concurrency & locking

- **Week:** 2
- **Status:** reviewed
- **Branch (when you start):** `kata-02-concurrency-locking`  (off `main`)
- **Spec:** `test/katas/kata-02-concurrency-locking.e2e-spec.ts` (RED)

---

## Anchor kata (input → required behavior)

50 parallel buys of the last stock item → exactly one wins, no oversell.

**New infra it forces:** none new — the `version` column already lives on `Product`.

---

## Concept brief

**What it is.** When two requests read the same row, decide based on what they
read, and both write back, one overwrites the other's change. That's a **lost
update** — the classic read-modify-write race. Selling stock is the textbook
case: both requests read `stock = 1`, both decide "there's enough", both write
`stock = 0` — and you've shipped two units you had one of.

**Why it matters.** Every "decrement a counter", "reserve a seat", "debit a
balance" endpoint has this race. It's invisible in dev (requests are serial) and
shows up in prod under load as oversold inventory, double-spends, negative
balances — data corruption you can't test away by clicking around.

**The three defenses (pick and know the trade-off):**

1. **Optimistic locking** — read the row + its `version`; on write, `UPDATE ...
   WHERE id = :id AND version = :v`. If someone else moved first, 0 rows update
   → you lost → retry or 409. Best when conflicts are *rare*. TypeORM
   `@VersionColumn` (already on `Product`) = JPA `@Version`.
2. **Pessimistic locking** — `SELECT ... FOR UPDATE` takes a row lock; other
   transactions block until you commit. Best when conflicts are *common*.
   TypeORM `.setLock('pessimistic_write')` = `SELECT ... FOR UPDATE`.
3. **Conditional atomic UPDATE** — `UPDATE products SET stock = stock - :q WHERE
   id = :id AND stock >= :q`. The DB does read + check + write as one atomic
   step; `affected === 0` means "not enough" → 409. Lock-free, no retry loop.

**Failure mode this defends against:** oversell / lost update under concurrency.

**Spring/JPA parallel:** `@Version` optimistic locking, `SELECT … FOR UPDATE`
pessimistic locking, and a conditional `@Modifying @Query` UPDATE — the exact
same three tools you'd reach for in the day job.

**Docs:**
- TypeORM locking — https://typeorm.io/select-query-builder#locking
- Postgres explicit locking — https://www.postgresql.org/docs/current/explicit-locking.html

---

## Acceptance criteria (the spec is the contract)

`POST /products/:id/purchase` with body `{ quantity }`:

- Successful buy → `200/201`, body `{ productId, quantity, remainingStock }`,
  product `stock` decremented by `quantity`.
- Not enough stock → `409 Conflict`, stock **unchanged**.
- **Nasty case:** stock = 1, 50 concurrent buys → exactly **one** `2xx`, the
  other 49 → `409`, final stock `0`, never negative, no `500`s.
- stock = 5, 30 concurrent buys → exactly **five** succeed, final stock `0`.

---

## Where you write code (all in `src/`, the logic is yours)

- `src/products/products.controller.ts` — add the `POST :id/purchase` route.
- `src/products/products.service.ts` — the purchase logic (the locking lives here).
- Reuse the `Product` entity's `stock` / `version` columns. No new table needed.

Run: `npm run test:kata -- test/katas/kata-02-concurrency-locking.e2e-spec.ts`
