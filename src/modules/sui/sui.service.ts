import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type {
  EventId,
  SuiTransactionBlockResponse,
  SuiTransactionBlockResponseOptions,
  TransactionFilter,
  SuiEvent,
  DryRunTransactionBlockResponse,
} from '@mysten/sui/client';
import type { SuiConfig } from '../../config/sui.config';
import type { IntentSubmittedEvent, SolutionSubmittedEvent, EventCursor } from '../../common/types/sui-events.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';

/**
 * Sui Service - Wrapper around @mysten/sui SDK
 * Handles on-chain event listening for intent and solution submissions
 * Events contain Walrus blob IDs for encrypted data
 */
@Injectable()
export class SuiService implements OnModuleInit {
  private readonly logger = new Logger(SuiService.name);
  private client: SuiClient;
  private config: SuiConfig;
  private isListening = false;
  private eventCursor: EventCursor | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private redisService: RedisService,
  ) {
    this.config = this.configService.get<SuiConfig>('sui')!;
  }

  async onModuleInit() {
    this.client = new SuiClient({
      url: this.config.rpcUrl || getFullnodeUrl(this.config.network),
    });
    
    this.logger.log(`Sui client initialized for ${this.config.network}`);
    
    // Load cursor from Redis to resume from last processed event
    const savedCursor = await this.redisService.getEventCursor();
    if (savedCursor) {
      this.eventCursor = savedCursor;
      this.logger.log(`Restored event cursor from Redis: ${savedCursor.eventSeq}`);
    } else {
      this.logger.log('No saved cursor found, starting from latest events');
    }
    
    // Auto-start event listening if configured
    if (this.config.autoStartEventListener !== false) {
      await this.startEventListener();
    }
  }

  // ===== EVENT LISTENING OPERATIONS =====

  /**
   * Start listening for on-chain events
   * Polls for IntentSubmitted and SolutionSubmitted events
   */
  async startEventListener(): Promise<void> {
    if (this.isListening) {
      this.logger.warn('Event listener already running');
      return;
    }

    this.isListening = true;
    this.logger.log('Starting on-chain event listener...');

    const pollInterval = this.config.eventPollingIntervalMs || 2000;

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollEvents();
      } catch (error: any) {
        this.logger.error(`Error polling events: ${error.message}`, error.stack);
      }
    }, pollInterval);

    this.logger.log(`Event listener started (polling every ${pollInterval}ms)`);
  }

  /**
   * Stop event listener
   */
  stopEventListener(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isListening = false;
    this.logger.log('Event listener stopped');
  }

  /**
   * Poll for new events
   */
  private async pollEvents(): Promise<void> {
    const packageId = this.config.intentPackageId;
    if (!packageId) {
      this.logger.warn('Intent package ID not configured, skipping event polling');
      return;
    }

    const intentEvents = await this.queryEvents(
      {
        MoveEventType: `${packageId}::intents::IntentSubmitted`,
      },
      this.eventCursor ? { eventSeq: this.eventCursor.eventSeq, txDigest: this.eventCursor.txDigest } : undefined,
      50,
      'ascending',
    );

    const solutionEvents = await this.queryEvents(
      {
        MoveEventType: `${packageId}::solutions::SolutionSubmitted`,
      },
      this.eventCursor ? { eventSeq: this.eventCursor.eventSeq, txDigest: this.eventCursor.txDigest } : undefined,
      50,
      'ascending',
    );

    for (const event of intentEvents.data) {
      await this.processIntentEvent(event);
    }

    for (const event of solutionEvents.data) {
      await this.processSolutionEvent(event);
    }

    // Update cursor and persist to Redis
    if (intentEvents.data.length > 0 || solutionEvents.data.length > 0) {
      const allEvents = [...intentEvents.data, ...solutionEvents.data];
      const lastEvent = allEvents[allEvents.length - 1];
      this.eventCursor = {
        eventSeq: lastEvent.id.eventSeq,
        txDigest: lastEvent.id.txDigest,
      };
      
      // Persist cursor to Redis for recovery after restart
      await this.redisService.storeEventCursor(this.eventCursor);
    }
  }

  /**
   * Process IntentSubmitted event
   */
  private async processIntentEvent(event: SuiEvent): Promise<void> {
    try {
      const parsedFields = event.parsedJson as any;
      
      const intentEvent: IntentSubmittedEvent = {
        intentId: parsedFields.intent_id || parsedFields.intentId,
        userAddress: parsedFields.user_address || parsedFields.userAddress,
        walrusBlobId: parsedFields.walrus_blob_id || parsedFields.walrusBlobId,
        createdTs: parsedFields.created_ts || parsedFields.createdTs,
        solverAccessWindow: {
          startMs: parsedFields.solver_access_window?.start_ms || parsedFields.solverAccessWindow?.startMs,
          endMs: parsedFields.solver_access_window?.end_ms || parsedFields.solverAccessWindow?.endMs,
        },
        autoRevokeTime: parsedFields.auto_revoke_time || parsedFields.autoRevokeTime,
      };

      this.logger.log(`Intent submitted: ${intentEvent.intentId} by ${intentEvent.userAddress}`);
      this.eventEmitter.emit('intent.submitted', intentEvent);
    } catch (error: any) {
      this.logger.error(`Error processing intent event: ${error.message}`, error.stack);
    }
  }

  /**
   * Process SolutionSubmitted event
   */
  private async processSolutionEvent(event: SuiEvent): Promise<void> {
    try {
      const parsedFields = event.parsedJson as any;
      
      const solutionEvent: SolutionSubmittedEvent = {
        solutionId: parsedFields.solution_id || parsedFields.solutionId,
        intentId: parsedFields.intent_id || parsedFields.intentId,
        solverAddress: parsedFields.solver_address || parsedFields.solverAddress,
        walrusBlobId: parsedFields.walrus_blob_id || parsedFields.walrusBlobId,
        submittedAt: parsedFields.submitted_at || parsedFields.submittedAt,
      };

      this.logger.log(`Solution submitted: ${solutionEvent.solutionId} for intent ${solutionEvent.intentId}`);
      this.eventEmitter.emit('solution.submitted', solutionEvent);
    } catch (error: any) {
      this.logger.error(`Error processing solution event: ${error.message}`, error.stack);
    }
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
  ): Promise<DryRunTransactionBlockResponse> {
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
