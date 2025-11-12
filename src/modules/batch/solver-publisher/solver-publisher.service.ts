import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisPubsubService } from 'src/modules/redis/redis-pubsub/redis-pubsub.service';

import { Batch } from '@intenus/common';

@Injectable()
export class SolverPublisherService {
  private readonly logger = new Logger(SolverPublisherService.name);

  constructor(
    private readonly redis: RedisPubsubService
  ) {}

  /**
   * Listen to batch.published event and publish to solvers
   */
  @OnEvent('batch.published')
  async handleBatchPublished(batch: Batch) {
    try {
      await this.publishBatchToSolvers(batch);
    } catch (error) {
      this.logger.error(`Failed to publish batch ${batch.batch_id}`, error);
    }
  }

  /**
   * Publish batch notification to solver network
   */
  async publishBatchToSolvers(batch: Batch): Promise<void> {
    const message = {
      batch_id: batch.batch_id,
      epoch: batch.epoch,
      intent_count: batch.intent_count,
      categories: batch.categories,
      estimated_value_usd: Number(batch.estimated_value_usd),
      solver_deadline: batch.solver_deadline,
      walrus_manifest: `/batches/${batch.epoch}/manifest.json`,
      timestamp: Date.now(),
    };

    // Publish to main channel
    await this.redis.publish('solver:batch:new', JSON.stringify(message));

    this.logger.log(
      `Published batch ${batch.batch_id} to solver network (${batch.intent_count} intents)`
    );
  }

  /**
   * Publish deadline warning (1 second before deadline)
   */
  async publishDeadlineWarning(batch: Batch): Promise<void> {
    const message = {
      batch_id: batch.batch_id,
      epoch: batch.epoch,
      deadline: batch.solver_deadline,
      time_remaining_ms: batch.solver_deadline - Date.now(),
    };

    await this.redis.publish('solver:batch:deadline', JSON.stringify(message));

    this.logger.debug(`Published deadline warning for batch ${batch.batch_id}`);
  }
}
