import { Test, TestingModule } from '@nestjs/testing';
import { CetusProvider } from './cetus.provider';
import { SuiService } from '../../sui/sui.service';
import type { CetusConfig } from '../../../common/types/source-map.types';

describe('CetusProvider', () => {
  let provider: CetusProvider;
  let suiService: SuiService;

  const mockSuiClient = {
    getObject: jest.fn(),
  };

  const mockPoolObject = {
    data: {
      content: {
        dataType: 'moveObject',
        fields: {
          current_sqrt_price: '18446744073709551616', // sqrt(1) in Q64.64 = price of 1.0
          current_tick_index: 0,
          fee_growth_global_a: '100000',
          fee_growth_global_b: '200000',
          liquidity: '1000000000000',
        },
      },
      digest: '0xdigest123',
    },
  };

  const mockPoolObject4x = {
    data: {
      content: {
        dataType: 'moveObject',
        fields: {
          current_sqrt_price: '36893488147419103232', // sqrt(4) in Q64.64 = price of 4.0
          current_tick_index: 0,
          liquidity: '1000000000000',
        },
      },
      digest: '0xdigest456',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CetusProvider,
        {
          provide: SuiService,
          useValue: {
            getSuiClient: jest.fn(() => mockSuiClient),
          },
        },
      ],
    }).compile();

    provider = module.get<CetusProvider>(CetusProvider);
    suiService = module.get<SuiService>(SuiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('fetchSwapQuote', () => {
    it('should fetch swap quote from Cetus pool', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject);

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      const result = await provider.fetchSwapQuote(
        config,
        '0xpool123',
        '1000000000',
        true,
        'testSource',
      );

      expect(suiService.getSuiClient).toHaveBeenCalled();
      expect(mockSuiClient.getObject).toHaveBeenCalled();
      expect(result.source).toBe('testSource');
      expect(result.metadata?.provider).toBe('cetus');
      expect(result.metadata?.poolAddress).toBe('0xpool123');
      expect(result.metadata?.spotPrice).toBeDefined();
    });

    it('should calculate output for aToB swap with 1:1 price', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject);

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      const result = await provider.fetchSwapQuote(
        config,
        '0xpool123',
        '1000000000',
        true, // aToB
        'testSource',
      );

      // With price = 1.0 and amount = 1000000000
      // Output should be ~1000000000 (1:1)
      expect(parseInt(result.value)).toBeCloseTo(1000000000, -6);
    });

    it('should calculate output for aToB swap with 4:1 price', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject4x);

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      const result = await provider.fetchSwapQuote(
        config,
        '0xpool123',
        '1000000000',
        true, // aToB
        'testSource',
      );

      // With price = 4.0 and amount = 1000000000
      // Output should be ~4000000000 (4:1)
      expect(parseInt(result.value)).toBeCloseTo(4000000000, -6);
    });

    it('should calculate output for bToA swap with 1:1 price', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject);

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      const result = await provider.fetchSwapQuote(
        config,
        '0xpool123',
        '1000000000',
        false, // bToA
        'testSource',
      );

      // With price = 1.0 and amount = 1000000000
      // Output should be ~1000000000 (1:1)
      expect(parseInt(result.value)).toBeCloseTo(1000000000, -6);
    });

    it('should calculate output for bToA swap with 4:1 price', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject4x);

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      const result = await provider.fetchSwapQuote(
        config,
        '0xpool123',
        '1000000000',
        false, // bToA
        'testSource',
      );

      // With price = 4.0 and amount = 1000000000
      // Output should be ~250000000 (1:4)
      expect(parseInt(result.value)).toBeCloseTo(250000000, -6);
    });

    it('should handle pool fetch errors', async () => {
      mockSuiClient.getObject.mockRejectedValue(new Error('Pool not found'));

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      await expect(
        provider.fetchSwapQuote(config, '0xpool123', '1000000000', true, 'testSource'),
      ).rejects.toThrow();
    });
  });

  describe('fetchPoolState', () => {
    it('should fetch current pool state', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject);

      const result = await provider.fetchPoolState('0xpool123', 'testSource');

      expect(mockSuiClient.getObject).toHaveBeenCalledWith({
        id: '0xpool123',
        options: {
          showContent: true,
          showType: true,
        },
      });
      expect(result.value.sqrtPrice).toBe('18446744073709551616');
      expect(result.value.tickCurrent).toBe(0);
      expect(result.value.liquidity).toBe('1000000000000');
      expect(result.metadata?.poolAddress).toBe('0xpool123');
    });

    it('should handle alternative field names', async () => {
      const altPoolObject = {
        data: {
          content: {
            dataType: 'moveObject',
            fields: {
              sqrt_price: '18446744073709551616',
              liquidity: '1000000000000',
            },
          },
          digest: '0xdigest123',
        },
      };

      mockSuiClient.getObject.mockResolvedValue(altPoolObject);

      const result = await provider.fetchPoolState('0xpool123', 'testSource');

      expect(result.value.sqrtPrice).toBe('18446744073709551616');
    });

    it('should throw error for invalid pool object', async () => {
      mockSuiClient.getObject.mockResolvedValue({
        data: {
          content: {
            dataType: 'package',
          },
        },
      });

      await expect(provider.fetchPoolState('0xpool123', 'testSource')).rejects.toThrow(
        'Invalid pool object: 0xpool123',
      );
    });

    it('should handle getObject errors', async () => {
      mockSuiClient.getObject.mockRejectedValue(new Error('Object not found'));

      await expect(provider.fetchPoolState('0xpool123', 'testSource')).rejects.toThrow(
        'Object not found',
      );
    });
  });

  describe('fetchSpotPrice', () => {
    it('should calculate spot price from pool state', async () => {
      mockSuiClient.getObject.mockResolvedValue(mockPoolObject);

      const result = await provider.fetchSpotPrice('0xpool123', 'testSource');

      expect(result.value).toBeCloseTo(1.0, 2);
      expect(result.metadata?.sqrtPrice).toBe('18446744073709551616');
      expect(result.metadata?.poolAddress).toBe('0xpool123');
    });

    it('should handle pool state fetch errors', async () => {
      mockSuiClient.getObject.mockRejectedValue(new Error('Failed to fetch pool'));

      await expect(provider.fetchSpotPrice('0xpool123', 'testSource')).rejects.toThrow(
        'Failed to fetch pool',
      );
    });
  });

  describe('calculatePriceFromSqrt', () => {
    it('should calculate price from sqrt price correctly', () => {
      // Q64.64 format: sqrt_price * 2^64 = actual_sqrt_price
      // For price = 1.0, sqrt(1.0) = 1.0
      // So sqrtPrice in Q64.64 = 1.0 * 2^64 = 18446744073709551616
      const sqrtPrice = '18446744073709551616';
      const price = provider.calculatePriceFromSqrt(sqrtPrice);

      expect(price).toBeCloseTo(1.0, 2);
    });

    it('should handle different sqrt prices', () => {
      // For price = 4.0, sqrt(4.0) = 2.0
      // So sqrtPrice in Q64.64 = 2.0 * 2^64 = 36893488147419103232
      const sqrtPrice = '36893488147419103232';
      const price = provider.calculatePriceFromSqrt(sqrtPrice);

      expect(price).toBeCloseTo(4.0, 2);
    });

    it('should handle zero sqrt price', () => {
      const price = provider.calculatePriceFromSqrt('0');
      expect(price).toBe(0);
    });
  });

  describe('error logging', () => {
    it('should log errors when fetching swap quote fails', async () => {
      const loggerSpy = jest.spyOn(provider['logger'], 'error');
      mockSuiClient.getObject.mockRejectedValue(new Error('Pool fetch failed'));

      const config: CetusConfig = {
        method: 'moveCall',
        typeArguments: ['0x2::sui::SUI', '0xusdc'],
      };

      await expect(
        provider.fetchSwapQuote(config, '0xpool123', '1000000000', true, 'testSource'),
      ).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('should log errors when fetching pool state fails', async () => {
      const loggerSpy = jest.spyOn(provider['logger'], 'error');
      mockSuiClient.getObject.mockRejectedValue(new Error('Object fetch failed'));

      await expect(provider.fetchPoolState('0xpool123', 'testSource')).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalled();
    });
  });
});
