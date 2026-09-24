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
import { OBSERVE_QUEUE, OBSERVE_WORKER, ObserverJob } from './observe.constant'
import {
  ObserveController,
  SetTraceIdHeaderMiddleWare,
} from './observe.controller'

@Module({
  controllers: [ObserveController],
  providers: [
    {
      provide: OBSERVE_QUEUE,
      inject: [REDIS],
      useFactory: (redis) => new Queue('observe', { connection: redis }),
    },
    {
      provide: OBSERVE_WORKER,
      inject: [REDIS],
      useFactory: (redis: Redis) => {
        const worker = new Worker(
          'observe',
          async (observe: Job<ObserverJob>) => {
            const workMs = observe.data.workMs ?? 0
            await (() => new Promise((r) => setTimeout(r, workMs)))()

            return
          },
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
