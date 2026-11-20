jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
}));

import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('StellarService.convertAsset', () => {
  function setup() {
    const keypair = StellarSdk.Keypair.random();
    const sourceAccount = {
      id: keypair.publicKey(),
      sequenceNumber: () => '1',
      accountId: () => keypair.publicKey(),
      incrementSequenceNumber: jest.fn(),
      signers: [{ key: keypair.publicKey(), weight: 1 }],
      thresholds: { med_threshold: 1 },
    };
    const submitTransaction = jest.fn().mockResolvedValue({
      hash: 'CONVERSION_HASH',
      ledger: 123,
      result_xdr: 'not-a-real-xdr',
    });
    const server = {
      loadAccount: jest.fn().mockResolvedValue(sourceAccount),
      submitTransaction,
    };
    const service = Object.create(StellarService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          STELLAR_BASE_FEE: '100',
          STELLAR_MAX_FEE: '1000',
          STELLAR_HORIZON_URL: 'https://horizon.example',
        };
        return values[key] ?? defaultValue;
      }),
    };
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.feeStatsCache = null;
    service.sourceKeypair = keypair;
    service.networkPassphrase = StellarSdk.Networks.TESTNET;
    service.horizonClientService = {
      getHealthyServer: jest.fn().mockReturnValue(server),
    };
    service.multiSigRepo = {
      create: jest.fn((value: unknown) => ({ id: 'multisig-1', ...value })),
      save: jest.fn(async (value: unknown) => value),
    };
    service.webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fee_charged: { p70: '100' } }),
    }) as any;
    return { service, server, submitTransaction };
  }

  afterEach(() => jest.restoreAllMocks());

  it('submits a strict-send path payment with the on-chain slippage guard', async () => {
    const { service, submitTransaction } = setup();

    const result = await service.convertAsset({
      sourceAsset: StellarSdk.Asset.native(),
      destAsset: new StellarSdk.Asset('USDC', ISSUER),
      sourceAmount: '95',
      destMin: '94.0275000',
      path: [new StellarSdk.Asset('XLM', ISSUER)],
      destination: ISSUER,
    });

    expect(result).toMatchObject({
      status: 'ok',
      hash: 'CONVERSION_HASH',
      ledger: 123,
      fee: '0.0000100',
    });
    const transaction = submitTransaction.mock.calls[0][0];
    expect(transaction.operations[0].type).toBe('pathPaymentStrictSend');
    expect(transaction.operations[0]).toMatchObject({
      sendAmount: '95.0000000',
      destMin: '94.0275000',
      destination: ISSUER,
    });
    expect(transaction.signatures.length).toBeGreaterThan(0);
  });

  it('does not submit when the source account requires more signatures', async () => {
    const { service, server, submitTransaction } = setup();
    server.loadAccount.mockResolvedValue({
      ...(await server.loadAccount()),
      signers: [{ key: service.sourceKeypair.publicKey(), weight: 1 }],
      thresholds: { med_threshold: 2 },
    });

    const result = await service.convertAsset({
      sourceAsset: StellarSdk.Asset.native(),
      destAsset: new StellarSdk.Asset('USDC', ISSUER),
      sourceAmount: '10',
      destMin: '9',
      path: [],
      destination: ISSUER,
      merchantId: 'merchant-1',
    });

    expect(result.status).toBe('pending_signatures');
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(service.multiSigRepo.save).toHaveBeenCalled();
  });
});
