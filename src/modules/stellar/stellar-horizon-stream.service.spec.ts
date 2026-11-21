import { Payment, PaymentStatus } from '../payments/payment.entity';
import { StellarHorizonStreamService } from './stellar-horizon-stream.service';

describe('StellarHorizonStreamService', () => {
  const merchantAccountId = 'G_MERCHANT_ACCOUNT';

  const createHarness = (autoStart = true) => {
    const streamOptions: any[] = [];
    const streamClosers: jest.Mock[] = [];
    const cursorValues: string[] = [];
    const stream = jest.fn((options: any) => {
      streamOptions.push(options);
      const close = jest.fn();
      streamClosers.push(close);
      return close;
    });
    const cursor = jest.fn((value: string) => {
      cursorValues.push(value);
      return { stream };
    });
    const payments = jest.fn(() => ({
      forAccount: jest.fn(() => ({ cursor })),
    }));
    const server = { payments };
    const horizonClient = {
      getHealthyServer: jest.fn(() => server),
    };
    const paymentRepository = {
      findOne: jest.fn(),
      save: jest.fn((payment) => Promise.resolve(payment)),
    };
    const values: Record<string, string | number> = {
      STELLAR_MERCHANT_ACCOUNT_ID: merchantAccountId,
      STELLAR_RECONNECT_BASE_DELAY_MS: 100,
      STELLAR_RECONNECT_MAX_DELAY_MS: 1000,
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: string | number) =>
        values[key] ?? defaultValue,
      ),
    };
    const service = new StellarHorizonStreamService(
      configService as any,
      paymentRepository as any,
      horizonClient as any,
    );

    if (autoStart) service.onModuleInit();

    return {
      service,
      configService,
      paymentRepository,
      horizonClient,
      streamOptions,
      streamClosers,
      cursorValues,
      stream,
    };
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resumes from the last payment paging token after reconnecting', () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createHarness();

    expect(harness.cursorValues).toEqual(['now']);
    harness.streamOptions[0].onmessage({
      type: 'payment',
      paging_token: '987654321',
      to: 'G_OTHER_ACCOUNT',
    });
    harness.streamOptions[0].onerror(new Error('stream disconnected'));

    expect(harness.streamClosers[0]).toHaveBeenCalledTimes(1);
    expect(harness.service.connected).toBe(false);
    jest.advanceTimersByTime(100);

    expect(harness.cursorValues).toEqual(['now', '987654321']);
    expect(harness.service.connected).toBe(true);
  });

  it('increases reconnect backoff when stream startup repeatedly fails', () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createHarness(false);
    harness.horizonClient.getHealthyServer
      .mockImplementationOnce(() => {
        throw new Error('Horizon unavailable');
      })
      .mockImplementationOnce(() => {
        throw new Error('Horizon still unavailable');
      });

    harness.service.onModuleInit();
    expect(harness.stream).not.toHaveBeenCalled();

    jest.advanceTimersByTime(99);
    expect(harness.stream).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(harness.stream).not.toHaveBeenCalled();

    jest.advanceTimersByTime(199);
    expect(harness.stream).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(harness.stream).toHaveBeenCalledTimes(1);
    expect(harness.service.connected).toBe(true);
  });

  it('matches an incoming payment by memo and amount and confirms it', async () => {
    const harness = createHarness();
    const payment = {
      id: 'payment-1',
      amount: '25.00',
      receivedAmount: '26.50',
      overpaidAmount: 0,
      externalReference: 'memo-123',
      status: PaymentStatus.PENDING,
    } as unknown as Payment;
    harness.paymentRepository.findOne.mockResolvedValue(payment);
    const record = {
      type: 'payment',
      paging_token: '456',
      to: merchantAccountId,
      amount: '26.50',
      transaction_hash: 'stellar-tx-hash',
      transaction: jest.fn().mockResolvedValue({ memo: 'memo-123' }),
    };

    await (harness.service as any).handleRecord(record);

    expect(harness.paymentRepository.findOne).toHaveBeenCalledWith({
      where: {
        status: PaymentStatus.PENDING,
        externalReference: 'memo-123',
      },
    });
    expect(payment.status).toBe(PaymentStatus.COMPLETED);
    expect(payment.overpaidAmount).toBe(1.5);
    expect(harness.paymentRepository.save).toHaveBeenCalledWith(payment);
  });

  it('matches an incoming payment by muxed ID without a memo', async () => {
    const harness = createHarness();
    const payment = {
      id: 'payment-muxed',
      amount: '25.00',
      receivedAmount: '25.00',
      overpaidAmount: 0,
      externalReference: null,
      depositAddress: 'M_MUXED_ADDRESS',
      muxedId: '1234567890',
      status: PaymentStatus.PENDING,
    } as unknown as Payment;
    harness.paymentRepository.findOne.mockResolvedValue(payment);
    const record = {
      type: 'payment',
      paging_token: '789',
      to: merchantAccountId,
      to_muxed: 'M_MUXED_ADDRESS',
      to_muxed_id: '1234567890',
      amount: '25.00',
      transaction_hash: 'muxed-tx-hash',
      transaction: jest.fn(),
    };

    await (harness.service as any).handleRecord(record);

    expect(harness.paymentRepository.findOne).toHaveBeenCalledWith({
      where: {
        status: PaymentStatus.PENDING,
        muxedId: '1234567890',
      },
    });
    expect(record.transaction).not.toHaveBeenCalled();
    expect(payment.status).toBe(PaymentStatus.COMPLETED);
    expect(harness.paymentRepository.save).toHaveBeenCalledWith(payment);
  });

  it('falls back to memo matching when the muxed ID is unknown', async () => {
    const harness = createHarness();
    const memoPayment = {
      id: 'payment-memo',
      amount: '10.00',
      receivedAmount: '10.00',
      overpaidAmount: 0,
      externalReference: 'memo-777',
      status: PaymentStatus.PENDING,
    } as unknown as Payment;
    harness.paymentRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(memoPayment);
    const record = {
      type: 'payment',
      paging_token: '790',
      to: merchantAccountId,
      to_muxed_id: '999',
      amount: '10.00',
      transaction_hash: 'memo-tx-hash',
      transaction: jest.fn().mockResolvedValue({ memo: 'memo-777' }),
    };

    await (harness.service as any).handleRecord(record);

    expect(harness.paymentRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { status: PaymentStatus.PENDING, muxedId: '999' },
    });
    expect(harness.paymentRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        status: PaymentStatus.PENDING,
        externalReference: 'memo-777',
      },
    });
    expect(memoPayment.status).toBe(PaymentStatus.COMPLETED);
  });

  it('does not fall back to the memo when the muxed payment is underpaid', async () => {
    const harness = createHarness();
    harness.paymentRepository.findOne.mockResolvedValue({
      id: 'payment-muxed',
      amount: '25.00',
      muxedId: '42',
      status: PaymentStatus.PENDING,
    } as unknown as Payment);
    const record = {
      type: 'payment',
      paging_token: '791',
      to: merchantAccountId,
      to_muxed_id: '42',
      amount: '5.00',
      transaction_hash: 'underpaid-tx',
      transaction: jest.fn().mockResolvedValue({ memo: 'anything' }),
    };

    await (harness.service as any).handleRecord(record);

    expect(record.transaction).not.toHaveBeenCalled();
    expect(harness.paymentRepository.save).not.toHaveBeenCalled();
  });
});
