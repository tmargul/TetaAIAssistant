export type DoctorCheckStatus = 'ok' | 'warning' | 'error' | 'skipped';

export type DoctorOverallStatus = 'ok' | 'warning' | 'error';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorReport {
  checkedAt: string;
  overall: DoctorOverallStatus;
  checks: DoctorCheck[];
  repairAvailable: boolean;
}

export interface DoctorRepairResult {
  success: boolean;
  actions: string[];
  message: string;
}
