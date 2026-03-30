export interface StellarError {
  status: number;
  code: string;
  message: string;
  detail?: string;
  extras?: any;
}

export enum StellarNetwork {
  TESTNET = 'TESTNET',
  PUBLIC = 'PUBLIC',
}