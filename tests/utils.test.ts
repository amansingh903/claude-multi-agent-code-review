import { describe, it, expect, vi } from 'vitest';
import { withRetry, withTimeout, ReviewError, ErrorCodes, formatError } from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, 2, 1)).rejects.toMatchObject({ code: ErrorCodes.RETRY_EXHAUSTED });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff between attempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const promise = withRetry(fn, 3, 1000).catch(e => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100); // 1000ms * 2^0 + jitter
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500); // not yet 2000ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600); // 2000ms * 2^1 + jitter reached
    expect(fn).toHaveBeenCalledTimes(3);
    const error = await promise;
    expect(error).toBeInstanceOf(ReviewError);
    vi.useRealTimers();
  });
});

describe('withTimeout', () => {
  it('resolves when the function finishes in time', async () => {
    await expect(withTimeout(async () => 'fast', 100)).resolves.toBe('fast');
  });

  it('rejects with AGENT_TIMEOUT when the function is too slow', async () => {
    const slow = () => new Promise(resolve => setTimeout(() => resolve('late'), 200));
    await expect(withTimeout(slow, 20, 'too slow')).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      message: 'too slow',
      metadata: { timeoutMs: 20 }
    });
  });
});

describe('formatError', () => {
  it('formats ReviewError with its code', () => {
    expect(formatError(new ReviewError('bad', ErrorCodes.PR_NOT_FOUND))).toBe('[PR_NOT_FOUND] bad');
  });
});

describe('RateLimiter', () => {
  it('allows requests within limits', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 5, maxTokensPerMinute: 10_000, maxConcurrent: 2 });
    expect(limiter.canProceed(1000)).toBe(true);
    await limiter.acquire(1000);
    expect(limiter.getStatus().requestsInWindow).toBe(1);
    expect(limiter.getStatus().tokensInWindow).toBe(1000);
    limiter.release();
  });

  it('blocks when the token budget would be exceeded', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 50, maxTokensPerMinute: 2000, maxConcurrent: 5 });
    await limiter.acquire(1500);
    limiter.release();
    expect(limiter.canProceed(1000)).toBe(false);
    expect(limiter.canProceed(500)).toBe(true);
  });

  it('blocks when requests per minute are exhausted', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    await limiter.acquire(10); limiter.release();
    await limiter.acquire(10); limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
  });

  it('respects maxConcurrent and wakes the next waiter on release', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 50, maxTokensPerMinute: 100_000, maxConcurrent: 1 });
    await limiter.acquire(10);
    let secondAcquired = false;
    const second = limiter.acquire(10).then(() => { secondAcquired = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(secondAcquired).toBe(false);
    limiter.release();
    await second;
    expect(secondAcquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  it('prunes records older than 60 seconds (sliding window)', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 100_000, maxConcurrent: 5 });
    await limiter.acquire(10); limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.canProceed(10)).toBe(true);
    expect(limiter.getStatus().requestsInWindow).toBe(0);
    vi.useRealTimers();
  });
});
