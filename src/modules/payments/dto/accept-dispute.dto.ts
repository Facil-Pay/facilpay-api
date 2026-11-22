import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptDisputeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Resolution notes must not exceed 2000 characters' })
  @ApiPropertyOptional({
    description: 'Optional merchant note explaining why the dispute is conceded',
    example: 'Customer claim is valid - conceding without evidence',
  })
  resolutionNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Resolved by must not exceed 1000 characters' })
  @ApiPropertyOptional({
    description: 'Actor conceding the dispute (merchant user id or email)',
    example: 'merchant@example.com',
  })
  resolvedBy?: string;
}
