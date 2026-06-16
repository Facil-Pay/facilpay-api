import { Throttle } from '@nestjs/throttler';

export const AuthThrottle = () => Throttle({ auth: { limit: 5, ttl: 900000 } });

export const LoginThrottle = () => Throttle({ login: { limit: 5, ttl: 60000 } });

export const RegisterThrottle = () => Throttle({ register: { limit: 3, ttl: 600000 } });

export const WebhookThrottle = () => Throttle({ webhook: { limit: 1000, ttl: 60000 } });

export const DefaultThrottle = () => Throttle({ default: { limit: 100, ttl: 60000 } });

export const BulkThrottle = () => Throttle({ bulk: { limit: 20, ttl: 60000 } });
