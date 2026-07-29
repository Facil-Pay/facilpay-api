import { ForbiddenException } from '@nestjs/common';

export class IpAllowlistBlockedException extends ForbiddenException {
  constructor(ip: string) {
    super({
      message: `Access denied: IP address ${ip} is not in the merchant's allowlist`,
      error: 'Forbidden',
      code: 'ip_not_allowed',
    });
  }
}
