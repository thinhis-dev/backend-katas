import { Body, Controller, Post, Headers } from '@nestjs/common'
import { OrdersService } from './orders.service'

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(
    @Body('productId') productId: string,
    @Body('quantity') quantity: number,
    @Headers('Idempotency-Key') idempotencyKey: string,
  ) {
    return this.orders.create(productId, quantity, idempotencyKey)
  }
}
