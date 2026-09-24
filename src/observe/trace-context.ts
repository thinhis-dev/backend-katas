import { AsyncLocalStorage } from 'node:async_hooks'

export type TraceContext = { traceId: string }

// One shared instance. Each run() call gives its callback a separate store,
// so concurrent requests never see each other's id.
export const traceStorage = new AsyncLocalStorage<TraceContext>()

export const currentTraceId = (): string | undefined =>
  traceStorage.getStore()?.traceId
