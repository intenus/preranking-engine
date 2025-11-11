import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { RequestLoggerMiddleware } from './common/middleware/logger.middleware';
import { LoggerModule } from './common/logger/logger.module';

import { WalrusModule } from './modules/walrus/walrus.module';
import { SuiModule } from './modules/sui/sui.module';
import { RouterOptimizerModule } from './modules/router-optimizer/router-optimizer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    LoggerModule,
    WalrusModule,
    SuiModule,
    RouterOptimizerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}