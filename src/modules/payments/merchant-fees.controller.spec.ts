import { MerchantFeesController } from './merchant-fees.controller';
import { PaymentsService } from './payments.service';

describe('MerchantFeesController', () => {
  let controller: MerchantFeesController;
  let paymentsService: {
    getMerchantFeeConfig: jest.Mock;
    getFeeReport: jest.Mock;
  };

  beforeEach(() => {
    paymentsService = {
      getMerchantFeeConfig: jest.fn(),
      getFeeReport: jest.fn(),
    };

    controller = new MerchantFeesController(paymentsService as unknown as PaymentsService);
  });

  it('returns fee config for authenticated merchant only', async () => {
    const user = { id: 'merchant-123' } as any;
    const expectedConfig = {
      merchantId: user.id,
      flatFee: 1.5,
      percentageFee: 2.5,
      minFee: 0.5,
    };
    paymentsService.getMerchantFeeConfig.mockResolvedValue(expectedConfig);

    await expect(controller.getMyFeeConfig(user)).resolves.toEqual(expectedConfig);
    expect(paymentsService.getMerchantFeeConfig).toHaveBeenCalledWith(user.id);
  });

  it('returns fee report for authenticated merchant only', async () => {
    const user = { id: 'merchant-123' } as any;
    const expectedReport = {
      merchantId: user.id,
      totalGrossAmount: 120,
      totalFeeAmount: 3,
      totalNetAmount: 117,
    };
    paymentsService.getFeeReport.mockResolvedValue(expectedReport);

    await expect(controller.getMyFeeReport(user)).resolves.toEqual(expectedReport);
    expect(paymentsService.getFeeReport).toHaveBeenCalledWith(user.id);
  });
});
