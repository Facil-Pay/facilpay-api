import { MiddlewareConsumer } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpLoggerMiddleware } from './modules/logger/http-logger.middleware';

describe('AppModule logging', () => {
  it('registers HttpLoggerMiddleware', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn(() => ({ forRoutes }));
    const consumer = { apply } as unknown as MiddlewareConsumer;

    const module = new AppModule();
    module.configure(consumer);

    expect(apply).toHaveBeenCalledWith(HttpLoggerMiddleware);
    expect(forRoutes).toHaveBeenCalledWith('*');
  });
});
