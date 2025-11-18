import { Injectable, Logger } from '@nestjs/common';
import type {
  IGSIntent,
  IGSConstraints,
} from '../../../common/types/igs-intent.types';
import type { IGSSolution } from '../../../common/types/igs-solution.types';
import { SuiService } from 'src/modules/sui/sui.service';
import {
  IntentSubmittedEvent,
  SolutionSubmittedEvent,
} from 'src/common/types/sui-events.types';

interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
}

interface ParsedTransaction {
  inputs: Array<{ assetId: string; amount: string }>;
  outputs: Array<{ assetId: string; amount: string }>;
  protocols: string[];
  hops: number;
  gasCost: number;
}

/**
 * Constraint Validator
 * Validates solutions against intent constraints based on IGS schema
 * Implements validation for all constraint types defined in igs-intent-schema.json
 */
@Injectable()
export class ConstraintValidator {
  private readonly logger = new Logger(ConstraintValidator.name);

  constructor(private readonly suiService: SuiService) {}

  /**
   * Main validation entry point
   * Validates basic constraints that don't require dry-run results
   */
  async validate(
    windowEndMs: number,
    intent: IGSIntent,
    solution: IGSSolution,
    submittedSolution: SolutionSubmittedEvent,
  ): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    const constraints = intent.constraints;

    if (!constraints) {
      return { isValid: true, errors: [] };
    }

    // 1. Validate deadline (absolute requirement)
    if (submittedSolution.submittedAt > windowEndMs) {
      errors.push({
        field: 'constraints.deadlineMs',
        message: `Solution submitted after deadline. Now: ${submittedSolution.submittedAt}, Deadline: ${windowEndMs}`,
        severity: 'error',
      });
    }

    const parsedTx = this.parseTransactionBytes(solution.transactionBytes);

    // 3. Validate max inputs (spending ceiling)
    if (constraints.maxInputs && constraints.maxInputs.length > 0) {
      for (const maxInput of constraints.maxInputs) {
        const actualInput = parsedTx.inputs.find(
          (inp) => inp.assetId === maxInput.assetId,
        );

        if (actualInput) {
          const actualAmount = BigInt(actualInput.amount);
          const maxAmount = BigInt(maxInput.amount);

          if (actualAmount > maxAmount) {
            errors.push({
              field: 'constraints.maxInputs',
              message: `Input amount exceeds maximum for ${maxInput.assetId}: ${actualAmount} > ${maxAmount}`,
              severity: 'error',
            });
          }
        }
      }
    }

    // 4. Validate routing constraints
    if (constraints.routing) {
      const { maxHops, blacklistProtocols, whitelistProtocols } =
        constraints.routing;

      // 4.1 Max hops validation
      if (maxHops !== undefined && parsedTx.hops > maxHops) {
        errors.push({
          field: 'constraints.routing.maxHops',
          message: `Too many routing hops: ${parsedTx.hops} > ${maxHops}`,
          severity: 'error',
        });
      }

      // 4.2 Protocol blacklist validation
      if (blacklistProtocols && blacklistProtocols.length > 0) {
        const blockedProtocols = parsedTx.protocols.filter((protocol) =>
          blacklistProtocols.includes(protocol),
        );

        if (blockedProtocols.length > 0) {
          errors.push({
            field: 'constraints.routing.blacklistProtocols',
            message: `Solution uses blacklisted protocols: ${blockedProtocols.join(', ')}`,
            severity: 'error',
          });
        }
      }

      // 4.3 Protocol whitelist validation
      if (whitelistProtocols && whitelistProtocols.length > 0) {
        const nonWhitelistedProtocols = parsedTx.protocols.filter(
          (protocol) => !whitelistProtocols.includes(protocol),
        );

        if (nonWhitelistedProtocols.length > 0) {
          errors.push({
            field: 'constraints.routing.whitelistProtocols',
            message: `Solution uses non-whitelisted protocols: ${nonWhitelistedProtocols.join(', ')}`,
            severity: 'error',
          });
        }
      }
    }

    return {
      isValid: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
    };
  }

  /**
   * Validate complex constraints that require dry-run results
   * This includes slippage, min outputs, gas costs, and limit prices
   */
  async validateComplexConstraints(
    intent: IGSIntent,
    solution: IGSSolution,
    dryRunResult: any,
  ): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    const constraints = intent.constraints;

    if (!constraints) {
      return { isValid: true, errors: [] };
    }

    // 1. Validate min outputs (slippage protection)
    if (constraints.minOutputs && constraints.minOutputs.length > 0) {
      for (const minOutput of constraints.minOutputs) {
        const actualOutput = this.extractOutputFromDryRun(
          dryRunResult,
          minOutput.assetId,
        );

        if (actualOutput) {
          const actualAmount = BigInt(actualOutput);
          const minAmount = BigInt(minOutput.amount);

          if (actualAmount < minAmount) {
            errors.push({
              field: 'constraints.minOutputs',
              message: `Output amount below minimum for ${minOutput.assetId}: ${actualAmount} < ${minAmount}`,
              severity: 'error',
            });
          }
        } else {
          errors.push({
            field: 'constraints.minOutputs',
            message: `Required output asset ${minOutput.assetId} not found in solution`,
            severity: 'error',
          });
        }
      }
    }

    // 2. Validate max slippage (based on expected vs actual outputs)
    if (
      constraints.maxSlippageBps !== undefined &&
      intent.operation.expectedOutcome
    ) {
      const expectedOutputs = intent.operation.expectedOutcome.expectedOutputs;

      for (const expectedOutput of expectedOutputs) {
        const actualOutputStr = this.extractOutputFromDryRun(
          dryRunResult,
          expectedOutput.assetId,
        );

        if (actualOutputStr && expectedOutput.amount !== '0') {
          const expectedAmount = BigInt(expectedOutput.amount);
          const actualAmount = BigInt(actualOutputStr);

          // Calculate slippage in basis points
          // slippage = (expected - actual) / expected * 10000
          const slippageBps = Number(
            ((expectedAmount - actualAmount) * BigInt(10000)) / expectedAmount,
          );

          if (slippageBps > constraints.maxSlippageBps) {
            errors.push({
              field: 'constraints.maxSlippageBps',
              message: `Slippage exceeds maximum: ${slippageBps} bps > ${constraints.maxSlippageBps} bps for ${expectedOutput.assetId}`,
              severity: 'error',
            });
          }
        }
      }
    }

    // 3. Validate max gas cost
    if (constraints.maxGasCost) {
      const gasUsed = this.extractGasFromDryRun(dryRunResult);
      const maxGas = BigInt(constraints.maxGasCost.amount);

      if (BigInt(gasUsed) > maxGas) {
        errors.push({
          field: 'constraints.maxGasCost',
          message: `Gas cost exceeds maximum: ${gasUsed} > ${maxGas}`,
          severity: 'error',
        });
      }
    }

    // 4. Validate limit price
    if (constraints.limitPrice) {
      const { price, comparison, priceAsset } = constraints.limitPrice;

      // Extract actual execution price from dry run
      const actualPrice = this.calculateExecutionPrice(
        intent,
        dryRunResult,
        priceAsset,
      );

      if (actualPrice !== null) {
        const limitPrice = parseFloat(price);
        const meetsCondition =
          comparison === 'gte'
            ? actualPrice >= limitPrice
            : actualPrice <= limitPrice;

        if (!meetsCondition) {
          errors.push({
            field: 'constraints.limitPrice',
            message: `Execution price ${actualPrice} does not meet limit ${comparison} ${limitPrice} for ${priceAsset}`,
            severity: 'error',
          });
        }
      } else {
        errors.push({
          field: 'constraints.limitPrice',
          message: `Unable to calculate execution price for ${priceAsset}`,
          severity: 'warning',
        });
      }
    }

    return {
      isValid: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
    };
  }

  /**
   * Parse transaction bytes to extract basic information
   * In production, this should use @mysten/sui.js to deserialize PTB
   */
  private parseTransactionBytes(transactionBytes: string): ParsedTransaction {
    const txn = this.suiService.getSuiClient()

    return {
      inputs: [],
      outputs: [],
      protocols: [],
      hops: 0,
      gasCost: 0,
    };
  }

  /**
   * Extract output amount for specific asset from dry run results
   */
  private extractOutputFromDryRun(
    dryRunResult: any,
    assetId: string,
  ): string | null {
    // TODO: Parse Sui dry run results to extract coin changes
    // Dry run results contain 'effects.created' or 'balanceChanges'

    if (!dryRunResult?.effects?.balanceChanges) {
      return null;
    }

    // Find the balance change for this asset (positive = received)
    const balanceChange = dryRunResult.effects.balanceChanges.find(
      (bc: any) => bc.coinType === assetId && BigInt(bc.amount) > 0,
    );

    return balanceChange ? balanceChange.amount : null;
  }

  /**
   * Extract gas cost from dry run results
   */
  private extractGasFromDryRun(dryRunResult: any): number {
    if (!dryRunResult?.effects?.gasUsed) {
      return 0;
    }

    const { computationCost, storageCost, storageRebate } =
      dryRunResult.effects.gasUsed;

    // Total gas = computation + storage - rebate
    return (
      Number(computationCost) + Number(storageCost) - Number(storageRebate || 0)
    );
  }

  /**
   * Calculate execution price from intent and dry run results
   * Price = input amount / output amount (in terms of priceAsset)
   */
  private calculateExecutionPrice(
    intent: IGSIntent,
    dryRunResult: any,
    priceAsset: string,
  ): number | null {
    // Extract input and output amounts from intent and dry run
    const inputAsset = intent.operation.inputs[0];
    const outputAsset = intent.operation.outputs[0];

    if (!inputAsset || !outputAsset) {
      return null;
    }

    // Get actual output from dry run
    const actualOutputStr = this.extractOutputFromDryRun(
      dryRunResult,
      outputAsset.assetId,
    );

    if (!actualOutputStr) {
      return null;
    }

    // Get input amount
    let inputAmount: string;
    if (inputAsset.amount.type === 'exact') {
      inputAmount = inputAsset.amount.value;
    } else {
      return null; // Can't calculate price for range/all inputs
    }

    // Calculate price based on which asset is the price asset
    const inputAmountNum = parseFloat(inputAmount);
    const outputAmountNum = parseFloat(actualOutputStr);

    // Adjust for decimals if asset info available
    const inputDecimals = inputAsset.assetInfo?.decimals || 0;
    const outputDecimals = outputAsset.assetInfo?.decimals || 0;

    const normalizedInput = inputAmountNum / Math.pow(10, inputDecimals);
    const normalizedOutput = outputAmountNum / Math.pow(10, outputDecimals);

    if (priceAsset === inputAsset.assetId) {
      // Price in terms of input asset
      return normalizedInput / normalizedOutput;
    } else if (priceAsset === outputAsset.assetId) {
      // Price in terms of output asset
      return normalizedOutput / normalizedInput;
    }

    return null;
  }
}
