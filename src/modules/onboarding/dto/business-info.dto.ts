import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class BusinessInfoDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Acme Inc' })
  businessName: string;

  @IsEmail()
  @ApiProperty({ example: 'ops@acme.example' })
  businessEmail: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ example: 'Lagos, Nigeria' })
  businessAddress?: string;
}
