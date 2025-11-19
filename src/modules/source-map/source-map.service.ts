import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefiLlamaProvider } from './providers/defillama.provider';
import { CetusProvider } from './providers/cetus.provider';
import { RedisService } from '../redis/redis.service';
import type {
  SourceMap,
  Source,
  SourceFetchResult,
  OracleConfig,
  OnChainConfig,
  DefiLlamaConfig,
  CetusConfig,
} from '../../common/types/source-map.types';
import type { IGSIntent } from '../../common/types/igs-intent.types';

@Injectable()
export class SourceMapService {
  private readonly logger = new Logger(SourceMapService.name);
  private sourceMap: SourceMap | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly defiLlamaProvider: DefiLlamaProvider,
    private readonly cetusProvider: CetusProvider,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.loadSourceMap();
  }

  private async loadSourceMap(): Promise<void> {
    try {
      this.sourceMap = require('./source/source-map.json');
      this.logger.log(`Loaded source map with ${Object.keys(this.sourceMap.sources).length} sources`);
    } catch (error) {
      this.logger.error('Failed to load source map', error);
    }
  }

  /**
   * Fetch data from a source
   */
  async fetch<T = any>(
    sourceId: string,
    intent?: IGSIntent,
    context?: Record<string, any>,
  ): Promise<SourceFetchResult<T>> {
    if (!this.sourceMap) {
      throw new Error('Source map not loaded');
    }

    const source = this.sourceMap.sources[sourceId];
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // Check cache
    if (source.cache?.enabled) {
      const cached = await this.getCached<T>(sourceId);
      if (cached) {
        this.logger.debug(`Cache hit for source: ${sourceId}`);
        return cached;
      }
    }

    let result: SourceFetchResult<T>;

    switch (source.type) {
      case 'oracle':
        result = await this.fetchFromOracle<T>(sourceId, source.config as OracleConfig, intent, context);
        break;
      case 'onchain':
        result = await this.fetchFromOnChain<T>(sourceId, source.config as OnChainConfig, intent, context);
        break;
      case 'aggregator':
        result = await this.fetchFromAggregator<T>(sourceId, source.config as any, intent, context);
        break;
      default:
        throw new Error(`Unknown source type: ${source.type}`);
    }

    // Cache result
    if (source.cache?.enabled) {
      await this.setCached(sourceId, result, source.cache.ttlMs || 5000);
    }

    return result;
  }

  /**
   * Fetch from oracle provider (DefiLlama, Pyth, etc.)
   */
  private async fetchFromOracle<T>(
    sourceId: string,
    config: OracleConfig,
    intent?: IGSIntent,
    context?: Record<string, any>,
  ): Promise<SourceFetchResult<T>> {
    const oracleConfig = config.config;

    switch (config.provider) {
      case 'defillama': {
        const defiLlamaConfig = oracleConfig as DefiLlamaConfig;
        
        // Interpolate coin addresses from intent if needed
        const coins = this.interpolateArray(defiLlamaConfig.coins, intent, context);
        const interpolatedConfig = { ...defiLlamaConfig, coins };

        let result: SourceFetchResult<any>;

        switch (defiLlamaConfig.endpoint) {
          case 'prices':
            result = await this.defiLlamaProvider.fetchPrice(interpolatedConfig, sourceId);
            break;
          case 'charts':
          case 'historical':
            result = await this.defiLlamaProvider.fetchHistorical(interpolatedConfig, sourceId);
            break;
          default:
            throw new Error(`Unknown DefiLlama endpoint: ${defiLlamaConfig.endpoint}`);
        }

        return result as SourceFetchResult<T>;
      }

      default:
        throw new Error(`Unsupported oracle provider: ${config.provider}`);
    }
  }

  /**
   * Fetch from on-chain (Cetus, dry run, etc.)
   */
  private async fetchFromOnChain<T>(
    sourceId: string,
    config: OnChainConfig,
    intent?: IGSIntent,
    context?: Record<string, any>,
  ): Promise<SourceFetchResult<T>> {
    
    // Check if this is a Cetus-specific config
    if (config.packageId?.includes('1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb')) {
      // This is Cetus package
      const poolAddress = this.interpolateString(context?.poolAddress || '', intent, context);
      
      if (config.method === 'moveCall' && config.functionName === 'calculate_swap_result') {
        const inputAmount = this.interpolateString(
          config.arguments?.[3] || '0',
          intent,
          context,
        );
        const aToB = true; // Can be derived from intent
        
        const result = await this.cetusProvider.fetchSwapQuote(
          config as any,
          poolAddress,
          inputAmount,
          aToB,
          sourceId,
        );
        
        return result as SourceFetchResult<T>;
      }
      
      if (config.method === 'objectRead') {
        const result = await this.cetusProvider.fetchSpotPrice(poolAddress, sourceId);
        return result as SourceFetchResult<T>;
      }
    }

    // Generic on-chain handling
    throw new Error(`Generic on-chain method not implemented: ${config.method}`);
  }

  /**
   * Fetch from aggregator (combines multiple sources)
   */
  private async fetchFromAggregator<T>(
    sourceId: string,
    config: any,
    intent?: IGSIntent,
    context?: Record<string, any>,
  ): Promise<SourceFetchResult<T>> {
    const results = await Promise.allSettled(
      config.sources.map((srcId: string) => this.fetch(srcId, intent, context)),
    );

    const successfulResults = results
      .filter((r): r is PromiseFulfilledResult<SourceFetchResult> => r.status === 'fulfilled')
      .map(r => r.value);

    if (successfulResults.length < (config.minimumSources || 1)) {
      throw new Error(`Insufficient sources: ${successfulResults.length}/${config.minimumSources}`);
    }

    const values = successfulResults.map(r => Number(r.value));
    let aggregatedValue: number;

    switch (config.strategy) {
      case 'median':
        aggregatedValue = this.median(values);
        break;
      case 'average':
        if (config.weights) {
          aggregatedValue = this.weightedAverage(values, successfulResults, config.weights);
        } else {
          aggregatedValue = this.average(values);
        }
        break;
      case 'min':
        aggregatedValue = Math.min(...values);
        break;
      case 'max':
        aggregatedValue = Math.max(...values);
        break;
      default:
        throw new Error(`Unsupported strategy: ${config.strategy}`);
    }

    return {
      value: aggregatedValue as T,
      timestamp: Date.now(),
      source: sourceId,
      metadata: {
        sources: successfulResults.map(r => r.source),
        values,
        strategy: config.strategy,
      },
    };
  }

  private interpolateString(template: string, intent?: IGSIntent, context?: Record<string, any>): string {
    if (!template) return '';
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const value = this.resolvePath(path.trim(), { intent, context });
      return String(value);
    });
  }

  private interpolateArray(arr: string[], intent?: IGSIntent, context?: Record<string, any>): string[] {
    return arr.map(item => this.interpolateString(item, intent, context));
  }

  private resolvePath(path: string, data: any): any {
    const keys = path.split('.');
    let value = data;
    for (const key of keys) {
      const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayKey, index] = arrayMatch;
        value = value?.[arrayKey]?.[parseInt(index)];
      } else {
        value = value?.[key];
      }
      if (value === undefined) break;
    }
    return value;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid];
  }

  private average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private weightedAverage(
    values: number[],
    results: SourceFetchResult[],
    weights: Record<string, number>,
  ): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < results.length; i++) {
      const sourceId = results[i].source;
      const weight = weights[sourceId] || 0;
      totalWeight += weight;
      weightedSum += values[i] * weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : this.average(values);
  }

  private async getCached<T>(sourceId: string): Promise<SourceFetchResult<T> | null> {
    const key = `source:${sourceId}`;
    const cached = await this.redisService.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  private async setCached<T>(sourceId: string, result: SourceFetchResult<T>, ttlMs: number): Promise<void> {
    const key = `source:${sourceId}`;
    await this.redisService.setWithExpiry(key, JSON.stringify(result), Math.floor(ttlMs / 1000));
  }
}