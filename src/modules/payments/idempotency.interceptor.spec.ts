import { ExecutionContext, CallHandler, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let mockIdempotencyService: {
    checkOrClaimKey: jest.Mock;
    updateResponse: jest.Mock;
    deleteKey: jest.Mock;
  };

  function createMockExecutionContext(headers: Record<string, string> = {}, body: any = {}): ExecutionContext {
    const request = {
      headers,
      body,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(responseOrError: any, isError = false): CallHandler {
    return {
      handle: jest.fn(() => (isError ? throwError(() => responseOrError) : of(responseOrError))),
    };
  }

  beforeEach(() => {
    mockIdempotencyService = {
      checkOrClaimKey: jest.fn(),
      updateResponse: jest.fn().mockResolvedValue(undefined),
      deleteKey: jest.fn().mockResolvedValue(undefined),
    };

    interceptor = new IdempotencyInterceptor(mockIdempotencyService as unknown as IdempotencyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('passes through to handler when idempotency-key header is missing', async () => {
    const context = createMockExecutionContext({}, { amount: 100 });
    const callHandler = createMockCallHandler({ success: true });

    const result$ = await interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(result).toEqual({ success: true });
    expect(callHandler.handle).toHaveBeenCalledTimes(1);
    expect(mockIdempotencyService.checkOrClaimKey).not.toHaveBeenCalled();
    expect(mockIdempotencyService.updateResponse).not.toHaveBeenCalled();
    expect(mockIdempotencyService.deleteKey).not.toHaveBeenCalled();
  });

  it('claims key, executes handler, and updates cached response on first request', async () => {
    const key = 'idem_key_123';
    const body = { amount: 250, currency: 'USD' };
    const handlerResponse = { id: 'pay_999', status: 'SUCCESS' };

    mockIdempotencyService.checkOrClaimKey.mockResolvedValue(null);
    const context = createMockExecutionContext({ 'idempotency-key': key }, body);
    const callHandler = createMockCallHandler(handlerResponse);

    const result$ = await interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(mockIdempotencyService.checkOrClaimKey).toHaveBeenCalledWith(key, body);
    expect(callHandler.handle).toHaveBeenCalledTimes(1);
    expect(mockIdempotencyService.updateResponse).toHaveBeenCalledWith(key, handlerResponse);
    expect(result).toEqual(handlerResponse);
  });

  it('replays cached response directly without executing handler when key exists', async () => {
    const key = 'idem_key_cached';
    const body = { amount: 500, currency: 'EUR' };
    const cachedResponse = { id: 'pay_cached_1', status: 'COMPLETED', cached: true };

    mockIdempotencyService.checkOrClaimKey.mockResolvedValue(cachedResponse);
    const context = createMockExecutionContext({ 'idempotency-key': key }, body);
    const callHandler = createMockCallHandler({ shouldNotBeCalled: true });

    const result$ = await interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(mockIdempotencyService.checkOrClaimKey).toHaveBeenCalledWith(key, body);
    expect(callHandler.handle).not.toHaveBeenCalled();
    expect(mockIdempotencyService.updateResponse).not.toHaveBeenCalled();
    expect(result).toEqual(cachedResponse);
  });

  it('deletes claimed key and propagates error when handler throws an exception', async () => {
    const key = 'idem_key_failed';
    const body = { amount: 100 };
    const error = new Error('Database down');

    mockIdempotencyService.checkOrClaimKey.mockResolvedValue(null);
    const context = createMockExecutionContext({ 'idempotency-key': key }, body);
    const callHandler = createMockCallHandler(error, true);

    const result$ = await interceptor.intercept(context, callHandler);

    await expect(lastValueFrom(result$)).rejects.toThrow('Database down');
    expect(mockIdempotencyService.deleteKey).toHaveBeenCalledWith(key);
    expect(mockIdempotencyService.updateResponse).not.toHaveBeenCalled();
  });

  it('propagates 409 ConflictException when concurrent in-flight request is detected', async () => {
    const key = 'idem_key_in_flight';
    const body = { amount: 300 };

    mockIdempotencyService.checkOrClaimKey.mockRejectedValue(
      new ConflictException('Another request with the same idempotency key is in progress'),
    );
    const context = createMockExecutionContext({ 'idempotency-key': key }, body);
    const callHandler = createMockCallHandler({ shouldNotBeCalled: true });

    await expect(interceptor.intercept(context, callHandler)).rejects.toThrow(ConflictException);
    expect(callHandler.handle).not.toHaveBeenCalled();
  });

  it('propagates 422 UnprocessableEntityException when key is reused with different body', async () => {
    const key = 'idem_key_body_mismatch';
    const body = { amount: 999 };

    mockIdempotencyService.checkOrClaimKey.mockRejectedValue(
      new UnprocessableEntityException('Idempotency key reused with different request body'),
    );
    const context = createMockExecutionContext({ 'idempotency-key': key }, body);
    const callHandler = createMockCallHandler({ shouldNotBeCalled: true });

    await expect(interceptor.intercept(context, callHandler)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(callHandler.handle).not.toHaveBeenCalled();
  });
});
