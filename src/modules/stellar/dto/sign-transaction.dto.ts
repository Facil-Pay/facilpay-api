import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SignTransactionDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'The base64-encoded signature for the transaction.',
    example: 'yG/5G2X4...',
  })
  signature: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'The public key of the signer.',
    example: 'GAX3...',
  })
  publicKey: string;
}
