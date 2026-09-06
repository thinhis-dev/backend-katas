import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  findAll(limit = 20): Promise<Product[]> {
    return this.products.find({ take: limit, order: { name: 'ASC' } });
  }

  findOne(id: string): Promise<Product | null> {
    return this.products.findOne({ where: { id } });
  }
}
