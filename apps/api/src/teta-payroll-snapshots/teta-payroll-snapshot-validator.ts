/**
 * Stage 3I — snapshot / report validation helpers.
 */
import { detectPayrollParametersReport } from './teta-payroll-report-detector';
import type {
  PayrollReportValidationStatus,
  TetaPayrollSnapshotValidation,
} from './teta-payroll-snapshot.types';

export function validatePayrollReportText(text: string): {
  status: PayrollReportValidationStatus;
  detection: ReturnType<typeof detectPayrollParametersReport>;
} {
  const detection = detectPayrollParametersReport(text);
  return { status: detection.status, detection };
}

export function emptySnapshotValidation(
  overrides: Partial<TetaPayrollSnapshotValidation> = {},
): TetaPayrollSnapshotValidation {
  return {
    ok: true,
    errors: [],
    warnings: [],
    ...overrides,
  };
}
