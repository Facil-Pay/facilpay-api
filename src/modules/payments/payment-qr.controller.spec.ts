// The real logger pulls in src/tracing.ts, which needs OpenTelemetry packages
// that are not installed everywhere; this suite does not need it.
jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

import * as QRCode from 'qrcode';
import { PaymentQrController } from './payment-qr.controller';
import { Payment } from './payment.entity';

jest.mock('qrcode', () => ({
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

const MUXED_ADDRESS =
  'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAGZFQ';

function createHarness(payment: Partial<Payment>) {
  const paymentsService = {
    findOne: jest.fn().mockResolvedValue(payment),
  };
  const paymentLinksService = {};
  const controller = new PaymentQrController(
    paymentsService as any,
    paymentLinksService as any,
  );
  const res = {
    setHeader: jest.fn(),
    send: jest.fn(),
  };

  return { controller, res, paymentsService };
}

function lastEncodedUri(): string {
  const mock = QRCode.toBuffer as unknown as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1][0] as string;
}

describe('PaymentQrController muxed deposit addresses', () => {
  beforeEach(() => {
    (QRCode.toBuffer as unknown as jest.Mock).mockClear();
  });

  it('uses the muxed deposit address and omits the memo in SEP-7 URIs', async () => {
    const { controller, res } = createHarness({
      id: 'payment-1',
      merchantId: 'merchant-1',
      amount: 50,
      description: 'Order 1',
      depositAddress: MUXED_ADDRESS,
    });

    await controller.getPaymentQr('payment-1', 300, 'png', 'sep7', res as any);

    const uri = lastEncodedUri();
    expect(uri.startsWith('web+stellar:pay?')).toBe(true);
    const params = new URLSearchParams(uri.split('?')[1]);
    expect(params.get('destination')).toBe(MUXED_ADDRESS);
    expect(params.get('memo')).toBeNull();
  });

  it('uses the muxed deposit address in plain payment data', async () => {
    const { controller, res } = createHarness({
      id: 'payment-1',
      merchantId: 'merchant-1',
      amount: 50,
      description: 'Order 1',
      depositAddress: MUXED_ADDRESS,
    });

    await controller.getPaymentQr(
      'payment-1',
      300,
      'png',
      'payment',
      res as any,
    );

    const uri = lastEncodedUri();
    expect(uri).toContain(`dest=${MUXED_ADDRESS}`);
    expect(uri).not.toContain('memo=');
  });

  it('keeps the merchant destination and memo without a muxed address', async () => {
    const { controller, res } = createHarness({
      id: 'payment-1',
      merchantId: 'merchant-1',
      amount: 50,
      description: 'Order 1',
      depositAddress: null,
    });

    await controller.getPaymentQr('payment-1', 300, 'png', 'sep7', res as any);

    const params = new URLSearchParams(lastEncodedUri().split('?')[1]);
    expect(params.get('destination')).toBe('merchant-1');
    expect(params.get('memo')).toBe('Order 1');
  });
});
