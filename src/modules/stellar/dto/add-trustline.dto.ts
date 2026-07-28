import { IsString, IsNotEmpty } from 'class-validator';

export class AddTrustlineDto {
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @IsString()
  @IsNotEmpty()
  assetIssuer: string;
}
