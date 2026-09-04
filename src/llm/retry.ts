import { sleep } from '../util/async';
import { LlmError } from './errors';
import { logger } from '../util/logger';

export interface RetryOptions {
  maxAttempts: number;
  delayMs?: number;
  label: string;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError) return error.retryable;
  const name = (error as { name?: string })?.name ?? '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Retries a failed call after a short pause.
 *
 * TODO: the pause is fixed rather than exponential, and we do not read the
 * Retry-After header a provider sends with a 429 yet.
 */
export async function withRetry<T>(
  options: RetryOptions,
  work: (attempt: number, previousError?: unknown) => Promise<T>,
  onRetry?: (error: unknown, attempt: number) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await work(attempt, lastError);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === options.maxAttempts) throw error;
      logger.debug(`${options.label}: attempt ${attempt} failed (${(error as Error).message}); retrying`);
      onRetry?.(error, attempt);
      await sleep(options.delayMs ?? 1000);
    }
  }
  throw lastError;
}
