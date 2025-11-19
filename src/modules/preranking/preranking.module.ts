import { Module } from '@nestjs/common';
import { PreRankingService } from './preranking.service';
import { ConstraintValidator } from './validators/constraint.validator';
import { SuiModule } from '../sui/sui.module';
import { SourceMapModule } from '../source-map/source-map.module';

@Module({
  imports: [SuiModule, SourceMapModule],
  providers: [PreRankingService, ConstraintValidator],
  exports: [PreRankingService],
})
export class PreRankingModule {}
