import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomerNoteDto {
  @ApiProperty({
    description: 'Note content',
    example: 'Customer requested refund due to service issue',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
