import { BadRequestException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentStatus } from './payment.entity';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    createBulk: jest.Mock;
    update: jest.Mock;
    addPaymentNote: jest.Mock;
    getPaymentNotes: jest.Mock;
    getTimeline: jest.Mock;
  };

  beforeEach(() => {
    paymentsService = {
      createBulk: jest.fn(),
      update: jest.fn(),
      addPaymentNote: jest.fn(),
      getPaymentNotes: jest.fn(),
      getTimeline: jest.fn(),
    };
    controller = new PaymentsController(
      paymentsService as any,
      undefined as any,
      undefined as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
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

  describe('update', () => {
    it('passes authenticated ownership and request context to the service', async () => {
      const dto = { description: 'Updated description' };
      const user = { id: 'merchant-1' } as any;
      const req = {
        ip: '203.0.113.10',
        headers: { 'user-agent': 'jest' },
      } as any;
      const updatedPayment = { id: 'payment-1' };
      paymentsService.update.mockResolvedValue(updatedPayment);

      await expect(
        controller.update('payment-1', dto, user, req),
      ).resolves.toBe(updatedPayment);
      expect(paymentsService.update).toHaveBeenCalledWith(
        'payment-1',
        dto,
        'merchant-1',
        '203.0.113.10',
        'jest',
      );
    });
  });

  describe('payment notes', () => {
    it('passes the authenticated merchant as note author and owner', async () => {
      const note = { id: 'note-1' };
      paymentsService.addPaymentNote.mockResolvedValue(note);
      paymentsService.getPaymentNotes.mockResolvedValue([note]);
      const request = { user: { id: 'merchant-1' } };

      await expect(
        controller.createNote('payment-1', { body: 'Internal note' } as any, request as any),
      ).resolves.toBe(note);
      await expect(
        controller.getNotes('payment-1', request as any),
      ).resolves.toEqual([note]);

      expect(paymentsService.addPaymentNote).toHaveBeenCalledWith(
        'payment-1',
        'merchant-1',
        'Internal note',
      );
      expect(paymentsService.getPaymentNotes).toHaveBeenCalledWith(
        'payment-1',
        'merchant-1',
      );
    });
  });
});
