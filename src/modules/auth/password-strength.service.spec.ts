import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { of, throwError } from 'rxjs';
import { PasswordStrengthService } from './password-strength.service';

describe('PasswordStrengthService', () => {
  const STRONG = 'Str0ng!Passw0rd';

  let httpService: { get: jest.Mock };
  let config: Record<string, string | number>;

  const sha1 = (value: string) =>
    createHash('sha1').update(value).digest('hex').toUpperCase();

  const createService = () =>
    new PasswordStrengthService(
      httpService as any,
      {
        get: jest.fn((key: string, fallback: unknown) =>
          key in config ? config[key] : fallback,
        ),
      } as any,
    );

  const hibpResponse = (lines: string[]) =>
    of({ data: lines.join('\r\n') } as any);

  const getError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as BadRequestException;
    }
    throw new Error('Expected promise to reject');
  };

  beforeEach(() => {
    config = {};
    // Every test talks to this stub; nothing reaches the network.
    httpService = { get: jest.fn().mockReturnValue(hibpResponse([])) };
  });

  describe('strength rules', () => {
    it.each([
      ['Sh0rt!pw', 'Password must be at least 10 characters long'],
      ['NOLOWERCASE1!', 'Password must contain at least one lowercase letter'],
      ['nouppercase1!', 'Password must contain at least one uppercase letter'],
      ['NoDigitsHere!', 'Password must contain at least one number'],
      ['NoSpecials123', 'Password must contain at least one special character'],
    ])('rejects %s', async (password, message) => {
      const error = await getError(createService().validateAndScore(password));

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error.getResponse() as any).message).toEqual([message]);
      expect(httpService.get).not.toHaveBeenCalled();
    });

    it('reports every failed rule at once', async () => {
      const error = await getError(createService().validateAndScore('abc'));

      expect((error.getResponse() as any).message).toEqual([
        'Password must be at least 10 characters long',
        'Password must contain at least one uppercase letter',
        'Password must contain at least one number',
        'Password must contain at least one special character',
      ]);
    });

    it('honours PASSWORD_MIN_LENGTH', async () => {
      config.PASSWORD_MIN_LENGTH = 20;

      const error = await getError(createService().validateAndScore(STRONG));

      expect((error.getResponse() as any).message).toEqual([
        'Password must be at least 20 characters long',
      ]);
    });

    it('accepts a password that meets every rule', async () => {
      await expect(createService().validateAndScore(STRONG)).resolves.toEqual({
        score: expect.any(Number),
        feedback: [],
      });
    });

    it.each([
      ['Abcdefg1!x', 1], // special only
      ['Abcdefg12!xy', 3], // >=12, special, two digits
      ['Abcdefghijk12!xyz', 4], // >=16, >=12, special, two digits
    ])('scores %s as %i', async (password, score) => {
      const result = await createService().validateAndScore(password);
      expect(result.score).toBe(score);
    });
  });

  describe('breach check', () => {
    it('sends only the 5-character SHA-1 prefix with padding enabled', async () => {
      await createService().validateAndScore(STRONG);

      const hash = sha1(STRONG);
      expect(httpService.get).toHaveBeenCalledTimes(1);
      const [url, options] = httpService.get.mock.calls[0];
      expect(url).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
      expect(url).not.toContain(hash.slice(5));
      expect(options).toEqual({
        responseType: 'text',
        headers: { 'Add-Padding': 'true' },
      });
    });

    it('rejects a breached password with the breach count', async () => {
      const suffix = sha1(STRONG).slice(5);
      httpService.get.mockReturnValue(
        hibpResponse([
          '0018A45C4D1DEF81644B54AB7F969B88D65:1',
          `${suffix}:42`,
          '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
        ]),
      );

      await expect(createService().validateAndScore(STRONG)).rejects.toThrow(
        new BadRequestException(
          `This password has appeared in ${(42).toLocaleString()} data breach(es). Please choose a different password.`,
        ),
      );
    });

    it('accepts a password whose suffix is not in the range', async () => {
      httpService.get.mockReturnValue(
        hibpResponse(['0018A45C4D1DEF81644B54AB7F969B88D65:1']),
      );

      await expect(createService().validateAndScore(STRONG)).resolves.toBeDefined();
    });

    it('treats padding entries (count 0) as not breached', async () => {
      const suffix = sha1(STRONG).slice(5);
      httpService.get.mockReturnValue(hibpResponse([`${suffix}:0`]));

      await expect(createService().validateAndScore(STRONG)).resolves.toBeDefined();
    });

    it('fails open when the breach API is unreachable', async () => {
      httpService.get.mockReturnValue(
        throwError(() => Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })),
      );

      await expect(createService().validateAndScore(STRONG)).resolves.toEqual({
        score: expect.any(Number),
        feedback: [],
      });
    });

    it('fails open when the HTTP client throws synchronously', async () => {
      httpService.get.mockImplementation(() => {
        throw new Error('socket hang up');
      });

      await expect(createService().validateAndScore(STRONG)).resolves.toBeDefined();
    });

    it('skips the breach check when HIBP_CHECK_ENABLED is false', async () => {
      config.HIBP_CHECK_ENABLED = 'false';

      await createService().validateAndScore(STRONG);

      expect(httpService.get).not.toHaveBeenCalled();
    });
  });
});
