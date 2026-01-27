import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    description: 'New email address for the user.',
    example: 'jane.new@example.com',
  })
  email?: string;

  @ApiPropertyOptional({
    description: 'New password for the user (minimum 6 characters).',
    example: 'N3wP@ssw0rd!',
    minLength: 6,
  })
  password?: string;
}
