/**
 * Stage 3J — deterministic contracts (fingerprint, snapshot required reuse).
 */
import { createHash } from 'crypto';
import type {
  PayrollExplanationDiagnostic,
  PayrollExplanationFocus,
  TetaPayrollComponentExplanation,
} from './teta-payroll-explanation.types';
import { STAGE3J_EXPLANATION_CONTRACT_VERSION } from './teta-payroll-explanation.types';

export type ExplanationFingerprintInput = {
  contractVersion: string;
  snapshotFileSha256: string;
  componentRecordHash: string;
  componentCode: string;
  focus: PayrollExplanationFocus;
  requestedDepth: number;
  semanticsCatalogVersion: string;
  semanticsCatalogSha256: string;
  directDependencyCodes: string[];
  transitiveDependencyCodes: string[];
  directDependentCodes: string[];
  calculationFormulaReferenceIds: string[];
  diagnosticCodes: string[];
};

function stableSort(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (Array.isArray(v)) {
      return v.map((item) => item);
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

export function computeExplanationFingerprint(input: ExplanationFingerprintInput): string {
  const payload = {
    contractVersion: input.contractVersion,
    snapshotFileSha256: input.snapshotFileSha256,
    componentRecordHash: input.componentRecordHash,
    componentCode: input.componentCode,
    focus: input.focus,
    requestedDepth: input.requestedDepth,
    semanticsCatalogVersion: input.semanticsCatalogVersion,
    semanticsCatalogSha256: input.semanticsCatalogSha256,
    directDependencyCodes: stableSort(input.directDependencyCodes),
    transitiveDependencyCodes: stableSort(input.transitiveDependencyCodes),
    directDependentCodes: stableSort(input.directDependentCodes),
    calculationFormulaReferenceIds: stableSort(input.calculationFormulaReferenceIds),
    diagnosticCodes: stableSort(input.diagnosticCodes),
  };
  return createHash('sha256').update(canonicalJsonStringify(payload), 'utf8').digest('hex');
}

export function buildFingerprintFromExplanation(
  explanation: TetaPayrollComponentExplanation,
  semanticsCatalogSha256: string,
  componentRecordHash: string,
): string {
  if (!explanation.source || !explanation.component) {
    return createHash('sha256').update(explanation.explanationId, 'utf8').digest('hex');
  }
  return computeExplanationFingerprint({
    contractVersion: STAGE3J_EXPLANATION_CONTRACT_VERSION,
    snapshotFileSha256: explanation.source.snapshotFileSha256,
    componentRecordHash,
    componentCode: explanation.component.code,
    focus: explanation.request.focus,
    requestedDepth: explanation.request.requestedDepth,
    semanticsCatalogVersion: explanation.source.semanticsCatalogVersion,
    semanticsCatalogSha256,
    directDependencyCodes: explanation.dependencies.direct.map((d) => d.componentCode),
    transitiveDependencyCodes: explanation.dependencies.transitive.map((d) => d.componentCode),
    directDependentCodes: explanation.impact.directDependents.map((d) => d.componentCode),
    calculationFormulaReferenceIds: explanation.impact.calculationFormulaUses.map(
      (u) => u.formulaInternalId,
    ),
    diagnosticCodes: explanation.diagnostics.map((d: PayrollExplanationDiagnostic) => d.code),
  });
}

/** Re-export Stage 3I snapshot-required contract text — single source via chat gate. */
export { evaluatePayrollChatGate } from '../teta-payroll-snapshots/teta-payroll-snapshot-chat-gate';
