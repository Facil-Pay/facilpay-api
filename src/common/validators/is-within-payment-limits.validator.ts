import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isWithinPaymentLimits', async: false })
export class IsWithinPaymentLimitsConstraint implements ValidatorConstraintInterface {
  validate(amount: number): boolean {
    const min = Number(process.env.PAYMENT_MIN_AMOUNT ?? 0.01);
    const max = Number(process.env.PAYMENT_MAX_AMOUNT ?? Infinity);
    return amount >= min && amount <= max;
  }

  defaultMessage(): string {
    const min = process.env.PAYMENT_MIN_AMOUNT ?? '0.01';
    const max = process.env.PAYMENT_MAX_AMOUNT;
    if (max) {
      return `Amount must be between ${min} and ${max}`;
    }
    return `Amount must be at least ${min}`;
  }
}

export function IsWithinPaymentLimits(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsWithinPaymentLimitsConstraint,
    });
  };
}
