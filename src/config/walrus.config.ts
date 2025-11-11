import { registerAs } from '@nestjs/config';

export interface WalrusConfig {
  network: 'devnet' | 'testnet' | 'mainnet';
  publisherUrl?: string;
  aggregatorUrl?: string;
  defaultEpochs?: number;
}

export const walrusConfig = registerAs(
  'walrus',
  (): WalrusConfig => ({
    network:
      (process.env.WALRUS_NETWORK as 'devnet' | 'testnet' | 'mainnet') ||
      'testnet',
    publisherUrl: process.env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: process.env.WALRUS_AGGREGATOR_URL,
    defaultEpochs: parseInt(process.env.WALRUS_DEFAULT_EPOCHS || '1', 10),
  }),
);
