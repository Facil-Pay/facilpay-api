import { ForbiddenException } from '@nestjs/common';

export class GeoRestrictedException extends ForbiddenException {
  constructor(message = 'Payments from this region are not permitted by the merchant') {
    super({ message, error: 'Forbidden', code: 'geo_restricted' });
  }
}
