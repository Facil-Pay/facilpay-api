import { Throttle } from '@nestjs/throttler';

/**
 * Apply auth throttle limit (5 requests per 15 minutes)
 */
export const AuthThrottle = () => Throttle({ auth: 5 } as any);

/**
 * Apply webhook throttle limit (1000 requests per minute)
 */
export const WebhookThrottle = () => Throttle({ webhook: 1000 } as any);

/**
 * Apply default throttle limit (100 requests per minute)
 */
export const DefaultThrottle = () => Throttle({ default: 100 } as any);
