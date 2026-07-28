import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { TetaPayrollSnapshotsModule } from '../teta-payroll-snapshots/teta-payroll-snapshots.module';
import { TetaPayrollComponentExplanationService } from './teta-payroll-component-explanation.service';
import { TetaPayrollExplanationController } from './teta-payroll-explanation.controller';

@Module({
  imports: [DatabaseModule, forwardRef(() => AuthModule), TetaPayrollSnapshotsModule],
  controllers: [TetaPayrollExplanationController],
  providers: [TetaPayrollComponentExplanationService],
  exports: [TetaPayrollComponentExplanationService],
})
export class TetaPayrollExplanationsModule {}
