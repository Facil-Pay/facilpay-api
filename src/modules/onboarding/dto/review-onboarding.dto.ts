import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OnboardingStatus } from '../merchant-onboarding.entity';

export class ReviewOnboardingDto {
  @IsEnum(OnboardingStatus)
  @ApiPropertyOptional({
    enum: OnboardingStatus,
    example: OnboardingStatus.APPROVED,
  })
  status: OnboardingStatus;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Incomplete documents' })
  rejectionReason?: string;
}
