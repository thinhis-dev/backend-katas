import { Module, ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { buildDataSourceOptions } from './database.config'
import { HealthModule } from './health/health.module'
import { ProductsModule } from './products/products.module'
import { RedisModule } from './redis/redis.module'
import { OrdersModule } from './orders/orders.module'
import { APP_PIPE } from '@nestjs/core'
import { AccountsModule } from './accounts/accounts.module'
import { JobsModule } from './jobs/jobs.module'
import { LimitedModule } from './limited/limited.module'
import { EventModule } from './events/event.module'
import { ObserveModule } from './observe/observe.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    RedisModule,
    HealthModule,
    ProductsModule,
    OrdersModule,
    AccountsModule,
    JobsModule,
    LimitedModule,
    EventModule,
    ObserveModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
