#!/usr/bin/env ts-node
/**
 * Interactive AIA evaluation harness — LOCAL evaluation surface only.
 * Does NOT modify production Stages 0–5 resolver logic.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  evaluateQuestion,
  getCapabilitiesHelpText,
  getHelpText,
  type PendingClarification,
} from '../aia-eval/aia-eval-orchestrator';
import { formatTraceSummary } from '../aia-eval/aia-eval-render';
import { appendInteraction, attachVerdict, createSession } from '../aia-eval/aia-eval-session';
import { emptyEvalSafetyCounters } from '../aia-eval/aia-eval.types';

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

  if (!process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT) {
    process.env.TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT = 'true';
  }

  const session = createSession(root);
  const counters = emptyEvalSafetyCounters();
  let traceOn = false;
  let lastTrace: Awaited<ReturnType<typeof evaluateQuestion>>['trace'] | null = null;
  let pending: PendingClarification | null = null;

  console.log('AIA Interactive Evaluation Harness');
  console.log(`Sesja: ${session.sessionId}`);
  console.log('Wpisz :help po komendy.\n');
  process.stdout.write('AIA> ');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      process.stdout.write('AIA> ');
      return;
    }

    if (input.startsWith(':')) {
      const [cmd, ...rest] = input.slice(1).split(/\s+/);
      const arg = rest.join(' ').trim();
      switch (cmd.toLowerCase()) {
        case 'help':
          console.log(getHelpText());
          break;
        case 'capabilities':
          console.log(getCapabilitiesHelpText());
          break;
        case 'trace':
          traceOn = arg.toLowerCase() === 'on';
          console.log(`Trace: ${traceOn ? 'ON' : 'OFF'}`);
          break;
        case 'last':
          if (lastTrace) {
            console.log(JSON.stringify(lastTrace, null, 2));
          } else {
            console.log('Brak poprzedniego pytania.');
          }
          break;
        case 'rate': {
          const verdict = arg.toLowerCase();
          const ok = attachVerdict(root, session, verdict);
          console.log(ok ? `Zapisano werdykt: ${verdict}` : 'Brak poprzedniej interakcji.');
          break;
        }
        case 'quit':
        case 'exit':
          console.log('Do widzenia.');
          rl.close();
          return;
        default:
          console.log('Nieznana komenda. Wpisz :help');
      }
      process.stdout.write('AIA> ');
      return;
    }

    try {
      const result = await evaluateQuestion(input, {
        repoRoot: root,
        skipGateCheck: true,
        safetyCounters: counters,
      }, pending);

      if (pending && result.trace.evaluationState === 'ERROR' && result.trace.error?.includes('clarification')) {
        console.log('\nNie rozpoznano wyboru. Podaj etykietę lub numer opcji.\n');
        if (pending.stage5.question?.choices) {
          pending.stage5.question.choices.forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.label}`);
          });
        }
        process.stdout.write('AIA> ');
        return;
      }

      pending = result.pending;
      lastTrace = result.trace;
      appendInteraction(root, session, result.trace);

      console.log('');
      console.log(result.trace.userFacingAnswer);
      if (traceOn) {
        console.log('\n--- trace ---');
        console.log(formatTraceSummary(result.trace));
      }
      if (result.trace.evaluationState === 'CLARIFICATION_REQUIRED' && result.trace.stage5.choiceLabels.length) {
        console.log('\nOpcje:');
        result.trace.stage5.choiceLabels.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
      }
    } catch (e) {
      console.error('Błąd:', e instanceof Error ? e.message : String(e));
    }

    console.log('');
    process.stdout.write('AIA> ');
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
