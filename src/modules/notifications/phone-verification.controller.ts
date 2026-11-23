import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SmsNotificationService } from './sms-notification.service';
import {
  SendVerificationCodeDto,
  VerifyPhoneNumberDto,
} from './dto/phone-verification.dto';

@ApiTags('phone-verification')
@ApiBearerAuth('bearer')
@Controller('v1/phone-verification')
@UseGuards(JwtAuthGuard)
export class PhoneVerificationController {
  constructor(private readonly smsNotificationService: SmsNotificationService) {}

  @Post('send-code')
  @ApiOperation({ summary: 'Send verification code to phone number' })
  async sendVerificationCode(
    @Body() dto: SendVerificationCodeDto,
    @Req() req: any,
  ) {
    await this.smsNotificationService.sendVerificationCode(
      req.user.id,
      dto.phoneNumber,
    );
    return { message: 'Verification code sent' };
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify phone number with code' })
  async verifyPhoneNumber(@Body() dto: VerifyPhoneNumberDto, @Req() req: any) {
    const verified = await this.smsNotificationService.verifyPhoneNumber(
      req.user.id,
      dto.phoneNumber,
      dto.code,
    );
    return { verified };
  }

  @Get('phone-number')
  @ApiOperation({ summary: 'Get verified phone number' })
  async getVerifiedPhoneNumber(@Req() req: any) {
    const phoneNumber = await this.smsNotificationService.getVerifiedPhoneNumber(
      req.user.id,
    );
    return { phoneNumber };
  }

  @Delete('phone-number')
  @ApiOperation({ summary: 'Remove verified phone number' })
  async removePhoneNumber(@Body() dto: SendVerificationCodeDto, @Req() req: any) {
    await this.smsNotificationService.removePhoneNumber(
      req.user.id,
      dto.phoneNumber,
    );
    return { message: 'Phone number removed' };
  }
}
