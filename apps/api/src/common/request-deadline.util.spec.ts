import {
  assertWithinDeadline,
  createRequestDeadline,
  isAbortTimeoutError,
  remainingMs,
  RequestDeadlineExceededError,
  stepTimeoutMs,
} from './request-deadline.util';

describe('request-deadline.util', () => {
  it('tracks remaining budget', () => {
    const deadline = createRequestDeadline(10_000, Date.now() - 3_000);
    expect(remainingMs(deadline)).toBeGreaterThan(6_900);
    expect(remainingMs(deadline)).toBeLessThanOrEqual(7_000);
  });

  it('throws when deadline exceeded', () => {
    const deadline = createRequestDeadline(1_000, Date.now() - 2_000);
    expect(() => assertWithinDeadline(deadline, 'agent Oracle')).toThrow(
      RequestDeadlineExceededError,
    );
  });

  it('caps step timeout by remaining budget', () => {
    const deadline = createRequestDeadline(10_000, Date.now() - 8_000);
    expect(stepTimeoutMs(deadline, 90_000)).toBeLessThanOrEqual(2_100);
  });

  it('detects abort timeout errors', () => {
    expect(isAbortTimeoutError(new DOMException('Timeout', 'TimeoutError'))).toBe(true);
    expect(isAbortTimeoutError(new Error('The operation was aborted due to timeout'))).toBe(true);
    expect(isAbortTimeoutError(new Error('something else'))).toBe(false);
  });
});
