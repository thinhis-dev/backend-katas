import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { Order } from './orders.entity'
import { IdempotencyKey } from '../idempotency/idempotency-key.entity'

@Module({
  imports: [TypeOrmModule.forFeature([Order, IdempotencyKey])],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
