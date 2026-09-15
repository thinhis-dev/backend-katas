# Kata 08 — Observability

- **Week:** 8
- **Status:** in progress
- **Branch:** `kata-08-observability`  (off `main`)
- **Spec:** `test/katas/kata-08-observability.e2e-spec.ts`  (RED. Do not edit.)
- **Run:** `npm run test:kata -- test/katas/kata-08-observability.e2e-spec.ts`

---

## Concept brief

Observability is the ability to answer "what happened to this one request?"
after the fact, from the signals the system emits. Three signals do most of the
work: logs (what happened), metrics (how much, how fast), and traces (the path
of one request across parts). This kata joins all three around a single
trace-id: one id per request, written on every log line, carried through a
background job, and timed by a latency metric.

The failure mode this kata defends against is the trace-id that vanishes at an
async boundary. A trace-id is easy to attach to one request. The id is hard to
keep once the work moves to a queue worker. The worker runs in its own loop and
shares no memory with the request. If you drop the id at that hop, the job logs
float free. You cannot tie a slow or failed job back to the caller.

Node carries per-request context with AsyncLocalStorage. AsyncLocalStorage is a
store that follows the async call chain of one request. That chain ends at the
queue. A BullMQ worker picks the job up later with an empty store. The id
survives only through the job payload. You put the id in the payload, then you
re-establish the context inside the worker.

Spring parallel: this is MDC plus a Micrometer timer. MDC (Mapped Diagnostic
Context) is a per-thread map of log fields. MDC is thread-local, so it does not
cross into an `@Async` thread pool on its own. You copy it across with a
`TaskDecorator`, that is the same move as copying the id onto the job here. The
latency metric is a Micrometer `Timer`, often applied with `@Timed`.

Docs: https://nodejs.org/api/async_context.html and
https://docs.nestjs.com/interceptors

---

## Acceptance criteria

All four assertions in the spec must pass. Then the kata is green.

1. A request gets a trace-id. An inbound `X-Request-Id` header is echoed. The
   response carries the id back in the `X-Request-Id` header.
2. When no id is supplied, the server generates one, and two requests get
   different ids. Context is per request, not one shared global.
3. The trace-id crosses the queue hop. The id on the POST request equals the id
   the worker records while it runs the job.
4. Each request records its latency. The metrics totals grow after traffic.

---

## API contract

The full contract lives in the spec header. Summary:

- `GET /observe/ping` returns `{ traceId }` and sets the `X-Request-Id` header.
- `POST /observe/jobs` with body `{ workMs? }` returns `202 { jobId }`.
- `GET /observe/jobs/:jobId` returns `{ state, traceId }`.
- `GET /observe/metrics` returns `{ count, sumMs }`.

---

## Your job (src/)

Create a new `src/observe/` module. Suggested parts:

- A context store built on `AsyncLocalStorage` that holds the current trace-id.
- Middleware or an interceptor that reads or generates `X-Request-Id`, runs the
  request inside the store, and writes the id on the response header.
- An interceptor that measures handler latency and adds it to a metrics counter.
- A controller with the four routes.
- A BullMQ queue and worker for `/observe/jobs`. Reuse the pattern in
  `src/jobs/jobs.module.ts`. Put the trace-id in the job data, and have the
  worker record the id it saw so `GET /observe/jobs/:jobId` can return it.

Reuse the shared Redis client from `src/redis/redis.module.ts`. Do not edit the
spec.

Boundaries: the teacher writes tests and this doc only. You write every line in
`src/`.

> Return with "done" for the review pass. If a test stays red, ask for a hint.
