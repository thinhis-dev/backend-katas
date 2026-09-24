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

All five tests in the spec must pass. Then the kata is green.

1. A request gets a trace-id. An inbound `X-Request-Id` header is echoed. The
   response carries the id back in the `X-Request-Id` header.
2. When no id is supplied, the server generates one, and two requests get
   different ids. Context is per request, not one shared global.
3. The trace-id crosses the queue hop. The id on the POST request equals the id
   the worker records while it runs the job.
4. A generated id also crosses the queue hop. When the POST request has no
   header, the id on the response header equals the id that the worker records.
5. Each request records its latency. The metrics totals grow after traffic.

---

## API contract

The full contract lives in the spec header. Summary:

- `GET /observe/ping` returns `{ traceId }` and sets the `X-Request-Id` header.
- `POST /observe/jobs` with body `{ workMs? }` returns `202 { jobId }`.
- `GET /observe/jobs/:jobId` returns `{ state, traceId }`.
- `GET /observe/metrics` returns `{ count, sumMs }`.

---

## Implementation walkthrough

This section is the step order. It names each file and the job of each part.
You write the code. Run the spec after each step, and make sure that the
named test turns green before you go on.

### The one idea

One request gets one id. Only the middleware makes that id. Every other part
reads the id from the store and never makes its own. The worker has no store,
so the id travels in the job data, and the worker opens a new store with it.

The flow for `POST /observe/jobs` with no header:

```
HTTP request
  -> middleware: id = header or new id "A"
                 set response header X-Request-Id: A
                 als.run({ traceId: A }, next)   // everything after this sees A
  -> controller createJob: id = als.getStore().traceId   // A, not a new id
                 queue.add('job', { workMs, traceId: A })
  -> response 202 { jobId }, header X-Request-Id: A
        ... Redis holds the job ...
worker loop (no request, empty store)
  -> processor(job): als.run({ traceId: job.data.traceId }, work)
                 work reads als.getStore().traceId      // A again
                 return { traceId: A }                  // BullMQ saves it as job.returnvalue
GET /observe/jobs/:jobId
  -> job = queue.getJob(jobId)
  -> { state: job.getState(), traceId: job.returnvalue?.traceId ?? null }
```

### Step 1. Create one shared store

Create `src/observe/trace-context.ts`. Export one `AsyncLocalStorage` instance
typed as `{ traceId: string }`. Add a small helper that returns the current
trace-id, or `undefined` when no store is open.

This instance must be a module-level constant. The middleware, the controller,
and the worker all import the same instance. The instance itself is shared, but
each `run()` call gives its callback a separate store. That is why two requests
at the same time do not mix their ids.

Spring parallel: the instance is `MDC`, `run()` is `MDC.put` plus the cleanup
in `finally`, and `getStore()` is `MDC.get`.

### Step 2. Open the store in the middleware

In `SetTraceIdHeaderMiddleWare.use()`, keep the code that picks the id and sets
the response header. Change the last line: call `next()` inside `run()` on your
store, not by itself. Everything that Nest runs after `next()` for this request
now sees the store.

Tests 1 and 2 turn green when `ping()` returns the id from the helper.

### Step 3. Read the id in createJob

In `ObserveController.createJob`, delete the `@Headers('X-Request-Id')`
parameter and the `Math.random()` line. Get the id from the helper of step 1.
Put that id in the job data. Return only `{ jobId }`, because the contract has
no `traceId` in the POST body.

### Step 4. Reopen the store in the worker

In `observe.module.ts`, change the worker processor. Wrap the work in `run()`
on the same store, with `job.data.traceId` as the store value. Inside the
callback, do the `workMs` sleep, then read the id back from the helper and
return it in an object.

BullMQ saves the return value of the processor on the job in Redis as
`job.returnvalue`. You do not need a separate Redis key.

Why not return `job.data.traceId` directly? That passes the test but skips the
lesson. The read from the store proves that code inside the worker, for
example a logger, sees the id of the request that created the job.

### Step 5. Return the id from GET /observe/jobs/:jobId

In `ObserveController.getJob`, replace `runs` with `traceId`. Read it from
`job.returnvalue`. Return `null` when the job has no return value yet, and for
the not-found case. Delete the `jobs:runs` Redis read, which this kata does not
use.

Tests 3 and 4 turn green after this step.

### Step 6. Count latency in an interceptor

Create `src/observe/latency.interceptor.ts`. In `intercept()`, record the start
time. Call `next.handle()` and use the RxJS `finalize` operator to add the
elapsed milliseconds to a running `count` and `sumMs`. Keep the two totals in
an `@Injectable()` service, so the interceptor and the controller share one
instance.

Register the interceptor on the controller with `@UseInterceptors`, or for the
whole app with `APP_INTERCEPTOR`. `getMetrics()` returns the two totals from
the service.

Test 5 turns green after this step.

Spring parallel: the interceptor is a Micrometer `Timer` around the handler,
the same as `@Timed`.

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
