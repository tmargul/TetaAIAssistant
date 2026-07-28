/**
 * Stage 3J — payroll component explanation types.
 */
export const STAGE3J_EXPLANATION_CONTRACT_VERSION =
  'teta-aia-payroll-component-explanation-v1' as const;

export const STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION =
  'teta-aia-payroll-component-chat-response-v1' as const;

export const STAGE3J_SEMANTICS_CATALOG_VERSION =
  'teta-payroll-component-semantics-v1' as const;

export const STAGE3J_DEFAULT_DEPTH = 5;
export const STAGE3J_MAX_DEPTH = 10;
export const STAGE3J_MAX_GRAPH_NODES = 500;
export const STAGE3J_MAX_PATHS_PER_TARGET = 3;
export const STAGE3J_MAX_CANDIDATES = 10;
export const STAGE3J_MAX_CODE_LENGTH = 4;

export type PayrollExplanationFocus =
  | 'overview'
  | 'formula'
  | 'dependencies'
  | 'impact'
  | 'full';

export type PayrollExplanationStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'snapshot_required'
  | 'component_not_found'
  | 'ambiguous_component'
  | 'unsupported_formula'
  | 'capability_not_available'
  | 'failed';

export type PayrollComponentSelectorType =
  | 'exact_code'
  | 'exact_title'
  | 'normalized_title'
  | 'candidate_list'
  | 'unresolved';

export type PayrollComponentSelectorConfidence =
  | 'exact'
  | 'normalized_exact'
  | 'ambiguous'
  | 'unresolved';

export type TetaPayrollComponentSelector = {
  selectorType: PayrollComponentSelectorType;
  rawValue: string;
  normalizedValue: string;
  confidence: PayrollComponentSelectorConfidence;
  suggestedCode?: string | null;
};

export type PayrollComponentCandidate = {
  code: string;
  title: string | null;
  typeCode: string | null;
};

export type PayrollEvidenceProvenance =
  | 'snapshot_exact'
  | 'graph_exact'
  | 'training_semantics_verified'
  | 'parser_diagnostic'
  | 'unknown';

export type PayrollExplanationDiagnostic = {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  provenance: PayrollEvidenceProvenance;
};

export type PayrollDirectDependencyExplanation = {
  componentCode: string;
  componentTitle: string | null;
  relationType: string;
  sourceFunction: string | null;
  sourceFragment: string;
  semanticMeaning: string | null;
  confidence: string;
  componentFound: boolean;
  provenance: PayrollEvidenceProvenance;
};

export type PayrollTransitiveDependencyExplanation = {
  componentCode: string;
  componentTitle: string | null;
  minimumDepth: number;
  paths: string[][];
};

export type PayrollDependentExplanation = {
  componentCode: string;
  componentTitle: string | null;
  relationType: string;
  sourceFunction: string | null;
  minimumDepth: number;
};

export type PayrollCalculationFormulaUse = {
  formulaInternalId: string;
  title: string | null;
  formulaTypeRaw: string | null;
  referenceCount: number;
  confidence: string;
};

export type PayrollSqlFormulaUseStatus =
  | 'confirmed_use'
  | 'probable_use'
  | 'not_indexed'
  | 'none_found';

export type PayrollSqlFormulaUse = {
  status: PayrollSqlFormulaUseStatus;
  message: string;
};

export type PayrollFormulaPlainLanguageStep = {
  stepType: string;
  sequence: number;
  description: string;
  evidenceTokenIds: string[];
  provenance: PayrollEvidenceProvenance;
};

export type PayrollExplanationEvidenceSummary = {
  snapshotExactFacts: number;
  graphExactFacts: number;
  verifiedSemanticFacts: number;
  unknownSemanticFacts: number;
  warnings: number;
};

export type TetaPayrollComponentExplanation = {
  contractVersion: typeof STAGE3J_EXPLANATION_CONTRACT_VERSION;
  status: PayrollExplanationStatus;
  explanationId: string;
  explanationFingerprintSha256: string;
  request: {
    focus: PayrollExplanationFocus;
    requestedDepth: number;
    intent?: string | null;
  };
  source: {
    snapshotId: string;
    snapshotFileSha256: string;
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
    hintId: string | null;
    correctionMode: string | null;
    correctionModeMeaning: string | null;
    obligatory: boolean | null;
    civilContract: boolean | null;
    context: string | null;
    parameters: Record<string, string | null>;
    meaning: string | null;
  } | null;
  candidates?: PayrollComponentCandidate[];
  formula: {
    available: boolean;
    raw: string | null;
    parseStatus: string;
    plainLanguageSteps: PayrollFormulaPlainLanguageStep[];
    references: string[];
    unknownCalls: string[];
    warnings: string[];
  };
  dependencies: {
    direct: PayrollDirectDependencyExplanation[];
    transitive: PayrollTransitiveDependencyExplanation[];
    maximumDepthReached: number;
    truncated: boolean;
    cycles: string[][];
    missingTargets: string[];
  };
  impact: {
    directDependents: PayrollDependentExplanation[];
    transitiveDependents: PayrollDependentExplanation[];
    calculationFormulaUses: PayrollCalculationFormulaUse[];
    sqlFormulaUses: PayrollSqlFormulaUse[];
    maximumDepthReached: number;
    truncated: boolean;
  };
  diagnostics: PayrollExplanationDiagnostic[];
  evidenceSummary: PayrollExplanationEvidenceSummary;
  narrative: {
    summary: string;
    formulaExplanation: string;
    dependencyExplanation: string;
    impactExplanation: string;
    warnings: string[];
  };
};

export type TetaPayrollComponentChatResponse = {
  contractVersion: typeof STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION;
  type: 'payroll_component_explanation';
  status: PayrollExplanationStatus;
  title: string;
  message: string;
  explanation: TetaPayrollComponentExplanation | null;
  historyRedaction: {
    rawFormulaPersisted: boolean;
    dependencyFragmentsPersisted: boolean;
    dataExpired: boolean;
  };
};

export type PayrollComponentRequest = {
  selector: {
    rawValue: string;
    selectorHint: 'code' | 'title' | 'unknown';
  };
  focus: PayrollExplanationFocus;
  requestedDepth: number;
};

export type PayrollExplanationRequest = {
  query?: string;
  code?: string;
  title?: string;
  focus?: PayrollExplanationFocus;
  depth?: number;
  intent?: string;
};
