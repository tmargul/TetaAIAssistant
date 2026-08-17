/**
 * Non-interactive smoke session for AIA evaluation harness controls.
 */
import fs from 'fs';
import path from 'path';
import { evaluateQuestion } from '../aia-eval/aia-eval-orchestrator';
import { emptyEvalSafetyCounters } from '../aia-eval/aia-eval.types';

const CONTROLS = [
  {
    id: 'current-position',
    question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
  },
  {
    id: 'surname-prefix',
    question:
      'Podaj imię, nazwisko, numer ewidencyjny i datę urodzenia pracowników, których nazwisko zaczyna się na literę A.',
  },
  {
    id: 'prefix-position',
    question:
      'Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracowników, których nazwisko zaczyna się na literę A.',
  },
  {
    id: 'twg',
    question: 'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.',
  },
  {
    id: 'periods-of-notice',
    question: 'Jakie okresy wypowiedzeń są dostępne w słowniku personelu?',
  },
];

function repoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  loadDotEnv(path.join(root, '.env'));
  process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT = 'true';

  const counters = emptyEvalSafetyCounters();
  const results: Record<string, unknown>[] = [];

  for (const control of CONTROLS) {
    const { trace } = await evaluateQuestion(control.question, {
      repoRoot: root,
      skipGateCheck: true,
      safetyCounters: counters,
    });
    results.push({
      id: control.id,
      question: control.question,
      evaluationState: trace.evaluationState,
      capability: trace.recognizedCapability,
      executor: trace.executor.executorId,
      clarification: trace.clarification,
      userFacingSummary: trace.userFacingAnswer.slice(0, 200),
      stage5TechnicalGapOnly: trace.stage5.technicalGapOnly,
      falseStrongBindings: trace.falseStrongBindings,
    });
    console.log(
      `[${control.id}] ${trace.evaluationState} capability=${trace.recognizedCapability ?? 'none'} executor=${trace.executor.executorId ?? 'none'}`,
    );
  }

  const outDir = path.join(root, '.local', 'aia-eval');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'smoke-session-v1.json'),
    JSON.stringify({ results, safetyCounters: counters }, null, 2),
    'utf8',
  );

  console.log('\nSAFETY COUNTERS:', JSON.stringify(counters));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
