# Roadmap, Spring parallels, per-topic nasty case, and hint tiers

Self-contained reference for the `kata` skill. The repo `CLAUDE.md` is the
authoritative contract; this file is the quick lookup.

## Roadmap + the "nasty case" each kata must test

| Wk | Topic (slug) | Anchor kata | The nasty case the spec MUST include | New infra |
|----|------|------|------|------|
| 1 | `idempotency` | `POST /orders` with `Idempotency-Key` | replay same key concurrently → still one order | `idempotency_keys` |
| 2 | `locking` | buy last unit of stock | 50 parallel buys via `Promise.all` → exactly one succeeds, no oversell | `version` col (present) |
| 3 | `transactions` | move money/stock between rows | force an error mid-transaction → nothing partially committed | `accounts` / `outbox` |
| 4 | `caching` | cache-aside product read | update invalidates cache; concurrent misses don't stampede | — |
| 5 | `queues` | offload a job to BullMQ | job fails N times → lands in a dead-letter queue, not lost | — (Redis) |
| 6 | `rate-limiting` | token-bucket per user | 101st request in a minute → `429` + `Retry-After` | — |
| 7 | `query-performance` | slow query over 1M rows | assert it uses an index / cursor pagination; no N+1 | — |
| 8 | `observability` | trace a request through a queue job | a trace-id is present end-to-end; a latency metric is recorded | — |

## Spring / JPA parallels (always mention the relevant one)

| NestJS / TypeORM | Spring / JPA |
|---|---|
| `@VersionColumn` | `@Version` (optimistic locking) |
| `.setLock('pessimistic_write')` | `SELECT … FOR UPDATE` |
| `dataSource.transaction()` / `QueryRunner` | `@Transactional` + isolation levels |
| unique constraint for idempotency | same pattern in JPA |
| ioredis `SETNX` / `SET NX PX` | distributed lock / idempotency guard |
| BullMQ processor + attempts/backoff | `@Async` + retry / a message listener with DLQ |
| Nest interceptor for timing | Spring AOP `@Around` / Micrometer timer |

## Hint tiers (escalate one at a time — NEVER paste a working solution)

1. **Restate** the failing assertion in plain language — what is it really asking?
2. **Name** the concept/tool to reach for (e.g. "a DB unique constraint", "a
   pessimistic lock", "Redis `SET key val NX PX`", "a BullMQ `attempts` option").
3. **Shape** — pseudocode only, no working TypeScript.
4. **Locate** — the exact file/method and the one-line approach; still not pasteable.

After tier 4, ask a Socratic question rather than handing over code.

## Contract reminders

- Spec file path: `test/katas/kata-<nn>-<slug>.e2e-spec.ts`, modelled on
  `test/health.e2e-spec.ts`.
- Run one kata: `npm run test:kata -- test/katas/kata-<nn>-<slug>.e2e-spec.ts`.
- Tests start RED. The learner writes all `src/` logic. Done = green spec + review.
