import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Role } from '../entities/role.entity';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let roleRepo: jest.Mocked<Pick<Repository<Role>, 'findOne'>>;

  const createContext = (user?: Record<string, unknown>): ExecutionContext => {
    const handler = jest.fn();
    const cls = class DummyController {};
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    roleRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
  });

  it('allows access when no permissions metadata is set', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createContext({ id: 'u1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      PERMISSIONS_KEY,
      expect.any(Array),
    );
    expect(roleRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows access when required permissions array is empty', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = createContext({ id: 'u1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(roleRepo.findOne).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when request has no user', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles']);
    const context = createContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('No role assigned');
  });

  it('throws ForbiddenException when user has no roleId', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles']);
    const context = createContext({ id: 'u1', roleId: null });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('No role assigned');
  });

  it('throws ForbiddenException when the referenced role is not found', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles']);
    roleRepo.findOne.mockResolvedValue(null);
    const context = createContext({ id: 'u1', roleId: 'role-missing' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('Role not found');
    expect(roleRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'role-missing' },
    });
  });

  it('throws ForbiddenException when role lacks a required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles', 'assign_roles']);
    roleRepo.findOne.mockResolvedValue({
      id: 'role-1',
      name: 'partial',
      permissions: ['manage_roles'],
    } as Role);
    const context = createContext({ id: 'u1', roleId: 'role-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Insufficient permissions',
    );
  });

  it('allows access when role contains all required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles', 'assign_roles']);
    roleRepo.findOne.mockResolvedValue({
      id: 'role-1',
      name: 'role-admin',
      permissions: ['manage_roles', 'assign_roles', 'read_audit'],
    } as Role);
    const context = createContext({ id: 'u1', roleId: 'role-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows access when role has wildcard (*) or admin permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_roles', 'assign_roles']);
    roleRepo.findOne.mockResolvedValueOnce({
      id: 'role-wildcard',
      name: 'superadmin',
      permissions: ['*'],
    } as Role);
    const context = createContext({ id: 'u1', roleId: 'role-wildcard' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    roleRepo.findOne.mockResolvedValueOnce({
      id: 'role-admin',
      name: 'admin',
      permissions: ['admin'],
    } as Role);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows access when role has namespace wildcard permission (e.g. payments:*)', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      'payments:read',
      'payments:refund',
    ]);
    roleRepo.findOne.mockResolvedValue({
      id: 'role-ns',
      name: 'payments-manager',
      permissions: ['payments:*'],
    } as Role);
    const context = createContext({ id: 'u1', roleId: 'role-ns' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
