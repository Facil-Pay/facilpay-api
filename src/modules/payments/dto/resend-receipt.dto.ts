import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional } from 'class-validator';

export class ResendReceiptDto {
  @ApiPropertyOptional({
    description: 'Optional email address override to send the receipt to instead of the payment payerEmail',
    example: 'customer@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
