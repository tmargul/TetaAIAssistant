export class RequestDeadlineExceededError extends Error {
  readonly label: string;
  readonly limitMs: number;
  readonly elapsedMs: number;

  constructor(label: string, limitMs: number, elapsedMs: number) {
    super(
      `Przekroczono limit czasu (${Math.round(limitMs / 1000)} s): ${label} (upłynęło ${Math.round(elapsedMs / 1000)} s).`,
    );
    this.name = 'RequestDeadlineExceededError';
    this.label = label;
    this.limitMs = limitMs;
    this.elapsedMs = elapsedMs;
  }
}

export type RequestDeadline = {
  startedAt: number;
  limitMs: number;
};

export function createRequestDeadline(limitMs: number, startedAt = Date.now()): RequestDeadline {
  return { startedAt, limitMs };
}

export function elapsedMs(deadline: RequestDeadline): number {
  return Date.now() - deadline.startedAt;
}

export function remainingMs(deadline: RequestDeadline): number {
  return Math.max(0, deadline.limitMs - elapsedMs(deadline));
}

export function isDeadlineExceeded(deadline: RequestDeadline): boolean {
  return remainingMs(deadline) <= 0;
}

export function assertWithinDeadline(deadline: RequestDeadline, label: string): void {
  if (!isDeadlineExceeded(deadline)) return;
  throw new RequestDeadlineExceededError(label, deadline.limitMs, elapsedMs(deadline));
}

/** Timeout pojedynczego kroku — nie większy niż pozostały budżet całego żądania. */
export function stepTimeoutMs(deadline: RequestDeadline, stepLimitMs: number): number {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) return 1;
  return Math.max(1, Math.min(stepLimitMs, remaining));
}

export function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return /timeout|aborted|abort/i.test(error.message);
}
