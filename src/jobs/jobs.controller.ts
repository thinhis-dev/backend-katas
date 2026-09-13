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
import { JOBS_QUEUE } from './jobs.token'
import { CreateJobBody } from './jobs.type'
import { REDIS } from '../redis/redis.module'
import Redis from 'ioredis'

type GetJobResult = {
  state: JobState | unknown
  runs: number
}

@Controller('jobs')
export class JobsController {
  constructor(
    @Inject(JOBS_QUEUE) private readonly queue: Queue,

    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  @Post()
  @HttpCode(202)
  async createJob(@Body() body: CreateJobBody): Promise<{ jobId: string }> {
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

  @Get('/dead-letter')
  async getAllDeadLetterJob() {
    // const jobIds = await this.redis.lrange('jobs:dead-letter', 0, -1)
    const jobIds = (await this.queue.getFailed(0, -1)).map(job => job.id)

    return { jobIds }
  }

  @Get('/:jobId')
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
