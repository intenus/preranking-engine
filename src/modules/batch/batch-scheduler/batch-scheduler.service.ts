import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BatchService } from '../batch.service';
import { BatchStatus } from '@intenus/common';
import { time } from 'console';
import { BATCH_CONFIG } from 'src/config/constant/batch.const';

/**
 * Batch Scheduler Service
 *
 * SIMPLIFIED RESPONSIBILITY: Time-based batch rotation only
 *
 * This service has ONE job:
 * - Rotate batches every 10 seconds (close current OPEN batch, open new one)
 *
 * IMPORTANT: Only 1 batch is active (OPEN status) at a time
 * - Old batches exist as historical records (CLOSED status)
 * - This is NOT a queue processor
 * - Batches are time window labels (epoch number = timestamp labels)
 *
 * ARCHITECTURAL BOUNDARIES:
 * - Does NOT manage solvers (handled by smart contracts)
 * - Does NOT manage ranking (handled by Router Optimizer in TEE)
 * - Does NOT check solver deadlines (Router Optimizer's responsibility)
 * - Does NOT aggregate solutions (SolutionAggregator's job)
 *
 * What this service DOES:
 * 1. Every 12 hours:
 *    - Close current batch (status: OPEN → CLOSED)
 *    - Publish batch to solvers (via Redis)
 *    - Open new batch (increment epoch)
 *
 * 2. Initialize on startup:
 *    - Calculate current epoch from timestamp
 *    - Open initial batch
 *
 * That's it. Simple time-based rotation.
 */
@Injectable()
export class BatchSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BatchSchedulerService.name);
  private currentEpoch = 0;
  private isInitialized = false;

  constructor(private readonly batchService: BatchService) {}

  async onModuleInit() {
    await this.initializeFirstBatch();

    const now = Date.now();
    const nextEpochBoundary =
      Math.ceil(now / BATCH_CONFIG.EPOCH_DURATION_MS) *
      BATCH_CONFIG.EPOCH_DURATION_MS;
    const delayUntilNextEpoch = nextEpochBoundary - now;

    setTimeout(() => {
      this.rotateBatch();
      setInterval(() => {
        this.rotateBatch();
      }, BATCH_CONFIG.EPOCH_DURATION_MS);
    }, delayUntilNextEpoch);

    this.logger.log(`Batch rotation will start in ${delayUntilNextEpoch}ms`);
  }

  /**
   * Initialize the first batch on startup
   */
  private async initializeFirstBatch() {
    try {
      const currentBatch = await this.batchService.getCurrentBatch();

      if (currentBatch) {
        this.currentEpoch = currentBatch.epoch;
        this.logger.log(
          `Resuming from existing batch epoch ${this.currentEpoch}`,
        );
      } else {
        this.currentEpoch = this.calculateEpoch();
        await this.batchService.openBatch(this.currentEpoch);
        this.logger.log(`First batch created with epoch ${this.currentEpoch}`);
      }

      this.isInitialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize first batch', error);
    }
  }

  /**
   * Rotate batch every 10 seconds
   *
   * This is the ONLY batch management logic needed:
   * 1. Close current batch (time window ended)
   * 2. Open new batch immediately (no gap)
   *
   * Old batches become historical records (status: CLOSED)
   * Only current batch is OPEN and accepting intents
   */
  async rotateBatch() {
    if (!this.isInitialized) {
      return;
    }

    try {
      const now = Date.now();
      const currentBatch = await this.batchService.getCurrentBatch();

      if (!currentBatch) {
        this.logger.warn(
          'No open batch found during rotation, creating new batch',
        );
        await this.batchService.openBatch(this.currentEpoch);
        return;
      }

      if (now >= currentBatch.end_time) {
        this.logger.log(
          `Rotating batch ${currentBatch.batch_id} (epoch ${currentBatch.epoch}) ` +
            `with ${currentBatch.intent_count} intents`,
        );
        await this.batchService.closeBatch(currentBatch.batch_id);

        const batch = await this.batchService.openBatch(this.currentEpoch);

        await this.batchService.publishBatch(batch);
      }
    } catch (error) {
      this.logger.error('Error during batch rotation', error);
    }
  }

  /**
   * Manual batch rotation (for testing/admin)
   */
  async manualRotate(): Promise<void> {
    const currentBatch = await this.batchService.getCurrentBatch();

    if (currentBatch) {
      await this.batchService.closeBatch(currentBatch.batch_id);
      await this.batchService.publishBatch(currentBatch);
    }

    this.currentEpoch++;
    await this.batchService.openBatch(this.currentEpoch);

    this.logger.log(`Manual batch rotation to epoch ${this.currentEpoch}`);
  }

  /**
   * Get current epoch number
   */
  getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      current_epoch: this.currentEpoch,
      is_initialized: this.isInitialized,
      next_rotation_in_ms: this.getTimeUntilNextRotation(),
    };
  }

  /**
   * Calculate time until next rotation
   */
  private getTimeUntilNextRotation(): number {
    const now = Date.now();
    const nextRotation = Math.ceil(now / 10000) * 10000; // Next 10s boundary
    return nextRotation - now;
  }

  /**
   * Calculate epoch
   */
  private calculateEpoch(): number {
    return Math.floor(Date.now() / 10000);
  }
}
