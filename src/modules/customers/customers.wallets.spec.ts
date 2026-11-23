import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { CustomerWallet } from './entities/customer-wallet.entity';
import { CustomerNote } from './entities/customer-note.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

describe('CustomersService - Wallets and Notes', () => {
  let service: CustomersService;
  let customerRepository: Repository<Customer>;
  let walletRepository: Repository<CustomerWallet>;
  let noteRepository: Repository<CustomerNote>;

  const mockCustomer: Customer = {
    id: 'customer-1',
    merchantId: 'merchant-1',
    email: 'test@example.com',
    name: 'Test Customer',
    phone: null,
    metadata: null,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CustomerWallet),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CustomerNote),
          useValue: {
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(),
          },
        },
        {
          provide: AuditLogsService,
          useValue: {
            record: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    customerRepository = module.get(getRepositoryToken(Customer));
    walletRepository = module.get(getRepositoryToken(CustomerWallet));
    noteRepository = module.get(getRepositoryToken(CustomerNote));
  });

  describe('addWallet', () => {
    it('should create a new wallet address for customer', async () => {
      const address = 'GAXYZ123ABC';
      
      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(walletRepository, 'create').mockReturnValue({
        id: 'wallet-1',
        customerId: mockCustomer.id,
        address,
        lastUsedAt: new Date(),
      } as CustomerWallet);
      jest.spyOn(walletRepository, 'save').mockResolvedValue({
        id: 'wallet-1',
        customerId: mockCustomer.id,
        address,
        lastUsedAt: new Date(),
      } as CustomerWallet);

      const result = await service.addWallet(mockCustomer.id, mockCustomer.merchantId, address);

      expect(result.address).toBe(address);
      expect(result.customerId).toBe(mockCustomer.id);
      expect(walletRepository.create).toHaveBeenCalledWith({
        customerId: mockCustomer.id,
        address,
        lastUsedAt: expect.any(Date),
      });
    });

    it('should update lastUsedAt if wallet already exists', async () => {
      const address = 'GAXYZ123ABC';
      const existingWallet: CustomerWallet = {
        id: 'wallet-1',
        customerId: mockCustomer.id,
        address,
        lastUsedAt: new Date('2023-01-01'),
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
      };

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(existingWallet);
      jest.spyOn(walletRepository, 'save').mockResolvedValue({
        ...existingWallet,
        lastUsedAt: new Date(),
      });

      const result = await service.addWallet(mockCustomer.id, mockCustomer.merchantId, address);

      expect(result.id).toBe(existingWallet.id);
      expect(result.lastUsedAt.getTime()).toBeGreaterThan(existingWallet.lastUsedAt.getTime());
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.addWallet('nonexistent', 'merchant-1', 'GAXYZ123ABC'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not store duplicate wallet addresses', async () => {
      const address = 'GAXYZ123ABC';
      const existingWallet: CustomerWallet = {
        id: 'wallet-1',
        customerId: mockCustomer.id,
        address,
        lastUsedAt: new Date('2023-01-01'),
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
      };

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(existingWallet);
      jest.spyOn(walletRepository, 'save').mockResolvedValue(existingWallet);

      await service.addWallet(mockCustomer.id, mockCustomer.merchantId, address);
      await service.addWallet(mockCustomer.id, mockCustomer.merchantId, address);

      // Should have been saved only once (for the update)
      expect(walletRepository.save).toHaveBeenCalledTimes(2);
      expect(walletRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getWallets', () => {
    it('should return wallets ordered by last used', async () => {
      const wallets: CustomerWallet[] = [
        {
          id: 'wallet-1',
          customerId: mockCustomer.id,
          address: 'GAXYZ123ABC',
          lastUsedAt: new Date('2024-01-02'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'wallet-2',
          customerId: mockCustomer.id,
          address: 'GBXYZ456DEF',
          lastUsedAt: new Date('2024-01-01'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'find').mockResolvedValue(wallets);

      const result = await service.getWallets(mockCustomer.id, mockCustomer.merchantId);

      expect(result).toEqual(wallets);
      expect(walletRepository.find).toHaveBeenCalledWith({
        where: { customerId: mockCustomer.id },
        order: { lastUsedAt: 'DESC' },
      });
    });
  });

  describe('getMostRecentWallet', () => {
    it('should return the most recently used wallet for refunds', async () => {
      const wallet: CustomerWallet = {
        id: 'wallet-1',
        customerId: mockCustomer.id,
        address: 'GAXYZ123ABC',
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(wallet);

      const result = await service.getMostRecentWallet(
        mockCustomer.id,
        mockCustomer.merchantId,
      );

      expect(result).toEqual(wallet);
    });

    it('should return null if no wallets exist', async () => {
      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(null);

      const result = await service.getMostRecentWallet(
        mockCustomer.id,
        mockCustomer.merchantId,
      );

      expect(result).toBeNull();
    });
  });

  describe('createNote', () => {
    it('should create an internal note for the customer', async () => {
      const noteDto = { content: 'Customer requested a refund' };
      const author = { id: 'user-1', name: 'Support Agent' };
      const savedNote: CustomerNote = {
        id: 'note-1',
        customerId: mockCustomer.id,
        content: noteDto.content,
        authorId: author.id,
        authorName: author.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(noteRepository, 'create').mockReturnValue(savedNote);
      jest.spyOn(noteRepository, 'save').mockResolvedValue(savedNote);

      const result = await service.createNote(
        mockCustomer.id,
        mockCustomer.merchantId,
        noteDto,
        author,
      );

      expect(result.content).toBe(noteDto.content);
      expect(result.authorId).toBe(author.id);
      expect(result.authorName).toBe(author.name);
    });

    it('should trim note content', async () => {
      const noteDto = { content: '  Customer note with spaces  ' };
      const author = { id: 'user-1' };

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(noteRepository, 'create').mockImplementation((data: any) => data);
      jest.spyOn(noteRepository, 'save').mockResolvedValue({} as CustomerNote);

      await service.createNote(mockCustomer.id, mockCustomer.merchantId, noteDto, author);

      expect(noteRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Customer note with spaces',
        }),
      );
    });
  });

  describe('getNotes', () => {
    it('should return notes ordered newest first', async () => {
      const notes: CustomerNote[] = [
        {
          id: 'note-2',
          customerId: mockCustomer.id,
          content: 'Second note',
          authorId: 'user-1',
          authorName: 'Agent',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'note-1',
          customerId: mockCustomer.id,
          content: 'First note',
          authorId: 'user-1',
          authorName: 'Agent',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      jest.spyOn(customerRepository, 'findOneBy').mockResolvedValue(mockCustomer);
      jest.spyOn(noteRepository, 'find').mockResolvedValue(notes);

      const result = await service.getNotes(mockCustomer.id, mockCustomer.merchantId);

      expect(result).toEqual(notes);
      expect(noteRepository.find).toHaveBeenCalledWith({
        where: { customerId: mockCustomer.id },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
