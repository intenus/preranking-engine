import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { redisConfig, RedisConfig } from '../../config';
import Redis from 'ioredis';
import { ConfigService, ConfigType } from '@nestjs/config';
import type { IGSIntent } from '../../common/types/igs-intent.types';
import type { IGSSolution } from '../../common/types/igs-solution.types';
import { IntentWithIGS } from '../../common/types';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  // Redis key prefixes
  private readonly INTENT_PREFIX = 'intent:';
  private readonly SOLUTION_PREFIX = 'solution:';
  private readonly FAILED_SOLUTION_PREFIX = 'failed:';
  private readonly RANKING_QUEUE = 'ranking:queue';
  private readonly EVENT_CURSOR_KEY = 'sui:event:cursor';

  constructor(
    @Inject(redisConfig.KEY)
    private readonly config: ConfigType<typeof redisConfig>,
  ) {}

  onModuleInit() {
    this.client = new Redis(this.config);
    this.logger.log('Redis client initialized');
  }

  getClient() {
    return this.client;
  }

  getPubClient() {
    return this.client.duplicate();
  }

  getSubClient() {
    return this.client.duplicate();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<'OK'> {
    return this.client.set(key, value);
  }

  async setWithExpiry(key: string, value: string, seconds: number): Promise<'OK'> {
    return this.client.set(key, value, 'EX', seconds);
  }

  // ===== INTENT STORAGE =====

  /**
   * Store intent in Redis
   */
  async storeIntent(intentId: string, intent: IntentWithIGS): Promise<void> {
    const key = `${this.INTENT_PREFIX}${intentId}`;
    await this.client.set(key, JSON.stringify(intent), 'EX', 3600); // 1 hour TTL
    this.logger.log(`Stored intent ${intentId} in Redis`);
  }

  /**
   * Get intent from Redis
   */
  async getIntent(intentId: string): Promise<IntentWithIGS | null> {
    const key = `${this.INTENT_PREFIX}${intentId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  // ===== SOLUTION STORAGE =====

  /**
   * Store passed solution result in Redis
   */
  async storeSolutionResult(
    intentId: string,
    solutionId: string,
    data: {
      solution: IGSSolution;
      solutionId: string;
      features: any;
      dryRunResult: any;
    },
  ): Promise<void> {
    const key = `${this.SOLUTION_PREFIX}${intentId}:${solutionId}`;
    await this.client.set(key, JSON.stringify(data), 'EX', 3600);
    
    // Also add to a set for easy retrieval
    await this.client.sadd(`${this.SOLUTION_PREFIX}${intentId}:passed`, solutionId);
    
    this.logger.log(`Stored solution ${solutionId} for intent ${intentId}`);
  }

  /**
   * Store failed solution
   */
  async storeFailedSolution(
    intentId: string,
    solutionId: string,
    data: {
      solutionId: string;
      failureReason: string;
      errors: any[];
    },
  ): Promise<void> {
    const key = `${this.FAILED_SOLUTION_PREFIX}${intentId}:${solutionId}`;
    await this.client.set(key, JSON.stringify(data), 'EX', 3600);
    
    // Add to failed set
    await this.client.sadd(`${this.FAILED_SOLUTION_PREFIX}${intentId}:set`, solutionId);
    
    this.logger.log(`Stored failed solution ${solutionId} for intent ${intentId}`);
  }

  /**
   * Get all passed solutions for an intent
   */
  async getPassedSolutions(intentId: string): Promise<any[]> {
    const solutionIds = await this.client.smembers(`${this.SOLUTION_PREFIX}${intentId}:passed`);
    
    const solutions = await Promise.all(
      solutionIds.map(async (solutionId) => {
        const key = `${this.SOLUTION_PREFIX}${intentId}:${solutionId}`;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
      }),
    );
    
    return solutions.filter(Boolean);
  }

  /**
   * Get failed solution count
   */
  async getFailedSolutionCount(intentId: string): Promise<number> {
    return this.client.scard(`${this.FAILED_SOLUTION_PREFIX}${intentId}:set`);
  }

  // ===== RANKING SERVICE INTEGRATION =====

  /**
   * Send data to ranking service
   * Uses a Redis list as a queue that the ranking service monitors
   */
  async sendToRankingService(intentId: string, data: any): Promise<void> {
    await this.client.lpush(this.RANKING_QUEUE, JSON.stringify(data));
    this.logger.log(`Sent intent ${intentId} to ranking service queue`);
  }

  // ===== EVENT CURSOR STORAGE =====

  /**
   * Store event cursor for resuming after restart
   */
  async storeEventCursor(cursor: { eventSeq: string; txDigest: string }): Promise<void> {
    await this.client.set(this.EVENT_CURSOR_KEY, JSON.stringify(cursor));
    this.logger.debug(`Updated event cursor: ${cursor.eventSeq}`);
  }

  /**
   * Get stored event cursor
   */
  async getEventCursor(): Promise<{ eventSeq: string; txDigest: string } | null> {
    const data = await this.client.get(this.EVENT_CURSOR_KEY);
    return data ? JSON.parse(data) : null;
  }

  // ===== CLEANUP =====

  /**
   * Delete all data for an intent
   */
  async deleteIntentData(intentId: string): Promise<void> {
    // Get all solution IDs
    const passedIds = await this.client.smembers(`${this.SOLUTION_PREFIX}${intentId}:passed`);
    const failedIds = await this.client.smembers(`${this.FAILED_SOLUTION_PREFIX}${intentId}:set`);
    
    // Delete all keys
    const keysToDelete = [
      `${this.INTENT_PREFIX}${intentId}`,
      `${this.SOLUTION_PREFIX}${intentId}:passed`,
      `${this.FAILED_SOLUTION_PREFIX}${intentId}:set`,
      ...passedIds.map(id => `${this.SOLUTION_PREFIX}${intentId}:${id}`),
      ...failedIds.map(id => `${this.FAILED_SOLUTION_PREFIX}${intentId}:${id}`),
    ];
    
    if (keysToDelete.length > 0) {
      await this.client.del(...keysToDelete);
    }
    
    this.logger.log(`Deleted all data for intent ${intentId}`);
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis client disconnected');
  }
}
