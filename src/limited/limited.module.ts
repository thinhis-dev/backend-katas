import { Module } from '@nestjs/common';
import { LimitedController } from './limited.controller';

@Module({
  controllers: [LimitedController]
})
export class LimitedModule {}
