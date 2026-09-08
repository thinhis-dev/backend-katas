import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository, UpdateResult } from 'typeorm'
import { Product } from './product.entity'

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private RETRY_MAX_ATTEMPT = 10

  findAll(limit = 20): Promise<Product[]> {
    return this.productsRepo.find({ take: limit, order: { name: 'ASC' } })
  }

  findOne(id: string): Promise<Product | null> {
    return this.productsRepo.findOne({ where: { id } })
  }

  async purchase(id: string, quantity: number): Promise<Product | null> {
    if (!id || quantity <= 0) {
      throw new BadRequestException('Param is not valid')
    }

    let retryCount = 0

    while (retryCount < this.RETRY_MAX_ATTEMPT) {
      const product = await this.productsRepo.findOne({ where: { id } })

      if (!product) {
        throw new NotFoundException(`Cannot find product with id: ${id}`)
      }

      const { stock, version } = product

      if (stock < quantity) {
        throw new ConflictException('Quantity is over stock!')
      }

      const { affected } = await this.dataSource
        .createQueryBuilder()
        .update(Product)
        .set({
          stock: stock - quantity,
          version: version + 1,
        })
        .where('id = :id AND version = :version', { id, version })
        .execute()

      if (affected === 0) {
        retryCount++
        continue
      }

      return product
    }

    throw new ConflictException('Too many retry times!')
  }
}
