import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { DefiLlamaConfig, SourceFetchResult } from '../../../common/types/source-map.types';

interface DefiLlamaPriceResponse {
  coins: Record<string, {
    decimals: number;
    price: number;
    symbol: string;
    timestamp: number;
    confidence: number;
  }>;
}

interface DefiLlamaChartResponse {
  coins: Record<string, {
    prices: Array<{
      timestamp: number;
      price: number;
    }>;
    symbol: string;
    confidence: number;
  }>;
}

@Injectable()
export class DefiLlamaProvider {
  private readonly logger = new Logger(DefiLlamaProvider.name);
  private readonly baseUrl = 'https://coins.llama.fi';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Fetch current price from DefiLlama
   */
  async fetchPrice(
    config: DefiLlamaConfig,
    sourceId: string,
  ): Promise<SourceFetchResult<number>> {
    try {
      const coins = config.coins.join(',');
      const url = `${config.baseUrl || this.baseUrl}/prices/current/${coins}`;

      this.logger.debug(`Fetching DefiLlama price: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get<DefiLlamaPriceResponse>(url),
      );

      const data = response.data;
      
      if (!data.coins || Object.keys(data.coins).length === 0) {
        throw new Error(`No price data found for: ${coins}`);
      }

      const coinKey = Object.keys(data.coins)[0];
      const coinData = data.coins[coinKey];

      return {
        value: coinData.price,
        timestamp: coinData.timestamp * 1000, // Convert to ms
        source: sourceId,
        confidence: coinData.confidence || 0.99,
        metadata: {
          symbol: coinData.symbol,
          decimals: coinData.decimals,
          provider: 'defillama',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch DefiLlama price: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch historical prices from DefiLlama
   */
  async fetchHistorical(
    config: DefiLlamaConfig,
    sourceId: string,
  ): Promise<SourceFetchResult<number[]>> {
    try {
      const coins = config.coins.join(',');
      const searchWidth = config.searchWidth || '4h';
      const url = `${config.baseUrl || this.baseUrl}/chart/${coins}?searchWidth=${searchWidth}`;

      this.logger.debug(`Fetching DefiLlama historical: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get<DefiLlamaChartResponse>(url),
      );

      const data = response.data;
      
      if (!data.coins || Object.keys(data.coins).length === 0) {
        throw new Error(`No historical data found for: ${coins}`);
      }

      const coinKey = Object.keys(data.coins)[0];
      const coinData = data.coins[coinKey];
      const prices = coinData.prices.map(p => p.price);

      return {
        value: prices,
        timestamp: Date.now(),
        source: sourceId,
        confidence: coinData.confidence || 0.99,
        metadata: {
          symbol: coinData.symbol,
          priceCount: prices.length,
          provider: 'defillama',
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch DefiLlama historical: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get percentage change over time period
   */
  async fetchPercentageChange(
    config: DefiLlamaConfig,
    sourceId: string,
  ): Promise<SourceFetchResult<number>> {
    try {
      const historicalResult = await this.fetchHistorical(config, sourceId);
      const prices = historicalResult.value;

      if (prices.length < 2) {
        throw new Error('Not enough historical data for percentage change');
      }

      const oldestPrice = prices[0];
      const latestPrice = prices[prices.length - 1];
      const percentageChange = ((latestPrice - oldestPrice) / oldestPrice) * 100;

      return {
        value: percentageChange,
        timestamp: historicalResult.timestamp,
        source: sourceId,
        confidence: historicalResult.confidence,
        metadata: {
          ...historicalResult.metadata,
          oldestPrice,
          latestPrice,
          period: config.searchWidth,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to calculate percentage change: ${error.message}`);
      throw error;
    }
  }
}