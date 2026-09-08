import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, UpdateResult } from 'typeorm'
import { Product } from './product.entity'

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
  ) {}

  findAll(limit = 20): Promise<Product[]> {
    return this.productsRepo.find({ take: limit, order: { name: 'ASC' } })
  }

  findOne(id: string): Promise<Product | null> {
    return this.productsRepo.findOne({ where: { id } })
  }

  async purchase(id: string, quantity: number): Promise<UpdateResult | null> {
    if (!id || quantity <= 0) {
      throw new BadRequestException('Param is not valid')
    }

    const product = await this.productsRepo.findOne({ where: { id } })

    if (!product) {
      throw new NotFoundException(`Cannot find product with id: ${id}`)
    }

    const { stock } = product

    if (stock >= quantity) {
      return await this.productsRepo.update(id, { stock: stock - quantity })
    } else {
      throw new ConflictException('Quantity is over stock!')
    }
  }
}
