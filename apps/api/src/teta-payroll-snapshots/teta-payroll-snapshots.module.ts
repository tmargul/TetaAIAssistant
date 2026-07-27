import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { TetaPayrollSnapshotController } from './teta-payroll-snapshot.controller';
import { TetaPayrollSnapshotImportService } from './teta-payroll-snapshot-import.service';
import { TetaPayrollSnapshotQueryService } from './teta-payroll-snapshot-query.service';
import { TetaPayrollSnapshotRepository } from './teta-payroll-snapshot-repository';

@Module({
  imports: [DatabaseModule, forwardRef(() => AuthModule)],
  controllers: [TetaPayrollSnapshotController],
  providers: [
    TetaPayrollSnapshotRepository,
    TetaPayrollSnapshotImportService,
    TetaPayrollSnapshotQueryService,
  ],
  exports: [
    TetaPayrollSnapshotImportService,
    TetaPayrollSnapshotQueryService,
    TetaPayrollSnapshotRepository,
  ],
})
export class TetaPayrollSnapshotsModule {}
