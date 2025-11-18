import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { WalrusService } from './walrus.service';
import { mockSwapIntent } from '../../../test/mocks/intent.mock';
import { mockValidSolution } from '../../../test/mocks/solution.mock';
import { of } from 'rxjs';

describe('WalrusService', () => {
  let service: WalrusService;
  let configService: ConfigService;
  let httpService: HttpService;

  const mockConfig = {
    network: 'testnet',
    aggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
    publisherUrl: 'https://publisher.walrus-testnet.walrus.space',
    suiRpcUrl: 'https://fullnode.testnet.sui.io',
  };

  const mockWalrusClient = {
    fetch: jest.fn(),
    fetchRaw: jest.fn(),
    store: jest.fn(),
    storeRaw: jest.fn(),
    fetchDecrypted: jest.fn(),
    storeEncrypted: jest.fn(),
    exists: jest.fn(),
    batches: {
      storeIntents: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalrusService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'walrus') return mockConfig;
              return null;
            }),
          },
        },
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
            put: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WalrusService>(WalrusService);
    configService = module.get<ConfigService>(ConfigService);
    httpService = module.get<HttpService>(HttpService);

    // Mock the WalrusClient
    (service as any).client = mockWalrusClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetchIntent', () => {
    it('should fetch and return intent from Walrus', async () => {
      const blobId = 'blob-intent-123';
      const buffer = Buffer.from(JSON.stringify(mockSwapIntent));
      mockWalrusClient.fetchRaw.mockResolvedValue(buffer);

      const result = await service.fetchIntent(blobId);

      expect(result).toEqual(mockSwapIntent);
      expect(mockWalrusClient.fetchRaw).toHaveBeenCalledWith(blobId);
    });

    it('should handle fetch errors gracefully', async () => {
      const blobId = 'invalid-blob-id';
      mockWalrusClient.fetchRaw.mockRejectedValue(new Error('Blob not found'));

      await expect(service.fetchIntent(blobId)).rejects.toThrow('Intent not found on Walrus');
    });
  });

  describe('fetchSolution', () => {
    it('should fetch and return solution from Walrus', async () => {
      const blobId = 'blob-solution-456';
      const buffer = Buffer.from(JSON.stringify(mockValidSolution));
      mockWalrusClient.fetchRaw.mockResolvedValue(buffer);

      const result = await service.fetchSolution(blobId);

      expect(result).toEqual(mockValidSolution);
      expect(mockWalrusClient.fetchRaw).toHaveBeenCalledWith(blobId);
    });

    it('should handle missing solution gracefully', async () => {
      const blobId = 'missing-blob';
      mockWalrusClient.fetchRaw.mockRejectedValue(new Error('Not found'));

      await expect(service.fetchSolution(blobId)).rejects.toThrow('Solution not found on Walrus');
    });
  });

  describe('storeIntents', () => {
    it('should store multiple intents to Walrus', async () => {
      const mockBlobId = 'batch-blob-123';
      const batchId = 'batch-1';
      const signer = {} as any;
      mockWalrusClient.batches.storeIntents.mockResolvedValue({ blob_id: mockBlobId });

      const intents = [{ intent_id: 'intent-1', data: mockSwapIntent }];
      const result = await service.storeIntents(intents, batchId, signer, 5);

      expect(result).toBeDefined();
      expect(mockWalrusClient.batches.storeIntents).toHaveBeenCalled();
    });
  });

  describe('storeRaw', () => {
    it('should store raw data to Walrus', async () => {
      const mockBlobId = 'raw-blob-456';
      const signer = {} as any;
      const rawData = Buffer.from('test data');
      const path = '/tmp/test.bin';
      const epochs = 5;
      
      mockWalrusClient.storeRaw.mockResolvedValue({ blob_id: mockBlobId });

      const result = await service.storeRaw(path, rawData, epochs, signer);

      expect(result.blob_id).toBe(mockBlobId);
      expect(mockWalrusClient.storeRaw).toHaveBeenCalledWith(path, rawData, epochs, signer);
    });
  });

  describe('getWalrusClient', () => {
    it('should return underlying Walrus client', () => {
      const client = service.getWalrusClient();
      expect(client).toBe(mockWalrusClient);
    });
  });
});
