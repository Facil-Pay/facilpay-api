import { BadRequestException } from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  PASSWORD_HISTORY_LIMIT,
  PasswordHistoryService,
} from './password-history.service';
import { PasswordHistory } from './entities/password-history.entity';

describe('PasswordHistoryService', () => {
  const userId = 'user-1';
  // Low cost keeps real bcrypt fast in tests.
  const bcryptHash = (password: string) => hash(password, 4);

  let rows: PasswordHistory[];
  let clock: number;
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let service: PasswordHistoryService;

  const seed = async (...passwords: string[]) => {
    for (const password of passwords) {
      rows.push({
        id: `ph-${rows.length + 1}`,
        userId,
        passwordHash: await bcryptHash(password),
        createdAt: new Date(clock++),
      });
    }
  };

  beforeEach(() => {
    rows = [];
    clock = Date.parse('2026-01-01T00:00:00Z');
    repo = {
      find: jest.fn(async ({ where, order, take }) => {
        const result = rows
          .filter((row) => row.userId === where.userId)
          .sort((a, b) =>
            order?.createdAt === 'DESC'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          );
        return take === undefined ? result : result.slice(0, take);
      }),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (entry) => {
        const saved = {
          id: `ph-${rows.length + 1}`,
          createdAt: new Date(clock++),
          ...entry,
        };
        rows.push(saved);
        return saved;
      }),
      remove: jest.fn(async (entries: PasswordHistory[]) => {
        const ids = new Set(entries.map((e) => e.id));
        rows = rows.filter((row) => !ids.has(row.id));
        return entries;
      }),
    };
    service = new PasswordHistoryService(repo as any);
  });

  describe('validatePasswordNotReused', () => {
    it('allows any password when there is no history', async () => {
      await expect(
        service.validatePasswordNotReused(userId, 'Anything1!'),
      ).resolves.toBeUndefined();
    });

    it('rejects a password that bcrypt-matches a recent entry', async () => {
      await seed('OldPassw0rd!', 'Current1Pass!');

      await expect(
        service.validatePasswordNotReused(userId, 'OldPassw0rd!'),
      ).rejects.toThrow(
        new BadRequestException(
          'You cannot reuse a password from your recent history. Please choose a different password.',
        ),
      );
    });

    it('allows a password that matches no entry', async () => {
      await seed('OldPassw0rd!', 'Current1Pass!');

      await expect(
        service.validatePasswordNotReused(userId, 'Brand-New-1!'),
      ).resolves.toBeUndefined();
    });

    it('is case-sensitive', async () => {
      await seed('OldPassw0rd!');

      await expect(
        service.validatePasswordNotReused(userId, 'oldpassw0rd!'),
      ).resolves.toBeUndefined();
    });

    it('cannot detect reuse from a fresh hash, so callers must pass plain text', async () => {
      await seed('OldPassw0rd!');
      const freshHash = await bcryptHash('OldPassw0rd!');

      // A new salt means the new hash never compares equal to the stored one.
      await expect(
        service.validatePasswordNotReused(userId, freshHash),
      ).resolves.toBeUndefined();
      await expect(
        service.validatePasswordNotReused(userId, 'OldPassw0rd!'),
      ).rejects.toThrow(BadRequestException);
    });

    it(`only checks the last ${PASSWORD_HISTORY_LIMIT} passwords`, async () => {
      await seed('Oldest-Pass1!', 'Pass-2!aaaa', 'Pass-3!aaaa', 'Pass-4!aaaa', 'Pass-5!aaaa', 'Pass-6!aaaa');

      await expect(
        service.validatePasswordNotReused(userId, 'Oldest-Pass1!'),
      ).resolves.toBeUndefined();
      await expect(
        service.validatePasswordNotReused(userId, 'Pass-2!aaaa'),
      ).rejects.toThrow(BadRequestException);

      expect(repo.find).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: PASSWORD_HISTORY_LIMIT,
      });
    });

    it("ignores other users' history", async () => {
      await seed('Shared-Pass1!');
      rows[0].userId = 'someone-else';

      await expect(
        service.validatePasswordNotReused(userId, 'Shared-Pass1!'),
      ).resolves.toBeUndefined();
    });
  });

  describe('recordPasswordChange', () => {
    it('stores the given hash for the user', async () => {
      await service.recordPasswordChange(userId, '$2b$04$storedhash');

      expect(repo.create).toHaveBeenCalledWith({
        userId,
        passwordHash: '$2b$04$storedhash',
      });
      expect(rows).toHaveLength(1);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it(`keeps exactly ${PASSWORD_HISTORY_LIMIT} entries, dropping the oldest`, async () => {
      for (let i = 1; i <= PASSWORD_HISTORY_LIMIT + 2; i++) {
        await service.recordPasswordChange(userId, `hash-${i}`);
      }

      expect(rows).toHaveLength(PASSWORD_HISTORY_LIMIT);
      expect(rows.map((r) => r.passwordHash).sort()).toEqual(
        ['hash-3', 'hash-4', 'hash-5', 'hash-6', 'hash-7'],
      );
    });

    it('does not prune while at or below the limit', async () => {
      for (let i = 1; i <= PASSWORD_HISTORY_LIMIT; i++) {
        await service.recordPasswordChange(userId, `hash-${i}`);
      }

      expect(repo.remove).not.toHaveBeenCalled();
      expect(rows).toHaveLength(PASSWORD_HISTORY_LIMIT);
    });

    it('makes a recorded password unusable on the next change', async () => {
      await service.recordPasswordChange(userId, await bcryptHash('Just-Set-1!'));

      await expect(
        service.validatePasswordNotReused(userId, 'Just-Set-1!'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
