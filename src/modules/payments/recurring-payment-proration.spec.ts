import { calculateRecurringPaymentProration } from './recurring-payment-proration';

describe('calculateRecurringPaymentProration', () => {
  const periodStart = new Date('2026-01-01T00:00:00.000Z');
  const periodEnd = new Date('2026-01-11T00:00:00.000Z');

  it('uses the full amount difference at the first day of the period', () => {
    expect(
      calculateRecurringPaymentProration(
        20,
        30,
        periodStart,
        periodEnd,
        periodStart,
      ),
    ).toMatchObject({
      unusedFraction: 1,
      adjustmentAmount: 10,
      nextChargeAmount: 40,
    });
  });

  it('uses the remaining period fraction and rounds to cents', () => {
    const preview = calculateRecurringPaymentProration(
      20,
      30,
      periodStart,
      periodEnd,
      new Date('2026-01-04T00:00:00.000Z'),
    );

    expect(preview.unusedFraction).toBe(0.7);
    expect(preview.adjustmentAmount).toBe(7);
    expect(preview.nextChargeAmount).toBe(37);
  });

  it('applies no adjustment at or after the period end', () => {
    for (const asOf of [periodEnd, new Date('2026-01-12T00:00:00.000Z')]) {
      expect(
        calculateRecurringPaymentProration(
          20,
          30,
          periodStart,
          periodEnd,
          asOf,
        ),
      ).toMatchObject({
        unusedFraction: 0,
        adjustmentAmount: 0,
        nextChargeAmount: 30,
      });
    }
  });

  it('returns no adjustment when a current period is unavailable', () => {
    expect(
      calculateRecurringPaymentProration(20, 30, null, null, periodStart),
    ).toMatchObject({
      unusedFraction: 0,
      adjustmentAmount: 0,
      nextChargeAmount: 30,
    });
  });

  it('caps a downgrade adjustment to keep the next payment positive', () => {
    expect(
      calculateRecurringPaymentProration(
        100,
        10,
        periodStart,
        periodEnd,
        periodStart,
      ),
    ).toMatchObject({ adjustmentAmount: -9.99, nextChargeAmount: 0.01 });
  });
});