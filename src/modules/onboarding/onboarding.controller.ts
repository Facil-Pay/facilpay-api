import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { OnboardingService } from './onboarding.service';
import { BusinessInfoDto } from './dto/business-info.dto';
import { DocumentsDto } from './dto/documents.dto';
import { ReviewOnboardingDto } from './dto/review-onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('business-info')
  @ApiOperation({ summary: 'Submit merchant business information' })
  submitBusinessInfo(@CurrentUser() user: User, @Body() dto: BusinessInfoDto) {
    return this.onboardingService.submitBusinessInfo(user.id, dto);
  }

  @Post('documents')
  @ApiOperation({ summary: 'Submit merchant onboarding documents' })
  submitDocuments(@CurrentUser() user: User, @Body() dto: DocumentsDto) {
    return this.onboardingService.submitDocuments(user.id, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get onboarding status' })
  getStatus(@CurrentUser() user: User) {
    return this.onboardingService.getStatus(user.id);
  }

  @Patch(':merchantId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Review merchant onboarding as admin' })
  review(
    @Param('merchantId') merchantId: string,
    @Body() dto: ReviewOnboardingDto,
  ) {
    return this.onboardingService.review(merchantId, dto);
  }
}
