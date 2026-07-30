import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { AppLogger } from '../logger/logger.service';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { UserRole } from '../../common/constants/roles';

describe('UsersService', () => {
    let service: UsersService;
    let userRepository: any;
    let appLogger: any;

    beforeEach(async () => {
        userRepository = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                take: jest.fn().mockReturnThis(),
                getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            })),
        };

        appLogger = {
            child: jest.fn().mockReturnValue({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                { provide: getRepositoryToken(User), useValue: userRepository },
                { provide: AppLogger, useValue: appLogger },
            ],
        }).compile();

        service = module.get<UsersService>(UsersService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('findOneWithAuth', () => {
        it('should allow a user to view their own profile', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'user@example.com';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];

            userRepository.findOne.mockResolvedValue(user);

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            const result = await service.findOneWithAuth('user-1', requestingUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(result).not.toHaveProperty('password');
        });

        it('should allow an admin to view any user profile', async () => {
            const targetUser = new User();
            targetUser.id = 'user-1';
            targetUser.email = 'user@example.com';
            targetUser.password = 'hashedPassword';
            targetUser.roles = [UserRole.USER];

            userRepository.findOne.mockResolvedValue(targetUser);

            const adminUser = new User();
            adminUser.id = 'admin-1';
            adminUser.roles = [UserRole.ADMIN];

            const result = await service.findOneWithAuth('user-1', adminUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(result).not.toHaveProperty('password');
        });

        it('should throw ForbiddenException when non-admin user tries to view another user profile', async () => {
            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            await expect(
                service.findOneWithAuth('user-2', requestingUser),
            ).rejects.toThrow(ForbiddenException);
            await expect(
                service.findOneWithAuth('user-2', requestingUser),
            ).rejects.toThrow('You can only view your own profile');
        });

        it('should throw NotFoundException when user does not exist', async () => {
            userRepository.findOne.mockResolvedValue(null);

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            await expect(
                service.findOneWithAuth('user-1', requestingUser),
            ).rejects.toThrow(NotFoundException);
        });
    });

    describe('updateWithAuth', () => {
        it('should allow a user to update their own profile', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'user@example.com';
            user.name = 'Old Name';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];
            user.deletedAt = null;

            userRepository.findOne.mockResolvedValue(user);
            userRepository.save.mockResolvedValue({ ...user, name: 'New Name' });

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            const result = await service.updateWithAuth('user-1', { name: 'New Name' }, requestingUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(result).not.toHaveProperty('password');
            expect(userRepository.save).toHaveBeenCalled();
        });

        it('should allow an admin to update any user profile', async () => {
            const targetUser = new User();
            targetUser.id = 'user-1';
            targetUser.email = 'user@example.com';
            targetUser.name = 'Old Name';
            targetUser.password = 'hashedPassword';
            targetUser.roles = [UserRole.USER];
            targetUser.deletedAt = null;

            userRepository.findOne.mockResolvedValue(targetUser);
            userRepository.save.mockResolvedValue({ ...targetUser, name: 'New Name' });

            const adminUser = new User();
            adminUser.id = 'admin-1';
            adminUser.roles = [UserRole.ADMIN];

            const result = await service.updateWithAuth('user-1', { name: 'New Name' }, adminUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(userRepository.save).toHaveBeenCalled();
        });

        it('should throw ForbiddenException when non-admin user tries to update another user profile', async () => {
            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            await expect(
                service.updateWithAuth('user-2', { name: 'New Name' }, requestingUser),
            ).rejects.toThrow(ForbiddenException);
            await expect(
                service.updateWithAuth('user-2', { name: 'New Name' }, requestingUser),
            ).rejects.toThrow('You can only update your own profile');
        });

        it('should throw NotFoundException when user does not exist', async () => {
            userRepository.findOne.mockResolvedValue(null);

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            await expect(
                service.updateWithAuth('user-1', { name: 'New Name' }, requestingUser),
            ).rejects.toThrow(NotFoundException);
        });

        it('should handle email updates with ownership check', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'old@example.com';
            user.name = 'User';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];
            user.deletedAt = null;
            user.isEmailVerified = true;

            userRepository.findOne
                .mockResolvedValueOnce(user) // First call to find the user being updated
                .mockResolvedValueOnce(null); // Second call to check if new email exists

            userRepository.save.mockResolvedValue({
                ...user,
                email: 'new@example.com',
                isEmailVerified: false,
            });

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            const result = await service.updateWithAuth(
                'user-1',
                { email: 'new@example.com' },
                requestingUser,
            );

            expect(result).toBeDefined();
            expect(userRepository.save).toHaveBeenCalled();
        });

        it('should throw ConflictException when email is already taken', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'old@example.com';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];
            user.deletedAt = null;

            const existingUser = new User();
            existingUser.id = 'user-2';
            existingUser.email = 'taken@example.com';

            userRepository.findOne
                .mockResolvedValueOnce(user)
                .mockResolvedValueOnce(existingUser);

            const requestingUser = new User();
            requestingUser.id = 'user-1';
            requestingUser.roles = [UserRole.USER];

            await expect(
                service.updateWithAuth('user-1', { email: 'taken@example.com' }, requestingUser),
            ).rejects.toThrow(ConflictException);
        });
    });

    describe('cross-user access control (e2e-style)', () => {
        it('should prevent User A from viewing User B profile', async () => {
            const userA = new User();
            userA.id = 'user-A';
            userA.roles = [UserRole.USER];

            await expect(
                service.findOneWithAuth('user-B', userA),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should prevent User A from updating User B profile', async () => {
            const userA = new User();
            userA.id = 'user-A';
            userA.roles = [UserRole.USER];

            await expect(
                service.updateWithAuth('user-B', { name: 'Malicious Update' }, userA),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should allow admin to access any user', async () => {
            const targetUser = new User();
            targetUser.id = 'user-123';
            targetUser.email = 'target@example.com';
            targetUser.password = 'hashedPassword';
            targetUser.roles = [UserRole.USER];
            targetUser.deletedAt = null;

            userRepository.findOne.mockResolvedValue(targetUser);

            const adminUser = new User();
            adminUser.id = 'admin-999';
            adminUser.roles = [UserRole.ADMIN];

            const result = await service.findOneWithAuth('user-123', adminUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-123');
        });

        it('should allow admin with multiple roles to access any user', async () => {
            const targetUser = new User();
            targetUser.id = 'user-123';
            targetUser.email = 'target@example.com';
            targetUser.password = 'hashedPassword';
            targetUser.roles = [UserRole.USER];
            targetUser.deletedAt = null;

            userRepository.findOne.mockResolvedValue(targetUser);

            const adminUser = new User();
            adminUser.id = 'admin-999';
            adminUser.roles = [UserRole.USER, UserRole.ADMIN]; // Has both roles

            const result = await service.findOneWithAuth('user-123', adminUser);

            expect(result).toBeDefined();
            expect(result.id).toBe('user-123');
        });
    });

    describe('/users/me endpoints remain unaffected', () => {
        it('should allow direct access to findOne for /users/me functionality', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'user@example.com';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];
            user.deletedAt = null;

            userRepository.findOne.mockResolvedValue(user);

            // Direct call to findOne (used by /users/me)
            const result = await service.findOne('user-1');

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(result).not.toHaveProperty('password');
        });

        it('should allow direct access to update for /users/me functionality', async () => {
            const user = new User();
            user.id = 'user-1';
            user.email = 'user@example.com';
            user.name = 'Old Name';
            user.password = 'hashedPassword';
            user.roles = [UserRole.USER];
            user.deletedAt = null;

            userRepository.findOne.mockResolvedValue(user);
            userRepository.save.mockResolvedValue({ ...user, name: 'New Name' });

            // Direct call to update (used by /users/me)
            const result = await service.update('user-1', { name: 'New Name' });

            expect(result).toBeDefined();
            expect(result.id).toBe('user-1');
            expect(userRepository.save).toHaveBeenCalled();
        });
    });
});
