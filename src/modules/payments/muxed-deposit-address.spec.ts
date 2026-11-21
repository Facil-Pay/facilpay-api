// The real logger pulls in src/tracing.ts, which needs OpenTelemetry packages
// that are not installed everywhere; this suite does not need it.
jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

import { EntityManager } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment } from './payment.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { deriveMuxedId } from '../stellar/muxed-account.util';

const BASE_ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

function createHarness(options: {
  enabled?: boolean;
  hasSettings?: boolean;
  baseAccount?: string;
}) {
  const payment = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    depositAddress: null,
    muxedId: null,
  } as unknown as Payment;

  const settings = {
    merchantId: 'merchant-1',
    muxedAccountsEnabled: options.enabled ?? true,
  } as MerchantSettings;

  const settingsRepository = {
    findOneBy: jest
      .fn()
      .mockResolvedValue(options.hasSettings === false ? null : settings),
  };

  const paymentRepository = {
    manager: { save: jest.fn(async (value) => value) },
  };

  const service = Object.assign(Object.create(PaymentsService.prototype), {
    configService: {
      get: jest.fn((_key: string) => options.baseAccount ?? BASE_ACCOUNT),
    },
    merchantSettingsRepository: settingsRepository,
    paymentRepository,
  }) as PaymentsService;

  return { service, payment, settingsRepository, paymentRepository };
}

describe('PaymentsService muxed deposit addresses', () => {
  it('assigns a muxed address when the merchant flag is enabled', async () => {
    const { service, payment } = createHarness({ enabled: true });

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      undefined,
    );

    expect(payment.muxedId).toBe(deriveMuxedId(payment.id));
    expect(payment.depositAddress).toMatch(/^M/);
  });

  it('skips the payment when the merchant flag is disabled', async () => {
    const { service, payment } = createHarness({ enabled: false });

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      undefined,
    );

    expect(payment.depositAddress).toBeNull();
    expect(payment.muxedId).toBeNull();
  });

  it('skips the payment when the merchant has no settings', async () => {
    const { service, payment } = createHarness({ hasSettings: false });

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      undefined,
    );

    expect(payment.depositAddress).toBeNull();
  });

  it('skips the payment when the base account is not configured', async () => {
    const { service, payment } = createHarness({
      enabled: true,
      baseAccount: '',
    });

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      undefined,
    );

    expect(payment.depositAddress).toBeNull();
  });

  it('saves through the payment repository when no manager is given', async () => {
    const { service, payment, paymentRepository } = createHarness({
      enabled: true,
    });

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      undefined,
    );

    expect(paymentRepository.manager.save).toHaveBeenCalledWith(payment);
  });

  it('uses the transaction manager when one is provided', async () => {
    const { service, payment, settingsRepository } = createHarness({
      enabled: true,
    });
    const manager = {
      getRepository: jest.fn(() => settingsRepository),
      save: jest.fn(async (value) => value),
    } as unknown as EntityManager;

    await (service as any).assignMuxedDepositAddress(
      payment,
      'merchant-1',
      manager,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(MerchantSettings);
    expect(manager.save).toHaveBeenCalledWith(payment);
  });
});
