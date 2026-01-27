import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService],
    }).compile();

    service = module.get<UsersService>(UsersService);
    service['users'] = [];
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new user with hashed password', async () => {
      const createUserDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const hashedPassword = 'hashed_password_123';
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

      const result = await service.create(createUserDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(createUserDto.password, 10);
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email', createUserDto.email);
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
      expect(result).not.toHaveProperty('password');
    });

    it('should store user in users array', async () => {
      const createUserDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

      await service.create(createUserDto);

      expect(service['users']).toHaveLength(1);
      expect(service['users'][0]).toHaveProperty('password', 'hashed');
    });
  });

  describe('findAll', () => {
    it('should return all users without passwords', async () => {
      service['users'] = [
        {
          id: '1',
          email: 'user1@example.com',
          password: 'hash1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          email: 'user2@example.com',
          password: 'hash2',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('password');
      expect(result[1]).not.toHaveProperty('password');
      expect(result[0]).toHaveProperty('email', 'user1@example.com');
      expect(result[1]).toHaveProperty('email', 'user2@example.com');
    });

    it('should return empty array when no users exist', async () => {
      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return user without password when found', async () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service['users'] = [user];

      const result = await service.findOne('123');

      expect(result).toHaveProperty('id', '123');
      expect(result).toHaveProperty('email', 'test@example.com');
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException when user not found', async () => {
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'User with ID nonexistent not found',
      );
    });
  });

  describe('findByEmail', () => {
    it('should return user with password when found', async () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service['users'] = [user];

      const result = await service.findByEmail('test@example.com');

      expect(result).toEqual(user);
      expect(result).toHaveProperty('password', 'hashed');
    });

    it('should return undefined when user not found', async () => {
      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update user and return without password', async () => {
      const user = {
        id: '123',
        email: 'old@example.com',
        password: 'oldhash',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service['users'] = [user];

      const updateDto = {
        email: 'new@example.com',
      };

      const result = await service.update('123', updateDto);

      expect(result).toHaveProperty('email', 'new@example.com');
      expect(result).not.toHaveProperty('password');
      expect(service['users'][0].email).toBe('new@example.com');
    });

    it('should hash password when updating password', async () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'oldhash',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service['users'] = [user];

      const updateDto = {
        password: 'newpassword',
      };

      const newHash = 'newhash123';
      (bcrypt.hash as jest.Mock).mockResolvedValue(newHash);

      await service.update('123', updateDto);

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 10);
      expect(service['users'][0].password).toBe(newHash);
    });

    it('should update updatedAt timestamp', async () => {
      const oldDate = new Date('2023-01-01');
      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hash',
        createdAt: oldDate,
        updatedAt: oldDate,
      };

      service['users'] = [user];

      const result = await service.update('123', { email: 'new@example.com' });

      expect(result.updatedAt.getTime()).toBeGreaterThan(oldDate.getTime());
    });

    it('should throw NotFoundException when user not found', async () => {
      await expect(
        service.update('nonexistent', { email: 'new@example.com' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.update('nonexistent', { email: 'new@example.com' }),
      ).rejects.toThrow('User with ID nonexistent not found');
    });
  });

  describe('remove', () => {
    it('should remove user from array', async () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service['users'] = [user];

      await service.remove('123');

      expect(service['users']).toHaveLength(0);
    });

    it('should throw NotFoundException when user not found', async () => {
      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('nonexistent')).rejects.toThrow(
        'User with ID nonexistent not found',
      );
    });
  });
});
