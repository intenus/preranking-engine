import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type {
  EventId,
  SuiTransactionBlockResponse,
  SuiTransactionBlockResponseOptions,
  TransactionFilter,
} from '@mysten/sui/client';
import type { SuiConfig } from '../../config/sui.config';

/**
 * Sui Service - Wrapper around @mysten/sui SDK
 * Provides blockchain interaction for submitting PTBs and querying on-chain data
 */
@Injectable()
export class SuiService implements OnModuleInit {
  private client: SuiClient;
  private config: SuiConfig;

  constructor(private configService: ConfigService) {
    this.config = this.configService.get<SuiConfig>('sui')!;
  }

  async onModuleInit() {
    // Initialize Sui client
    this.client = new SuiClient({
      url: this.config.rpcUrl || getFullnodeUrl(this.config.network),
    });
  }

  // ===== TRANSACTION OPERATIONS =====

  /**
   * Execute a transaction block on Sui
   */
  async executeTransactionBlock(
    transactionBlock: string | Uint8Array,
    signature: string | string[],
    options?: SuiTransactionBlockResponseOptions,
  ): Promise<SuiTransactionBlockResponse> {
    return this.client.executeTransactionBlock({
      transactionBlock:
        typeof transactionBlock === 'string'
          ? transactionBlock
          : Buffer.from(transactionBlock).toString('base64'),
      signature: Array.isArray(signature) ? signature : [signature],
      options: options || {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
        showBalanceChanges: true,
      },
    });
  }

  /**
   * Dry run a transaction block (simulate without executing)
   */
  async dryRunTransactionBlock(
    transactionBlock: string | Uint8Array,
  ): Promise<any> {
    return this.client.dryRunTransactionBlock({
      transactionBlock:
        typeof transactionBlock === 'string'
          ? transactionBlock
          : Buffer.from(transactionBlock).toString('base64'),
    });
  }

  /**
   * Get transaction block by digest
   */
  async getTransactionBlock(
    digest: string,
    options?: SuiTransactionBlockResponseOptions,
  ): Promise<SuiTransactionBlockResponse> {
    return this.client.getTransactionBlock({
      digest,
      options: options || {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });
  }

  /**
   * Wait for transaction to be finalized
   */
  async waitForTransaction(
    digest: string,
    options?: { timeout?: number; pollInterval?: number },
  ): Promise<SuiTransactionBlockResponse> {
    return this.client.waitForTransaction({
      digest,
      ...options,
    });
  }

  // ===== OBJECT OPERATIONS =====

  /**
   * Get object by ID
   */
  async getObject(
    objectId: string,
    options?: {
      showType?: boolean;
      showOwner?: boolean;
      showPreviousTransaction?: boolean;
      showDisplay?: boolean;
      showContent?: boolean;
      showBcs?: boolean;
      showStorageRebate?: boolean;
    },
  ) {
    return this.client.getObject({
      id: objectId,
      options,
    });
  }

  /**
   * Get multiple objects by IDs
   */
  async getObjects(objectIds: string[], options?: any) {
    return this.client.multiGetObjects({
      ids: objectIds,
      options,
    });
  }

  /**
   * Get owned objects for an address
   */
  async getOwnedObjects(
    owner: string,
    options?: { filter?: any; options?: any; cursor?: string; limit?: number },
  ) {
    return this.client.getOwnedObjects({
      owner,
      ...options,
    });
  }

  // ===== COIN OPERATIONS =====

  /**
   * Get all coins for an address
   */
  async getCoins(
    owner: string,
    coinType?: string,
    cursor?: string,
    limit?: number,
  ) {
    return this.client.getCoins({
      owner,
      coinType,
      cursor,
      limit,
    });
  }

  /**
   * Get coin balance for an address
   */
  async getBalance(owner: string, coinType?: string) {
    return this.client.getBalance({
      owner,
      coinType,
    });
  }

  /**
   * Get all coin balances for an address
   */
  async getAllBalances(owner: string) {
    return this.client.getAllBalances({
      owner,
    });
  }

  // ===== QUERY OPERATIONS =====

  /**
   * Query events
   */
  async queryEvents(
    query: any,
    cursor?: EventId,
    limit?: number,
    order?: 'ascending' | 'descending',
  ) {
    return this.client.queryEvents({
      query,
      cursor,
      limit,
      order,
    });
  }

  /**
   * Query transaction blocks
   */
  async queryTransactionBlocks(
    filter: TransactionFilter,
    options: SuiTransactionBlockResponseOptions,
    cursor?: string,
    limit?: number,
    order?: 'ascending' | 'descending',
  ) {
    return this.client.queryTransactionBlocks({
      filter,
      options,
      cursor,
      limit,
      order,
    });
  }

  // ===== SOLVER REGISTRY OPERATIONS =====

  /**
   * Query solver registry (custom method - requires contract integration)
   */
  async querySolverRegistry(solverAddress: string): Promise<any> {
    // This would query the on-chain solver registry contract
    // Implementation depends on the contract structure
    // For now, return a placeholder
    try {
      // Example: Query a shared object or table
      const objectId = process.env.SOLVER_REGISTRY_OBJECT_ID;
      if (!objectId) {
        throw new Error('SOLVER_REGISTRY_OBJECT_ID not configured');
      }

      const object = await this.getObject(objectId, {
        showContent: true,
        showType: true,
      });

      return object.data;
    } catch (error: any) {
      throw new Error(`Failed to query solver registry: ${error.message}`);
    }
  }

  /**
   * Check if solver is registered
   */
  async isSolverRegistered(solverAddress: string): Promise<boolean> {
    try {
      const solverInfo = await this.querySolverRegistry(solverAddress);
      return solverInfo !== null;
    } catch {
      return false;
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Get current epoch
   */
  async getLatestEpoch(): Promise<string> {
    const checkpoint = await this.client.getLatestCheckpointSequenceNumber();
    // Note: This is a simplified version. Actual epoch calculation may differ
    return checkpoint;
  }

  /**
   * Get network info
   */
  async getNetworkInfo() {
    return {
      network: this.config.network,
      rpcUrl: this.config.rpcUrl,
      chainId: await this.client.getChainIdentifier(),
    };
  }

  /**
   * Get reference gas price
   */
  async getReferenceGasPrice(): Promise<bigint> {
    return this.client.getReferenceGasPrice();
  }

  /**
   * Get underlying Sui client for advanced operations
   */
  getSuiClient(): SuiClient {
    return this.client;
  }
}
