import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { BatchService } from './batch.service';
import { BatchSchedulerService } from './batch-scheduler/batch-scheduler.service';
import { BatchStatus } from '@intenus/common';
// import { SubmitSolutionDto, GetBatchStatsDto } from './dto/batch.dto';
// import { BatchStatus } from './entities/batch.entity';

@Controller('batch')
export class BatchController {
  constructor(
    private readonly batchService: BatchService,
    private readonly schedulerService: BatchSchedulerService,
  ) {}

  /**
   * Get current open batch
   */
  @Get('current')
  async getCurrentBatch() {
    const batch = await this.batchService.getCurrentBatch();
    
    if (!batch) {
      return {
        message: 'No open batch currently',
        epoch: this.schedulerService.getCurrentEpoch(),
      };
    }

    return {
      batch_id: batch.batch_id,
      epoch: batch.epoch,
      status: batch.status,
      intent_count: batch.intent_count,
      categories: batch.categories,
      time_remaining_ms: batch.end_time - Date.now(),
      solver_deadline: batch.solver_deadline,
    };
  }

  /**
   * Get batch by ID
   */
  @Get(':batch_id')
  async getBatch(@Param('batch_id') batch_id: string) {
    const batch = await this.batchService.getBatch(batch_id);
    
    return {
      ...batch,
      time_since_start_ms: Date.now() - batch.start_time,
    };
  }

  /**
   * Get solutions for a batch
   */
  // @Get(':batch_id/solutions')
  // async getBatchSolutions(@Param('batch_id') batch_id: string) {
  //   const solutions = await this.batchService.getBatchSolutions(batch_id);
    
  //   return {
  //     batch_id,
  //     solution_count: solutions.length,
  //     solutions: solutions.map(s => ({
  //       solution_id: s.solution_id,
  //       solver_address: s.solver_address,
  //       total_surplus_usd: s.total_surplus_usd,
  //       estimated_gas: s.estimated_gas,
  //       status: s.status,
  //       rank: s.rank,
  //       final_score: s.final_score,
  //       submitted_at: s.submitted_at,
  //     })),
  //   };
  // }

  /**
   * Submit solution (from solver)
   * This endpoint receives solutions from solvers
   */
  // @Post('solution/submit')
  // @HttpCode(HttpStatus.CREATED)
  // async submitSolution(@Body() dto: SubmitSolutionDto) {
  //   const solution = await this.batchService.submitSolution(dto);
    
  //   return {
  //     message: 'Solution submitted successfully',
  //     solution_id: solution.solution_id,
  //     batch_id: solution.batch_id,
  //     status: solution.status,
  //   };
  // }

  /**
   * Get batches by status
   */
  @Get('status/:status')
  async getBatchesByStatus(
    @Param('status') status: BatchStatus,
    @Query('limit') limit?: number,
  ) {
    const batches = await this.batchService.getBatchesByStatus(
      status,
      limit || 10
    );
    
    return {
      status,
      count: batches.length,
      batches,
    };
  }

  /**
   * Get batch statistics
   */
  // @Get('stats/summary')
  // async getBatchStats(@Query() query: GetBatchStatsDto) {
  //   const stats = await this.batchService.getBatchStats(
  //     query.from_epoch,
  //     query.to_epoch
  //   );
    
  //   return stats;
  // }

  /**
   * Manual batch rotation (for testing)
   */
  @Post('rotate/manual')
  @HttpCode(HttpStatus.OK)
  async manualRotate() {
    await this.schedulerService.manualRotate();
    
    return {
      message: 'Batch rotated manually',
      new_epoch: this.schedulerService.getCurrentEpoch(),
    };
  }

  /**
   * Health check for batch system
   */
  @Get('health/status')
  async getHealthStatus() {
    const currentBatch = await this.batchService.getCurrentBatch();
    const currentEpoch = this.schedulerService.getCurrentEpoch();

    return {
      status: 'ok',
      current_epoch: currentEpoch,
      current_batch: currentBatch ? {
        batch_id: currentBatch.batch_id,
        status: currentBatch.status,
        intent_count: currentBatch.intent_count,
        time_remaining_ms: currentBatch.end_time - Date.now(),
      } : null,
      timestamp: Date.now(),
    };
  }
}
