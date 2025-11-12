import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BatchService } from '../batch.service';
import { WalrusService } from 'src/modules/walrus/walrus.service';

/**
 * Intent reference from Walrus
 */
interface WalrusIntentReference {
  intent_id: string;
  user_address: string;
  category: string;
  estimated_value_usd?: number;
  walrus_blob_id: string;
  is_encrypted: boolean;
  timestamp: number;
  status?: string;
}

/**
 * Intent Collector Service
 *
 * Responsibilities:
 * 1. Poll Walrus for new intents (every 2 seconds)
 * 2. Detect missed intents (event-driven fallback)
 * 3. Assign intents to current batch
 * 4. Publish intents immediately
 */
@Injectable()
export class IntentCollectorService {
  private readonly logger = new Logger(IntentCollectorService.name);
  private processedIntents = new Set<string>();
  private lastPollTimestamp = 0;

  constructor(
    private readonly batchService: BatchService,
    private readonly walrusService: WalrusService,
  ) {}

  /**
   * Scheduled job - Poll Walrus for new intents every 2 seconds
   * This ensures we don't miss any intents even if events fail
   */
  @Cron('*/10 * * * * *') // Every 2 seconds
  async pollWalrusForIntents(): Promise<void> {
    try {
      const currentBatch = await this.batchService.getCurrentBatch();

      if (!currentBatch) {
        this.logger.warn('No open batch available for intent collection');
        return;
      }
      const newIntents = await this.fetchNewIntentsFromWalrus(
        currentBatch.epoch,
        this.lastPollTimestamp,
      );

      if (newIntents.length === 0) {
        return;
      }

      this.logger.log(`Found ${newIntents.length} new intents from Walrus`);
      for (const intent of newIntents) {
        await this.processIntent(intent, currentBatch.batch_id);
      }
      this.lastPollTimestamp = Date.now();
    } catch (error) {
      this.logger.error('Failed to poll Walrus for intents', error);
    }
  }

  /**
   * Fetch new intents from Walrus storage
   * Query: /intents/{epoch}/*.json where timestamp > lastPollTimestamp
   */
  private async fetchNewIntentsFromWalrus(
    epoch: number,
    sinceTimestamp: number,
  ): Promise<WalrusIntentReference[]> {
    try {
      const walrusPath = `/intents/${epoch}/`;
      const intents = await this.walrusService.fetchIntent(walrusPath);
      this.logger.debug(
        `Polling Walrus for intents in epoch ${epoch} since ${sinceTimestamp}`,
      );

      return intents.filter(
        (intent) =>
          intent.timestamp > sinceTimestamp &&
          !this.processedIntents.has(intent.intent_id),
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch intents from Walrus for epoch ${epoch}`,
        error,
      );
      return [];
    }
  }

  /**
   * Process a single intent: add to batch and publish
   */
  private async processIntent(
    intent: WalrusIntentReference,
    batch_id: string,
  ): Promise<void> {
    if (this.processedIntents.has(intent.intent_id)) {
      this.logger.debug(
        `Intent ${intent.intent_id} already processed, skipping`,
      );
      return;
    }

    try {
      await this.batchService.addIntentToBatch(
        batch_id,
        intent.intent_id,
        intent.category,
      );
      this.processedIntents.add(intent.intent_id);

      this.logger.log(
        `Intent ${intent.intent_id} collected from Walrus and added to batch ${batch_id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process intent ${intent.intent_id}`, error);
    }
  }

  /**
   * Event-driven fallback: Listen to intent.created event
   * This is a backup in case polling misses something
   */
  @OnEvent('intent.created')
  async handleIntentCreated(intent: WalrusIntentReference): Promise<void> {
    try {
      if (this.processedIntents.has(intent.intent_id)) {
        return;
      }

      const currentBatch = await this.batchService.getCurrentBatch();

      if (!currentBatch) {
        this.logger.warn(
          'No open batch available, intent will be picked up by poller',
        );
        return;
      }

      await this.processIntent(intent, currentBatch.batch_id);
    } catch (error) {
      this.logger.error(
        `Failed to handle intent.created event for ${intent.intent_id}`,
        error,
      );
    }
  }

  /**
   * Add intent to current batch (public API for manual additions)
   */
  async addIntentToCurrentBatch(intent: WalrusIntentReference): Promise<void> {
    const currentBatch = await this.batchService.getCurrentBatch();

    if (!currentBatch) {
      throw new Error('No open batch available');
    }

    await this.processIntent(intent, currentBatch.batch_id);
  }

  /**
   * Get intent statistics for a batch
   */
  async getBatchIntentStats(batch_id: string) {
    const batch = await this.batchService.getBatch(batch_id);

    return {
      batch_id,
      intent_count: batch.intent_count,
      categories: batch.categories,
      estimated_value_usd: batch.estimated_value_usd,
    };
  }

  /**
   * Clean up old processed intents from memory (prevent memory leak)
   * Keep only last 1000 processed intent IDs
   */
  @Cron(CronExpression.EVERY_MINUTE)
  private cleanupProcessedIntents(): void {
    if (this.processedIntents.size > 1000) {
      const idsArray = Array.from(this.processedIntents);
      const recentIds = idsArray.slice(-1000); // Keep last 1000
      this.processedIntents = new Set(recentIds);

      this.logger.debug(
        `Cleaned up processed intents cache (kept ${this.processedIntents.size})`,
      );
    }
  }

  /**
   * Get collector statistics
   */
  getCollectorStats() {
    return {
      processed_intents_count: this.processedIntents.size,
      last_poll_timestamp: this.lastPollTimestamp,
      last_poll_ago_ms: Date.now() - this.lastPollTimestamp,
    };
  }
}
