import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import { Product } from './product.entity'
import { REDIS } from '../redis/redis.module'
import Redis from 'ioredis'

type PurchaseResult = {
  productId: string
  quantity: number
  remainingStock: number
}

const SOURCE = {
  DB: 'db',
  CACHE: 'cache',
} as const

type Source = (typeof SOURCE)[keyof typeof SOURCE]

type ProductWithSource = Product & {
  source: Source
}

type DbReadResult = {
  dbReads: number
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  private RETRY_MAX_ATTEMPT = 10

  private convertProductFromCached = (productFromCache: string): Product => {
    const productJSON = JSON.parse(productFromCache)

    if (
      typeof productJSON !== 'object' ||
      productJSON == null ||
      !('id' in productJSON) ||
      !('name' in productJSON) ||
      !('priceCents' in productJSON) ||
      !('stock' in productJSON) ||
      !('version' in productJSON) ||
      !('updatedAt' in productJSON) ||
      !productJSON.id ||
      !productJSON.name
    ) {
      throw new Error('Value from cache is not valid product')
    }

    return productJSON
  }

  private countDbRead = new Map()

  findAll(limit = 20): Promise<Product[]> {
    return this.productsRepo.find({ take: limit, order: { name: 'ASC' } })
  }

  async findOne(id: string): Promise<ProductWithSource | null> {
    const productFromCache = await this.redis.get(id)

    if (productFromCache) {
      return {
        ...this.convertProductFromCached(productFromCache),
        source: SOURCE.CACHE,
      }
    }

    while (this.countDbRead.get(id)) {
      continue
    }

    const product = await this.productsRepo.findOne({ where: { id } })
    this.countDbRead.set(id, (this.countDbRead.get(id) ?? 0) + 1)

    if (!product) {
      throw new NotFoundException('Cannot find that product')
    }

    await this.redis.set(id, JSON.stringify(product))

    return {
      ...product,
      source: SOURCE.DB,
    }
  }

  async getNumberOfDbRead(id: string): Promise<DbReadResult> {
    return await { dbReads: this.countDbRead.get(id) }
  }

  /** Optimistic locking */
  // async purchase(id: string, quantity: number): Promise<PurchaseResult> {
  //   let retryCount = 0

  //   while (retryCount < this.RETRY_MAX_ATTEMPT) {
  //     const product = await this.productsRepo.findOne({ where: { id } })

  //     if (!product) {
  //       throw new NotFoundException(`Cannot find product with id: ${id}`)
  //     }

  //     const { stock, version } = product

  //     if (stock < quantity) {
  //       throw new ConflictException('Quantity is over stock!')
  //     }

  //     const { affected } = await this.dataSource
  //       .createQueryBuilder()
  //       .update(Product)
  //       .set({
  //         stock: stock - quantity,
  //         version: version + 1,
  //       })
  //       .where('id = :id AND version = :version', { id, version })
  //       .execute()

  //     if (affected === 0) {
  //       retryCount++
  //       continue
  //     }

  //     return {
  //       productId: id,
  //       quantity,
  //       remainingStock: stock - quantity,
  //     }
  //   }

  //   throw new ConflictException('Too many retry times!')
  // }

  /** Pessimistic locking */
  async purchase(id: string, quantity: number): Promise<PurchaseResult> {
    return this.dataSource.transaction(async (manager) => {
      const product = await manager
        .getRepository(Product)
        .createQueryBuilder('product')
        .setLock('pessimistic_write')
        .where('product.id = :id', { id })
        .getOne()

      if (!product) {
        throw new NotFoundException(`Cannot find product with id: ${id}`)
      }

      const { stock } = product

      if (stock < quantity) {
        throw new ConflictException('Quantity is over stock!')
      }

      const remainingStock = stock - quantity

      product.stock = remainingStock

      this.redis.del(id)
      this.countDbRead.set(id, 0)

      await manager.save(product)

      return {
        productId: id,
        quantity,
        remainingStock,
      }
    })
  }
}
