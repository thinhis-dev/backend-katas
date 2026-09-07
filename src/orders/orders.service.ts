import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Order } from './orders.entity'
import { DataSource, QueryFailedError, Repository } from 'typeorm'
import { IdempotencyKey } from '../idempotency/idempotency-key.entity'

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,

    @InjectRepository(IdempotencyKey)
    private readonly idempotencyKeysRepo: Repository<IdempotencyKey>,

    private readonly dataSource: DataSource,
  ) {}

  async create(
    productId: string,
    quantity: number,
    idempotencyKey?: string,
  ): Promise<Order> {
    if (!idempotencyKey) {
      throw new BadRequestException('Missing Idempotency Key')
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.insert(IdempotencyKey, { key: idempotencyKey })
        const order = await manager.save(
          manager.create(Order, { productId, quantity }),
        )
        await manager.update(IdempotencyKey, idempotencyKey, {
          result: {
            id: order.id,
            productId: order.productId,
            quantity: order.quantity,
          },
        })

        return order
      })
    } catch (error) {
      if (error instanceof QueryFailedError) {
        if (
          !(
            error.driverError?.code === '23505' ||
            (error as any).code === '23505'
          )
        )
          throw error
      }

      const existingKey = await this.idempotencyKeysRepo.findOneBy({
        key: idempotencyKey,
      })

      if (!existingKey?.result || !this.isOrderResult(existingKey.result))
        throw new ConflictException(
          'Idempotency key claimed but result missing',
        )

      return existingKey.result
    }
  }

  private isOrderResult = (result: unknown): result is Order => {
    return (
      typeof result === 'object' &&
      result != null &&
      'id' in result &&
      'productId' in result &&
      'quantity' in result &&
      typeof result.id === 'string' &&
      typeof result.productId === 'string' &&
      typeof result.quantity === 'number'
    )
  }
}
