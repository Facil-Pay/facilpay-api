import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { PaymentStatus } from '../payment.entity';

export class PaymentWebhookDto {
    @IsString()
    @IsNotEmpty()
    paymentId: string;

    @IsEnum(PaymentStatus)
    @IsNotEmpty()
    status: PaymentStatus;

    @IsString()
    @IsOptional()
    externalReference?: string;
}
