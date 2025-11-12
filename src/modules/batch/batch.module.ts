import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { BatchSchedulerService } from './batch-scheduler/batch-scheduler.service';
import { IntentCollectorService } from './intent-collector/intent-collector.service';
import { SolverPublisherService } from './solver-publisher/solver-publisher.service';
import { RedisModule } from '../redis/redis.module';
import { BatchEntity } from './entities';
import { WalrusModule } from '../walrus/walrus.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BatchEntity]),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RedisModule,
    WalrusModule
  ],
  providers: [
    BatchService,
    BatchSchedulerService,
    IntentCollectorService,
    SolverPublisherService,
  ],
  controllers: [BatchController],
  exports: [BatchService, BatchSchedulerService], // Export for other modules
})
export class BatchModule {}
