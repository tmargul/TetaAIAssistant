import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OracleModule } from '../oracle/oracle.module';
import { TetaCanonicalReportOrchestratorService } from './teta-canonical-report-orchestrator.service';
import { TetaReportDownloadCleanupService } from './teta-report-download-cleanup.service';
import { TetaReportDownloadController } from './teta-report-download.controller';
import { TetaReportDownloadRegistryService } from './teta-report-download-registry.service';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => OracleModule)],
  controllers: [TetaReportDownloadController],
  providers: [
    TetaReportDownloadRegistryService,
    TetaReportDownloadCleanupService,
    TetaCanonicalReportOrchestratorService,
  ],
  exports: [
    TetaCanonicalReportOrchestratorService,
    TetaReportDownloadRegistryService,
  ],
})
export class TetaChatReportsModule {}
