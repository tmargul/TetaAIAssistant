import { runP1EmployeeCurrentPositionPilot } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position-pipeline';
import { runP1EmployeeVerticalPilot } from '../teta-p1-employee-vertical-pilot/teta-p1-vertical-pilot-pipeline';
import { runP1SurnameCurrentPositionPilot } from '../teta-p1-employee-vertical-pilot/teta-p1-surname-current-position-pipeline';
import type {
  EvalSafetyCounters,
  ExecutorSummary,
  IntentMatch,
  RecognizedCapabilityId,
} from './aia-eval.types';

export type ExecutorRunResult = {
  summary: ExecutorSummary;
  userFacingDetail: string;
  renderedRows: string[][];
  full: Record<string, unknown>;
  countersDelta: Partial<EvalSafetyCounters>;
};

const EXECUTOR_IDS: Record<Exclude<RecognizedCapabilityId, null>, string> = {
  employee_current_position: 'p1_employee_current_position_by_employee_number',
  employee_surname_prefix: 'p1_employee_surname_prefix',
  employee_surname_prefix_with_position: 'p1_employee_surname_prefix_with_current_position',
};

function mergeSafetyFromPilot(
  pilot: Record<string, unknown>,
  counters: EvalSafetyCounters,
): void {
  counters.dmlStatementsExecuted +=
    Number((pilot.executionAudit as { dmlStatementsExecuted?: number })?.dmlStatementsExecuted) ||
    Number((pilot.safetyCounters as { dmlStatementsExecuted?: number })?.dmlStatementsExecuted) ||
    0;
  counters.ddlStatementsExecuted +=
    Number((pilot.executionAudit as { ddlStatementsExecuted?: number })?.ddlStatementsExecuted) ||
    0;
  counters.plsqlBlocksExecuted +=
    Number((pilot.executionAudit as { plsqlBlocksExecuted?: number })?.plsqlBlocksExecuted) || 0;
}

export async function runRegisteredExecutor(input: {
  repoRoot: string;
  capabilityId: Exclude<RecognizedCapabilityId, null>;
  intent: IntentMatch;
  counters: EvalSafetyCounters;
  skipGateCheck?: boolean;
  useFakeExecutor?: boolean;
  fakeRows?: unknown[][];
}): Promise<ExecutorRunResult> {
  const executorId = EXECUTOR_IDS[input.capabilityId];
  const question = input.intent.canonicalQuestion ?? '';
  let pilot: Record<string, unknown>;

  switch (input.capabilityId) {
    case 'employee_current_position':
      pilot = await runP1EmployeeCurrentPositionPilot(input.repoRoot, {
        question,
        employeeNumber: input.intent.businessSlots.employeeNumber,
        skipGateCheck: input.skipGateCheck,
        useFakeExecutor: input.useFakeExecutor,
        fakeRows: input.fakeRows,
        writeArtifacts: false,
      });
      break;
    case 'employee_surname_prefix':
      pilot = await runP1EmployeeVerticalPilot(input.repoRoot, {
        question,
        skipGateCheck: input.skipGateCheck,
        useFakeExecutor: input.useFakeExecutor,
        fakeRows: input.fakeRows,
        writeArtifacts: false,
      });
      break;
    case 'employee_surname_prefix_with_position':
      pilot = await runP1SurnameCurrentPositionPilot(input.repoRoot, {
        question,
        skipGateCheck: input.skipGateCheck,
        useFakeExecutor: input.useFakeExecutor,
        fakeRows: input.fakeRows,
        writeArtifacts: false,
      });
      break;
    default:
      input.counters.unregisteredExecutorCalls += 1;
      throw new Error(`unregistered_executor:${input.capabilityId}`);
  }

  mergeSafetyFromPilot(pilot, input.counters);

  const chat = pilot.chatResponse as
    | { message?: string; report?: { rows?: string[][]; rowCount?: number } }
    | undefined;
  const executionAudit = pilot.executionAudit as
    | { businessSelectStatementsExecuted?: number; rowCount?: number }
    | undefined;
  const rows = chat?.report?.rows ?? [];
  const rowCount =
    chat?.report?.rowCount ??
    executionAudit?.rowCount ??
    (Array.isArray(rows) ? rows.length : 0);

  return {
    summary: {
      executorId,
      pilotStatus: String(pilot.pilotStatus ?? 'unknown'),
      rowCount,
      businessSelectStatementsExecuted: executionAudit?.businessSelectStatementsExecuted ?? 0,
    },
    userFacingDetail: String(chat?.message ?? ''),
    renderedRows: Array.isArray(rows) ? rows.map((r) => [...r]) : [],
    full: pilot,
    countersDelta: {},
  };
}

export function isExecutorSuccess(pilot: Record<string, unknown>): boolean {
  const status = String(pilot.pilotStatus ?? '');
  return (
    status === 'implemented_and_real_readonly_smoke_completed' ||
    status === 'implemented_and_real_readonly_smoke_awaiting_user_validation' ||
    status === 'dry_run_ok_awaiting_phase_b'
  );
}

export function listRegisteredExecutorLabels(): string[] {
  return Object.values(EXECUTOR_IDS);
}
