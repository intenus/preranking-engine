import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
import { mockSwapIntent } from '../../../test/mocks/intent.mock';
import { mockValidSolution } from '../../../test/mocks/solution.mock';

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: any;

  const mockConfig = {
    host: 'localhost',
    port: 6379,
    password: undefined,
    db: 0,
  };

  beforeEach(async () => {
    mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
      lpush: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      duplicate: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: 'CONFIGURATION(redis)',
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    (service as any).client = mockRedisClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Intent Storage', () => {
    it('should store intent in Redis', async () => {
      const intentId = 'intent-123';
      const intentWithIGS = {
        intent: {
          intent_id: intentId,
          creator: '0xabc',
          blobId: 'blob-123',
        } as any,
        IGSIntent: mockSwapIntent,
      };
      
      await service.storeIntent(intentId, intentWithIGS);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `intent:${intentId}`,
        JSON.stringify(intentWithIGS),
        'EX',
        3600,
      );
    });

    it('should get intent from Redis', async () => {
      const intentId = 'intent-123';
      mockRedisClient.get.mockResolvedValue(JSON.stringify(mockSwapIntent));

      const result = await service.getIntent(intentId);

      expect(result).toEqual(mockSwapIntent);
      expect(mockRedisClient.get).toHaveBeenCalledWith(`intent:${intentId}`);
    });

    it('should return null for non-existent intent', async () => {
      const intentId = 'non-existent';
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.getIntent(intentId);

      expect(result).toBeNull();
    });
  });

  describe('Solution Storage', () => {
    it('should store passed solution result', async () => {
      const intentId = 'intent-123';
      const solutionId = 'solution-456';
      const data = {
        solution: mockValidSolution,
        solutionId,
        features: { score: 0.95 },
        dryRunResult: { status: 'success' },
      };

      await service.storeSolutionResult(intentId, solutionId, data);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `solution:${intentId}:${solutionId}`,
        JSON.stringify(data),
        'EX',
        3600,
      );
      expect(mockRedisClient.sadd).toHaveBeenCalledWith(
        `solution:${intentId}:passed`,
        solutionId,
      );
    });

    it('should store failed solution', async () => {
      const intentId = 'intent-123';
      const solutionId = 'solution-789';
      const data = {
        solutionId,
        failureReason: 'Constraint validation failed',
        errors: [{ message: 'Invalid slippage' }],
      };

      await service.storeFailedSolution(intentId, solutionId, data);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `failed:${intentId}:${solutionId}`,
        JSON.stringify(data),
        'EX',
        3600,
      );
      expect(mockRedisClient.sadd).toHaveBeenCalledWith(
        `failed:${intentId}:set`,
        solutionId,
      );
    });

    it('should get all passed solutions for intent', async () => {
      const intentId = 'intent-123';
      const solutionIds = ['sol-1', 'sol-2'];
      const solutions = [
        { solutionId: 'sol-1', features: {} },
        { solutionId: 'sol-2', features: {} },
      ];

      mockRedisClient.smembers.mockResolvedValue(solutionIds);
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(solutions[0]))
        .mockResolvedValueOnce(JSON.stringify(solutions[1]));

      const result = await service.getPassedSolutions(intentId);

      expect(result).toHaveLength(2);
      expect(mockRedisClient.smembers).toHaveBeenCalledWith(`solution:${intentId}:passed`);
    });

    it('should get failed solution count', async () => {
      const intentId = 'intent-123';
      mockRedisClient.scard.mockResolvedValue(3);

      const count = await service.getFailedSolutionCount(intentId);

      expect(count).toBe(3);
      expect(mockRedisClient.scard).toHaveBeenCalledWith(`failed:${intentId}:set`);
    });
  });

  describe('Event Cursor Storage', () => {
    it('should store event cursor', async () => {
      const cursor = { eventSeq: '1000', txDigest: 'tx-123' };

      await service.storeEventCursor(cursor);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'sui:event:cursor',
        JSON.stringify(cursor),
      );
    });

    it('should get event cursor', async () => {
      const cursor = { eventSeq: '1000', txDigest: 'tx-123' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cursor));

      const result = await service.getEventCursor();

      expect(result).toEqual(cursor);
      expect(mockRedisClient.get).toHaveBeenCalledWith('sui:event:cursor');
    });

    it('should return null if no cursor exists', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.getEventCursor();

      expect(result).toBeNull();
    });
  });

  describe('Ranking Service Integration', () => {
    it('should send data to ranking service queue', async () => {
      const intentId = 'intent-123';
      const data = { intentId, solutions: [] };

      await service.sendToRankingService(intentId, data);

      expect(mockRedisClient.lpush).toHaveBeenCalledWith(
        'ranking:queue',
        JSON.stringify(data),
      );
    });
  });

  describe('Cleanup', () => {
    it('should delete all intent data', async () => {
      const intentId = 'intent-123';
      const passedIds = ['sol-1', 'sol-2'];
      const failedIds = ['sol-3'];

      mockRedisClient.smembers
        .mockResolvedValueOnce(passedIds)
        .mockResolvedValueOnce(failedIds);

      await service.deleteIntentData(intentId);

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        `intent:${intentId}`,
        `solution:${intentId}:passed`,
        `failed:${intentId}:set`,
        `solution:${intentId}:sol-1`,
        `solution:${intentId}:sol-2`,
        `failed:${intentId}:sol-3`,
      );
    });
  });

  describe('getClient', () => {
    it('should return Redis client', () => {
      const client = service.getClient();
      expect(client).toBe(mockRedisClient);
    });
  });
});
