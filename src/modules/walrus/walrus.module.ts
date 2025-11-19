import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalrusService } from './walrus.service';
import { walrusConfig } from '../../config/walrus.config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule.forFeature(walrusConfig), HttpModule],
  providers: [WalrusService],
  exports: [WalrusService],
})
export class WalrusModule {}
