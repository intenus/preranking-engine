/**
 * Core Types - Generated from core-schema.json
 * PreRanking and Ranking Engine types
 */

import { IGSIntent } from "./igs-intent.types";
import { IntentSubmittedEvent } from "./sui-events.types";

export interface SolutionSubmission {
  solutionId: string;
  intentId: string;
  solverAddress: string;
  submittedAt: number;
  transactionBytesRef?: string;
}

export interface IntentClassification {
  primaryCategory: 'swap' | 'limit_order' | 'complex_defi' | 'arbitrage' | 'other';
  subCategory?: string;
  detectedPriority: 'speed' | 'cost' | 'output' | 'balanced';
  complexityLevel: 'simple' | 'moderate' | 'complex';
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
  metadata: {
    method: 'rule_based' | 'ml_model' | 'hybrid';
    modelVersion?: string;
    featuresUsed?: string[];
  };
}

export interface IntentWithIGS {
  intent: IntentSubmittedEvent;
  IGSIntent: IGSIntent;
}

export interface PreRankingResult {
  intentId: string;
  intentClassification: IntentClassification;
  passedSolutionIds: string[];
  failedSolutionIds: Array<{
    solutionId: string;
    failureReason: string;
    errors: any[];
  }>;
  featureVectors: Array<{
    solutionId: string;
    features: {
      surplusUsd: number;
      surplusPercentage: number;
      gasCost: number;
      protocolFees: number;
      totalCost: number;
      totalHops: number;
      protocolsCount: number;
      estimatedExecutionTime?: number;
      solverReputationScore?: number;
      solverSuccessRate?: number;
    };
  }>;
  dryRunResults: Array<{
    solutionId: string;
    result: any;
  }>;
  stats: {
    totalSubmitted: number;
    passed: number;
    failed: number;
    dryRunExecuted: number;
    dryRunSuccessful: number;
  };
  processedAt: number;
}

export interface RankedSolution {
  rank: number;
  score: number;
  solutionId: string;
  solverAddress: string;
  scoreBreakdown: {
    surplusScore: number;
    costScore: number;
    speedScore: number;
    reputationScore: number;
  };
  reasoning: {
    primaryReason: string;
    secondaryReasons: string[];
    riskAssessment: 'low' | 'medium' | 'high';
    confidenceLevel: number;
  };
  personalizationApplied: boolean;
  userFitScore?: number;
  warnings: string[];
  expiresAt: number;
}

export interface RankingResult {
  intentId: string;
  rankedSolutions: RankedSolution[];
  bestSolution: RankedSolution;
  metadata: {
    totalSolutions: number;
    averageScore: number;
    strategy: string;
    strategyVersion: string;
    intentCategory: string;
  };
  rankedAt: number;
  expiresAt: number;
}
