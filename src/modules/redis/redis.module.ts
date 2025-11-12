import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';
import { RedisPubsubService } from './redis-pubsub/redis-pubsub.service';
import { RedisCacheService } from './redis-cache/redis-cache.service';
import { redisConfig } from '../../config/redis.config';

@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [RedisService, RedisCacheService, RedisPubsubService],
  exports: [RedisService, RedisCacheService, RedisPubsubService],
})
export class RedisModule {}
