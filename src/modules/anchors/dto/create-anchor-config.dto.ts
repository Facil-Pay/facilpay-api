import { IsString, IsNotEmpty, IsArray, ArrayMinSize, IsBoolean, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAnchorConfigDto {
  @ApiProperty({ description: 'Anchor home domain', example: 'testanchor.stellar.org' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  homeDomain: string;

  @ApiProperty({ description: 'Asset codes this anchor supports for SEP-24', example: ['USDC', 'SRT'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9]{1,12}$/, { each: true, message: 'Each asset code must be 1-12 alphanumeric characters' })
  supportedAssets: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
