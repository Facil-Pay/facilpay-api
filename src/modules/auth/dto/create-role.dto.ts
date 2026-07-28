import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @IsString()
  @IsOptional()
  description?: string;
}
