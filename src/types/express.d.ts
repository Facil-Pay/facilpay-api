import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    user?: {
      id?: string | number;
      userId?: string | number;
      sub?: string | number;
      [key: string]: unknown;
    };
  }
}
