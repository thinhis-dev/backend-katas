import {
  Controller,
  Get,
  Inject,
  Headers,
  Res,
  HttpStatus,
  HttpException,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  UseFilters,
  BadRequestException,
} from '@nestjs/common'
import { REDIS } from '../redis/redis.module'
import Redis from 'ioredis'
import { Response } from 'express'

type LimitedResult = {
  ok: boolean
}

export class TooManyRequestsException extends HttpException {
  constructor(
    public readonly retryAfter: number,
    message?: string,
  ) {
    super(
      message || 'Too many requests, please slow down.',
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}

@Catch(TooManyRequestsException)
export class RateLimitFilter implements ExceptionFilter {
  catch(exception: TooManyRequestsException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const status = exception.getStatus()

    response.setHeader(
      'retry-after',
      String(exception.retryAfter > 0 ? exception.retryAfter : 0),
    )

    response.status(status).json({
      statusCode: status,
      message: exception.message,
    })
  }
}

@Controller('limited')
@UseFilters(RateLimitFilter)
export class LimitedController {
  constructor(
    @Inject(REDIS)
    private readonly redis: Redis,
  ) {
    this.redis.defineCommand('increaseWithExpiration', {
      numberOfKeys: 1,
      lua: `
        local nextRate = redis.call('INCR', KEYS[1])

        if nextRate == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end

        return { nextRate, redis.call('TTL', KEYS[1]) }
      `,
    })
  }

  private LIMIT = 100

  private WINDOW_SECOND = 60

  @Get()
  async getLimitedEndpoint(
    @Headers('X-User-Id') userId: string,
  ): Promise<LimitedResult> {
    if (!userId) {
      throw new BadRequestException('Request does not have X-User-Id')
    }

    const key = `ratelimit:${userId}`

    const [nextRate, ttl] = await this.redis.increaseWithExpiration(
      key,
      this.WINDOW_SECOND,
    )

    if (nextRate > this.LIMIT) {
      throw new TooManyRequestsException(ttl, 'Rate limit exceeded!')
    }

    return { ok: true }
  }
}
