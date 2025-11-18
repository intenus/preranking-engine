import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IntentSubmittedEvent, SolutionSubmittedEvent } from '../../src/common/types/sui-events.types';
import type { IGSIntent } from '../../src/common/types/igs-intent.types';
import type { IGSSolution } from '../../src/common/types/igs-solution.types';
import type { PreRankingResult } from '../../src/common/types/core.types';
import { WalrusService } from '../../src/modules/walrus/walrus.service';
import { PreRankingService } from '../../src/modules/preranking/preranking.service';
import { RedisService } from '../../src/modules/redis/redis.service';

interface IntentContext {
  intent: IGSIntent;
  intentId: string;
  passedSolutionCount: number;
  windowCloseTimeout: NodeJS.Timeout | null;
  walrusBlobId: string;
  windowEndMs: number;
}

/**
 * Intent Processing Service
 * New workflow (instant preranking):
 * 1. Listen for IntentSubmitted events on chain
 * 2. Fetch encrypted intent from Walrus
 * 3. Store intent in Redis
 * 4. Set timeout for window close
 * 5. When SolutionSubmitted event arrives:
 *    - Fetch solution from Walrus instantly
 *    - Run preranking immediately
 *    - Store passed solutions in Redis
 * 6. When window closes, send all passed solutions to ranking service
 */
@Injectable()
export class IntentProcessingService {
  private readonly logger = new Logger(IntentProcessingService.name);
  private activeIntents = new Map<string, IntentContext>();

  constructor(
    private readonly walrusService: WalrusService,
    private readonly preRankingService: PreRankingService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Handle IntentSubmitted event from blockchain
   */
  @OnEvent('intent.submitted')
  async handleIntentSubmitted(event: IntentSubmittedEvent): Promise<void> {
    try {
      this.logger.log(`Processing intent: ${event.intentId}`);

      const intent = await this.walrusService.fetchIntentHttp(event.walrusBlobId);
      await this.redisService.storeIntent(event.intentId, {
        intent: event,
        IGSIntent: intent,
      });

      const windowDuration = event.solverAccessWindow.endMs - event.solverAccessWindow.startMs;
      const now = Date.now();
      const remainingTime = Math.max(0, event.solverAccessWindow.endMs - now);

      this.logger.log(
        `Intent ${event.intentId}: Solution window ${windowDuration}ms, remaining ${remainingTime}ms`,
      );

      const context: IntentContext = {
        intent,
        intentId: event.intentId,
        passedSolutionCount: 0,
        windowCloseTimeout: null,
        walrusBlobId: event.walrusBlobId,
        windowEndMs: event.solverAccessWindow.endMs,
      };

      this.activeIntents.set(event.intentId, context);

      context.windowCloseTimeout = setTimeout(async () => {
        await this.sendToRankingService(event.intentId);
      }, remainingTime);

      this.logger.log(`Intent ${event.intentId} registered, ready for instant preranking`);
    } catch (error: any) {
      this.logger.error(`Error handling intent submitted: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle SolutionSubmitted event from blockchain
   * NEW: Instant preranking - validate immediately when solution arrives
   */
  @OnEvent('solution.submitted')
  async handleSolutionSubmitted(event: SolutionSubmittedEvent): Promise<void> {
    try {
      const context = this.activeIntents.get(event.intentId);
      if (!context) {
        this.logger.warn(`Received solution for unknown intent: ${event.intentId}`);
        return;
      }

      this.logger.log(`Received solution ${event.solutionId} for intent ${event.intentId}`);

      const solution = await this.walrusService.fetchSolution(event.walrusBlobId);
      const preRankingResult = await this.preRankingService.processSingleSolution(
        context.windowEndMs,
        context.intent,
        event,
        solution,
      );

      if (preRankingResult.passed) {
        await this.redisService.storeSolutionResult(
          event.intentId,
          event.solutionId,
          {
            solution,
            solutionId: event.solutionId,
            features: preRankingResult.features,
            dryRunResult: preRankingResult.dryRunResult,
          },
        );

        context.passedSolutionCount++;

        this.logger.log(
          `Solution ${event.solutionId} PASSED preranking for intent ${event.intentId} (${context.passedSolutionCount} total passed)`,
        );
      } else {
        await this.redisService.storeFailedSolution(
          event.intentId,
          event.solutionId,
          {
            solutionId: event.solutionId,
            failureReason: preRankingResult.failureReason,
            errors: preRankingResult.errors,
          },
        );

        this.logger.log(
          `Solution ${event.solutionId} FAILED preranking: ${preRankingResult.failureReason}`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Error handling solution submitted: ${error.message}`, error.stack);
    }
  }

  /**
   * Send all passed solutions to ranking service when window closes
   */
  private async sendToRankingService(intentId: string): Promise<void> {
    try {
      const context = this.activeIntents.get(intentId);

      if (!context) {
        this.logger.warn(`No context found for intent: ${intentId}`);
        return;
      }

      this.logger.log(
        `Solution window closed for intent ${intentId}. Sending ${context.passedSolutionCount} passed solutions to ranking service`,
      );

      if (context.passedSolutionCount === 0) {
        this.logger.warn(`No solutions passed preranking for intent ${intentId}`);
        await this.redisService.deleteIntentData(intentId);
        this.activeIntents.delete(intentId);
        return;
      }

      const passedSolutions = await this.redisService.getPassedSolutions(intentId);

      await this.redisService.sendToRankingService(intentId, {
        intentId,
        intent: context.intent,
        passedSolutions,
        totalSolutionsSubmitted: passedSolutions.length + (await this.redisService.getFailedSolutionCount(intentId)),
        windowClosedAt: Date.now(),
      });

      this.logger.log(`Sent ${passedSolutions.length} solutions to ranking service for intent ${intentId}`);

      this.activeIntents.delete(intentId);
    } catch (error: any) {
      this.logger.error(`Error sending to ranking service: ${error.message}`, error.stack);
      this.activeIntents.delete(intentId);
    }
  }

  /**
   * Get active intent count (for monitoring)
   */
  getActiveIntentCount(): number {
    return this.activeIntents.size;
  }

  /**
   * Get intent context (for debugging)
   */
  getIntentContext(intentId: string): IntentContext | undefined {
    return this.activeIntents.get(intentId);
  }

  /**
   * Manually trigger sending to ranking service (for testing)
   */
  async triggerSendToRanking(intentId: string): Promise<void> {
    await this.sendToRankingService(intentId);
  }
}
