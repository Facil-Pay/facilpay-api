/**
 * Standard error response interface for all API errors
 */
export interface ErrorResponse {
  /**
   * HTTP status code
   */
  statusCode: number;

  /**
   * Timestamp when the error occurred
   */
  timestamp: string;

  /**
   * API path where the error occurred
   */
  path: string;

  /**
   * Error message or array of validation error messages
   */
  message: string | string[];

  /**
   * Error type/name
   */
  error: string;

  /**
   * Optional validation errors for detailed field-level errors
   */
  validationErrors?: ValidationError[];
}

/**
 * Detailed validation error for a specific field
 */
export interface ValidationError {
  /**
   * Field name that failed validation
   */
  field: string;

  /**
   * Validation error messages for this field
   */
  errors: string[];
}
