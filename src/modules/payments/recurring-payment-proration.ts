export interface RecurringPaymentProrationPreview {
  currentAmount: number;
  newAmount: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  unusedFraction: number;
  adjustmentAmount: number;
  nextChargeAmount: number;
}

export function calculateRecurringPaymentProration(
  currentAmount: number,
  newAmount: number,
  periodStart: Date | null,
  periodEnd: Date | null,
  asOf = new Date(),
): RecurringPaymentProrationPreview {
  const periodDuration =
    periodStart && periodEnd
      ? periodEnd.getTime() - periodStart.getTime()
      : 0;
  const unusedFraction =
    periodDuration > 0 && periodEnd
      ? Math.max(
          0,
          Math.min(1, (periodEnd.getTime() - asOf.getTime()) / periodDuration),
        )
      : 0;
  const rawAdjustment = Number(
    ((newAmount - currentAmount) * unusedFraction).toFixed(2),
  );
  const adjustmentAmount = Math.max(rawAdjustment, 0.01 - newAmount);

  return {
    currentAmount,
    newAmount,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    unusedFraction,
    adjustmentAmount: Number(adjustmentAmount.toFixed(2)),
    nextChargeAmount: Number((newAmount + adjustmentAmount).toFixed(2)),
  };
}