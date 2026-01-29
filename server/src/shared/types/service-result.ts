/**
 * Standardized service result type
 * All services should return this pattern for consistency
 */

export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  error_code?: string;
  metadata?: Record<string, any>;
}

/**
 * Create a successful result
 */
export const successResult = <T>(data?: T, metadata?: Record<string, any>): ServiceResult<T> => ({
  success: true,
  data,
  metadata,
});

/**
 * Create an error result
 */
export const errorResult = <T = void>(
  error: string,
  error_code?: string,
  metadata?: Record<string, any>
): ServiceResult<T> => ({
  success: false,
  error,
  error_code,
  metadata,
});

/**
 * Type guard to check if result is successful
 */
export const isSuccess = <T>(result: ServiceResult<T>): result is ServiceResult<T> & { success: true; data: T } => {
  return result.success === true;
};

/**
 * Type guard to check if result is an error
 */
export const isError = <T>(result: ServiceResult<T>): result is ServiceResult<T> & { success: false; error: string } => {
  return result.success === false;
};

/**
 * Common service result types
 */
export type VoidResult = ServiceResult<void>;
export type BooleanResult = ServiceResult<boolean>;
export type StringResult = ServiceResult<string>;
export type NumberResult = ServiceResult<number>;

/**
 * Paginated result type
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export type PaginatedServiceResult<T> = ServiceResult<PaginatedResult<T>>;
