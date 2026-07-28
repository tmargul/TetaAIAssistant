/**
 * Stage 3J — resolve component against active snapshot.
 */
import type { TetaPayrollSnapshotRepository } from '../teta-payroll-snapshots/teta-payroll-snapshot-repository';
import type { PayrollComponentCandidate } from './teta-payroll-explanation.types';
import { selectPayrollComponent } from './teta-payroll-component-selector';

export function listComponentCandidates(
  repository: TetaPayrollSnapshotRepository,
  snapshotId: string,
): PayrollComponentCandidate[] {
  return repository.listComponentSummaries(snapshotId);
}

export function resolvePayrollComponent(input: {
  repository: TetaPayrollSnapshotRepository;
  installationScopeId: string;
  rawSelector: string;
  exactCode?: string | null;
}): {
  active: ReturnType<TetaPayrollSnapshotRepository['getActive']>;
  selection: ReturnType<typeof selectPayrollComponent>;
} {
  const active = input.repository.getActive(input.installationScopeId);
  if (!active) {
    return {
      active: null,
      selection: {
        selector: {
          selectorType: 'unresolved',
          rawValue: input.rawSelector,
          normalizedValue: input.rawSelector,
          confidence: 'unresolved',
        },
        resolved: null,
        candidates: [],
        ambiguous: false,
      },
    };
  }

  if (input.exactCode) {
    const component = input.repository.getComponent(active.snapshotId, input.exactCode);
    if (component) {
      return {
        active,
        selection: {
          selector: {
            selectorType: 'exact_code',
            rawValue: input.exactCode,
            normalizedValue: input.exactCode,
            confidence: 'exact',
          },
          resolved: {
            code: component.code,
            title: component.title,
            typeCode: component.typeCode,
          },
          candidates: [],
          ambiguous: false,
        },
      };
    }
  }

  const candidates = listComponentCandidates(input.repository, active.snapshotId);
  const selection = selectPayrollComponent({
    rawValue: input.rawSelector,
    components: candidates,
  });
  return { active, selection };
}
