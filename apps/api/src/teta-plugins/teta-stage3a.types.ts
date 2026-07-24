/**
 * Stage 3A — types for canonical graph index + resolver.
 * Does not modify Stage 1–2E.1 extractors or facts.
 */

export const STAGE3A_INDEX_SCHEMA_VERSION = 'teta-aia-graph-index-v1';
export const STAGE3A_IDENTITY_VERSION = 'teta-aia-canonical-id-v1';

export type GraphResolveStatus =
  | 'resolved'
  | 'ambiguous'
  | 'unresolved'
  | 'conflicting'
  | 'invalid';

export type GraphNameKind =
  | 'canonical_name'
  | 'name'
  | 'label'
  | 'control_name'
  | 'dataset_name'
  | 'column_name'
  | 'oracle_name'
  | 'dotnet_type'
  | 'alias'
  | 'guid'
  | 'help_label'
  | 'parameter_name';

export type GraphCandidate = {
  nodeId: string;
  scoreRank: number;
  matchKind: string;
  confidence: string | null;
  domain: string | null;
  type: string | null;
  canonicalName: string | null;
  name: string | null;
};

export type GraphNodeView = {
  id: string;
  type: string;
  domain: string | null;
  name: string | null;
  canonicalName: string | null;
  owner: string | null;
  objectType: string | null;
  confidence: string | null;
  sourceStages: string[];
  attributes: Record<string, unknown>;
  evidence: unknown[];
  semanticNormalization: Record<string, unknown> | null;
};

export type GraphEdgeView = {
  id: string;
  type: string;
  from: string;
  to: string;
  confidence: string | null;
  sourceStages: string[];
  attributes: Record<string, unknown>;
  evidence: unknown[];
};

export type GraphPathHop = {
  edgeId: string;
  edgeType: string;
  fromId: string;
  toId: string;
  confidence: string | null;
  sourceStages: string[];
};

export type GraphPath = {
  kind: string;
  nodeIds: string[];
  edgeIds: string[];
  hops: GraphPathHop[];
  warnings: string[];
};

export type GraphConflictView = {
  conflictId: string;
  conflictType: string;
  subjectId: string | null;
  resolutionStatus: string | null;
  alternatives: unknown[];
  evidence: unknown[];
};

export type GraphResolverResult = {
  status: GraphResolveStatus;
  query: Record<string, unknown>;
  selectedNodeId: string | null;
  candidates: GraphCandidate[];
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  paths: GraphPath[];
  conflicts: GraphConflictView[];
  warnings: string[];
  provenance: unknown[];
  audit: Record<string, unknown>;
  truncated?: boolean;
  continuation?: Record<string, unknown> | null;
};

export type Stage3aIndexStatus = {
  exists: boolean;
  indexPath: string;
  indexSchemaVersion: string | null;
  identityVersion: string | null;
  sourceFile: string | null;
  sourceGeneratedAt: string | null;
  sourceHash: string | null;
  sourceSize: number | null;
  builtAt: string | null;
  nodesTotal: number | null;
  edgesTotal: number | null;
  conflictsTotal: number | null;
  namesTotal: number | null;
  referenceChainsTotal: number | null;
};

export type Stage3aBuildResult = {
  ok: boolean;
  indexPath: string;
  durationMs: number;
  nodesTotal: number;
  edgesTotal: number;
  conflictsTotal: number;
  namesTotal: number;
  referenceChainsTotal: number;
  sourceHash: string;
  sourceSize: number;
  identityVersion: string;
  indexSchemaVersion: string;
  integrity: Stage3aIntegrityReport;
};

export type Stage3aIntegrityReport = {
  ok: boolean;
  missingEdgeSource: number;
  missingEdgeTarget: number;
  duplicateNodeIds: number;
  duplicateEdgeIds: number;
  sourceHashMatch: boolean;
  identityVersionOk: boolean;
  errors: string[];
};

export type Stage3aAuditReport = {
  generatedAt: string;
  sourceHash: string | null;
  indexSchemaVersion: string;
  identityVersion: string | null;
  nodesIndexed: number;
  edgesIndexed: number;
  namesIndexed: number;
  conflictsIndexed: number;
  referenceChainsIndexed: number;
  invalidNodeReferences: number;
  invalidEdgeReferences: number;
  duplicateNodeIds: number;
  duplicateEdgeIds: number;
  missingEdgeSource: number;
  missingEdgeTarget: number;
  indexSourceMismatch: boolean;
  queriesExecuted: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  conflicting: number;
  truncatedResults: number;
  averageQueryTimeMs: number;
  maxQueryTimeMs: number;
  buildDurationMs: number | null;
  openDurationMs: number | null;
  referenceResults: Record<string, unknown>;
  smokeResults: Record<string, unknown>;
  queryTimingsMs: Record<string, number>;
  strictErrors: string[];
};
