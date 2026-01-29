import { HttpAdapterHost } from '@nestjs/core';
import { LoggingExceptionFilter } from './logging-exception.filter';
import { AppLogger } from './logger.service';

describe('LoggingExceptionFilter', () => {
  it('logs errors with stack traces', () => {
    const mockPinoLogger = {
      error: jest.fn(),
    };
    const mockAppLogger = {
      child: jest.fn(() => mockPinoLogger),
    } as unknown as AppLogger;

    const httpAdapterHost = { httpAdapter: {} } as HttpAdapterHost;
    const filter = new LoggingExceptionFilter(mockAppLogger, httpAdapterHost);

    const error = new Error('boom');
    const request = {
      method: 'GET',
      originalUrl: '/test',
      requestId: 'req-123',
      user: { id: 'user-1' },
    } as any;
    const response = { locals: {} } as any;

    (filter as any).logException(error, request, response, 500);

    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Unhandled exception',
    );
    const meta = mockPinoLogger.error.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect((meta.err as Error).stack).toBeDefined();
  });
});
