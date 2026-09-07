# Learning Log

The AI teacher reads this file to know where you are. Keep one row per night —
what you attempted, what broke, and the one idea that stuck. This is your
interview story bank in 8 weeks.

| Date       | Kata                 | Status      | What broke | What I learned |
|------------|----------------------|-------------|-----------|----------------|
| 2026-09-08 | kata-01-idempotency  | reviewed    | naive check-then-insert races; caught 23505 backwards; `save()` on assigned PK silently UPDATEs | claim + result in ONE tx ⇒ the loser's blocked INSERT only fails *after* the winner commits, so a plain read already sees the result — no lock/poll needed |

<!--
Status values: not started | in progress | green (tests pass) | reviewed
Add a new row per kata. Do not delete old rows — the history is the point.
-->
