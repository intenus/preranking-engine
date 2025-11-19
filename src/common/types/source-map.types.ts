export type SourceType = 'oracle' | 'onchain' | 'offchain' | 'aggregator';

export type OracleProvider = 'defillama' | 'pyth' | 'switchboard';

export type OnChainMethod = 'dryRun' | 'moveCall' | 'eventQuery' | 'objectRead';

export interface DefiLlamaConfig {
  provider: 'defillama';
  baseUrl?: string;
  endpoint: 'prices' | 'charts' | 'historical';
  coins: string[]; // e.g., ['sui:0x2::sui::SUI', 'coingecko:usd-coin']
  searchWidth?: string; // e.g., '4h' for historical prices
}

export interface CetusConfig {
  method: 'moveCall' | 'eventQuery';
  poolAddress?: string;
  coinTypeA?: string;
  coinTypeB?: string;
  moduleAddress?: string;
  typeArguments?: string[];
}

export interface OracleConfig {
  provider: OracleProvider;
  config: DefiLlamaConfig | CetusConfig | any;
}

export interface OnChainConfig {
  method: OnChainMethod;
  packageId?: string;
  moduleName?: string;
  functionName?: string;
  typeArguments?: string[];
  arguments?: any[];
  eventType?: string;
  objectId?: string;
  parseStrategy?: 'json' | 'bcs' | 'custom';
}

export interface OffChainConfig {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  queryParams?: Record<string, any>;
  bodyTemplate?: Record<string, any>;
  parseStrategy?: 'json' | 'xml' | 'custom';
  jsonPath?: string;
}

export interface AggregatorConfig {
  sources: string[];
  strategy: 'median' | 'average' | 'min' | 'max' | 'first';
  weights?: Record<string, number>;
  minimumSources?: number;
  maxDeviation?: number;
}

export interface CacheConfig {
  enabled?: boolean;
  ttlMs?: number;
  strategy?: 'lru' | 'fifo' | 'ttl';
  maxSize?: number;
}

export interface Source {
  type: SourceType;
  description?: string;
  config: OracleConfig | OnChainConfig | OffChainConfig | AggregatorConfig;
  cache?: CacheConfig;
}

export interface SourceMap {
  version: string;
  sources: Record<string, Source>;
}

export interface SourceFetchResult<T = any> {
  value: T;
  timestamp: number;
  source: string;
  confidence?: number;
  metadata?: Record<string, any>;
}
