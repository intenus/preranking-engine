import { registerAs } from '@nestjs/config';

export interface SuiConfig {
  network: 'devnet' | 'testnet' | 'mainnet';
  rpcUrl: string;
  faucetUrl?: string;
}

export const suiConfig = registerAs(
  'sui',
  (): SuiConfig => ({
    network:
      (process.env.SUI_NETWORK as 'devnet' | 'testnet' | 'mainnet') ||
      'testnet',
    rpcUrl:
      process.env.SUI_RPC_URL ||
      (process.env.SUI_NETWORK === 'mainnet'
        ? 'https://fullnode.mainnet.sui.io'
        : 'https://fullnode.testnet.sui.io'),
    faucetUrl: process.env.SUI_FAUCET_URL,
  }),
);
