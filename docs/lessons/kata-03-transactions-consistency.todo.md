# Kata 03 — Transactions & consistency

- **Week:** 3
- **Status:** todo
- **Branch:** `kata-03-transactions`  (off `main`) — `git checkout -b kata-03-transactions`
- **Spec:** `test/katas/kata-03-transactions.e2e-spec.ts`  *(do NOT edit — it is the contract)*
- **Run:** `npm run test:kata -- test/katas/kata-03-transactions.e2e-spec.ts`

---

## Anchor kata (input → required behavior)

Move money between two accounts → **both rows change or neither**; survive a
failure mid-transfer with no partial commit.

**New infra it forces:** `accounts` table (scaffolded — columns only).

---

## Concept brief

A **transaction** is a group of writes the DB treats as one indivisible unit:
**A**tomic (all or nothing), **C**onsistent, **I**solated, **D**urable. This kata
is about the **A** — atomicity across *two rows*.

**The failure mode it defends against.** A transfer is two writes — debit the
source, credit the destination. Done naively they are two independent statements:

```
source.balance -= amount;  save(source);   // ← committed
dest.balance   += amount;  save(dest);     // ← what if THIS throws?
```

If anything dies between them (destination doesn't exist, process crashes, the
pool drops the connection), the source is **already debited** and the money has
evaporated. The invariant that must survive any failure: **total money across the
two accounts is conserved** — no partial commit ever creates or destroys value.
That only holds if both writes commit together or neither does.

Two dangers stack this week — you need both defenses:

- **Atomicity** (this week) → wrap debit + credit in one transaction so a
  mid-transfer failure rolls the whole thing back.
- **Isolation / lost updates** (Week 2, back again) → under concurrency two
  transfers reading the same balance can lose each other's update. Use the
  locking you already know (`FOR UPDATE`, `@VersionColumn`, or a conditional
  `UPDATE … WHERE balance_cents >= :amt`) **inside** the transaction.

**Spring/JPA parallel.** This is `@Transactional` wrapping both writes in one unit
of work. TypeORM makes it explicit: `dataSource.transaction(async (mgr) => { … })`
or a `QueryRunner` (`startTransaction` / `commitTransaction` / `rollbackTransaction`).
The callback's `return` **is** the COMMIT; a throw anywhere inside **is** the
ROLLBACK. (Kata-02's sting still applies: an un-`await`ed write inside the
callback escapes the transaction and commits on its own.)

**Docs:**
- TypeORM transactions — https://typeorm.io/transactions
- Postgres `SELECT … FOR UPDATE` — https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE

---

## API contract

```
POST /accounts/:id/transfer          (:id is the SOURCE account)
  body: { "toAccountId": "<uuid>", "amountCents": <positive int> }

  -> 200/201  { fromAccountId, toAccountId, amountCents,
                fromBalanceCents, toBalanceCents }
             (source debited AND destination credited by amountCents)
  -> 409      insufficient funds        (BOTH balances UNCHANGED — clean no-op)
  -> 404      destination doesn't exist (source balance UNCHANGED)
```

---

## Test cases (what grades you)

1. **Valid transfer moves both rows.** A=1000, B=0, transfer 300 → A=700, B=300.
2. **Over-balance → `409`, both balances untouched.** A=100, transfer 500 → 409;
   A still 100, B still 0 (atomic no-op).
3. **Non-existent destination → source debit rolls back.** A control transfer
   first proves the endpoint is live and actually moves money (A→900); then a
   transfer into a random uuid must fail *without* leaving the source at 700. A
   naive debit-then-credit leaks the money here; a transactional one doesn't.
4. **Money conserved under concurrency.** A=1000, B=0; fire 20 transfers of 100
   A→B via `Promise.all`, repeated over 4 fresh rounds. **Exactly 10** succeed,
   10 get `409`; `A+B` is **always** 1000; no balance ever negative; A ends 0,
   B ends 1000. No `500`s, no oversend.

---

## Acceptance criteria

All 4 tests green — no `500`s, no oversend, money conserved on every round.
Done = green spec **and** the teacher's review pass.

---

## Files

**Scaffolded for you (columns only — logic is yours):**
- `src/accounts/account.entity.ts` — `Account` { id, name, balanceCents, version, updatedAt }
- `db/migrations/1789200000000-CreateAccounts.ts` — already applied to the dev DB

**You create (all business logic):**
- `src/accounts/accounts.module.ts`
- `src/accounts/accounts.controller.ts` — `POST /accounts/:id/transfer`
- `src/accounts/accounts.service.ts` — the transactional transfer
- a DTO for the body (mirror `src/products/dto` + the global `ValidationPipe`)
- register `AccountsModule` in `src/app.module.ts`

---

## Hints (ask for one tier at a time — never the solution)

1. Restate the failing assertion in plain language.
2. Name the tool: a DB transaction + a row lock / conditional update.
3. Shape it in pseudocode — no working TypeScript.
4. Point at the exact file/method and the one-line approach.

## Things to be ready to defend in review

- Where exactly is the COMMIT, and where is the ROLLBACK, in your code?
- If the process were `kill -9`'d between the debit and the credit, what state
  would the DB be in? Why?
- How do two concurrent transfers on the same source avoid a lost update — which
  line enforces it, and is it inside or outside the transaction?
- Why integer cents and never a float for money?
