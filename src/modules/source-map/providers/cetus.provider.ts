import { Injectable, Logger } from '@nestjs/common';
import { SuiService } from '../../sui/sui.service';
import { Transaction } from '@mysten/sui/transactions';
import type { CetusConfig, SourceFetchResult } from '../../../common/types/source-map.types';

interface CetusPoolData {
  sqrtPrice: string;
  tickCurrent: number;
  feeGrowthGlobalA: string;
  feeGrowthGlobalB: string;
  liquidity: string;
}

@Injectable()
export class CetusProvider {
  private readonly logger = new Logger(CetusProvider.name);
  
  // Cetus mainnet addresses
  private readonly CETUS_PACKAGE = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';
  private readonly CETUS_GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

  constructor(private readonly suiService: SuiService) {}

  /**
   * Fetch swap quote from Cetus pool
   * NOTE: This is a READ operation - we just read pool state and calculate the quote
   * No actual transaction is executed
   */
  async fetchSwapQuote(
    config: CetusConfig,
    poolAddress: string,
    inputAmount: string,
    aToB: boolean,
    sourceId: string,
  ): Promise<SourceFetchResult<string>> {
    try {
      // For MVP: Read pool state and calculate spot price * amount
      const poolState = await this.fetchPoolState(poolAddress, sourceId);
      const price = this.calculatePriceFromSqrt(poolState.value.sqrtPrice);
      
      // Simple calculation: outputAmount = inputAmount * price (if aToB)
      // or inputAmount / price (if bToA)
      const inputAmountNum = parseInt(inputAmount);
      let outputAmount: number;
      
      if (aToB) {
        outputAmount = inputAmountNum * price;
      } else {
        outputAmount = inputAmountNum / price;
      }

      return {
        value: Math.floor(outputAmount).toString(),
        timestamp: Date.now(),
        source: sourceId,
        metadata: {
          provider: 'cetus',
          poolAddress,
          aToB,
          inputAmount,
          spotPrice: price,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Cetus swap quote: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read current pool state (sqrt price, liquidity, etc.)
   */
  async fetchPoolState(
    poolAddress: string,
    sourceId: string,
  ): Promise<SourceFetchResult<CetusPoolData>> {
    try {
      const client = this.suiService.getSuiClient();
      
      const poolObject = await client.getObject({
        id: poolAddress,
        options: {
          showContent: true,
          showType: true,
        },
      });

      if (!poolObject.data || poolObject.data.content?.dataType !== 'moveObject') {
        throw new Error(`Invalid pool object: ${poolAddress}`);
      }

      const fields = poolObject.data.content.fields as any;

      const poolData: CetusPoolData = {
        sqrtPrice: fields.current_sqrt_price || fields.sqrt_price,
        tickCurrent: fields.current_tick_index || 0,
        feeGrowthGlobalA: fields.fee_growth_global_a || '0',
        feeGrowthGlobalB: fields.fee_growth_global_b || '0',
        liquidity: fields.liquidity || '0',
      };

      return {
        value: poolData,
        timestamp: Date.now(),
        source: sourceId,
        metadata: {
          provider: 'cetus',
          poolAddress,
          objectDigest: poolObject.data.digest,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Cetus pool state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate price from sqrt price
   * Price = (sqrtPrice / 2^64)^2
   */
  calculatePriceFromSqrt(sqrtPrice: string): number {
    const Q64 = BigInt(2) ** BigInt(64);
    const sqrtPriceBig = BigInt(sqrtPrice);
    const price = Number(sqrtPriceBig * sqrtPriceBig) / Number(Q64 * Q64);
    return price;
  }

  /**
   * Get spot price from pool
   */
  async fetchSpotPrice(
    poolAddress: string,
    sourceId: string,
  ): Promise<SourceFetchResult<number>> {
    try {
      const poolState = await this.fetchPoolState(poolAddress, sourceId);
      const price = this.calculatePriceFromSqrt(poolState.value.sqrtPrice);

      return {
        value: price,
        timestamp: poolState.timestamp,
        source: sourceId,
        metadata: {
          ...poolState.metadata,
          sqrtPrice: poolState.value.sqrtPrice,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Cetus spot price: ${error.message}`);
      throw error;
    }
  }

}