import { Inject, Module, OnModuleDestroy } from '@nestjs/common'
import { JobsController } from './jobs.controller'
import { REDIS } from '../redis/redis.module'
import { Job, Queue, Worker } from 'bullmq'
import { JOBS_QUEUE, JOBS_WORKER } from './jobs.token'
import { CreateJobBody } from './jobs.type'
import Redis from 'ioredis'

@Module({
  controllers: [JobsController],
  providers: [
    {
      provide: JOBS_QUEUE,
      inject: [REDIS],
      useFactory: (redis) => new Queue('jobs', { connection: redis }),
    },
    {
      provide: JOBS_WORKER,
      inject: [REDIS],
      useFactory: (redis: Redis) => {
        const worker = new Worker(
          'jobs',
          async (job: Job<CreateJobBody>) => {
            const key = `jobs:runs:${job.id}`

            const run = await redis.incr(key)
            await redis.expire(key, 3600)

            const failBudget = job.data.failTimes ?? 0

            if (run <= failBudget) {
              throw new Error(`Forced failure for run: ${run}`)
            }

            const workMs = job.data.workMs ?? 0
            await (() => new Promise((r) => setTimeout(r, workMs)))()

            return
          },
          {
            connection: redis,
          },
        )
        
        // worker.on('failed', async (job?: Job) => {
        //   if (
        //     job &&
        //     job.id &&
        //     job.attemptsMade &&
        //     job.opts.attempts &&
        //     job.attemptsMade >= job.opts.attempts
        //   ) {
        //     await redis.rpush('jobs:dead-letter', job.id)
        //   }
        // })

        return worker
      },
    },
  ],
  exports: [JOBS_QUEUE],
})
export class JobsModule implements OnModuleDestroy {
  constructor(
    @Inject(JOBS_QUEUE) private queue: Queue,
    @Inject(JOBS_WORKER) private worker: Worker,
  ) {}

  async onModuleDestroy() {
    await this.worker.close() // worker must be closed first
    await this.queue.close()
  }
}
export { JOBS_QUEUE }
