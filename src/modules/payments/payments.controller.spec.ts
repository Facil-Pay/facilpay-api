import { BadRequestException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentStatus } from './payment.entity';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: { createBulk: jest.Mock };

  beforeEach(() => {
    paymentsService = { createBulk: jest.fn() };
    controller = new PaymentsController(paymentsService as any);
  });

  describe('createBulk', () => {
    it('should create a valid bulk batch and return created payments', async () => {
      const requestBody = [
        { amount: 100.0, currency: 'USD' },
        { amount: 150.0, currency: 'USD' },
      ];

      const response = {
        created: 2,
        payments: [
          {
            id: 'uuid-1',
            amount: 100.0,
            currency: 'USD',
            status: PaymentStatus.PENDING,
            description: null,
            externalReference: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'uuid-2',
            amount: 150.0,
            currency: 'USD',
            status: PaymentStatus.PENDING,
            description: null,
            externalReference: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      paymentsService.createBulk.mockResolvedValue(response);

      await expect(controller.createBulk(requestBody as any)).resolves.toEqual(
        response,
      );
      expect(paymentsService.createBulk).toHaveBeenCalled();
    });

    it('should reject an empty array with BadRequestException', async () => {
      await expect(controller.createBulk([] as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject an invalid item inside the batch with BadRequestException', async () => {
      const invalidBody = [{ amount: -10.0, currency: 'USD' }];
      await expect(controller.createBulk(invalidBody as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
