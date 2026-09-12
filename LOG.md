# Learning Log

The AI teacher reads this file to know where you are. Keep one row per night —
what you attempted, what broke, and the one idea that stuck. This is your
interview story bank in 8 weeks.

| Date       | Kata                 | Status      | What broke | What I learned |
|------------|----------------------|-------------|-----------|----------------|
| 2026-09-08 | kata-01-idempotency  | reviewed    | naive check-then-insert races; caught 23505 backwards; `save()` on assigned PK silently UPDATEs | claim + result in ONE tx ⇒ the loser's blocked INSERT only fails *after* the winner commits, so a plain read already sees the result — no lock/poll needed |
| 2026-09-08 | kata-02-concurrency-locking | reviewed | naive read-modify-write oversold 50/1; `repo.save()` bumps `@VersionColumn` but does NOT guard on it (SQL: `WHERE id` only) so it never throws → retry never fired; mixed save()-vs-QueryBuilder conflict signals | TypeORM ≠ JPA: `save()` won't do the optimistic CAS Hibernate does automatically — you hand-roll `UPDATE … SET version=version+1 WHERE id AND version=loaded` and retry on `affected===0`. Conflict is a 0-row result, not an exception |
| 2026-09-08 | kata-02 (pessimistic variant) | reviewed | `pessimistic_read` (`FOR SHARE`) let all 50 buyers hold the row at once → oversell; an un-`await`ed `save()` committed before the write flushed → `Connection terminated` on teardown | a pessimistic lock only serializes with `FOR UPDATE` **and** finishing the write before returning — the callback's `return` *is* the COMMIT, so an unawaited write escapes the transaction |
| 2026-09-09 | kata-03-transactions | reviewed | locked rows via `manager` but saved via `this.accountsRepo` → writes ran on a 2nd connection, blocked on the tx's own `FOR UPDATE` locks → hung until timeout; `catch{}` masks DB errors as a generic 400 | the whole unit of work rides ONE transactional handle — reads AND writes go through the same `manager` (Spring: escaping `@Transactional` into a `REQUIRES_NEW` EM self-deadlocks the same way) |
| 2026-09-09 | kata-03b lock-ordering (extension) | reviewed | `from`-then-`to` locking = caller-supplied order; concurrent A→B and B→A grabbed the same 2 rows in opposite order → `40P01 deadlock detected` (invisible to the money-conservation check — the victim rolls back clean) | deadlock-free = every tx locks resources in ONE global total order; the order is arbitrary, consistency is everything (sort the 2 ids, lock smaller first). Still TODO: drop the swallowing `catch`, DRY the two lock branches |
| 2026-09-12 | kata-04-caching | reviewed | `self.crypto` (browser global) → `ReferenceError` 500 on every cache miss; then a false alarm — drained shared-DB stock (kata-02 `kata02-*` corpses + idempotent seed that never tops up) made the invalidation test fail at `stock>0`, not in my code; unawaited `redis.del`. Still TODO: gaps (a)–(e) below | cache-aside = app owns the logic; single-flight via a real distributed lock (`SET NX PX` + unique token + Lua compare-and-del release) so 20 cold reads = 1 DB hit; invalidate **after** commit and keep all Redis I/O out of the open tx (they're two systems, no 2-phase commit → add a TTL backstop). Reviewer gaps to fix: (a) TTL<load ⇒ 2nd loader, (b) loser-timeout should be 503 not 404, (c) no TTL on cached value, (d) namespace keys `product:<id>`, (e) tidy waitForCache/counter |

<!--
Status values: not started | in progress | green (tests pass) | reviewed
Add a new row per kata. Do not delete old rows — the history is the point.
-->
