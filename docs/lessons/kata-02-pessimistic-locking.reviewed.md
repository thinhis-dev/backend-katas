# Kata 02 — Side note: doing it with a pessimistic lock instead

**Status:** reviewed

You solved the oversell race with **optimistic locking** (read `version`,
`UPDATE … WHERE id AND version`, retry on `affected === 0`). This note is the
alternative you asked about: the **pessimistic** lock — the one thing TypeORM
*does* wire up for you. Same green spec, different engine underneath.

Read this when you want to feel the trade-off. It is a refactor of
`src/products/products.service.ts` — **you write it**; this is the shape, not a
paste-in.

---

## The idea in one line

Instead of "hope nobody moved, detect it after, retry" (optimistic), pessimistic
is "**take the row for myself before I read it**; everyone else waits at the
door until I commit." The DB serializes the buyers for you — no version math, no
retry loop.

SQL underneath: `SELECT … FOR UPDATE`. The first transaction to grab the row
holds a **row-level write lock**; concurrent `SELECT … FOR UPDATE` on the same
row *block* until the holder commits or rolls back, then proceed one at a time
seeing the already-decremented stock.

---

## Two rules you cannot skip

1. **A lock only exists inside a transaction.** `FOR UPDATE` outside a tx is
   released instantly and buys you nothing. So the whole read-check-write must
   run in **one** transaction.
2. **The lock and the read must be the same statement.** You lock *by* reading
   with the lock mode — you don't read, then lock. In TypeORM that's
   `.setLock('pessimistic_write')` on the query that loads the row.

---

## The shape (fill in the blanks yourself)

```
async purchase(id, quantity):
  return dataSource.transaction(async (manager) => {
    // 1. LOAD + LOCK in one go — this is the SELECT ... FOR UPDATE
    const product = await manager
      .createQueryBuilder(Product, 'p')
      .setLock('pessimistic_write')
      .where('p.id = :id', { id })
      .getOne()

    // 2. guard: not found -> 404 ; stock < quantity -> 409
    //    (throwing here rolls the tx back automatically)

    // 3. decrement — a plain manager.update / save is fine now,
    //    because YOU hold the lock; nobody else can interleave
    product.stock -= quantity
    await manager.save(product)

    // 4. return { productId, quantity, remainingStock: product.stock }
  })
  // no retry loop, no `version` in the WHERE — the lock did the serializing
```

Notes:
- Use the transaction's `manager` for **every** query inside — a stray
  `this.productsRepo` call runs on a *different* connection, outside the lock,
  and defeats the whole thing.
- `version: version + 1` is no longer load-bearing here. `@VersionColumn` will
  still auto-bump on `save()`; harmless, just not what's protecting you anymore.
- The retry loop disappears. Contention shows up as **waiting**, not as
  `affected === 0`.

---

## Optimistic vs. pessimistic — when to pick which

| | Optimistic (what you built) | Pessimistic (this note) |
|---|---|---|
| Mechanism | version CAS + retry | `SELECT … FOR UPDATE`, others block |
| Best when | conflicts are **rare** | conflicts are **common** (flash sale, one hot SKU) |
| Cost under load | wasted work + retries when it's hot | throughput bottleneck — buyers serialize on the row |
| Failure signal | `affected === 0` (a 0-row result) | none — you just waited your turn |
| Deadlock risk | none | yes, if you lock multiple rows in inconsistent order |
| Holds a DB lock | no | yes, for the tx duration — keep the tx **short** |

Rule of thumb: **optimistic by default** (most endpoints are low-contention),
reach for **pessimistic** when you *know* everyone hammers the same row and the
retry storm would be worse than a queue at the door.

> Third option, cleanest for this exact case: the lock-free conditional update
> `UPDATE products SET stock = stock - :q WHERE id = :id AND stock >= :q`, then
> `affected === 0 ⇒ 409`. No version, no lock, no retry — one atomic statement.
> Worth trying too.

---

## Spring / JPA parallel (your day job)

- `.setLock('pessimistic_write')`  ≈  `@Lock(LockModeType.PESSIMISTIC_WRITE)` on
  the repository method, or `em.find(Entity, id, PESSIMISTIC_WRITE)`.
- `dataSource.transaction(...)`  ≈  `@Transactional` around the method.
- "lock only lives in a tx"  ≈  the identical rule in JPA — a pessimistic lock
  outside an active `@Transactional` throws / is meaningless.
- The difference you learned in this kata still stands: JPA's **optimistic**
  `@Version` is automatic (it throws `OptimisticLockException`); TypeORM's is
  not, so you hand-rolled it. **Pessimistic**, by contrast, both frameworks give
  you for real.

---

## Docs

- TypeORM locking — https://typeorm.io/select-query-builder#locking
- Postgres row locks (`FOR UPDATE`) — https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
- JPA `LockModeType` — https://jakarta.ee/specifications/persistence/3.0/apidocs/jakarta.persistence/jakarta/persistence/lockmodetype

---

## To actually try it

The spec doesn't care *how* you win the race, only that you do:

```
npm run test:kata -- test/katas/kata-02-concurrency-locking.e2e-spec.ts
```

Refactor `purchase()` to the shape above, keep it green, and notice: the
`ok.length === 5 / stock === 0` assertions pass the same, but now they pass
because buyers **queued**, not because losers **retried**.
