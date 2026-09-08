# Learning Log

The AI teacher reads this file to know where you are. Keep one row per night —
what you attempted, what broke, and the one idea that stuck. This is your
interview story bank in 8 weeks.

| Date       | Kata                 | Status      | What broke | What I learned |
|------------|----------------------|-------------|-----------|----------------|
| 2026-09-08 | kata-01-idempotency  | reviewed    | naive check-then-insert races; caught 23505 backwards; `save()` on assigned PK silently UPDATEs | claim + result in ONE tx ⇒ the loser's blocked INSERT only fails *after* the winner commits, so a plain read already sees the result — no lock/poll needed |
| 2026-09-08 | kata-02-concurrency-locking | reviewed | naive read-modify-write oversold 50/1; `repo.save()` bumps `@VersionColumn` but does NOT guard on it (SQL: `WHERE id` only) so it never throws → retry never fired; mixed save()-vs-QueryBuilder conflict signals | TypeORM ≠ JPA: `save()` won't do the optimistic CAS Hibernate does automatically — you hand-roll `UPDATE … SET version=version+1 WHERE id AND version=loaded` and retry on `affected===0`. Conflict is a 0-row result, not an exception |
| 2026-09-08 | kata-02 (pessimistic variant) | reviewed | `pessimistic_read` (`FOR SHARE`) let all 50 buyers hold the row at once → oversell; an un-`await`ed `save()` committed before the write flushed → `Connection terminated` on teardown | a pessimistic lock only serializes with `FOR UPDATE` **and** finishing the write before returning — the callback's `return` *is* the COMMIT, so an unawaited write escapes the transaction |

<!--
Status values: not started | in progress | green (tests pass) | reviewed
Add a new row per kata. Do not delete old rows — the history is the point.
-->
