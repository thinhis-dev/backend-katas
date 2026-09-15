import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Event } from './event.entity'
import { Repository } from 'typeorm'

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
  ) {}

  async findAll(
    limit: number,
    userId?: string,
    cursor?: string,
  ): Promise<{ items: Event[]; nextCursor: string | null }> {
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .orderBy('event.createdAt', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .where('event.userId = :userId', { userId })
      .limit(limit + 1)

    if (cursor) {
      const { createdAt, nextCursorId } = JSON.parse(cursor)

      qb.andWhere('(event.createdAt, event.id) < (:createdAt, :nextCursorId)', {
        createdAt,
        nextCursorId,
      })
    }

    const events = await qb.getMany()

    const hasNextPage = events.length > limit

    if (hasNextPage) {
      events.pop()
    }

    const nextCursorCreatedAt = hasNextPage
      ? events[events.length - 1].createdAt.toISOString()
      : null

    const nextCursorId = hasNextPage ? events[events.length - 1].id : null

    const nextCursor = hasNextPage
      ? JSON.stringify({
          createdAt: nextCursorCreatedAt,
          nextCursorId,
        })
      : null

    return {
      items: events,
      nextCursor,
    }
  }
}
