import { BadRequestException } from '@nestjs/common';
import { Sep31Service } from './sep31.service';
import { Sep31Customer } from './entities/sep31-customer.entity';
import { Sep31Transaction } from './entities/sep31-transaction.entity';

const sendingAccount = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('Sep31Service', () => {
  let service: Sep31Service;
  let customerRepo: {
    create: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let transactionRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let paymentsService: { create: jest.Mock; findOne: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    customerRepo = {
      create: jest.fn((value) => value),
      findOne: jest.fn(),
      save: jest.fn(async (value) => ({ id: 'customer-id', ...value })),
    };
    transactionRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'transaction-id', ...value })),
      findOne: jest.fn(),
    };
    paymentsService = {
      create: jest.fn().mockResolvedValue({ id: 'payment-id' }),
      findOne: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'SEP31_PII_ENCRYPTION_KEY') {
          return 'test-only-encryption-key-with-at-least-32-characters';
        }
        if (key === 'STELLAR_SOURCE_SECRET') {
          return 'SCZW2UDX4YC7TXGXBHWI5RUFLQMT2AGLG6ILLUM57X7HBLNTQUQ5N5YA';
        }
        return defaultValue;
      }),
    };

    service = new Sep31Service(
      customerRepo as never,
      transactionRepo as never,
      { verifySep10Token: jest.fn().mockResolvedValue(sendingAccount) } as never,
      paymentsService as never,
      {
        findOne: jest.fn().mockResolvedValue({ id: 'merchant-id' }),
        assertMerchantActive: jest.fn().mockResolvedValue(undefined),
      } as never,
      configService as never,
    );
  });

  it('encrypts SEP-12 customer fields before saving them', async () => {
    const result = await service.updateCustomer(sendingAccount, {
      type: 'sep31_sender',
      fields: { first_name: 'Ada', last_name: 'Lovelace' },
    });

    const saved = customerRepo.save.mock.calls[0][0] as Sep31Customer;
    expect(result).toEqual({ id: 'customer-id', status: 'ACCEPTED' });
    expect(saved.encryptedFields).toBeTruthy();
    expect(saved.encryptedFields).not.toContain('Lovelace');
  });

  it('creates a merchant payment that can be matched by the Stellar memo', async () => {
    customerRepo.findOne
      .mockResolvedValueOnce({
        id: 'sender-id',
        type: 'sender',
        senderAccount,
        status: 'ACCEPTED',
      })
      .mockResolvedValueOnce({
        id: 'receiver-id',
        type: 'receiver',
        senderAccount,
        merchantId: 'merchant-id',
        status: 'ACCEPTED',
      });

    const result = await service.createTransaction(senderAccount, {
      amount: '25.00',
      asset_code: 'XLM',
      sender_id: 'sender-id',
      receiver_id: 'receiver-id',
    });

    const paymentInput = paymentsService.create.mock.calls[0][0];
    const saved = transactionRepo.save.mock.calls[0][0] as Sep31Transaction;
    expect(result).toEqual({ id: 'transaction-id' });
    expect(paymentInput).toMatchObject({
      amount: 25,
      currency: 'XLM',
      merchantId: 'merchant-id',
      externalReference: saved.stellarMemo,
    });
    expect(saved).toMatchObject({
      paymentId: 'payment-id',
      merchantId: 'merchant-id',
      status: 'pending_sender',
    });
  });

  it('rejects transaction fields that have not been defined by the anchor', async () => {
    await expect(
      service.createTransaction(sendingAccount, {
        amount: '25.00',
        asset_code: 'XLM',
        sender_id: 'sender-id',
        receiver_id: 'receiver-id',
        fields: { transaction: { purpose: 'family support' } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
