import { Injectable } from '@nestjs/common'

@Injectable()
export class LatencyMetricsService {
  private count = 0
  private sumMs = 0

  record(durationMs: number) {
    this.count += 1
    this.sumMs += durationMs
  }

  snapshot() {
    return { count: this.count, sumMs: this.sumMs }
  }
}
