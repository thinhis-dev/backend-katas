import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './database.config';
import { HealthModule } from './health/health.module';
import { ProductsModule } from './products/products.module';
import { RedisModule } from './redis/redis.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    RedisModule,
    HealthModule,
    ProductsModule,
    OrdersModule
  ],
})
export class AppModule {}
