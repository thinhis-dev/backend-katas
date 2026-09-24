import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NestMiddleware,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import { JobState, Queue } from 'bullmq'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import {
  CreateObserveJobBody,
  OBSERVE_QUEUE,
  ObserverJob,
  ObserverJobResult,
} from './observe.constant'
import { currentTraceId, traceStorage } from './trace-context'
import { LatencyInterceptor } from './latency.interceptor'
import { LatencyMetricsService } from './latency-metrics.service'

type GetJobResult = {
  state: JobState | 'unknown'
  traceId: string | null
}

@Injectable()
export class SetTraceIdHeaderMiddleWare implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // The middleware is the ONLY place that creates an id. Everything
    // downstream reads it from the store.
    const inbound = req.header('x-request-id')
    const traceId = inbound && inbound.length > 0 ? inbound : randomUUID()

    res.setHeader('X-Request-Id', traceId)

    // next() runs inside the store, so the guards, interceptors, and handler
    // of this request all see this traceId.
    traceStorage.run({ traceId }, next)
  }
}

@Controller('observe')
@UseInterceptors(LatencyInterceptor)
export class ObserveController {
  constructor(
    @Inject(OBSERVE_QUEUE)
    private readonly queue: Queue<ObserverJob, ObserverJobResult>,
    private readonly metrics: LatencyMetricsService,
  ) {}

  @Get('/ping')
  ping() {
    return { traceId: currentTraceId() }
  }

  @Get('/metrics')
  getMetrics() {
    return this.metrics.snapshot()
  }

  @Post('/jobs')
  @HttpCode(202)
  async createJob(
    @Body() body: CreateObserveJobBody,
  ): Promise<{ jobId: string }> {
    const traceId = currentTraceId()
    if (!traceId) {
      // Only happens if the middleware is not applied to this route.
      throw new Error('No trace context: is SetTraceIdHeaderMiddleWare applied?')
    }

    // The worker has no request context. The id crosses the queue hop only
    // because it rides inside the job payload.
    const job = await this.queue.add(
      'job',
      { workMs: body?.workMs, traceId },
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

    return { jobId: job.id }
  }

  @Get('/jobs/:jobId')
  async getJob(@Param('jobId') jobId: string): Promise<GetJobResult> {
    const job = await this.queue.getJob(jobId)

    if (!job) {
      return { state: 'unknown', traceId: null }
    }

    const state = await job.getState()

    // BullMQ stores the processor's return value on the job in Redis.
    // It is empty until the worker finishes.
    return {
      state,
      traceId: job.returnvalue?.traceId ?? null,
    }
  }
}
