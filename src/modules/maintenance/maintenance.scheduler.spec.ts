import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceScheduler } from './maintenance.scheduler';
import { MaintenanceService } from './maintenance.service';
import { AppLogger } from '../logger/logger.service';

describe('MaintenanceScheduler', () => {
  let scheduler: MaintenanceScheduler;
  let maintenanceService: jest.Mocked<MaintenanceService>;
  let appLogger: jest.Mocked<AppLogger>;
  let mockLogger: any;

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    maintenanceService = {
      purgeOldData: jest.fn(),
    } as any;

    appLogger = {
      child: jest.fn().mockReturnValue(mockLogger),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceScheduler,
        { provide: MaintenanceService, useValue: maintenanceService },
        { provide: AppLogger, useValue: appLogger },
      ],
    }).compile();

    scheduler = module.get<MaintenanceScheduler>(MaintenanceScheduler);
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(scheduler).toBeDefined();
    });

    it('should inject MaintenanceService', () => {
      expect(scheduler).toHaveProperty('maintenanceService');
    });

    it('should inject AppLogger', () => {
      expect(scheduler).toHaveProperty('appLogger');
    });
  });

  describe('handleDataRetention', () => {
    it('should call maintenanceService.purgeOldData', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(maintenanceService.purgeOldData).toHaveBeenCalledTimes(1);
      expect(maintenanceService.purgeOldData).toHaveBeenCalledWith();
    });

    it('should log start of data retention job', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(appLogger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'MaintenanceScheduler',
          task: 'dataRetention',
        }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Starting scheduled data retention job');
    });

    it('should successfully complete when purgeOldData succeeds', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await expect(scheduler.handleDataRetention()).resolves.not.toThrow();

      expect(maintenanceService.purgeOldData).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle errors from purgeOldData gracefully', async () => {
      const testError = new Error('Database purge failed');
      maintenanceService.purgeOldData.mockRejectedValue(testError);

      await expect(scheduler.handleDataRetention()).resolves.not.toThrow();

      expect(maintenanceService.purgeOldData).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: testError }),
        'Scheduled data retention job failed',
      );
    });

    it('should log errors without throwing', async () => {
      const testError = new Error('Connection timeout');
      maintenanceService.purgeOldData.mockRejectedValue(testError);

      const result = await scheduler.handleDataRetention();

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle database connection errors', async () => {
      const connectionError = new Error('ECONNREFUSED');
      maintenanceService.purgeOldData.mockRejectedValue(connectionError);

      await scheduler.handleDataRetention();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: connectionError }),
        expect.stringContaining('failed'),
      );
    });

    it('should handle query timeout errors', async () => {
      const timeoutError = new Error('Query execution timeout');
      maintenanceService.purgeOldData.mockRejectedValue(timeoutError);

      await scheduler.handleDataRetention();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: timeoutError }),
        expect.stringContaining('failed'),
      );
    });

    it('should create child logger with correct context', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(appLogger.child).toHaveBeenCalledWith({
        module: 'MaintenanceScheduler',
        task: 'dataRetention',
      });
    });

    it('should log before calling purgeOldData', async () => {
      maintenanceService.purgeOldData.mockImplementation(async () => {
        expect(mockLogger.info).toHaveBeenCalled();
      });

      await scheduler.handleDataRetention();

      expect(mockLogger.info).toHaveBeenCalledBefore(maintenanceService.purgeOldData as any);
    });

    it('should pass error context to logger on failure', async () => {
      const error = new Error('Purge operation failed');
      maintenanceService.purgeOldData.mockRejectedValue(error);

      await scheduler.handleDataRetention();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error }),
        expect.any(String),
      );
    });
  });

  describe('cron configuration', () => {
    it('should have handleDataRetention method', () => {
      expect(scheduler.handleDataRetention).toBeDefined();
      expect(typeof scheduler.handleDataRetention).toBe('function');
    });

    it('should be async function', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);
      const result = scheduler.handleDataRetention();

      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });

  describe('edge cases', () => {
    it('should handle undefined errors', async () => {
      maintenanceService.purgeOldData.mockRejectedValue(undefined);

      await expect(scheduler.handleDataRetention()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle errors with no message', async () => {
      const error = { name: 'CustomError' };
      maintenanceService.purgeOldData.mockRejectedValue(error);

      await expect(scheduler.handleDataRetention()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle very long running purge operations', async () => {
      maintenanceService.purgeOldData.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 5000)),
      );

      const startTime = Date.now();
      await scheduler.handleDataRetention();
      const duration = Date.now() - startTime;

      expect(maintenanceService.purgeOldData).toHaveBeenCalled();
      expect(duration).toBeGreaterThanOrEqual(5000);
    });

    it('should handle multiple concurrent invocations', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      const promises = [
        scheduler.handleDataRetention(),
        scheduler.handleDataRetention(),
        scheduler.handleDataRetention(),
      ];

      await Promise.all(promises);

      expect(maintenanceService.purgeOldData).toHaveBeenCalledTimes(3);
    });
  });

  describe('logging behavior', () => {
    it('should log with module and task context on start', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(appLogger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'MaintenanceScheduler',
          task: 'dataRetention',
        }),
      );
    });

    it('should log start message', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting scheduled data retention job',
      );
    });

    it('should log error message on failure', async () => {
      const error = new Error('Test error');
      maintenanceService.purgeOldData.mockRejectedValue(error);

      await scheduler.handleDataRetention();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(Object),
        'Scheduled data retention job failed',
      );
    });

    it('should not call error logger on success', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should always create child logger', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(appLogger.child).toHaveBeenCalled();
    });
  });

  describe('service interaction', () => {
    it('should call purgeOldData exactly once per invocation', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(maintenanceService.purgeOldData).toHaveBeenCalledTimes(1);
    });

    it('should pass no arguments to purgeOldData', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      expect(maintenanceService.purgeOldData).toHaveBeenCalledWith();
    });

    it('should not modify purgeOldData calls with additional parameters', async () => {
      maintenanceService.purgeOldData.mockResolvedValue(undefined);

      await scheduler.handleDataRetention();

      const calls = maintenanceService.purgeOldData.mock.calls;
      expect(calls[0]).toHaveLength(0);
    });

    it('should await purgeOldData completion before returning', async () => {
      let purgeCompleted = false;
      maintenanceService.purgeOldData.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        purgeCompleted = true;
      });

      await scheduler.handleDataRetention();

      expect(purgeCompleted).toBe(true);
    });
  });
});
