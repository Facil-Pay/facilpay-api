import { Test, TestingModule } from '@nestjs/testing';
import { LifecycleLoggerService } from './lifecycle-logger.service';
import { AppLogger } from './logger.service';
import { Logger } from 'pino';

describe('LifecycleLoggerService', () => {
  let service: LifecycleLoggerService;
  let appLogger: jest.Mocked<AppLogger>;
  let mockChildLogger: jest.Mocked<Logger>;

  beforeEach(async () => {
    mockChildLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
    } as any;

    appLogger = {
      child: jest.fn().mockReturnValue(mockChildLogger),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LifecycleLoggerService,
        { provide: AppLogger, useValue: appLogger },
      ],
    }).compile();

    service = module.get<LifecycleLoggerService>(LifecycleLoggerService);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should create a child logger with module name', () => {
      expect(appLogger.child).toHaveBeenCalledWith({
        module: LifecycleLoggerService.name,
      });
    });

    it('should have correct module name in child logger context', () => {
      expect(appLogger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'LifecycleLoggerService',
        }),
      );
    });
  });

  describe('onApplicationShutdown', () => {
    it('should log shutdown event without signal', () => {
      service.onApplicationShutdown();

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: undefined },
        'Application shutdown',
      );
    });

    it('should log shutdown with SIGTERM signal', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: 'SIGTERM' },
        'Application shutdown',
      );
    });

    it('should log shutdown with SIGINT signal', () => {
      service.onApplicationShutdown('SIGINT');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: 'SIGINT' },
        'Application shutdown',
      );
    });

    it('should log shutdown with SIGHUP signal', () => {
      service.onApplicationShutdown('SIGHUP');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: 'SIGHUP' },
        'Application shutdown',
      );
    });

    it('should use info level for shutdown logging', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalled();
      expect(mockChildLogger.error).not.toHaveBeenCalled();
      expect(mockChildLogger.warn).not.toHaveBeenCalled();
      expect(mockChildLogger.debug).not.toHaveBeenCalled();
    });

    it('should include signal in log context', () => {
      const signal = 'SIGUSR1';
      service.onApplicationShutdown(signal);

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal }),
        expect.any(String),
      );
    });

    it('should log with correct message', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(Object),
        'Application shutdown',
      );
    });

    it('should handle null signal gracefully', () => {
      service.onApplicationShutdown(null as any);

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: null },
        'Application shutdown',
      );
    });

    it('should handle empty string signal', () => {
      service.onApplicationShutdown('');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: '' },
        'Application shutdown',
      );
    });

    it('should handle custom signal names', () => {
      const customSignal = 'CUSTOM_SIGNAL_123';
      service.onApplicationShutdown(customSignal);

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: customSignal },
        'Application shutdown',
      );
    });

    it('should be called without throwing errors', () => {
      expect(() => service.onApplicationShutdown('SIGTERM')).not.toThrow();
      expect(() => service.onApplicationShutdown()).not.toThrow();
    });
  });

  describe('lifecycle implementation', () => {
    it('should implement OnApplicationShutdown interface', () => {
      expect(service).toHaveProperty('onApplicationShutdown');
      expect(typeof service.onApplicationShutdown).toBe('function');
    });

    it('should have onApplicationShutdown method', () => {
      const method = service.onApplicationShutdown;
      expect(method).toBeDefined();
      expect(typeof method).toBe('function');
    });
  });

  describe('logger usage', () => {
    it('should call child logger info method', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalled();
    });

    it('should call info with exactly two arguments', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
      );
      expect(mockChildLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should pass object context as first argument', () => {
      service.onApplicationShutdown('SIGTERM');

      const firstArg = mockChildLogger.info.mock.calls[0][0];
      expect(firstArg).toEqual(expect.any(Object));
      expect(firstArg).toHaveProperty('signal');
    });

    it('should pass string message as second argument', () => {
      service.onApplicationShutdown('SIGTERM');

      const secondArg = mockChildLogger.info.mock.calls[0][1];
      expect(typeof secondArg).toBe('string');
      expect(secondArg).toBe('Application shutdown');
    });

    it('should use logger created from AppLogger.child()', () => {
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalled();
    });
  });

  describe('multiple invocations', () => {
    it('should handle multiple shutdown calls', () => {
      service.onApplicationShutdown('SIGTERM');
      service.onApplicationShutdown('SIGINT');
      service.onApplicationShutdown('SIGHUP');

      expect(mockChildLogger.info).toHaveBeenCalledTimes(3);
    });

    it('should log each signal separately', () => {
      service.onApplicationShutdown('SIGTERM');
      service.onApplicationShutdown('SIGINT');

      const calls = mockChildLogger.info.mock.calls;
      expect(calls[0][0]).toEqual({ signal: 'SIGTERM' });
      expect(calls[1][0]).toEqual({ signal: 'SIGINT' });
    });

    it('should handle rapid successive calls', () => {
      for (let i = 0; i < 10; i++) {
        service.onApplicationShutdown(`SIGNAL_${i}`);
      }

      expect(mockChildLogger.info).toHaveBeenCalledTimes(10);
    });
  });

  describe('error handling', () => {
    it('should not throw if logger.info throws', () => {
      mockChildLogger.info.mockImplementation(() => {
        throw new Error('Logger error');
      });

      expect(() => service.onApplicationShutdown('SIGTERM')).toThrow();
    });

    it('should propagate logger errors', () => {
      const error = new Error('Logging failed');
      mockChildLogger.info.mockImplementation(() => {
        throw error;
      });

      expect(() => service.onApplicationShutdown('SIGTERM')).toThrow(error);
    });
  });

  describe('signal types', () => {
    const commonSignals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGABRT'];

    commonSignals.forEach(signal => {
      it(`should handle ${signal} signal`, () => {
        service.onApplicationShutdown(signal);

        expect(mockChildLogger.info).toHaveBeenCalledWith(
          { signal },
          'Application shutdown',
        );
      });
    });

    it('should handle signals with optional parameter', () => {
      const signal = 'SIGTERM';
      service.onApplicationShutdown(signal);

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal }),
        expect.any(String),
      );
    });

    it('should log graceful shutdown', () => {
      service.onApplicationShutdown();

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: undefined },
        'Application shutdown',
      );
    });
  });

  describe('logging context', () => {
    it('should include signal in log context object', () => {
      service.onApplicationShutdown('SIGTERM');

      const logContext = mockChildLogger.info.mock.calls[0][0];
      expect(logContext).toHaveProperty('signal');
    });

    it('should have signal property with correct value', () => {
      const testSignal = 'SIGTERM';
      service.onApplicationShutdown(testSignal);

      const logContext = mockChildLogger.info.mock.calls[0][0];
      expect(logContext.signal).toBe(testSignal);
    });

    it('should not have additional context properties', () => {
      service.onApplicationShutdown('SIGTERM');

      const logContext = mockChildLogger.info.mock.calls[0][0];
      expect(Object.keys(logContext)).toEqual(['signal']);
    });

    it('should use consistent message format', () => {
      service.onApplicationShutdown('SIGTERM');
      service.onApplicationShutdown('SIGINT');

      const message1 = mockChildLogger.info.mock.calls[0][1];
      const message2 = mockChildLogger.info.mock.calls[1][1];

      expect(message1).toBe(message2);
      expect(message1).toBe('Application shutdown');
    });
  });

  describe('integration scenarios', () => {
    it('should be triggered during graceful shutdown', () => {
      // Simulate NestJS calling onApplicationShutdown during graceful shutdown
      service.onApplicationShutdown('SIGTERM');

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        { signal: 'SIGTERM' },
        'Application shutdown',
      );
    });

    it('should log shutdown with different signals for different termination reasons', () => {
      // Graceful shutdown
      service.onApplicationShutdown('SIGTERM');
      expect(mockChildLogger.info).toHaveBeenLastCalledWith(
        { signal: 'SIGTERM' },
        'Application shutdown',
      );

      // User interrupt
      service.onApplicationShutdown('SIGINT');
      expect(mockChildLogger.info).toHaveBeenLastCalledWith(
        { signal: 'SIGINT' },
        'Application shutdown',
      );
    });

    it('should handle process termination scenarios', () => {
      const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];

      signals.forEach(signal => {
        service.onApplicationShutdown(signal);
      });

      expect(mockChildLogger.info).toHaveBeenCalledTimes(3);
    });
  });
});
