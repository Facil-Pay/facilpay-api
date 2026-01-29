import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import {
  ErrorResponse,
  ValidationError,
} from '../interfaces/error-response.interface';

/**
 * Custom exception filter for handling validation errors
 * Provides a standardized error response format for all validation failures
 */
@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();
    const validationErrors = this.formatValidationErrors(exceptionResponse);

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: this.extractMessage(exceptionResponse),
      error: exception.name || 'Bad Request',
      validationErrors:
        validationErrors.length > 0 ? validationErrors : undefined,
    };

    response.status(status).json(errorResponse);
  }

  /**
   * Extract the main error message from the exception response
   */
  private extractMessage(
    exceptionResponse: string | Record<string, any>,
  ): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const { message } = exceptionResponse;

      if (Array.isArray(message)) {
        return message;
      }

      if (typeof message === 'string') {
        return message;
      }

      return 'Validation failed';
    }

    return 'Bad Request';
  }

  /**
   * Format validation errors into a structured format
   */
  private formatValidationErrors(
    exceptionResponse: string | Record<string, any>,
  ): ValidationError[] {
    if (
      typeof exceptionResponse === 'object' &&
      Array.isArray(exceptionResponse.message)
    ) {
      const errorMap = new Map<string, string[]>();

      exceptionResponse.message.forEach((msg: string) => {
        // Parse validation error messages in format "field should not be empty"
        const field = this.extractFieldName(msg);
        const errorMessage = msg;

        if (!errorMap.has(field)) {
          errorMap.set(field, []);
        }
        errorMap.get(field)!.push(errorMessage);
      });

      return Array.from(errorMap.entries()).map(([field, errors]) => ({
        field,
        errors,
      }));
    }

    return [];
  }

  /**
   * Extract field name from validation error message
   */
  private extractFieldName(message: string): string {
    // Try to extract field name from common validation message patterns
    const words = message.split(' ');
    if (words.length > 0) {
      // Usually the first word is the field name
      return words[0];
    }
    return 'unknown';
  }
}
