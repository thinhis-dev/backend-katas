import { Controller, Get, Query } from '@nestjs/common'
import { EventService } from './event.service'

@Controller('events')
export class EventsController {
  constructor(private readonly event: EventService) {}

  @Get()
  findAll(@Query('limit') rawLimit ?: string, @Query('userId') userId?: string, @Query('cursor') cursor?: string) {
    const limit = rawLimit ? Number(rawLimit) : 20 
    
    return this.event.findAll(limit, userId, cursor)
  }
}
