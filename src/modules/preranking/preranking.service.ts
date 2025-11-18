import { Injectable, Logger } from '@nestjs/common';
import type { IGSIntent } from '../../common/types/igs-intent.types';
import type { IGSSolution } from '../../common/types/igs-solution.types';
import type {
  PreRankingResult,
  IntentClassification,
} from '../../common/types/core.types';
import { ConstraintValidator } from './validators/constraint.validator';
import { SuiService } from '../sui/sui.service';
import { SolutionSubmittedEvent } from 'src/common/types/sui-events.types';

/**
 * PreRanking Service
 * NEW: Instant preranking - validates solutions immediately as they arrive
 * Does NOT perform final ranking - only filtering/validation
 */
@Injectable()
export class PreRankingService {
  private readonly logger = new Logger(PreRankingService.name);

  constructor(
    private readonly constraintValidator: ConstraintValidator,
    private readonly suiService: SuiService,
  ) {}

  /**
   * Process a single solution instantly (new workflow)
   * Returns validation result immediately
   */
  async processSingleSolution(
    windowEndMs: number,
    intent: IGSIntent,
    submittedSolution: SolutionSubmittedEvent,
    solution: IGSSolution,
  ): Promise<{
    passed: boolean;
    failureReason?: string;
    errors?: any[];
    features?: any;
    dryRunResult?: any;
  }> {
    try {
      this.logger.log(
        `PreRanking: Processing solution ${submittedSolution.solutionId} instantly`,
      );

      const validationResult = await this.constraintValidator.validate(
        windowEndMs,
        intent,
        solution,
        submittedSolution
      );

      if (!validationResult.isValid) {
        return {
          passed: false,
          failureReason: 'Constraint validation failed',
          errors: validationResult.errors,
        };
      }

      const dryRunResult = await this.suiService.dryRunTransactionBlock(
        solution.transactionBytes,
      );

      if (dryRunResult.effects?.status?.status !== 'success') {
        return {
          passed: false,
          failureReason: 'Dry run failed',
          errors: [
            { message: dryRunResult.effects?.status?.error || 'Unknown error' },
          ],
        };
      }

      const complexValidationResult = await this.constraintValidator.validateComplexConstraints(
        intent,
        solution,
        dryRunResult,
      );

      if (!complexValidationResult.isValid) {
        return {
          passed: false,
          failureReason: 'Complex validation failed',
          errors: complexValidationResult.errors,
        };
      }

      const features = this.extractFeatures(intent, solution, dryRunResult);

      return {
        passed: true,
        features,
        dryRunResult,
      };
    } catch (error: any) {
      this.logger.error(
        `Error processing solution ${submittedSolution.solutionId}: ${error.message}`,
      );
      return {
        passed: false,
        failureReason: 'Processing error',
        errors: [{ message: error.message }],
      };
    }
  }

  /**
   * @deprecated 
   * Replaced by processSingleSolution for instant preranking
   * Process solutions for an intent
   * Returns filtered solutions with feature vectors
   */
  async processIntent(
    intent: IGSIntent,
    solutions: Array<{ solutionId: string; solution: IGSSolution }>,
  ): Promise<PreRankingResult> {
    this.logger.log(
      `PreRanking: Processing intent with ${solutions.length} solutions`,
    );

    const passedSolutions: string[] = [];
    const failedSolutions: Array<{
      solutionId: string;
      failureReason: string;
      errors: any[];
    }> = [];
    const featureVectors: PreRankingResult['featureVectors'] = [];
    const dryRunResults: PreRankingResult['dryRunResults'] = [];

    let dryRunExecuted = 0;
    let dryRunSuccessful = 0;

    const classification = this.classifyIntent(intent);

    for (const { solutionId, solution } of solutions) {
      try {
        // const validationResult = await this.constraintValidator.validate(
        //   intent,
        //   solution,
        // );

        // if (!validationResult.isValid) {
        //   failedSolutions.push({
        //     solutionId,
        //     failureReason: 'Constraint validation failed',
        //     errors: validationResult.errors,
        //   });
        //   continue;
        // }

        // Step 2: Dry run transaction
        dryRunExecuted++;
        const dryRunResult = await this.suiService.dryRunTransactionBlock(
          solution.transactionBytes,
        );

        if (dryRunResult.effects?.status?.status !== 'success') {
          failedSolutions.push({
            solutionId,
            failureReason: 'Dry run failed',
            errors: [
              {
                message: dryRunResult.effects?.status?.error || 'Unknown error',
              },
            ],
          });
          continue;
        }

        dryRunSuccessful++;
        dryRunResults.push({
          solutionId,
          result: dryRunResult,
        });

        // Step 3: Extract features
        const features = this.extractFeatures(intent, solution, dryRunResult);
        featureVectors.push({
          solutionId,
          features,
        });

        passedSolutions.push(solutionId);
      } catch (error: any) {
        this.logger.error(
          `Error processing solution ${solutionId}: ${error.message}`,
        );
        failedSolutions.push({
          solutionId,
          failureReason: 'Processing error',
          errors: [{ message: error.message }],
        });
      }
    }

    this.logger.log(
      `PreRanking complete: ${passedSolutions.length} passed, ${failedSolutions.length} failed`,
    );

    return {
      intentId: `${intent.object.userAddress}_${intent.object.createdTs}`,
      intentClassification: classification,
      passedSolutionIds: passedSolutions,
      failedSolutionIds: failedSolutions,
      featureVectors,
      dryRunResults,
      stats: {
        totalSubmitted: solutions.length,
        passed: passedSolutions.length,
        failed: failedSolutions.length,
        dryRunExecuted,
        dryRunSuccessful,
      },
      processedAt: Date.now(),
    };
  }

  /**
   * Classify intent using rule-based approach
   * Can be replaced with ML model later
   */
  private classifyIntent(intent: IGSIntent): IntentClassification {
    const primaryCategory = this.determinePrimaryCategory(intent);
    const detectedPriority = this.detectPriority(intent);
    const complexityLevel = this.determineComplexity(intent);
    const riskLevel = this.assessRisk(intent);

    return {
      primaryCategory,
      detectedPriority,
      complexityLevel,
      riskLevel,
      confidence: 0.85, // Rule-based confidence
      metadata: {
        method: 'rule_based',
        featuresUsed: ['intent_type', 'constraints', 'operation_mode'],
      },
    };
  }

  private determinePrimaryCategory(
    intent: IGSIntent,
  ): 'swap' | 'limit_order' | 'complex_defi' | 'arbitrage' | 'other' {
    if (intent.intentType.startsWith('swap')) {
      return 'swap';
    }
    if (intent.intentType.startsWith('limit')) {
      return 'limit_order';
    }
    return 'other';
  }

  private detectPriority(
    intent: IGSIntent,
  ): 'speed' | 'cost' | 'output' | 'balanced' {
    const goal = intent.preferences?.optimizationGoal;
    if (goal === 'fastest_execution') return 'speed';
    if (goal === 'minimize_gas') return 'cost';
    if (goal === 'maximize_output') return 'output';
    return 'balanced';
  }

  private determineComplexity(
    intent: IGSIntent,
  ): 'simple' | 'moderate' | 'complex' {
    const inputCount = intent.operation.inputs.length;
    const outputCount = intent.operation.outputs.length;
    const hasConstraints = !!intent.constraints;

    if (inputCount === 1 && outputCount === 1 && !hasConstraints) {
      return 'simple';
    }
    if (inputCount + outputCount <= 4) {
      return 'moderate';
    }
    return 'complex';
  }

  private assessRisk(intent: IGSIntent): 'low' | 'medium' | 'high' {
    const hasSlippageProtection = !!intent.constraints?.maxSlippageBps;
    const hasDeadline = !!intent.constraints?.deadlineMs;
    const hasMinOutputs = !!intent.constraints?.minOutputs;

    if (hasSlippageProtection && hasDeadline && hasMinOutputs) {
      return 'low';
    }
    if (hasSlippageProtection || hasDeadline) {
      return 'medium';
    }
    return 'high';
  }

  /**
   * Extract features from solution for ranking
   */
  private extractFeatures(
    intent: IGSIntent,
    solution: IGSSolution,
    dryRunResult: any,
  ): PreRankingResult['featureVectors'][0]['features'] {
    const gasCost = this.extractGasCost(dryRunResult);
    const protocolFees = this.extractProtocolFees(dryRunResult);
    const surplus = this.calculateSurplus(intent, dryRunResult);

    return {
      surplusUsd: surplus.usd,
      surplusPercentage: surplus.percentage,
      gasCost,
      protocolFees,
      totalCost: gasCost + protocolFees,
      totalHops: this.extractHopCount(dryRunResult),
      protocolsCount: this.extractProtocolCount(dryRunResult),
      estimatedExecutionTime: 2000, // Placeholder
      solverReputationScore: 0.8, // Would query from on-chain registry
      solverSuccessRate: 0.9, // Would query from on-chain registry
    };
  }

  private extractGasCost(dryRunResult: any): number {
    return Number(dryRunResult.effects?.gasUsed?.computationCost || 0);
  }

  /**
   * Extract protocol fees from dry run result
   * Fees are typically captured in balance changes or events
   */
  private extractProtocolFees(dryRunResult: any): number {
    try {
      const events = dryRunResult.events || [];
      let totalFees = 0;

      // Look for fee-related events
      // Common patterns: SwapEvent, FeeCollected, etc.
      for (const event of events) {
        const parsedJson = event.parsedJson;
        if (parsedJson) {
          if (parsedJson.fee || parsedJson.protocol_fee || parsedJson.platformFee) {
            const fee = parsedJson.fee || parsedJson.protocol_fee || parsedJson.platformFee;
            totalFees += Number(fee);
          }
          // Check for swap events with fee information
          if (parsedJson.fee_amount) {
            totalFees += Number(parsedJson.fee_amount);
          }
        }
      }

      return totalFees;
    } catch (error) {
      this.logger.warn(`Failed to extract protocol fees: ${error}`);
      return 0;
    }
  }

  /**
   * Calculate surplus (output amount vs expected minimum)
   * Positive surplus means user gets more than minimum expected
   */
  private calculateSurplus(
    intent: IGSIntent,
    dryRunResult: any,
  ): {
    usd: number;
    percentage: number;
  } {
    try {
      const balanceChanges = dryRunResult.balanceChanges || [];
      
      // Find output balance changes for the user
      const outputs = intent.operation.outputs || [];
      
      if (outputs.length === 0 || balanceChanges.length === 0) {
        return { usd: 0, percentage: 0 };
      }

      // Get the expected minimum output from constraints
      const minOutputs = intent.constraints?.minOutputs;
      if (!minOutputs || minOutputs.length === 0) {
        return { usd: 0, percentage: 0 };
      }

      // Calculate surplus for primary output
      const primaryOutput = outputs[0];
      const minOutput = minOutputs.find(
        (min) => min.assetId === primaryOutput.assetId,
      );

      if (!minOutput) {
        return { usd: 0, percentage: 0 };
      }

      // Find actual output from balance changes
      const actualOutput = balanceChanges.find(
        (change: any) =>
          change.coinType === primaryOutput.assetId &&
          change.owner?.AddressOwner === intent.object.userAddress,
      );

      if (!actualOutput) {
        return { usd: 0, percentage: 0 };
      }

      const actualAmount = Math.abs(Number(actualOutput.amount));
      const minAmount = Number(minOutput.amount);
      const surplusAmount = actualAmount - minAmount;
      const surplusPercentage = (surplusAmount / minAmount) * 100;

      // Note: USD conversion would require oracle/price feed
      // For now, return raw surplus amount
      return {
        usd: surplusAmount, // Would convert to USD with oracle
        percentage: surplusPercentage,
      };
    } catch (error) {
      this.logger.warn(`Failed to calculate surplus: ${error}`);
      return { usd: 0, percentage: 0 };
    }
  }

  /**
   * Extract hop count from dry run result
   * Hops are counted by analyzing balance changes and object changes
   * Each intermediate swap/interaction counts as a hop
   */
  private extractHopCount(dryRunResult: any): number {
    try {
      // Count balance changes (excluding gas payment)
      const balanceChanges = dryRunResult.balanceChanges || [];
      const nonGasChanges = balanceChanges.filter(
        (change: any) => change.coinType !== '0x2::sui::SUI',
      );

      // Each unique coin type transition represents a potential hop
      // Simple heuristic: (unique coin types - 1) / 2
      // More sophisticated: parse transaction commands
      const uniqueCoinTypes = new Set(
        nonGasChanges.map((change: any) => change.coinType),
      );

      // If we have object changes, analyze those for swap operations
      const objectChanges = dryRunResult.objectChanges || [];
      const swapOperations = objectChanges.filter(
        (change: any) =>
          change.type === 'mutated' || change.type === 'created',
      );

      // Heuristic: max of coin type transitions or swap operations
      const hopsByBalance = Math.max(1, uniqueCoinTypes.size - 1);
      const hopsByObjects = Math.max(1, Math.floor(swapOperations.length / 2));

      return Math.max(hopsByBalance, hopsByObjects);
    } catch (error) {
      this.logger.warn(`Failed to extract hop count: ${error}`);
      return 1;
    }
  }

  /**
   * Extract protocol count from dry run result
   * Protocols are identified by analyzing events and package IDs
   */
  private extractProtocolCount(dryRunResult: any): number {
    try {
      const events = dryRunResult.events || [];
      const objectChanges = dryRunResult.objectChanges || [];

      // Extract unique package IDs from events
      const packageIdsFromEvents = new Set(
        events
          .map((event: any) => {
            const eventType = event.type;
            if (typeof eventType === 'string') {
              const parts = eventType.split('::');
              if (parts.length >= 2) {
                return parts[0]; // Package ID
              }
            }
            return null;
          })
          .filter((id: string | null) => id !== null && id !== '0x2'), // Exclude system package
      );

      // Extract unique package IDs from object changes
      const packageIdsFromObjects = new Set(
        objectChanges
          .map((change: any) => {
            const objectType = change.objectType;
            if (typeof objectType === 'string') {
              const parts = objectType.split('::');
              if (parts.length >= 2) {
                return parts[0];
              }
            }
            return null;
          })
          .filter((id: string | null) => id !== null && id !== '0x2'),
      );

      // Combine both sets
      const allPackageIds = new Set([
        ...packageIdsFromEvents,
        ...packageIdsFromObjects,
      ]);

      // Return count, minimum 1 protocol
      return Math.max(1, allPackageIds.size);
    } catch (error) {
      this.logger.warn(`Failed to extract protocol count: ${error}`);
      return 1; 
    }
  }
}
