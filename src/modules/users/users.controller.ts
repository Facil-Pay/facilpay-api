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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
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

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List users',
    description: 'Returns all users (passwords are never returned).',
  })
  @ApiOkResponse({
    description: 'List of users.',
    schema: {
      example: [
        {
          id: 'abc123',
          email: 'jane.doe@example.com',
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T10:00:00.000Z',
        },
      ],
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
  findAll() {
    return this.usersService.findAll();
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

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Deletes a user by id.',
  })
  @ApiParam({
    name: 'id',
    description: 'User id.',
    example: 'abc123',
  })
  @ApiNoContentResponse({
    description: 'User deleted successfully.',
  })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
