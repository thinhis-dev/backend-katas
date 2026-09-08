import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ProductsService } from './products.service'

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.products.findAll(limit ? Number(limit) : 20)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id)
  }

  @Post(':id/purchase')
  async purchase(@Param('id') id: string, @Body('quantity') quantity: number) {
    return await this.products.purchase(id, quantity)
  }
}
