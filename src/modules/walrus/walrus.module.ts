import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalrusService } from './walrus.service';
import { walrusConfig } from '../../config/walrus.config';

@Module({
  imports: [ConfigModule.forFeature(walrusConfig)],
  providers: [WalrusService],
  exports: [WalrusService],
})
export class WalrusModule {}