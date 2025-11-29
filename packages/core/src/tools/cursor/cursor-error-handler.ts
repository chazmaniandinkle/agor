/**
 * Error Handler
 *
 * Provides retry logic and error classification for Cursor CLI operations.
 */

export class CursorErrorHandler {
  /**
   * Execute cursor-agent command with automatic retry on transient errors
   */
  static async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      onRetry?: (attempt: number, error: Error) => void;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelay = options.retryDelay ?? 1000;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error is retryable
        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        if (attempt < maxRetries) {
          console.warn(
            `[CursorErrorHandler] Attempt ${attempt} failed, retrying in ${retryDelay}ms:`,
            lastError.message
          );

          options.onRetry?.(attempt, lastError);

          await this.sleep(retryDelay);
        }
      }
    }

    throw new Error(
      `Failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Determine if error is transient and retryable
   */
  private static isRetryable(error: Error): boolean {
    const retryablePatterns = [
      /ECONNRESET/,
      /ECONNREFUSED/,
      /ETIMEDOUT/,
      /EPIPE/,
      /rate limit/i,
      /temporary/i,
      /busy/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error.message));
  }

  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse Cursor CLI error output from stderr
   */
  static parseErrorOutput(stderr: string): {
    message: string;
    code?: string;
    isAuthError: boolean;
    isNetworkError: boolean;
  } {
    const isAuthError = /auth|api.?key|unauthorized/i.test(stderr);
    const isNetworkError = /network|connection|timeout/i.test(stderr);

    // Extract error code if present (e.g., "Error: ERR_INVALID_API_KEY")
    const codeMatch = stderr.match(/Error:\s+([A-Z_]+)/);
    const code = codeMatch?.[1];

    return {
      message: stderr.trim(),
      code,
      isAuthError,
      isNetworkError,
    };
  }
}
