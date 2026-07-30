import { IsArray, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Matches a plain IPv4, plain IPv6, or CIDR notation for either family
const IP_OR_CIDR_REGEX =
  /^((\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?|([0-9a-fA-F:]+)(\/\d{1,3})?)$/;

export class UpdateIpAllowlistDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(IP_OR_CIDR_REGEX, {
    each: true,
    message: 'Each entry must be a valid IP address or CIDR range (e.g. "1.2.3.4" or "10.0.0.0/8")',
  })
  @ApiProperty({
    description:
      'List of allowed IP addresses or CIDR ranges. An empty array removes all restrictions.',
    example: ['1.2.3.4', '10.0.0.0/8', '2001:db8::/32'],
    type: [String],
  })
  allowedIps: string[];
}
