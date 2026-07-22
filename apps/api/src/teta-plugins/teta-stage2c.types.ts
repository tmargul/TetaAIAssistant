/** Stage 2C — Help HTML semantic mapping onto Stage 2A/2B graph. */

export type Stage2cHelpStatus =
  | 'help_found'
  | 'help_file_missing'
  | 'help_file_unreadable'
  | 'help_encoding_failed'
  | 'help_empty'
  | 'help_parse_failed';

export type Stage2cFieldConfidence =
  | 'confirmed_structural'
  | 'probable_structural'
  | 'candidate_text'
  | 'ambiguous';

export type Stage2cMatchStatus =
  | 'confirmed_label_control'
  | 'probable_same_container'
  | 'probable_tab_order'
  | 'matched_by_caption'
  | 'matched_by_control_name'
  | 'ambiguous'
  | 'unmatched';

export type Stage2cHelpKind =
  | 'formOverview'
  | 'sectionHelp'
  | 'fieldHelp'
  | 'actionHelp'
  | 'warningHelp'
  | 'workflowHelp';

export type Stage2cEncodingResult = {
  detectedEncoding: string;
  decodingStatus: 'ok' | 'failed' | 'high_replacement';
  replacementCharacterCount: number;
  text: string;
};

export type Stage2cSection = {
  heading: string;
  level: number;
  text: string;
  lists: string[][];
  tables: Array<{ headers: string[]; rows: string[][] }>;
  order: number;
};

export type Stage2cFieldEntry = {
  label: string;
  normalizedLabel: string;
  normalizedLabelAscii: string;
  description: string;
  section: string | null;
  sourceFragment: string;
  order: number;
  extractionPattern: string;
  confidence: Stage2cFieldConfidence;
  evidence: string[];
  helpKind: Stage2cHelpKind;
};

export type Stage2cHelpDocument = {
  guid: string;
  registryId?: string | null;
  formType?: string | null;
  assembly?: string | null;
  helpPath: string | null;
  helpStatus: Stage2cHelpStatus;
  detectedEncoding?: string | null;
  decodingStatus?: string | null;
  replacementCharacterCount?: number;
  title: string | null;
  overview: string | null;
  sections: Stage2cSection[];
  fieldEntries: Stage2cFieldEntry[];
  actionEntries: Stage2cFieldEntry[];
  unmatchedEntries: Stage2cFieldEntry[];
  parseWarnings: string[];
};

export type Stage2cControlMatch = {
  helpField: string;
  control: string | null;
  controlKind?: string | null;
  matchStatus: Stage2cMatchStatus;
  score: number;
  evidence: string[];
  helpKind: Stage2cHelpKind;
};

export type Stage2cLinkedMapping = {
  guid: string;
  formType: string | null;
  helpLabel: string;
  helpDescription: string;
  helpKind: Stage2cHelpKind;
  section: string | null;
  control: string | null;
  controlKind?: string | null;
  matchStatus: Stage2cMatchStatus;
  score: number;
  targetBinding?: {
    datasetTable?: string | null;
    dataMember?: string | null;
  } | null;
  lookupBinding?: {
    datasetTable?: string | null;
    valueMember?: string | null;
    displayMember?: string | null;
  } | null;
  parameterName?: string | null;
  oracleMapping?: {
    targetObjects: string[];
    lookupObjects: string[];
  } | null;
  evidence: string[];
};

export type Stage2cConflict = {
  conflictType: string;
  formType?: string | null;
  guid?: string | null;
  subject?: string | null;
  message: string;
};

export type Stage2cAuditSummary = {
  registryEntriesChecked: number;
  helpFilesFound: number;
  helpMissing: number;
  helpUnreadable: number;
  encodingFailures: number;
  parsedDocuments: number;
  sections: number;
  extractedFieldEntries: number;
  actionEntries: number;
  fieldEntriesMatchedToControls: number;
  confirmedMatches: number;
  probableMatches: number;
  ambiguous: number;
  unmatchedHelpFields: number;
  controlsWithoutHelp: number;
  helpMappingsWithOracleChain: number;
  lookupFieldsCorrectlySplit: number;
  duplicateHelpDocuments: number;
  parseWarnings: number;
};
