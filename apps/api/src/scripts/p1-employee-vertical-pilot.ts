import path from 'path';
import { runP1EmployeeVerticalPilot } from '../teta-p1-employee-vertical-pilot';

async function main() {
  const root = path.resolve(__dirname, '../../../..');
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase =
    phaseArg?.split('=')[1] === 'a' ? 'a' : phaseArg?.split('=')[1] === 'b' ? 'b' : 'auto';

  // Gate must be explicit in env; CLI can set it for local smoke only when --enable-pilot-gate is passed
  if (process.argv.includes('--enable-pilot-gate')) {
    process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT = 'true';
  }

  const result = await runP1EmployeeVerticalPilot(root, {
    phase,
    writeArtifacts: true,
    useFakeExecutor: process.argv.includes('--fake'),
  });

  const safe = { ...result } as Record<string, unknown>;
  // Never dump full employee rows to console beyond preview
  if (safe.chatResponse && typeof safe.chatResponse === 'object') {
    const chat = { ...(safe.chatResponse as Record<string, unknown>) };
    if (chat.report && typeof chat.report === 'object') {
      const report = { ...(chat.report as Record<string, unknown>) };
      const rows = Array.isArray(report.rows) ? report.rows.slice(0, 10) : [];
      report.rows = rows;
      chat.report = report;
    }
    safe.chatResponse = chat;
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
