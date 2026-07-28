import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  @IsNotEmpty()
  roleId: string;
}
