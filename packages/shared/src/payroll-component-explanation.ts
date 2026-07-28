/**
 * Stage 3J — client-safe payroll explanation chat contracts.
 */
export const TETA_PAYROLL_COMPONENT_CHAT_RESPONSE_VERSION =
  'teta-aia-payroll-component-chat-response-v1' as const;

export type PayrollComponentExplanationStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'snapshot_required'
  | 'component_not_found'
  | 'ambiguous_component'
  | 'unsupported_formula'
  | 'capability_not_available'
  | 'failed';

export type PayrollComponentCandidateView = {
  code: string;
  title: string | null;
  typeCode: string | null;
};

export type PayrollDirectDependencyView = {
  componentCode: string;
  componentTitle: string | null;
  relationType: string;
  sourceFunction: string | null;
  semanticMeaning: string | null;
  componentFound: boolean;
};

export type PayrollTransitiveDependencyView = {
  componentCode: string;
  componentTitle: string | null;
  minimumDepth: number;
  paths: string[][];
};

export type PayrollDependentView = {
  componentCode: string;
  componentTitle: string | null;
  minimumDepth: number;
};

export type PayrollCalculationFormulaUseView = {
  formulaInternalId: string;
  title: string | null;
  formulaTypeRaw: string | null;
  referenceCount: number;
};

export type PayrollComponentExplanationView = {
  contractVersion: string;
  status: PayrollComponentExplanationStatus;
  explanationFingerprintSha256: string;
  request: { focus: string; requestedDepth: number };
  source: {
    reportGeneratedAt: string | null;
    kpVersion: string | null;
    paVersion: string | null;
    parserVersion: string;
    semanticsCatalogVersion: string;
  } | null;
  component: {
    code: string;
    title: string | null;
    typeCode: string | null;
    typeMeaning: string | null;
    correctionMode: string | null;
    correctionModeMeaning: string | null;
    parameters: Record<string, string | null>;
    meaning: string | null;
  } | null;
  candidates?: PayrollComponentCandidateView[];
  formula: {
    available: boolean;
    raw: string | null;
    parseStatus: string;
    plainLanguageSteps: Array<{ sequence: number; description: string }>;
  };
  dependencies: {
    direct: PayrollDirectDependencyView[];
    transitive: PayrollTransitiveDependencyView[];
    truncated: boolean;
    cycles: string[][];
    missingTargets: string[];
  };
  impact: {
    directDependents: PayrollDependentView[];
    transitiveDependents: PayrollDependentView[];
    calculationFormulaUses: PayrollCalculationFormulaUseView[];
    sqlFormulaUses: Array<{ status: string; message: string }>;
    truncated: boolean;
  };
  diagnostics: Array<{ code: string; message: string; severity: string }>;
  narrative: {
    summary: string;
    formulaExplanation: string;
    dependencyExplanation: string;
    impactExplanation: string;
    warnings: string[];
  };
  dataExpired?: boolean;
};

export type TetaPayrollComponentChatResponse = {
  contractVersion: typeof TETA_PAYROLL_COMPONENT_CHAT_RESPONSE_VERSION;
  type: 'payroll_component_explanation';
  status: PayrollComponentExplanationStatus;
  title: string;
  message: string;
  explanation: PayrollComponentExplanationView | null;
  historyRedaction: {
    rawFormulaPersisted: boolean;
    dependencyFragmentsPersisted: boolean;
    dataExpired: boolean;
  };
};
