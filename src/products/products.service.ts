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

  private POLL_MS = 20

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

  private async acquireLock(id, token, ttlMs) {
    return await this.redis.set(`lock:${id}`, token, 'PX', ttlMs, 'NX')
  }

  private async releaseLock(id, token) {
    const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
    return await this.redis.eval(luaScript, 1, `lock:${id}`, token)
  }

  sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  private async waitForCache(id) {
    for (let i = 0; i < this.RETRY_MAX_ATTEMPT; i++) {
      await this.sleep(this.POLL_MS)

      const cachedProduct = await this.redis.get(id)

      if (cachedProduct) {
        return {
          ...this.convertProductFromCached(cachedProduct),
          source: SOURCE.CACHE,
        }
      }
    }
  }

  findAll(limit = 20): Promise<Product[]> {
    return this.productsRepo.find({ take: limit, order: { name: 'ASC' } })
  }

  async findOne(id: string): Promise<ProductWithSource | null> {
    const cachedProduct = await this.redis.get(id)

    if (cachedProduct) {
      return {
        ...this.convertProductFromCached(cachedProduct),
        source: SOURCE.CACHE,
      }
    }

    const token = crypto.randomUUID()

    if ((await this.acquireLock(id, token, 200)) === 'OK') {
      try {
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
      } finally {
        await this.releaseLock(id, token)
      }
    } else {
      const productAfterWaiting = await this.waitForCache(id)

      if (!productAfterWaiting) {
        throw new NotFoundException('Cannot find product')
      }

      return productAfterWaiting
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
    const purchaseResult = await this.dataSource.transaction(
      async (manager) => {
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

        await manager.save(product)

        return {
          productId: id,
          quantity,
          remainingStock,
        }
      },
    )

    await this.redis.del(id)
    this.countDbRead.set(id, 0)

    return purchaseResult
  }
}
