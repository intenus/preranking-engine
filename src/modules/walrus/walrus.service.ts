import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IntenusWalrusClient,
  StorageResult,
  QuiltResult,
  QuiltBlob,
  BatchManifest,
  BatchIntent,
  UserHistoryAggregated,
  ModelMetadata,
} from '@intenus/walrus';
import type { Signer } from '@mysten/sui/cryptography';
import { IntenusWalrusClient as WalrusClient } from '@intenus/walrus';
import type { WalrusConfig } from '../../config/walrus.config';

/**
 * Walrus Service - Thin wrapper around @intenus/walrus SDK
 * Provides storage operations for intents, batches, solutions, and archives
 */
@Injectable()
export class WalrusService implements OnModuleInit {
  private client: IntenusWalrusClient;
  private config: WalrusConfig;

  constructor(private configService: ConfigService) {
    this.config = this.configService.get<WalrusConfig>('walrus')!;
  }

  async onModuleInit() {
    // Initialize Walrus client
    this.client = new WalrusClient({
      network: this.config.network,
      publisherUrl: this.config.publisherUrl,
      aggregatorUrl: this.config.aggregatorUrl,
      defaultEpochs: this.config.defaultEpochs,
    });
  }

  // ===== BATCH OPERATIONS =====

  /**
   * Store batch manifest to Walrus
   */
  async storeBatchManifest(
    manifest: BatchManifest,
    signer: Signer,
  ): Promise<StorageResult> {
    return this.client.batches.storeManifest(manifest, signer);
  }

  /**
   * Fetch batch manifest by epoch
   */
  async fetchBatchManifest(epoch: number): Promise<BatchManifest> {
    return this.client.batches.fetchManifest(epoch);
  }

  /**
   * Check if batch manifest exists
   */
  async batchManifestExists(epoch: number): Promise<boolean> {
    return this.client.batches.manifestExists(epoch);
  }

  /**
   * Store intents as Quilt (batch optimization)
   */
  async storeIntentsQuilt(
    intents: Array<{ intent_id: string; data: BatchIntent; category?: string }>,
    batchId: string,
    signer: Signer,
    epochs?: number,
  ): Promise<QuiltResult> {
    return this.client.batches.storeIntentsQuilt(
      intents,
      batchId,
      signer,
      epochs,
    );
  }

  /**
   * Fetch intent from Quilt by patch ID
   */
  async fetchIntentFromQuilt(
    quiltBlobId: string,
    intentIdentifier: string,
  ): Promise<BatchIntent> {
    const buffer = await this.client.batches.fetchIntentFromQuilt(
      quiltBlobId,
      intentIdentifier,
    );
    return JSON.parse(buffer.toString());
  }

  // ===== ARCHIVE OPERATIONS =====

  /**
   * Store execution archive
   */
  async storeArchive(archive: any, signer: Signer): Promise<StorageResult> {
    return this.client.archives.storeArchive(archive, signer);
  }

  /**
   * Fetch archive by batch ID
   */
  async fetchArchive(epoch: number, batchId: string): Promise<any> {
    return this.client.archives.fetchArchive(epoch, batchId);
  }

  /**
   * Check if archive exists
   */
  async archiveExists(epoch: number, batchId: string): Promise<boolean> {
    return this.client.archives.archiveExists(epoch, batchId);
  }

  // ===== USER OPERATIONS =====

  /**
   * Store user history
   */
  async storeUserHistory(
    history: UserHistoryAggregated,
    signer: Signer,
  ): Promise<StorageResult> {
    return this.client.users.storeHistory(history, signer);
  }

  /**
   * Fetch user history
   */
  async fetchUserHistory(userAddress: string): Promise<any> {
    return this.client.users.fetchHistory(userAddress);
  }

  /**
   * Check if user history exists
   */
  async userHistoryExists(userAddress: string): Promise<boolean> {
    return this.client.users.historyExists(userAddress);
  }

  // ===== TRAINING OPERATIONS =====

  /**
   * Store training dataset
   */
  async storeTrainingDataset(
    version: string,
    features: Buffer,
    labels: Buffer,
    metadata: any,
    signer: Signer,
  ): Promise<StorageResult> {
    return this.client.training.storeDataset(
      version,
      features,
      labels,
      metadata,
      signer,
    );
  }

  /**
   * Store trained model
   */
  async storeModel(
    modelName: string,
    version: string,
    modelBuffer: Buffer,
    metadata: any,
    signer: Signer,
  ): Promise<StorageResult> {
    return this.client.training.storeModel(
      modelName,
      version,
      modelBuffer,
      metadata,
      signer,
    );
  }

  /**
   * Fetch training dataset
   */
  async fetchTrainingDataset(
    version: string,
  ): Promise<{ features: Buffer; labels: Buffer }> {
    return this.client.training.fetchDataset(version);
  }

  /**
   * Fetch trained model
   */
  async fetchModel(
    modelName: string,
    version: string,
  ): Promise<{
    metadata: ModelMetadata;
    model: Buffer;
  }> {
    return this.client.training.fetchModel(modelName, version);
  }

  // ===== LOW-LEVEL OPERATIONS =====

  /**
   * Store raw data to Walrus
   */
  async storeRaw(
    path: string,
    data: Buffer,
    epochs: number,
    signer: Signer,
  ): Promise<StorageResult> {
    return this.client.storeRaw(path, data, epochs, signer);
  }

  /**
   * Fetch raw data from Walrus
   */
  async fetchRaw(path: string): Promise<Buffer> {
    return this.client.fetchRaw(path);
  }

  /**
   * Check if path exists
   */
  async exists(path: string): Promise<boolean> {
    return this.client.exists(path);
  }

  /**
   * Store Quilt (batch of blobs)
   */
  async storeQuilt(
    blobs: QuiltBlob[],
    epochs: number,
    signer: Signer,
    deletable: boolean = false,
  ): Promise<QuiltResult> {
    return this.client.storeQuilt(blobs, epochs, signer, deletable);
  }

  /**
   * Fetch from Quilt by patch ID
   */
  async fetchFromQuilt(
    quiltBlobId: string,
    patchIdentifier: string,
  ): Promise<Buffer> {
    return this.client.fetchFromQuilt(quiltBlobId, patchIdentifier);
  }

  /**
   * Get underlying Walrus client for advanced operations
   */
  getWalrusClient(): IntenusWalrusClient {
    return this.client;
  }
}
