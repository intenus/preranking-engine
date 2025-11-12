import { Module } from '@nestjs/common';
import { DatasetController } from './dataset.controller';

@Module({
  controllers: [DatasetController]
})
export class DatasetModule {}
