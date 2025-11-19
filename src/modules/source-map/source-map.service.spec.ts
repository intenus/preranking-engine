import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SourceMapService } from './source-map.service';
import { DefiLlamaProvider } from './providers/defillama.provider';
import { CetusProvider } from './providers/cetus.provider';
import { RedisService } from '../redis/redis.service';
import type { SourceFetchResult, SourceMap } from '../../common/types/source-map.types';

describe('SourceMapService', () => {
  let service: SourceMapService;
  let defiLlamaProvider: DefiLlamaProvider;
  let cetusProvider: CetusProvider;
  let redisService: RedisService;
  let configService: ConfigService;

  const mockSourceMap: SourceMap = {
    version: '1.0.0',
    sources: {
      suiPriceDefiLlama: {
        type: 'oracle',
        description: 'SUI/USD price from DefiLlama',
        config: {
          provider: 'defillama',
          config: {
            provider: 'defillama',
            endpoint: 'prices',
            coins: ['sui:0x2::sui::SUI'],
          },
        },
        cache: {
          enabled: true,
          ttlMs: 30000,
          strategy: 'ttl',
        },
      },
      cetusPoolPrice: {
        type: 'onchain',
        description: 'Get spot price from Cetus pool',
        config: {
          method: 'moveCall',
          packageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
          moduleName: 'pool',
          functionName: 'calculate_swap_result',
          typeArguments: ['{{intent.operation.inputs[0].assetId}}', '{{intent.operation.outputs[0].assetId}}'],
          arguments: ['{{cetusPoolAddress}}', 'true', 'true', '{{intent.operation.inputs[0].amount.value}}'],
          parseStrategy: 'json',
        },
        cache: {
          enabled: true,
          ttlMs: 10000,
          strategy: 'ttl',
        },
      },
      aggregatedSuiPrice: {
        type: 'aggregator',
        description: 'Aggregate SUI price from multiple sources',
        config: {
          sources: ['suiPriceDefiLlama', 'cetusPoolPrice'],
          strategy: 'median',
          minimumSources: 1,
          maxDeviation: 5,
        },
      },
    },
  };

  const mockDefiLlamaResult: SourceFetchResult<number> = {
    value: 1.5,
    timestamp: Date.now(),
    source: 'suiPriceDefiLlama',
    confidence: 0.99,
    metadata: {
      symbol: 'SUI',
      decimals: 9,
      provider: 'defillama',
    },
  };

  const mockCetusResult: SourceFetchResult<string> = {
    value: '1500000',
    timestamp: Date.now(),
    source: 'cetusPoolPrice',
    metadata: {
      provider: 'cetus',
      poolAddress: '0xpool123',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceMapService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SOURCE_MAP_PATH') return './source-map.json';
              return null;
            }),
          },
        },
        {
          provide: DefiLlamaProvider,
          useValue: {
            fetchPrice: jest.fn(),
            fetchHistorical: jest.fn(),
            fetchPercentageChange: jest.fn(),
          },
        },
        {
          provide: CetusProvider,
          useValue: {
            fetchSwapQuote: jest.fn(),
            fetchPoolState: jest.fn(),
            fetchSpotPrice: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            setWithExpiry: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SourceMapService>(SourceMapService);
    defiLlamaProvider = module.get<DefiLlamaProvider>(DefiLlamaProvider);
    cetusProvider = module.get<CetusProvider>(CetusProvider);
    redisService = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);

    // Mock source map loading
    (service as any).sourceMap = mockSourceMap;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetch', () => {
    it('should fetch from oracle source (DefiLlama)', async () => {
      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue(mockDefiLlamaResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('suiPriceDefiLlama');

      expect(defiLlamaProvider.fetchPrice).toHaveBeenCalled();
      expect(result.value).toBe(1.5);
      expect(result.confidence).toBe(0.99);
    });

    it('should fetch from on-chain source (Cetus)', async () => {
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue(mockCetusResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const intent = {
        operation: {
          inputs: [{ assetId: '0x2::sui::SUI', amount: { value: '1000000000' } }],
          outputs: [{ assetId: '0xusdc', amount: { min: '1400000' } }],
        },
      } as any;

      const context = { poolAddress: '0xpool123' };

      const result = await service.fetch('cetusPoolPrice', intent, context);

      expect(cetusProvider.fetchSwapQuote).toHaveBeenCalled();
      expect(result.value).toBe('1500000');
    });

    it('should return cached result if available', async () => {
      const cachedResult = JSON.stringify(mockDefiLlamaResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(cachedResult);

      const result = await service.fetch('suiPriceDefiLlama');

      expect(redisService.get).toHaveBeenCalledWith('source:suiPriceDefiLlama');
      expect(defiLlamaProvider.fetchPrice).not.toHaveBeenCalled();
      expect(result.value).toBe(1.5);
    });

    it('should cache result after fetching', async () => {
      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue(mockDefiLlamaResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(redisService, 'setWithExpiry').mockResolvedValue(undefined);

      await service.fetch('suiPriceDefiLlama');

      expect(redisService.setWithExpiry).toHaveBeenCalledWith(
        'source:suiPriceDefiLlama',
        JSON.stringify(mockDefiLlamaResult),
        30, // 30000ms / 1000
      );
    });

    it('should throw error if source not found', async () => {
      await expect(service.fetch('nonExistentSource')).rejects.toThrow('Source not found: nonExistentSource');
    });

    it('should throw error if source map not loaded', async () => {
      (service as any).sourceMap = null;

      await expect(service.fetch('suiPriceDefiLlama')).rejects.toThrow('Source map not loaded');
    });
  });

  describe('fetchFromAggregator', () => {
    it('should aggregate multiple sources using median strategy', async () => {
      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue({
        ...mockDefiLlamaResult,
        value: 1.5,
      });
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue({
        ...mockCetusResult,
        value: '1.6',
      });
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('aggregatedSuiPrice');

      // Median of [1.5, 1.6] = 1.55
      expect(result.value).toBe(1.55);
      expect(result.metadata?.strategy).toBe('median');
      expect(result.metadata?.sources).toHaveLength(2);
    });

    it('should handle single source success when minimumSources is 1', async () => {
      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue(mockDefiLlamaResult);
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockRejectedValue(new Error('Cetus failed'));
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('aggregatedSuiPrice');

      // Only DefiLlama succeeded
      expect(result.value).toBe(1.5);
      expect(result.metadata?.sources).toHaveLength(1);
    });

    it('should throw error if insufficient sources', async () => {
      // Create aggregator requiring 2 sources
      (service as any).sourceMap.sources.strictAggregator = {
        type: 'aggregator',
        config: {
          sources: ['suiPriceDefiLlama', 'cetusPoolPrice'],
          strategy: 'median',
          minimumSources: 2,
        },
      };

      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockRejectedValue(new Error('DefiLlama failed'));
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue(mockCetusResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      await expect(service.fetch('strictAggregator')).rejects.toThrow('Insufficient sources');
    });

    it('should calculate average with weights', async () => {
      // Create weighted aggregator
      (service as any).sourceMap.sources.weightedAvg = {
        type: 'aggregator',
        config: {
          sources: ['suiPriceDefiLlama', 'cetusPoolPrice'],
          strategy: 'average',
          weights: { suiPriceDefiLlama: 0.7, cetusPoolPrice: 0.3 },
        },
      };

      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue({
        ...mockDefiLlamaResult,
        value: 1.5,
      });
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue({
        ...mockCetusResult,
        value: '1.6',
      });
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('weightedAvg');

      // Weighted average: (1.5 * 0.7 + 1.6 * 0.3) = 1.53
      expect(result.value).toBeCloseTo(1.53, 2);
    });
  });

  describe('interpolation', () => {
    it('should interpolate intent fields in template strings', async () => {
      const intent = {
        operation: {
          inputs: [{ assetId: '0x2::sui::SUI', amount: { value: '1000000000' } }],
          outputs: [{ assetId: '0xusdc' }],
        },
      } as any;

      const context = { poolAddress: '0xpool123' };

      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue(mockCetusResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      await service.fetch('cetusPoolPrice', intent, context);

      expect(cetusProvider.fetchSwapQuote).toHaveBeenCalledWith(
        expect.any(Object),
        '0xpool123',
        '1000000000',
        expect.any(Boolean),
        'cetusPoolPrice',
      );
    });

    it('should handle array interpolation', async () => {
      const intent = {
        operation: {
          inputs: [{ assetId: '0x2::sui::SUI' }],
        },
      } as any;

      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue(mockDefiLlamaResult);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      // Modify config to use template
      (service as any).sourceMap.sources.suiPriceDefiLlama.config.config.coins = [
        'sui:{{intent.operation.inputs[0].assetId}}',
      ];

      await service.fetch('suiPriceDefiLlama', intent);

      expect(defiLlamaProvider.fetchPrice).toHaveBeenCalledWith(
        expect.objectContaining({
          coins: ['sui:0x2::sui::SUI'],
        }),
        'suiPriceDefiLlama',
      );
    });
  });

  describe('aggregation strategies', () => {
    const values = [1.0, 2.0, 3.0, 4.0, 5.0];

    it('should calculate median correctly for odd array', () => {
      const median = (service as any).median(values);
      expect(median).toBe(3.0);
    });

    it('should calculate median correctly for even array', () => {
      const median = (service as any).median([1.0, 2.0, 4.0, 5.0]);
      expect(median).toBe(3.0); // (2.0 + 4.0) / 2
    });

    it('should calculate average correctly', () => {
      const avg = (service as any).average(values);
      expect(avg).toBe(3.0);
    });

    it('should handle min strategy', async () => {
      (service as any).sourceMap.sources.minPrice = {
        type: 'aggregator',
        config: {
          sources: ['suiPriceDefiLlama', 'cetusPoolPrice'],
          strategy: 'min',
        },
      };

      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue({
        ...mockDefiLlamaResult,
        value: 1.5,
      });
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue({
        ...mockCetusResult,
        value: '1.3',
      });
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('minPrice');
      expect(result.value).toBe(1.3);
    });

    it('should handle max strategy', async () => {
      (service as any).sourceMap.sources.maxPrice = {
        type: 'aggregator',
        config: {
          sources: ['suiPriceDefiLlama', 'cetusPoolPrice'],
          strategy: 'max',
        },
      };

      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockResolvedValue({
        ...mockDefiLlamaResult,
        value: 1.5,
      });
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockResolvedValue({
        ...mockCetusResult,
        value: '1.7',
      });
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const result = await service.fetch('maxPrice');
      expect(result.value).toBe(1.7);
    });
  });

  describe('error handling', () => {
    it('should handle DefiLlama provider errors', async () => {
      jest.spyOn(defiLlamaProvider, 'fetchPrice').mockRejectedValue(new Error('API error'));
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      await expect(service.fetch('suiPriceDefiLlama')).rejects.toThrow('API error');
    });

    it('should handle Cetus provider errors', async () => {
      jest.spyOn(cetusProvider, 'fetchSwapQuote').mockRejectedValue(new Error('RPC error'));
      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      const intent = {
        operation: {
          inputs: [{ assetId: '0x2::sui::SUI', amount: { value: '1000000000' } }],
        },
      } as any;

      await expect(service.fetch('cetusPoolPrice', intent, { poolAddress: '0xpool123' })).rejects.toThrow(
        'RPC error',
      );
    });

    it('should handle unknown source type', async () => {
      (service as any).sourceMap.sources.unknownType = {
        type: 'unknown',
        config: {},
      };

      jest.spyOn(redisService, 'get').mockResolvedValue(null);

      await expect(service.fetch('unknownType')).rejects.toThrow('Unknown source type: unknown');
    });
  });
});
