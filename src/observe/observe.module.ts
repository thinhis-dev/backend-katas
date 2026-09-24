import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleDestroy,
} from '@nestjs/common'
import { REDIS } from '../redis/redis.module'
import { Job, Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import {
  OBSERVE_QUEUE,
  OBSERVE_WORKER,
  ObserverJob,
  ObserverJobResult,
} from './observe.constant'
import {
  ObserveController,
  SetTraceIdHeaderMiddleWare,
} from './observe.controller'
import { currentTraceId, traceStorage } from './trace-context'
import { LatencyInterceptor } from './latency.interceptor'
import { LatencyMetricsService } from './latency-metrics.service'

@Module({
  controllers: [ObserveController],
  providers: [
    LatencyMetricsService,
    LatencyInterceptor,
    {
      provide: OBSERVE_QUEUE,
      inject: [REDIS],
      useFactory: (redis) => new Queue('observe', { connection: redis }),
    },
    {
      provide: OBSERVE_WORKER,
      inject: [REDIS],
      useFactory: (redis: Redis) => {
        const worker = new Worker<ObserverJob, ObserverJobResult>(
          'observe',
          // The worker loop starts with an EMPTY store. Re-open it with the id
          // that rode in the payload, so any code inside (a logger, a nested
          // call) sees the id of the request that created the job.
          (job: Job<ObserverJob>) =>
            traceStorage.run({ traceId: job.data.traceId }, async () => {
              const workMs = job.data.workMs ?? 0
              await new Promise((r) => setTimeout(r, workMs))

              // Read back from the store, not from job.data, to prove the
              // context really holds inside the worker.
              // BullMQ saves this return value as job.returnvalue.
              return { traceId: currentTraceId()! }
            }),
          {
            connection: redis,
          },
        )

        return worker
      },
    },
  ],
  exports: [OBSERVE_QUEUE],
})
export class ObserveModule implements OnModuleDestroy, NestModule {
  constructor(
    @Inject(OBSERVE_QUEUE) private queue: Queue,
    @Inject(OBSERVE_WORKER) private worker: Worker,
  ) {}

  async onModuleDestroy() {
    await this.worker.close() // worker must be closed first
    await this.queue.close()
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SetTraceIdHeaderMiddleWare).forRoutes(ObserveController)
  }
}
export { OBSERVE_QUEUE }
