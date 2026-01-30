import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * UpdateUserDto inherits all validation from CreateUserDto
 * but makes all fields optional using PartialType
 * This ensures consistent validation rules for updates
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
