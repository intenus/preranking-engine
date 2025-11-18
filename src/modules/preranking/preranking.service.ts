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
    // Extract gas cost from dry run
    const gasCost = this.extractGasCost(dryRunResult);

    // Calculate surplus (simplified - would need market data in production)
    const surplus = this.calculateSurplus(intent, dryRunResult);

    return {
      surplusUsd: surplus.usd,
      surplusPercentage: surplus.percentage,
      gasCost,
      protocolFees: 0, // Would extract from dry run events
      totalCost: gasCost,
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

  private calculateSurplus(
    intent: IGSIntent,
    dryRunResult: any,
  ): {
    usd: number;
    percentage: number;
  } {
    // Simplified - would need actual output amounts and market prices
    return {
      usd: 0,
      percentage: 0,
    };
  }

  private extractHopCount(dryRunResult: any): number {
    // Would parse transaction structure to count hops
    return 1;
  }

  private extractProtocolCount(dryRunResult: any): number {
    // Would parse events to count unique protocols
    return 1;
  }
}
