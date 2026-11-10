import { fromUnits, toUnits } from './payout-amount.util';

describe('payout-amount.util', () => {
  describe('toUnits', () => {
    it('returns 0n for null, undefined, or empty string', () => {
      expect(toUnits(null)).toBe(0n);
      expect(toUnits(undefined)).toBe(0n);
      expect(toUnits('')).toBe(0n);
    });

    it('converts whole and decimal strings into 7-decimal stroop units', () => {
      expect(toUnits('0')).toBe(0n);
      expect(toUnits('1')).toBe(10_000_000n);
      expect(toUnits('12.3456789')).toBe(123_456_789n);
      expect(toUnits(25.5)).toBe(255_000_000n);
      expect(toUnits('.5')).toBe(5_000_000n);
    });

    it('supports negative amounts', () => {
      expect(toUnits('-1')).toBe(-10_000_000n);
      expect(toUnits('-0.0000001')).toBe(-1n);
    });

    it('allows trailing zeros beyond 7 decimal places', () => {
      expect(toUnits('1.1234567000')).toBe(11_234_567n);
    });

    it('throws when non-zero digits appear beyond 7 decimal places', () => {
      expect(() => toUnits('1.12345678')).toThrow(
        'Amount has more than 7 decimal places: 1.12345678',
      );
    });

    it('throws on malformed decimal strings', () => {
      expect(() => toUnits('abc')).toThrow('Invalid decimal amount: abc');
      expect(() => toUnits('12.3.4')).toThrow('Invalid decimal amount: 12.3.4');
    });
  });

  describe('fromUnits', () => {
    it('formats stroop units as fixed 7-decimal strings', () => {
      expect(fromUnits(0n)).toBe('0.0000000');
      expect(fromUnits(10_000_000n)).toBe('1.0000000');
      expect(fromUnits(123_456_789n)).toBe('12.3456789');
      expect(fromUnits(1n)).toBe('0.0000001');
    });

    it('formats negative stroop units accurately', () => {
      expect(fromUnits(-10_000_000n)).toBe('-1.0000000');
      expect(fromUnits(-1n)).toBe('-0.0000001');
    });

    it('round-trips arbitrary valid amounts losslessly', () => {
      for (const sample of ['0.0000001', '42.1250000', '999999.9999999', '-3.5000000']) {
        expect(fromUnits(toUnits(sample))).toBe(sample);
      }
    });
  });
});
