import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { Public } from './modules/auth/decorators/public.decorator';
import { CurrentUser } from './modules/auth/decorators/current-user.decorator';
import { User } from './modules/users/user.entity';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'API status',
    description: 'Simple public endpoint to verify the API is running.',
  })
  @ApiOkResponse({
    description: 'API is running.',
    schema: {
      example: 'FacilPay API running',
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the authenticated user as parsed from the JWT access token.',
  })
  @ApiOkResponse({
    description: 'Authenticated user profile.',
    schema: {
      example: {
        message: 'This is a protected route',
        user: {
          id: 'abc123',
          email: 'jane.doe@example.com',
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T10:00:00.000Z',
        },
      },
    },
  })
  getProfile(@CurrentUser() user: User) {
    return {
      message: 'This is a protected route',
      user,
    };
  }
}
