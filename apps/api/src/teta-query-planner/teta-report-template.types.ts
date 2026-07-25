/**
 * Stage 3C — report template types.
 */

export type SourceRoleResolution = {
  sourceRole: string;
  enrichment?: boolean;
  searchTerms: string[];
  formNameFragments?: string[];
  semanticTags?: string[];
};

export type ProjectionRoleResolution = {
  businessRole: string;
  sourceRole: string;
  displayLabel: string;
  labelHints: string[];
  preferDisplayText?: boolean;
};

export type RequiredJoinSpec = {
  leftSourceRole: string;
  rightSourceRole: string;
  joinType: 'inner' | 'left';
  required: boolean;
  enrichment?: boolean;
};

export type FilterResolution =
  | {
      filterRole: string;
      type: 'half_open_date_interval';
      columnBusinessRole: string;
      clock: 'oracle_sysdate';
    }
  | {
      filterRole: string;
      type: 'effective_on_date';
      clock: 'oracle_sysdate';
      requiresActiveEmploymentEvidence?: boolean;
      /** When set, resolve effective dating against this resolved source (e.g. current_position). */
      sourceRole?: string;
      searchTerms?: string[];
    };

export type OrderingResolution = {
  orderRole: string;
  businessRole: string;
  direction: 'ascending' | 'descending';
};

export type ReportQueryTemplate = {
  subject: string;
  intent: string;
  requiredSourceRoles: string[];
  requiredProjectionRoles: string[];
  requiredFilters: string[];
  defaultOrdering: string[];
  sourceRoleResolutions: SourceRoleResolution[];
  projectionRoleResolutions: ProjectionRoleResolution[];
  requiredJoins: RequiredJoinSpec[];
  filterResolutions: FilterResolution[];
  orderingResolutions: OrderingResolution[];
  auditReferenceHints?: {
    note?: string;
    knownConfirmedObjectsIfPresentInGraph?: string[];
  };
};

export type ReportQueryTemplatesFile = {
  version: string;
  templates: ReportQueryTemplate[];
};
