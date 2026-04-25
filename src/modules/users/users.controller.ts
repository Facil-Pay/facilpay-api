import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces';
import { Query } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Creates a new user and returns the user (password is never returned). This endpoint is public.',
  })
  @ApiBody({
    type: CreateUserDto,
    examples: {
      basic: {
        summary: 'Create user with email + password',
        value: { email: 'jane.doe@example.com', password: 'P@ssw0rd!' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'User created successfully.',
    schema: {
      example: {
        id: 'abc123',
        email: 'jane.doe@example.com',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns paginated users (passwords are never returned). Admin only.',
  })
  @ApiOkResponse({
    description: 'Paginated list of users.',
    schema: {
      example: {
        data: [
          {
            id: 'abc123',
            email: 'jane.doe@example.com',
            roles: ['USER'],
            createdAt: '2026-01-26T10:00:00.000Z',
            updatedAt: '2026-01-26T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing/invalid access token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'User does not have ADMIN role.',
    schema: {
      example: {
        statusCode: 403,
        message: 'Forbidden',
      },
    },
  })
  @ApiOperation({ summary: 'List users with pagination and filtering' })
  findAll(@Query() query: PaginationDto): Promise<PaginatedResult<any>> {
    return this.usersService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get a user by id',
    description: 'Returns a single user by their id.',
  })
  @ApiParam({
    name: 'id',
    description: 'User id.',
    example: 'abc123',
  })
  @ApiOkResponse({
    description: 'User found.',
    schema: {
      example: {
        id: 'abc123',
        email: 'jane.doe@example.com',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Updates user fields by id. Only provided fields will be changed. Returns the updated user.',
  })
  @ApiParam({
    name: 'id',
    description: 'User id.',
    example: 'abc123',
  })
  @ApiBody({
    type: UpdateUserDto,
    examples: {
      updateEmail: {
        summary: 'Update email only',
        value: { email: 'jane.new@example.com' },
      },
      updatePassword: {
        summary: 'Update password only',
        value: { password: 'N3wP@ssw0rd!' },
      },
    },
  })
  @ApiOkResponse({
    description: 'User updated successfully.',
    schema: {
      example: {
        id: 'abc123',
        email: 'jane.new@example.com',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T12:00:00.000Z',
      },
    },
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Deletes a user by id. Admin only.',
  })
  @ApiParam({
    name: 'id',
    description: 'User id.',
    example: 'abc123',
  })
  @ApiNoContentResponse({
    description: 'User deleted successfully.',
  })
  @ApiForbiddenResponse({
    description: 'User does not have ADMIN role.',
    schema: {
      example: {
        statusCode: 403,
        message: 'Forbidden',
      },
    },
  })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
