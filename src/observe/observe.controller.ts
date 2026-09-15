import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { JobState, Queue } from 'bullmq'
import { REDIS } from '../redis/redis.module'
import Redis from 'ioredis'
import { CreateObserveJobBody, OBSERVE_QUEUE } from './observe.constant'

type GetJobResult = {
  state: JobState | unknown
  runs: number
}

@Controller('observe')
export class ObserveController {
  constructor(
    @Inject(OBSERVE_QUEUE) private readonly queue: Queue,

    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  @Get('/ping')
  async ping() {
    return { message: 'pong' }
  }

  @Get('/metrics')
  async getMetrics() {}

  @Post('/jobs')
  @HttpCode(202)
  async createJob(
    @Body() body: CreateObserveJobBody,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add('job', body, {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 500,
      },
    })

    if (!job || !job.id) {
      throw new BadRequestException('Cannot create job')
    }

    return { jobId: job.id }
  }

  @Get('/jobs/:jobId')
  async getJob(@Param('jobId') jobId: string): Promise<GetJobResult> {
    const job = await this.queue.getJob(jobId)

    if (!job) {
      return {
        state: 'unknown',
        runs: 0,
      }
    }

    const state = await job.getState()
    const runsRaw = await this.redis.get(`jobs:runs:${job.id}`)
    const runs = Number(runsRaw) ?? 0

    return {
      state,
      runs,
    }
  }
}
