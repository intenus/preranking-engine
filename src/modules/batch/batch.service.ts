import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Batch, BatchStatus } from '@intenus/common';
import { BatchEntity } from './entities';
import { v4 as uuidv4 } from 'uuid';
import { BATCH_CONFIG } from 'src/config/constant';
/**
 * BATCH CONCEPT:
 * - Batch is a TIME-BASED GROUP, not a queue
 * - Intents are published IMMEDIATELY upon arrival
 * - Batch ID is just a timestamp-based label for grouping
 * - New batch starts every EPOCH_DURATION_MS (10s)
 * - Think: "All intents between 10:00:00 and 10:00:10 belong to Batch #1"
 */
@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);
  private currentBatchId: string | null = null;

  constructor(
    @InjectRepository(BatchEntity)
    private readonly batchRepo: Repository<BatchEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create and open a new batch
   */
  async openBatch(epoch: number): Promise<Batch> {
    const now = Date.now();
    const batch = this.batchRepo.create({
      batch_id: uuidv4(),
      epoch,
      intent_ids: [],
      intent_count: 0,
      categories: {},
      estimated_value_usd: 0,
      status: BatchStatus.OPEN,
      start_time: now,
      end_time: now + BATCH_CONFIG.EPOCH_DURATION_MS,
      solver_deadline:
        now + BATCH_CONFIG.EPOCH_DURATION_MS + BATCH_CONFIG.SOLVER_WINDOW_MS,
    });

    await this.batchRepo.save(batch);

    this.logger.log(`Batch ${batch.batch_id} opened for epoch ${epoch}`);
    this.eventEmitter.emit('batch.opened', batch);

    this.currentBatchId = batch.batch_id;

    return batch;
  }

  /**
   * Close batch - end of time window
   *
   * Called automatically after EPOCH_DURATION_MS
   * Does NOT block intent processing - new batch is already open!
   */
  async closeBatch(batch_id: string): Promise<BatchEntity> {
    const batch = await this.getBatch(batch_id);

    if (batch.status === BatchStatus.CLOSED) {
      throw new Error(`Cannot close batch in status: ${batch.status}`);
    }

    batch.status = BatchStatus.CLOSED;

    await this.batchRepo.save(batch);

    this.logger.log(
      `Batch ${batch_id} closed with ${batch.intent_count} intents`,
    );
    this.eventEmitter.emit('batch.closed', batch);

    return batch;
  }

  /**
   * Publish batch to solver network
   *
   * NOTE: Individual intents are published immediately when added.
   * This is just a batch-level notification for solvers to know
   * "the time window has closed, you can finalize solutions now"
   */
  async publishBatch(batch: Batch): Promise<void> {
    this.logger.log(`Batch ${batch.batch_id} published to solvers`);
    this.eventEmitter.emit('batch.published', batch);
  }

  /**
   * Add intent to current batch and publish immediately
   *
   * Flow:
   * 1. Assign to current time-based batch
   * 2. Publish to Walrus/Redis IMMEDIATELY
   * 3. Solvers can start working on it right away
   *
   * Batch is just a label, NOT a queue!
   */
  async addIntentToBatch(
    batch_id: string,
    intent_id: string,
    category: string,
  ): Promise<void> {
    const batch = await this.getBatch(batch_id);

    if (batch.status == BatchStatus.CLOSED) {
      throw new Error('Batch is not accepting intents');
    }

    batch.intent_ids.push(intent_id);
    batch.intent_count += 1;

    batch.categories[category] = (batch.categories[category] || 0) + 1;

    await this.batchRepo.save(batch);

    this.logger.debug(`Intent ${intent_id} added to batch ${batch_id}`);
    this.eventEmitter.emit('intent.published', {
      batch_id,
      intent_id,
      category,
      epoch: batch.epoch,
    });
  }

  /**
   * Get batch by ID with database lookup
   */
  async getBatch(batch_id: string): Promise<BatchEntity> {
    const batch = await this.batchRepo.findOne({
      where: { batch_id },
    });

    if (!batch) {
      throw new NotFoundException(`Batch ${batch_id} not found`);
    }

    return batch;
  }

  /**
   * Get current open batch
   */
  async getCurrentBatch(): Promise<BatchEntity | null> {
    return this.batchRepo.findOne({
      where: { status: BatchStatus.PUBLISHED },
      order: { epoch: 'DESC' },
    });
  }

  /**
   * Get batches by status
   */
  async getBatchesByStatus(
    status: BatchStatus,
    limit = 10,
  ): Promise<BatchEntity[]> {
    return this.batchRepo.find({
      where: { status },
      order: { epoch: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get batch statistics
   */
  async getBatchStats(from_epoch?: number, to_epoch?: number) {
    const query = this.batchRepo.createQueryBuilder('batch');

    if (from_epoch) {
      query.andWhere('batch.epoch >= :from_epoch', { from_epoch });
    }

    if (to_epoch) {
      query.andWhere('batch.epoch <= :to_epoch', { to_epoch });
    }

    const batches = await query.getMany();

    return {
      total_batches: batches.length,
      total_intents: batches.reduce((sum, b) => sum + b.intent_count, 0),
      avg_intents_per_batch:
        batches.length > 0
          ? batches.reduce((sum, b) => sum + b.intent_count, 0) / batches.length
          : 0,
      total_value_usd: batches.reduce(
        (sum, b) => sum + Number(b.estimated_value_usd),
        0,
      ),
      by_status: batches.reduce(
        (acc, b) => {
          acc[b.status] = (acc[b.status] || 0) + 1;
          return acc;
        },
        {} as Record<BatchStatus, number>,
      ),
    };
  }
}
