import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RotateSigningKeyDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Hours the outgoing key stays published as `retiring`. Defaults to 72; 0 unpublishes it immediately.',
    minimum: 0,
    maximum: 720,
    default: 72,
    example: 72,
  })
  gracePeriodHours?: number;
}
