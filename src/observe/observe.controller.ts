import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NestMiddleware,
  Param,
  Post,
  Res,
} from '@nestjs/common'
import { JobState, Queue } from 'bullmq'
import { REDIS } from '../redis/redis.module'
import Redis from 'ioredis'
import { CreateObserveJobBody, OBSERVE_QUEUE } from './observe.constant'
import type { NextFunction, Request, Response } from 'express'

type GetJobResult = {
  state: JobState | unknown
  runs: number
}

export class SetTraceIdHeaderMiddleWare implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const traceIdFromHeader = req.headers['x-request-id'] as string
    const traceId =
      traceIdFromHeader ??
      `trace-${Math.random().toString(36).substring(2, 15)}`

    res.setHeader('X-Request-Id', traceId)

    next()
  }
}

@Controller('observe')
export class ObserveController {
  constructor(
    @Inject(OBSERVE_QUEUE) private readonly queue: Queue,

    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  @Get('/ping')
  async ping(@Headers('X-Request-Id') traceIdFromHeader: string) {
    const traceId =
      traceIdFromHeader ??
      `trace-${Math.random().toString(36).substring(2, 15)}`

    return { traceId }
  }

  @Get('/metrics')
  async getMetrics() {}

  @Post('/jobs')
  @HttpCode(202)
  async createJob(
    @Body() body: CreateObserveJobBody,
    @Headers('X-Request-Id') traceIdFromHeader: string,
  ): Promise<{ jobId: string; traceId: string }> {
    const traceId =
      traceIdFromHeader ??
      `trace-${Math.random().toString(36).substring(2, 15)}`

    const job = await this.queue.add(
      'job',
      { ...body, traceId },
      {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 500,
        },
      },
    )

    if (!job || !job.id) {
      throw new BadRequestException('Cannot create job')
    }

    return { jobId: job.id, traceId }
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
