# Kata 01 — Idempotency

- **Week:** 1
- **Status:** doing
- **Branch:** `kata-01-idempotency` (off `main`)
- **Spec (contract, do not edit):** `test/katas/kata-01-idempotency.e2e-spec.ts`
- **Run:** `npm run test:kata -- test/katas/kata-01-idempotency.e2e-spec.ts`

---

## Key concept

An operation is **idempotent** when running it twice has the same effect as
running it once. `POST /orders` is *not* naturally idempotent — each call wants a
new row. Idempotency is how you make an unsafe write safe to retry.

**Failure mode it defends against:** the client sends `POST /orders`, the order
is created, but the `201` is lost to a timeout. The client retries the *same*
intent → **two orders, one intent** → double charge. The classic checkout bug.

**The fix:** the client stamps each intent with a unique `Idempotency-Key`. The
server remembers "seen this key → here's the order I made" and replays the stored
result instead of redoing the work.

**The nasty part (the real lesson):** two identical requests arriving *at the
same time*. Both check "seen this key?" → both see "no" → both insert. A naive
check-then-insert has a race window. The senior move: let the **database** own
uniqueness (a `UNIQUE` constraint on the key) so one insert wins and the other
hits a constraint violation you catch — not an app-level `if`.

### Spring / JPA parallel

Same defense you'd write at your day job: `@Transactional` around a write guarded
by a `UNIQUE` constraint (or a dedicated idempotency table). The unique violation
you catch here is the same `DataIntegrityViolationException` you'd catch in
Spring — different framework, identical shape.

### Docs (day reading)

- Stripe — Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- IETF draft — Idempotency-Key HTTP header:
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/

---

## What I need to do

Create a new `orders` module in `src/`. The teacher wrote the spec; you write
every line of solution code.

- [ ] `src/orders/order.entity.ts` — the orders table (`id`, `productId`, `quantity`)
- [ ] **The store you must discover:** where does `key → order` live? Design that
      entity yourself. *Figuring out what to store is half the lesson.*
- [ ] Migration for the new table(s): `npm run migration:generate -- db/migrations/CreateOrders`
- [ ] `src/orders/orders.service.ts` — the idempotency logic
- [ ] `src/orders/orders.controller.ts` — `POST /orders`; read the header with
      `@Headers('idempotency-key')`; reject when it's missing
- [ ] `src/orders/orders.module.ts` — register it in `src/app.module.ts`

**Gotcha:** the e2e tests boot via `createNestApplication()`, which does **not**
run `main.ts`, so the global `ValidationPipe` is inactive in tests. Enforce the
missing-key `400` explicitly in the controller — don't lean on a pipe.

---

## Acceptance criteria

All 4 spec assertions green. Contract:

```
POST /orders
  headers: { "Idempotency-Key": "<unique key>" }
  body:    { "productId": "<uuid>", "quantity": <positive int> }
  -> 201  body: { id, productId, quantity }
```

---

## Test cases (from the spec)

| # | Case                          | Expected                              |
|---|-------------------------------|---------------------------------------|
| 1 | Create with a key             | `201`, body has `id`                  |
| 2 | Replay the **same** key       | same `id`, no duplicate row           |
| 3 | Two **different** keys        | two different `id`s                   |
| 4 | **Missing** key               | `400 Bad Request`                     |

**Not in the spec, but defend against it anyway:** the concurrent double-submit
(two identical requests via `Promise.all`). A DB `UNIQUE` constraint makes this
free. Ask the teacher to harden the spec with a concurrent test once you're green
if you want to prove your defense holds.

---

## Definition of done

Green e2e **and** the teacher's review pass. Then:

1. `git mv` this file to `kata-01-idempotency.reviewed.md`
2. Update the `LOG.md` row (status, what broke, the one idea that stuck)
3. Commit: `git commit -m "kata-01: idempotent orders"`

## Stuck?

Ask the teacher for a hint — you'll get one tier at a time (restate → name the
tool → pseudocode shape → exact file+line), never the full solution.
</content>
