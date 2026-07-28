import { IsString, IsNotEmpty } from 'class-validator';

export class RemoveTrustlineDto {
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @IsString()
  @IsNotEmpty()
  assetIssuer: string;
}
