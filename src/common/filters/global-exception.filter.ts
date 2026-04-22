import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  ArgumentsHost,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorResponse } from '../interfaces/error-response.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const path = request.url;
    const timestamp = new Date().toISOString();

    let errorResponse: ErrorResponse;

    if (exception instanceof HttpException) {
      errorResponse = this.handleHttpException(
        exception,
        path,
        timestamp,
      );
    } else if (exception instanceof QueryFailedError) {
      errorResponse = this.handleQueryFailedError(
        exception,
        path,
        timestamp,
      );
    } else {
      errorResponse = this.handleUnknownError(
        exception,
        path,
        timestamp,
      );
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private handleHttpException(
    exception: HttpException,
    path: string,
    timestamp: string,
  ): ErrorResponse {
    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = 'An error occurred';
    let error = exception.name;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const responseObj = exceptionResponse as Record<string, any>;
      message =
        responseObj.message ||
        (Array.isArray(responseObj.message)
          ? responseObj.message.join(', ')
          : message);
      error = responseObj.error || error;
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    }

    const errorPayload: ErrorResponse = {
      statusCode,
      message: Array.isArray(message) ? message.join(', ') : message,
      error,
      timestamp,
      path,
    };

    this.logger.warn(
      `HttpException - ${statusCode}: ${errorPayload.message}`,
    );

    return errorPayload;
  }

  private handleQueryFailedError(
    exception: QueryFailedError,
    path: string,
    timestamp: string,
  ): ErrorResponse {
    const statusCode = HttpStatus.BAD_REQUEST;
    const lowerMessage = exception.message.toLowerCase();
    const isDuplicate = lowerMessage.includes('duplicate');
    const isConstraint = lowerMessage.includes('constraint');

    let message = 'Database error occurred';

    if (isDuplicate) {
      message = 'A resource with this value already exists';
    } else if (isConstraint) {
      message = 'Invalid data provided';
    }

    const errorPayload: ErrorResponse = {
      statusCode,
      message,
      error: 'QueryFailedError',
      timestamp,
      path,
    };

    this.logger.error(
      `QueryFailedError - Database operation failed: ${exception.message}`,
      exception.stack,
    );

    return errorPayload;
  }

  private handleUnknownError(
    exception: unknown,
    path: string,
    timestamp: string,
  ): ErrorResponse {
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    const message = 'An unexpected error occurred';
    const error = exception instanceof Error ? exception.name : 'UnknownError';

    const errorPayload: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp,
      path,
    };

    this.logger.error(
      `UnknownError - An unexpected error occurred`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    return errorPayload;
  }
}
