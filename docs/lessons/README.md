# Lessons — your task board

One file per kata. **The status lives in the filename** so `ls` tells you where
you are:

```
kata-<nn>-<slug>.<status>.md
                   └─ todo → doing → green → reviewed
```

| Status     | Meaning                                                        |
|------------|----------------------------------------------------------------|
| `todo`     | Not started. Detail may be a stub until you begin the kata.    |
| `doing`    | Assignment handed off; you're implementing `src/`.             |
| `green`    | The e2e spec passes. Not done yet — review still pending.      |
| `reviewed` | Green **and** the teacher reviewed your diff. Kata complete.   |

Advance a kata by renaming the file, e.g.:

```bash
git mv docs/lessons/kata-01-idempotency.doing.md \
       docs/lessons/kata-01-idempotency.green.md
```

You normally don't rename by hand: when you're done, run **`/kata-review`** (or
just say *"done"*). It runs the kata's e2e spec, reviews your `src/` diff if it's
green, then advances this file's status **and** the `LOG.md` row for you. If the
spec is still red it gives you the next hint instead — and marks nothing.

This board is the **forward** view (concept, what to do, ACs, test cases).
`LOG.md` at the repo root is the **backward** view (what broke, what stuck) —
your interview story bank. Keep both.

Each file mirrors the real contract in `test/katas/kata-<nn>-<slug>.e2e-spec.ts`
— but **the spec is the source of truth**, not this note. If they ever disagree,
the spec wins.
</content>
</invoke>
