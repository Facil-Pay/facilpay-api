import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, IsNotEmpty } from 'class-validator';

export class DocumentsDto {
  @IsUrl()
  @IsNotEmpty()
  @ApiProperty({ example: 'https://cdn.example.com/id.jpg' })
  idDocumentUrl: string;

  @IsUrl()
  @IsNotEmpty()
  @ApiProperty({ example: 'https://cdn.example.com/cert.pdf' })
  businessCertificateUrl: string;
}
