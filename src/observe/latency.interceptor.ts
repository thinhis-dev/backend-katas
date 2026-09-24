import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { performance } from 'node:perf_hooks'
import { Observable, finalize } from 'rxjs'
import { LatencyMetricsService } from './latency-metrics.service'

@Injectable()
export class LatencyInterceptor implements NestInterceptor {
  constructor(private readonly metrics: LatencyMetricsService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // performance.now() has sub-millisecond precision, so a fast handler
    // still records a duration above 0.
    const start = performance.now()

    // finalize runs on success AND on error, so failed requests are timed too.
    return next
      .handle()
      .pipe(finalize(() => this.metrics.record(performance.now() - start)))
  }
}
