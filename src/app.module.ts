import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { redisConfig } from './config/redis.config';
import { walrusConfig } from './config/walrus.config';
import { suiConfig } from './config/sui.config';
import { RequestLoggerMiddleware } from './common/middleware/logger.middleware';
import { LoggerModule } from './common/logger/logger.module';
import { BatchModule } from './modules/batch/batch.module';
import { RedisModule } from './modules/redis/redis.module';
import { WalrusModule } from './modules/walrus/walrus.module';
import { SuiModule } from './modules/sui/sui.module';
import { DatasetModule } from './modules/dataset/dataset.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [redisConfig, walrusConfig, suiConfig],
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    LoggerModule,
    BatchModule,
    RedisModule,
    WalrusModule,
    SuiModule,
    DatasetModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}