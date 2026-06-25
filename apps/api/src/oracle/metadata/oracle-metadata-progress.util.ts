export type CatalogProgressCallback = (progress: number, message: string) => void;

export class ProgressHeartbeat {
  private timer: ReturnType<typeof setInterval> | undefined;
  private startedAt = Date.now();

  start(
    report: (message: string) => void,
    baseMessage: string,
    intervalMs = 2000,
  ): void {
    this.startedAt = Date.now();
    this.stop();
    const tick = () => {
      const sec = Math.floor((Date.now() - this.startedAt) / 1000);
      report(`${baseMessage} (${sec} s)`);
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async run<T>(baseMessage: string, report: (message: string) => void, fn: () => Promise<T>): Promise<T> {
    this.start(report, baseMessage);
    try {
      return await fn();
    } finally {
      this.stop();
    }
  }
}

export function mapCatalogProgress(catalogPercent: number): number {
  return Math.max(5, Math.min(55, Math.round(catalogPercent)));
}

export function mapGraphProgress(graphPercent: number): number {
  return 55 + Math.round((Math.max(0, Math.min(100, graphPercent)) / 100) * 30);
}
