# Kata 05 — Queues & jobs

- **Week:** 5
- **Status:** reviewed
- **Branch:** `kata-05-queues-jobs`  (off `main`)
- **Spec:** `test/katas/kata-05-queues-jobs.e2e-spec.ts`  *(the contract — do NOT edit)*

---

## Concept brief

**What a queue is.** A queue splits *asking for work* from *doing work*. The web
handler (the **producer**) writes a job into Redis and returns; a separate
**worker** loop pulls the job out and runs it. They share nothing but Redis. In
BullMQ that's a `Queue` (`queue.add(name, data, opts)`) on the producer side and
a `Worker(name, async (job) => {...}, { connection })` on the consumer side.

**Why it matters.** Three payoffs, each a real failure it defends against:

1. **Latency** — the caller shouldn't wait on slow side-work (email, PDF, a
   webhook). Enqueue in ~1ms, return `202`, do the 800ms of work off the request.
2. **Durability** — the job is a row in Redis, not a stack frame. If the process
   crashes mid-work, the job is still there and gets re-run. A plain in-process
   `@Async` task dies with the process — the work is just *gone*, silently.
3. **Retry + isolation** — transient failures (a flaky SMTP server) get retried
   with backoff instead of surfacing as a 500 to the user; a permanently-broken
   job is quarantined (dead-letter) instead of looping forever or vanishing.

**The failure mode this kata targets:** a job that keeps failing must not be
*lost*. Naive fire-and-forget has no record and no retry; this kata forces
retry-with-backoff and a **dead-letter list** you can inspect.

**Spring/JPA parallel.** You've used `@Async` and `@Scheduled` by just adding the
annotation. Under the hood `@Async` hands your method to a `TaskExecutor` thread
pool — in-memory, so a crash before the pool drains loses the task, and there's
no built-in retry or DLQ. `@Retryable` (Spring Retry) adds attempts/backoff but
still in-process. BullMQ is the durable, cross-process version: Redis is the
thread pool's backing store, `attempts`/`backoff` are the `@Retryable` knobs, and
the dead-letter list is the `@Recover` / error queue you'd otherwise hand-roll.
Wiring it yourself is the point — it shows what the annotation was doing for you.

Docs: https://docs.bullmq.io/guide/jobs · https://docs.bullmq.io/guide/retrying-failing-jobs

---

## When you actually need a queue (and when it's overengineering)

A queue is not free: it's a second piece of infra to run, monitor, and reason
about (Redis + a worker process), plus a whole class of new problems —
at-least-once delivery, idempotent handlers, ordering, poison messages, backlog.
Reach for it only when the work has one of these **real** properties:

- **Slow work the caller shouldn't wait on.** Sending an email/SMS, generating a
  PDF or report, transcoding an image/video, calling a slow third-party API.
  *Real problem:* checkout takes 4s because you `await` the confirmation email
  through a flaky SMTP server, and when SMTP is down the whole order 500s. Move
  the email to a queue → checkout returns in 200ms and the email retries itself.
- **Work that must survive a crash / must not be lost.** Anything with money,
  fulfillment, or "we promised the user we'd do this." *Real problem:* a fire-
  and-forget `@Async` task to charge a card runs in a thread pool; the pod is
  redeployed mid-flight → the charge is silently gone with no record. A queued
  job is a durable row in Redis that re-runs.
- **Spiky load you want to smooth.** 10k webhooks arrive in a burst but your DB
  can only take 500/s. The queue is a *buffer* — workers drain it at a safe rate
  instead of the burst knocking the DB over.
- **Fan-out / retryable integration.** One order event needs to hit search-index
  + analytics + a partner API, each of which fails independently and should retry
  on its own without re-charging the card.
- **Scheduled / recurring work.** Nightly reconciliation, "cancel unpaid orders
  after 30 min." (In BullMQ v6 this is *Job Schedulers*, not the old `repeat`.)

### You probably DON'T need a queue when…

- The work is **fast and in-process** (a few ms of CPU, one local DB write) — just
  do it inline. A queue adds latency and a failure mode to save nothing.
- The caller **needs the result now** to respond (it's request/response, not
  fire-and-forget). Queuing then blocking-polling for the result reinvents a slow
  synchronous call.
- **A DB transaction already gives you the guarantee.** If "both rows change or
  neither" is the need, that's kata-03's transaction, not a job.
- You reach for it **"for scale" with no measured problem.** One box, low traffic,
  work that finishes in 50ms → inline is correct. Add the queue when a real
  number hurts (p99 latency, a lost-task incident, a DB overload), not before.

**The one-line test:** *"If this work fails or is slow, does the user's request
need to fail or wait?"* No → queue it. Yes → keep it inline (and make it fast).

*Spring parallel:* same call you make when deciding between doing work in the
request thread, handing it to `@Async`, or putting it on a real broker
(Rabbit/Kafka/SQS). The annotation makes `@Async` look free — it isn't; it just
hides the same trade-off this section makes explicit.

---

## Acceptance criteria (what the spec asserts)

1. **Offload** — `POST /jobs {workMs:800}` returns `202 {jobId}` in <500ms, and
   at return time the job is not yet `completed`; the worker completes it later
   (`runs === 1`). Proves the handler enqueues instead of running work inline.
2. **Retry** — `POST /jobs {failTimes:2}` (within the 3-attempt budget) ends
   `completed` with `runs === 3`: it didn't give up on the first throw.
3. **Dead-letter (nasty case)** — `POST /jobs {failTimes:99}` ends `failed` with
   `runs === 3` (burned the whole budget) **and** its `jobId` appears in
   `GET /jobs/dead-letter`. The job is quarantined, not lost.

Queue config is part of the contract: **attempts = 3** with a short backoff.

---

## What to build in `src/`

- A `JobsModule` with:
  - a BullMQ **`Queue`** provider (use the existing Redis connection — note
    `maxRetriesPerRequest: null` is already set on the `REDIS` client, which
    BullMQ requires) and a **`Worker`** whose processor honors `failTimes` /
    `workMs` and increments a per-job `runs` counter (in Redis, keyed by jobId).
  - a **controller**: `POST /jobs`, `GET /jobs/:jobId`, `GET /jobs/dead-letter`.
  - graceful shutdown: close the Worker and Queue in `onModuleDestroy` (else Jest
    hangs on open Redis handles).
  - dead-letter: on the worker `failed` event, when a job has used its last
    attempt, push its id onto a Redis list you read back in `/jobs/dead-letter`.
- Register `JobsModule` in `src/app.module.ts`.
- `bullmq` (**v6.3.4**) and `ioredis` are already installed. `@nestjs/bullmq` is
  **not** — you can add it if you want the decorator style, but raw `bullmq`
  (Queue + Worker) is the more instructive path here and needs no new dependency.

### BullMQ v6 notes (we're on v6, not the v5 most tutorials show)

- **Redis floor raised** to 6.2+; this box runs Redis 7.4, so you're fine.
- **`ioredis` is now an optional peer dependency** of BullMQ (v6 no longer pulls
  it in itself). It's already a direct dep here, so nothing to do — but it's why
  v6 makes you be explicit about the connection.
- The `{ connection: { host, port, maxRetriesPerRequest: null } }` option on
  `new Queue(...)` / `new Worker(...)` is unchanged — verified working on v6.3.4.
  `job.getState()`, the worker `'failed'` event, and `attempts`/`backoff` are all
  as the v5 docs describe.
- **Gone in v6** (don't reach for these in old examples): the `repeat` option and
  legacy repeatable jobs (use *Job Schedulers* now), `Job#discard()` (throw
  `UnrecoverableError` to stop retries instead), and the separate `paused` job
  state (paused jobs now read as `waiting`). None affect this kata.

Run: `npm run test:kata -- test/katas/kata-05-queues-jobs.e2e-spec.ts`

---

## Parking lot (Redis/BullMQ questions to revisit later)

- How does the worker actually pull jobs — polling vs. blocking (`BRPOPLPUSH`)?
- What's the difference between BullMQ's own `attemptsMade` and our `runs`?
- BullMQ has no native DLQ — why do we forward failures to our own list?
  → **Resolved in review:** don't. BullMQ routes a still-retriable throw to
  `delayed` and only an *exhausted* one to the `failed` set, so `queue.getFailed()`
  *is* the DLQ — crash-durable, and it already applies the `attemptsMade >= attempts`
  guard for you. The `worker.on('failed')` + `RPUSH` copy was a best-effort shadow
  of state the queue already owns (lost if the process dies in the gap); deleted it.
  `lockDuration`/stalled-job detection is a *different* failure (worker dies while a
  job is `active`), not this one.
- Concurrency: what does `Worker`'s `concurrency` option change, and locking?
- `UnrecoverableError` (v6): how to make a job fail *without* burning its retries
  — the "this will never work, don't bother retrying" signal.
