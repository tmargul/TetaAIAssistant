import path from 'path';
import { runP1EmployeeCurrentPositionPilot } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position-pipeline';
import {
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
  validateCurrentPositionEmployeeNumber,
} from '../teta-p1-employee-vertical-pilot/teta-p1-current-position.types';

function readEmployeeNumberArg(argv: string[]): string {
  const eq = argv.find((a) => a.startsWith('--employee-number='));
  if (eq) return validateCurrentPositionEmployeeNumber(eq.slice('--employee-number='.length));
  const idx = argv.indexOf('--employee-number');
  if (idx >= 0) {
    const next = argv[idx + 1];
    if (!next || next.startsWith('--')) {
      throw new Error('missing_employee_number_value');
    }
    return validateCurrentPositionEmployeeNumber(next);
  }
  return P1_CURRENT_POSITION_EMPLOYEE_NUMBER;
}

async function main() {
  const root = path.resolve(__dirname, '../../../..');
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase =
    phaseArg?.split('=')[1] === 'a' ? 'a' : phaseArg?.split('=')[1] === 'b' ? 'b' : 'auto';

  if (process.argv.includes('--enable-pilot-gate')) {
    process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT = 'true';
  }

  const employeeNumber = readEmployeeNumberArg(process.argv);

  const result = await runP1EmployeeCurrentPositionPilot(root, {
    phase,
    writeArtifacts: true,
    employeeNumber,
    useFakeExecutor: process.argv.includes('--fake'),
  });

  const safe = { ...result } as Record<string, unknown>;
  if (safe.chatResponse && typeof safe.chatResponse === 'object') {
    const chat = { ...(safe.chatResponse as Record<string, unknown>) };
    if (chat.report && typeof chat.report === 'object') {
      const report = { ...(chat.report as Record<string, unknown>) };
      report.rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
      chat.report = report;
    }
    safe.chatResponse = chat;
  }
  if (safe.compiledSelect && typeof safe.compiledSelect === 'object') {
    const compiled = { ...(safe.compiledSelect as Record<string, unknown>) };
    compiled.sqlText = compiled.sqlText ? '[redacted_in_console_see_local_artifact]' : null;
    safe.compiledSelect = compiled;
  }
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
