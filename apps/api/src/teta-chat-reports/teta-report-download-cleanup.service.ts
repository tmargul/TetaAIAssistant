import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';

/**
 * Thin Nest lifecycle wrapper — registry already runs an unref'd timer;
 * this ensures shutdown cleanup is invoked from the module.
 */
@Injectable()
export class TetaReportDownloadCleanupService implements OnModuleDestroy {
  constructor(private readonly registry: TetaReportDownloadRegistryService) {}

  onModuleDestroy(): void {
    this.registry.shutdown();
  }

  cleanupNow(): number {
    return this.registry.cleanupExpired();
  }
}
