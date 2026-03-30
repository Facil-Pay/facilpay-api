import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  describe('HttpException handling', () => {
    it('should handle BadRequestException with proper format', () => {
      const mockRequest = {
        url: '/test',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new BadRequestException('Name is required');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: expect.any(String),
          error: expect.any(String),
          timestamp: expect.any(String),
          path: '/test',
        }),
      );
    });

    it('should handle UnauthorizedException with 401 status', () => {
      const mockRequest = {
        url: '/protected',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new UnauthorizedException('Invalid credentials');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNAUTHORIZED,
          error: expect.any(String),
          timestamp: expect.any(String),
          path: '/protected',
        }),
      );
    });

    it('should handle ConflictException with 409 status', () => {
      const mockRequest = {
        url: '/api/users',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new ConflictException('Email already exists');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          error: expect.any(String),
          path: '/api/users',
        }),
      );
    });

    it('should handle validation errors array format', () => {
      const mockRequest = {
        url: '/api/data',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const validationErrors = ['name must not be empty', 'email must be valid'];
      const exception = new BadRequestException({
        message: validationErrors,
        error: 'Bad Request',
      });

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.message).toContain('name must not be empty');
      expect(jsonCall.message).toContain('email must be valid');
    });
  });

  describe('QueryFailedError handling', () => {
    it('should handle duplicate key error safely', () => {
      const mockRequest = {
        url: '/api/users',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const queryError = new QueryFailedError(
        'SELECT * FROM users WHERE email = ?',
        ['test@email.com'],
        new Error('Duplicate entry for key email_unique'),
      );

      filter.catch(queryError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.error).toBe('QueryFailedError');
      expect(jsonCall.message).toBe('A resource with this value already exists');
      expect(jsonCall.statusCode).toBe(HttpStatus.BAD_REQUEST);
      // Ensure raw SQL is NOT exposed
      expect(jsonCall.message).not.toContain('SELECT');
    });

    it('should handle constraint error safely', () => {
      const mockRequest = {
        url: '/api/data',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const queryError = new QueryFailedError(
        'UPDATE users SET email = ? WHERE id = ?',
        ['newemail@email.com', '1'],
        new Error('Foreign key constraint failed'),
      );

      filter.catch(queryError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.message).toBe('Invalid data provided');
      // Ensure raw SQL is NOT exposed
      expect(jsonCall.message).not.toContain('UPDATE');
    });

    it('should not expose raw SQL queries in error messages', () => {
      const mockRequest = {
        url: '/api/data',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const queryError = new QueryFailedError(
        'DELETE FROM users WHERE id = ? AND age > ?',
        ['5', '18'],
        new Error('Syntax error in query'),
      );

      filter.catch(queryError, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.message).not.toContain('DELETE');
      expect(jsonCall.message).not.toContain('query');
    });
  });

  describe('Unknown error handling', () => {
    it('should handle unknown errors with 500 status', () => {
      const mockRequest = {
        url: '/api/unknown',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const error = new Error('Something went wrong');

      filter.catch(error, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(jsonCall.message).toBe('An unexpected error occurred');
      expect(jsonCall.error).toBe('Error');
    });

    it('should return generic message for unexpected errors', () => {
      const mockRequest = {
        url: '/api/error',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const error = new Error('Internal database connection lost');

      filter.catch(error, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.message).toBe('An unexpected error occurred');
      // Ensure internal error details are NOT exposed
      expect(jsonCall.message).not.toContain('database');
      expect(jsonCall.message).not.toContain('connection');
    });

    it('should handle non-Error objects thrown as errors', () => {
      const mockRequest = {
        url: '/api/error',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      filter.catch('String error', mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(jsonCall.message).toBe('An unexpected error occurred');
    });
  });

  describe('Error response format validation', () => {
    it('should include all required fields in response', () => {
      const mockRequest = {
        url: '/api/test',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new BadRequestException('Test error');

      filter.catch(exception, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall).toHaveProperty('statusCode');
      expect(jsonCall).toHaveProperty('message');
      expect(jsonCall).toHaveProperty('error');
      expect(jsonCall).toHaveProperty('timestamp');
      expect(jsonCall).toHaveProperty('path');
    });

    it('should include valid ISO timestamp', () => {
      const mockRequest = {
        url: '/api/test',
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new BadRequestException('Test error');

      filter.catch(exception, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      const timestamp = new Date(jsonCall.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it('should match requested path in response', () => {
      const testPath = '/api/users/123';
      const mockRequest = {
        url: testPath,
      } as Request;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      const mockArgumentsHost = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as any;

      const exception = new BadRequestException('Test error');

      filter.catch(exception, mockArgumentsHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall.path).toBe(testPath);
    });
  });
});
