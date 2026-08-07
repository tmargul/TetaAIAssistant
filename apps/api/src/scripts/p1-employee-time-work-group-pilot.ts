import path from 'path';
import { runP1EmployeeTimeWorkGroupPilot } from '../teta-p1-employee-vertical-pilot/teta-p1-time-work-group-pipeline';
import {
  P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
  validateTimeWorkGroupEmployeeNumber,
} from '../teta-p1-employee-vertical-pilot/teta-p1-time-work-group.types';

function readEmployeeNumberArg(argv: string[]): string {
  const eq = argv.find((a) => a.startsWith('--employee-number='));
  if (eq) return validateTimeWorkGroupEmployeeNumber(eq.slice('--employee-number='.length));
  const idx = argv.indexOf('--employee-number');
  if (idx >= 0) {
    const next = argv[idx + 1];
    if (!next || next.startsWith('--')) throw new Error('missing_employee_number_value');
    return validateTimeWorkGroupEmployeeNumber(next);
  }
  return P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER;
}

async function main() {
  const root = path.resolve(__dirname, '../../../..');
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase =
    phaseArg?.split('=')[1] === 'a' ? 'a' : phaseArg?.split('=')[1] === 'b' ? 'b' : 'auto';

  if (process.argv.includes('--enable-pilot-gate')) {
    process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT = 'true';
  }

  const result = await runP1EmployeeTimeWorkGroupPilot(root, {
    phase,
    writeArtifacts: true,
    employeeNumber: readEmployeeNumberArg(process.argv),
  });

  const safe = { ...result } as Record<string, unknown>;
  console.log(JSON.stringify(safe, null, 2));
  if (
    process.argv.includes('--strict') &&
    Array.isArray(result.strictErrors) &&
    result.strictErrors.length
  ) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
