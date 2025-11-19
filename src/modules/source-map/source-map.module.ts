import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SourceMapService } from './source-map.service';
import { SuiModule } from '../sui/sui.module';
import { RedisModule } from '../redis/redis.module';
import { CetusProvider } from './providers/cetus.provider';
import { DefiLlamaProvider } from './providers/defillama.provider';

@Module({
  imports: [
    HttpModule,
    SuiModule,
    RedisModule,
  ],
  providers: [
    SourceMapService,
    CetusProvider,
    DefiLlamaProvider
  ],
  exports: [SourceMapService],
})
export class SourceMapModule {}