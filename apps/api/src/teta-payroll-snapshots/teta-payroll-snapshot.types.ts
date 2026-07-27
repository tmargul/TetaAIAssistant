/**
 * Stage 3I — payroll parameter snapshot contracts.
 * Snapshot = customer installation config from Teta "Wydruk parametrów płacowych" RTF.
 * DOMAN fixture is customer_example only — never a default/fallback.
 */

export const STAGE3I_SNAPSHOT_CONTRACT_VERSION =
  'teta-aia-payroll-parameter-snapshot-v1' as const;
export const STAGE3I_PARSER_VERSION = 'teta-payroll-report-parser-v1' as const;
export const STAGE3I_FORMULA_LANGUAGE_VERSION =
  'teta-payroll-formula-language-v1' as const;

export const STAGE3I_SOURCE_TYPE = 'teta_payroll_parameters_report' as const;
export const STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE = 'customer_example' as const;

export const STAGE3I_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const STAGE3I_MAX_DECODED_TEXT_BYTES = 200 * 1024 * 1024;
export const STAGE3I_MAX_SECTIONS = 200;
export const STAGE3I_MAX_RECORDS = 250_000;
export const STAGE3I_MAX_FIELD_BYTES = 2 * 1024 * 1024;
export const STAGE3I_MAX_PARSE_MS = 60_000;

export type PayrollReportValidationStatus =
  | 'valid_payroll_parameters_report'
  | 'incomplete_payroll_parameters_report'
  | 'unsupported_rtf_report'
  | 'malformed_rtf'
  | 'rejected_by_limits';

export type PayrollSnapshotStatus =
  | 'active'
  | 'inactive'
  | 'superseded'
  | 'rejected';

export type PayrollSectionKind =
  | 'components'
  | 'context_components'
  | 'sql_formulas'
  | 'calculation_formulas'
  | 'recognized_generic'
  | 'unknown_section';

export type PayrollFormulaParseStatus =
  | 'parsed'
  | 'parsed_with_unknown_tokens'
  | 'unsupported'
  | 'malformed';

export type PayrollDependencyRelationType =
  | 'current_list_value'
  | 'historical_value'
  | 'sql_runtime_value'
  | 'indirect_formula_reference'
  | 'unknown_reference';

export type PayrollDependencyConfidence =
  | 'exact'
  | 'documented_pattern'
  | 'probable'
  | 'unresolved';

export type TetaPayrollSnapshotSource = {
  type: typeof STAGE3I_SOURCE_TYPE;
  sourceScope: typeof STAGE3I_SOURCE_SCOPE_CUSTOMER_EXAMPLE | 'customer_installation';
  fileName: string;
  fileSha256: string;
  fileSizeBytes: number;
  reportGeneratedAt: string | null;
  importedAt: string;
  kpVersion: string | null;
  paVersion: string | null;
  companyScope: string[];
  reportDateParseStatus?: ReportDateParseStatus;
  reportDateSourceEvidence?: string | null;
};

export type TetaPayrollSnapshotSummary = {
  componentCount: number;
  componentFormulaCount: number;
  directDependencyCount: number;
  sqlFormulaCount: number;
  calculationFormulaCount: number;
  calculationFormulaComponentReferences: number;
  contextRecordCount: number;
  unparsedRecordCount: number;
  warningCount: number;
  sectionCount: number;
  totalSectionsDetected: number;
  coreSectionsNormalized: number;
  genericSectionsPreserved: number;
  unknownSectionsPreserved: number;
  tocSectionCount: number;
  bodySectionCount: number;
  matchedSectionCount: number;
};

export type TetaPayrollSnapshotValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type TetaPayrollSectionSummary = {
  sectionId: string;
  title: string;
  kind: PayrollSectionKind;
  ordinal: number;
  recordCount: number;
  canonicalId?: string | null;
  canonicalLabel?: string | null;
  sourceLabel?: string;
};

export type TetaPayrollComponentDefinition = {
  snapshotId: string;
  componentInternalId: string | null;
  code: string;
  title: string | null;
  typeCode: string | null;
  hintId: string | null;
  formulaRaw: string | null;
  correctionMode: string | null;
  meaningRaw: string | null;
  parameters: {
    parameter1: string | null;
    parameter2: string | null;
    parameter3: string | null;
  };
  obligatory: boolean | null;
  civilContract: boolean | null;
  accountingRaw: string | null;
  splitByCostCenter: boolean | null;
  contextRaw: string | null;
  creationModificationRaw: string | null;
  sourceEvidence: {
    section: string;
    recordOrdinal: number;
    recordHash: string;
  };
};

export type TetaPayrollComponentDependency = {
  snapshotId: string;
  fromComponentCode: string;
  toComponentCode: string;
  relationType: PayrollDependencyRelationType;
  sourceFunction: string | null;
  sourceFragment: string;
  confidence: PayrollDependencyConfidence;
  sourceEvidence: {
    section: string;
    recordOrdinal: number;
  };
};

export type TetaPayrollFormulaAst = {
  status: PayrollFormulaParseStatus;
  raw: string;
  tokens: string[];
  directComponentCodes: string[];
  unknownCalls: string[];
  diagnostics: string[];
};

export type TetaPayrollCalculationFormulaDefinition = {
  snapshotId: string;
  formulaId: string;
  internalId: string;
  title: string | null;
  formulaTypeRaw: string | null;
  formulaRaw: string | null;
  sourceEvidence: {
    sectionCanonicalId: string;
    sourceLabel: string;
    recordOrdinal: number;
    recordHash: string;
  };
};

export type TetaPayrollCalculationFormulaComponentReference = {
  snapshotId: string;
  calculationFormulaId: string;
  componentCode: string;
  sourceFunction: string;
  confidence: 'exact' | 'documented_pattern' | 'probable' | 'unresolved';
};

export type ReportDateParseStatus = 'exact' | 'best_effort' | 'unrecognized';

export type TetaPayrollParameterSnapshot = {
  contractVersion: typeof STAGE3I_SNAPSHOT_CONTRACT_VERSION;
  snapshotId: string;
  parserVersion: typeof STAGE3I_PARSER_VERSION;
  installationScopeId: string;
  source: TetaPayrollSnapshotSource;
  status: PayrollSnapshotStatus;
  sections: TetaPayrollSectionSummary[];
  summary: TetaPayrollSnapshotSummary;
  validation: TetaPayrollSnapshotValidation;
};

export type PayrollSnapshotRequiredResponse = {
  type: 'payroll_parameter_snapshot_required';
  message: string;
  instructions: string[];
  uploadAllowed: boolean;
};

export type PayrollComponentNotFoundResponse = {
  type: 'payroll_component_not_found_in_active_snapshot';
  message: string;
  reportGeneratedAt: string | null;
};

export type PayrollChatGateResult =
  | {
      kind: 'generic_payroll_knowledge';
      scope: 'generic_payroll_knowledge';
    }
  | {
      kind: 'snapshot_required';
      scope: 'client_payroll_configuration';
      response: PayrollSnapshotRequiredResponse;
    }
  | {
      kind: 'component_summary';
      scope: 'client_payroll_configuration';
      code: string;
      title: string | null;
      typeCode: string | null;
      directDependencyCount: number;
      snapshotId: string;
    }
  | {
      kind: 'component_not_found';
      scope: 'client_payroll_configuration';
      response: PayrollComponentNotFoundResponse;
    };
