/** Stage 2E.1 shared audit shape. */

export type Stage2e1Audit = {
  domainCounts: Record<string, number>;
  nodesByDomain: Record<string, number>;
  edgesByDomainPair: Record<string, number>;
  invalidOracleCandidates: number;
  invalidOracleCandidatesDotnet: number;
  invalidOracleCandidatesDatasetColumn: number;
  invalidOracleCandidatesOther: number;
  datasetColumnsCreated: number;
  datasetColumnsResolvedToOracle: number;
  datasetColumnsUnresolved: number;
  oracleObjectsByOwner: Record<string, number>;
  oracleObjectsByType: Record<string, number>;
  oracleIdentityCollisions: number;
  synonymsResolved: number;
  synonymsUnresolved: number;
  orphanNodesTotal: number;
  expectedOrphans: number;
  unexpectedOrphans: number;
  invalidDomainOrphans: number;
  unresolvedNodes: number;
  unresolvedEdges: number;
  unresolvedConflicts: number;
  resolvedConflicts: number;
  conflictsTotal: number;
  domainEdgeViolations: number;
  referenceChainsWithTypedIds: number;
  referenceChainsInvalidDomain: number;
  brokenEdges: number;
  duplicateCanonicalIds: number;
  /** Patch 2E.1 quality: DISPLAYS_FROM must not target oracle_column */
  directLookupDisplayToOracleColumns: number;
  /** Final nodes[] still typed as oracle_object with .NET name */
  dotnetNamesTypedAsOracleObjects: number;
  /** owner=UNKNOWN with confirmed* status */
  confirmedOracleObjectsWithUnknownOwner: number;
  /** integrity.orphanNodes entries that are not current nodes */
  staleOrphanReferences: number;
  /** Refs listing UNKNOWN+confirmed oracle */
  referenceChainsContainingUnknownConfirmedOracle: number;
  examples: {
    invalidOracleCandidatesDotnet: string[];
    invalidOracleCandidatesDatasetColumn: string[];
    datasetColumnsCreated: string[];
    domainEdgeViolations: string[];
    unexpectedOrphans: string[];
    invalidDomainOrphans: string[];
    directLookupDisplayToOracleColumns: string[];
    dotnetNamesTypedAsOracleObjects: string[];
    confirmedOracleObjectsWithUnknownOwner: string[];
  };
};

export function emptyStage2e1Audit(): Stage2e1Audit {
  return {
    domainCounts: {},
    nodesByDomain: {},
    edgesByDomainPair: {},
    invalidOracleCandidates: 0,
    invalidOracleCandidatesDotnet: 0,
    invalidOracleCandidatesDatasetColumn: 0,
    invalidOracleCandidatesOther: 0,
    datasetColumnsCreated: 0,
    datasetColumnsResolvedToOracle: 0,
    datasetColumnsUnresolved: 0,
    oracleObjectsByOwner: {},
    oracleObjectsByType: {},
    oracleIdentityCollisions: 0,
    synonymsResolved: 0,
    synonymsUnresolved: 0,
    orphanNodesTotal: 0,
    expectedOrphans: 0,
    unexpectedOrphans: 0,
    invalidDomainOrphans: 0,
    unresolvedNodes: 0,
    unresolvedEdges: 0,
    unresolvedConflicts: 0,
    resolvedConflicts: 0,
    conflictsTotal: 0,
    domainEdgeViolations: 0,
    referenceChainsWithTypedIds: 0,
    referenceChainsInvalidDomain: 0,
    brokenEdges: 0,
    duplicateCanonicalIds: 0,
    directLookupDisplayToOracleColumns: 0,
    dotnetNamesTypedAsOracleObjects: 0,
    confirmedOracleObjectsWithUnknownOwner: 0,
    staleOrphanReferences: 0,
    referenceChainsContainingUnknownConfirmedOracle: 0,
    examples: {
      invalidOracleCandidatesDotnet: [],
      invalidOracleCandidatesDatasetColumn: [],
      datasetColumnsCreated: [],
      domainEdgeViolations: [],
      unexpectedOrphans: [],
      invalidDomainOrphans: [],
      directLookupDisplayToOracleColumns: [],
      dotnetNamesTypedAsOracleObjects: [],
      confirmedOracleObjectsWithUnknownOwner: [],
    },
  };
}
