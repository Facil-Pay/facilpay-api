import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../common/constants/roles';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('canActivate', () => {
    it('should allow access when no roles are required', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => ({ user: { id: '123' } }) }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when empty roles array is provided', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);

      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => ({ user: { id: '123' } }) }),
      } as unknown as ExecutionContext;
      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should deny access when user has no roles', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
      ]);

      const mockRequest = { user: { id: '123' } };
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(false);
    });

    it('should deny access when user roles do not match required roles', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
      ]);

      const mockRequest = { user: { id: '123', roles: [UserRole.USER] } };
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(false);
    });

    it('should allow access when user has matching role', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
      ]);

      const mockRequest = { user: { id: '123', roles: [UserRole.ADMIN] } };
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when user has one of multiple required roles', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
        UserRole.USER,
      ]);

      const mockRequest = { user: { id: '123', roles: [UserRole.USER] } };
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when user has multiple roles including required one', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
      ]);

      const mockRequest = {
        user: { id: '123', roles: [UserRole.USER, UserRole.ADMIN] },
      };
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should deny access when user is undefined', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
        UserRole.ADMIN,
      ]);

      const mockRequest = {};
      const mockContext = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => mockRequest }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(false);
    });
  });
});
