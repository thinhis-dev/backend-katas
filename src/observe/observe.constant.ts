export const OBSERVE_QUEUE = 'OBSERVE_QUEUE'
export const OBSERVE_WORKER = 'OBSERVE_WORKER'

export type CreateObserveJobBody = {
  workMs?: number
}

export type ObserverJob = CreateObserveJobBody & {
  traceId: string
}
