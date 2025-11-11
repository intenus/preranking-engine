import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SuiService } from './sui.service';
import { suiConfig } from '../../config/sui.config';

@Module({
  imports: [ConfigModule.forFeature(suiConfig)],
  providers: [SuiService],
  exports: [SuiService],
})
export class SuiModule {}