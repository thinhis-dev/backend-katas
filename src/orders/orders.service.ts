import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Order } from './orders.entity'
import { Repository } from 'typeorm'

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  async create(productId: string, quantity: number): Promise<Order> {
    const newOrder = this.orders.create({
      productId,
      quantity,
    })

    return await this.orders.save(newOrder)
  }
}
