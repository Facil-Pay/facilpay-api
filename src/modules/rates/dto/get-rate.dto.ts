import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetRateDto {
  @IsString()
  @Length(3, 3, { message: 'from must be a 3-letter currency code' })
  @ApiProperty({ description: 'Source currency code', example: 'USD' })
  from: string;

  @IsString()
  @Length(3, 3, { message: 'to must be a 3-letter currency code' })
  @ApiProperty({ description: 'Target currency code', example: 'XLM' })
  to: string;
}
