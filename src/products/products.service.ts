import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
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
}
