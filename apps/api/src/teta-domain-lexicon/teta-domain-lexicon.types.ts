import type { PlannerIntentType } from '../teta-planner/teta-stage3b.types';

export const TETA_DOMAIN_LEXICON_RESOLUTION_CONTRACT_VERSION =
  'teta-aia-domain-lexicon-resolution-v1' as const;

export type LexiconStatus = 'resolved' | 'resolved_with_warnings' | 'ambiguous' | 'unresolved';
export type ResolutionKind = 'single_domain' | 'multi_domain' | 'ambiguous' | 'unresolved';
export type LexiconConfidence =
  | 'exact'
  | 'verified_alias'
  | 'context_required'
  | 'fallback_diacritic_folded';
export type LexiconMatchMode =
  | 'exact_phrase'
  | 'contains_phrase'
  | 'ordered_terms'
  | 'required_terms'
  | 'token_prefixes';

export type LexiconEntryStatus =
  | 'approved'
  | 'candidate'
  | 'discovered_from_help'
  | 'enriched_from_help'
  | 'ambiguous'
  | 'rejected'
  | 'client_specific';

export type ConceptKind =
  | 'entity'
  | 'document'
  | 'attribute'
  | 'operation'
  | 'report'
  | 'workflow'
  | 'unknown';

export type DomainClassificationConfidence =
  | 'confirmed'
  | 'strongly_supported'
  | 'candidate'
  | 'ambiguous'
  | 'unclassified';

export type DomainRegistryEntry = {
  domainId: string;
  canonicalLabel: string;
  aliases: string[];
  status: 'approved' | 'candidate' | 'rejected';
  sourcePolicy: {
    helpDiscoveryAllowed: boolean;
    knowledgeDocumentEnrichmentAllowed: boolean;
    clientOverlayAllowed: boolean;
  };
  provenance: { type: string; sourceId: string };
};

export type TetaDomainRegistry = {
  registryVersion: string;
  domains: DomainRegistryEntry[];
};

export type DomainLexiconEntry = {
  entryId: string;
  conceptId: string;
  /** @deprecated use domainId */
  domain: string;
  domainId?: string;
  domainPackId?: string;
  canonicalLabel: string;
  conceptKind?: ConceptKind;
  aliases: Array<{
    text: string;
    matchMode: 'exact_or_phrase' | 'token_prefixes';
    confidence: LexiconConfidence;
  }>;
  status: LexiconEntryStatus;
  ambiguityPolicy: 'context_required' | 'allow_auto_resolve';
  provenance: { type: string; sourceId: string };
};

export type DomainLexiconOperationRule = {
  ruleId: string;
  domain: string;
  requiredConcepts: string[];
  patterns: Array<{
    matchMode?: LexiconMatchMode;
    phrase?: string;
    orderedTerms?: string[];
    requiredTerms?: string[];
    tokenPrefixes?: string[];
  }>;
  mapsTo: {
    intent?: PlannerIntentType;
    subject?: string;
    focus?: 'dependencies' | 'impact' | 'formula' | 'overview' | 'full';
    capability?: string | null;
    capabilityStatus?: 'not_available_yet' | 'available' | 'recognized_but_not_routed';
    scope?:
      | 'generic_payroll_knowledge'
      | 'client_payroll_configuration'
      | 'recognized_but_not_routed'
      | 'unresolved';
  };
  status: 'approved' | 'candidate' | 'rejected';
};

export type DomainLanguagePack = {
  domainPackId: string;
  domainId: string;
  normalizationProfile: string;
  entries: DomainLexiconEntry[];
  operationRules: DomainLexiconOperationRule[];
};

export type DomainLexiconManifest = {
  manifestVersion: string;
  lexiconVersion: string;
  normalizationProfile: string;
  registryFile: string;
  domainPacks: Array<{ domainPackId: string; file: string; status: string }>;
  candidateStores: string[];
  knowledgeSourceManifest: string;
  provenance: { type: string; sourceId: string };
};

export type TetaPolishDomainLexiconCatalog = {
  lexiconVersion: string;
  normalizationProfile: string;
  entries: DomainLexiconEntry[];
  operationRules: DomainLexiconOperationRule[];
  manifest?: DomainLexiconManifest;
  registry?: TetaDomainRegistry;
};

export type NormalizedPolishText = {
  original: string;
  normalizedExact: string;
  normalizedDiacriticFolded: string;
  tokens: string[];
};

export type LexiconScope =
  | 'generic_payroll_knowledge'
  | 'client_payroll_configuration'
  | 'recognized_but_not_routed'
  | 'unresolved'
  | null;

export type TetaDomainLexiconResolution = {
  contractVersion: typeof TETA_DOMAIN_LEXICON_RESOLUTION_CONTRACT_VERSION;
  lexiconVersion: string;
  status: LexiconStatus;
  resolutionKind: ResolutionKind;
  normalizedQuery: string;
  normalizedQueryDiacriticFolded: string;
  domains: Array<{ domainId: string; confidence: DomainClassificationConfidence }>;
  concepts: Array<{
    conceptId: string;
    domain: string;
    matchType: string;
    confidence: LexiconConfidence;
    matchedText: string;
    sourceEntryId: string;
  }>;
  mapping: {
    intent: PlannerIntentType | null;
    subject: string | null;
    focus: 'dependencies' | 'impact' | 'formula' | 'overview' | 'full' | null;
    capability: string | null;
    capabilityStatus?: 'not_available_yet' | 'available' | 'recognized_but_not_routed' | null;
    scope: LexiconScope;
    operationId?: string | null;
    routingStatus?: 'routed' | 'recognized_but_not_routed' | 'unresolved';
  };
  candidates: Array<{ entryId: string; conceptId: string; reason: string }>;
  diagnostics: string[];
  lexiconSha256: string;
  resolutionFingerprintSha256: string;
  matchedRuleIds: string[];
};

export type HelpConceptCandidate = {
  candidateId: string;
  candidateLabel: string;
  normalizedLabel: string;
  domainCandidates: Array<{ domainId: string; confidence: DomainClassificationConfidence }>;
  conceptKindCandidates: ConceptKind[];
  status: 'discovered_from_help' | 'enriched_from_help' | 'candidate' | 'ambiguous' | 'rejected';
  aliases: string[];
  definitions: string[];
  applicationEvidence: Array<{ nodeId: string; nodeType: string; evidencePath: string }>;
  technicalEvidence: Array<{ nodeId: string; nodeType: string }>;
  sourceScope: 'global' | 'version' | 'client';
  productVersion: string | null;
};

export type HelpCoverageReport = {
  contractVersion: 'teta-aia-help-domain-coverage-v1';
  formsTotal: number;
  formsWithHelp: number;
  helpCoveragePercent: number;
  helpFieldCount: number;
  candidateConcepts: number;
  genericLabelsPreventedFromGlobalApproval: number;
  rawHelpCandidateLabels: number;
  candidatesAfterGenericFiltering: number;
  candidatesAfterDeduplication: number;
  duplicateCandidatesMerged: number;
  helpAutoApprovedConcepts: number;
  reconciliation?: {
    registeredForms: number;
    helpDocumentsInGraph: number;
    formsWithValidHelpEdge: number;
    helpDocumentsWithoutRegisteredForm: number;
    registeredFormsWithMultipleHelpDocuments: number;
    invalidOrExcludedHelpDocuments: number;
    finalFormsWithHelp: number;
    differenceHelpDocumentsVsFinalFormsWithHelp: number;
    differenceReason: string;
  };
  perDomain: Array<{
    domainId: string;
    formsWithHelp: number;
    helpDiscoveredCandidates: number;
    helpAutoApprovedConcepts: number;
    classificationConfidence: DomainClassificationConfidence | 'not_applicable';
  }>;
  helpActionCount: number | null;
  helpDocumentsWithActions: number | null;
  helpDocumentsWithActionsUnavailable: boolean;
  helpDocumentsWithActionsUnavailableReason: string | null;
  helpActionsUsedAsCandidates: number | null;
  helpActionsUnavailableFromGraph: number;
  helpActionsUnavailableReason: string | null;
  orphanHelpActions: number | null;
  actionsWithoutHelpEvidence: number | null;
  fingerprintSha256: string;
};

export type KnowledgeSourceRecord = {
  sourceId: string;
  domainId: string;
  sourceType: 'pdf' | 'docx' | 'rtf' | 'txt' | 'html' | 'json' | 'jsonl' | 'mp4' | 'other';
  scope: 'global' | 'version' | 'client';
  productVersion: string | null;
  originalFileName: string;
  fileSha256: string;
  status: 'inventoried' | 'registered' | 'rejected';
  provenance: { type: string; sourceId: string; scannedAt: string };
};

export type KnowledgeSourceManifest = {
  manifestVersion: string;
  sources: KnowledgeSourceRecord[];
  provenance: { type: string; sourceId: string };
};
