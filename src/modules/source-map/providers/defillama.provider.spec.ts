import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { DefiLlamaProvider } from './defillama.provider';
import { of, throwError } from 'rxjs';
type AxiosResponse<T = any> = {
  data: T;
  status: number;
  statusText: string;
  headers: any;
  config: any;
};

describe('DefiLlamaProvider', () => {
  let provider: DefiLlamaProvider;
  let httpService: HttpService;

  const mockPriceResponse: AxiosResponse = {
    data: {
      coins: {
        'sui:0x2::sui::SUI': {
          decimals: 9,
          price: 1.5,
          symbol: 'SUI',
          timestamp: 1700000000,
          confidence: 0.99,
        },
      },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  const mockChartResponse: AxiosResponse = {
    data: {
      coins: {
        'sui:0x2::sui::SUI': {
          prices: [
            { timestamp: 1700000000, price: 1.4 },
            { timestamp: 1700001000, price: 1.5 },
            { timestamp: 1700002000, price: 1.6 },
          ],
          symbol: 'SUI',
          confidence: 0.98,
        },
      },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefiLlamaProvider,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    provider = module.get<DefiLlamaProvider>(DefiLlamaProvider);
    httpService = module.get<HttpService>(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('fetchPrice', () => {
    it('should fetch current price from DefiLlama', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockPriceResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      const result = await provider.fetchPrice(config, 'testSource');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://coins.llama.fi/prices/current/sui:0x2::sui::SUI',
      );
      expect(result.value).toBe(1.5);
      expect(result.source).toBe('testSource');
      expect(result.confidence).toBe(0.99);
      expect(result.metadata?.symbol).toBe('SUI');
      expect(result.metadata?.decimals).toBe(9);
    });

    it('should use custom base URL if provided', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockPriceResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI'],
        baseUrl: 'https://custom.defillama.com',
      };

      await provider.fetchPrice(config, 'testSource');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://custom.defillama.com/prices/current/sui:0x2::sui::SUI',
      );
    });

    it('should handle multiple coins', async () => {
      const multiCoinResponse: AxiosResponse = {
        ...mockPriceResponse,
        data: {
          coins: {
            'sui:0x2::sui::SUI': {
              decimals: 9,
              price: 1.5,
              symbol: 'SUI',
              timestamp: 1700000000,
              confidence: 0.99,
            },
            'coingecko:usd-coin': {
              decimals: 6,
              price: 1.0,
              symbol: 'USDC',
              timestamp: 1700000000,
              confidence: 0.99,
            },
          },
        },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(multiCoinResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI', 'coingecko:usd-coin'],
      };

      const result = await provider.fetchPrice(config, 'testSource');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://coins.llama.fi/prices/current/sui:0x2::sui::SUI,coingecko:usd-coin',
      );
      expect(result.value).toBe(1.5); // First coin price
    });

    it('should throw error if no price data found', async () => {
      const emptyResponse: AxiosResponse = {
        ...mockPriceResponse,
        data: { coins: {} },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(emptyResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await expect(provider.fetchPrice(config, 'testSource')).rejects.toThrow(
        'No price data found for: sui:0x2::sui::SUI',
      );
    });

    it('should handle HTTP errors', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('Network error')));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await expect(provider.fetchPrice(config, 'testSource')).rejects.toThrow('Network error');
    });
  });

  describe('fetchHistorical', () => {
    it('should fetch historical prices from DefiLlama', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockChartResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
        searchWidth: '4h',
      };

      const result = await provider.fetchHistorical(config, 'testSource');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://coins.llama.fi/chart/sui:0x2::sui::SUI?searchWidth=4h',
      );
      expect(result.value).toEqual([1.4, 1.5, 1.6]);
      expect(result.metadata?.priceCount).toBe(3);
      expect(result.metadata?.symbol).toBe('SUI');
    });

    it('should use default search width if not provided', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockChartResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await provider.fetchHistorical(config, 'testSource');

      expect(httpService.get).toHaveBeenCalledWith(
        'https://coins.llama.fi/chart/sui:0x2::sui::SUI?searchWidth=4h',
      );
    });

    it('should throw error if no historical data found', async () => {
      const emptyResponse: AxiosResponse = {
        ...mockChartResponse,
        data: { coins: {} },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(emptyResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await expect(provider.fetchHistorical(config, 'testSource')).rejects.toThrow(
        'No historical data found for: sui:0x2::sui::SUI',
      );
    });
  });

  describe('fetchPercentageChange', () => {
    it('should calculate percentage change from historical data', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockChartResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
        searchWidth: '4h',
      };

      const result = await provider.fetchPercentageChange(config, 'testSource');

      // Percentage change: ((1.6 - 1.4) / 1.4) * 100 = 14.285714...
      expect(result.value).toBeCloseTo(14.29, 1);
      expect(result.metadata?.oldestPrice).toBe(1.4);
      expect(result.metadata?.latestPrice).toBe(1.6);
      expect(result.metadata?.period).toBe('4h');
    });

    it('should handle negative percentage change', async () => {
      const decreasingPrices: AxiosResponse = {
        ...mockChartResponse,
        data: {
          coins: {
            'sui:0x2::sui::SUI': {
              prices: [
                { timestamp: 1700000000, price: 2.0 },
                { timestamp: 1700001000, price: 1.5 },
              ],
              symbol: 'SUI',
              confidence: 0.98,
            },
          },
        },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(decreasingPrices));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      const result = await provider.fetchPercentageChange(config, 'testSource');

      // Percentage change: ((1.5 - 2.0) / 2.0) * 100 = -25
      expect(result.value).toBe(-25);
    });

    it('should throw error if insufficient historical data', async () => {
      const singlePriceResponse: AxiosResponse = {
        ...mockChartResponse,
        data: {
          coins: {
            'sui:0x2::sui::SUI': {
              prices: [{ timestamp: 1700000000, price: 1.5 }],
              symbol: 'SUI',
              confidence: 0.98,
            },
          },
        },
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(singlePriceResponse));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'historical' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await expect(provider.fetchPercentageChange(config, 'testSource')).rejects.toThrow(
        'Not enough historical data for percentage change',
      );
    });
  });

  describe('error handling', () => {
    it('should log and rethrow errors', async () => {
      const loggerSpy = jest.spyOn(provider['logger'], 'error');
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('API unavailable')));

      const config = {
        provider: 'defillama' as const,
        endpoint: 'prices' as const,
        coins: ['sui:0x2::sui::SUI'],
      };

      await expect(provider.fetchPrice(config, 'testSource')).rejects.toThrow('API unavailable');
      expect(loggerSpy).toHaveBeenCalled();
    });
  });
});
