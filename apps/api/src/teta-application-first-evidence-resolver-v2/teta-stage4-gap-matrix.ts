export type Stage4GapRow = {
  capability: string;
  existingImplementation: string;
  existingEvidence: string;
  missingConnection: string;
  stage4Action: string;
};

export const STAGE4_GAP_MATRIX: Stage4GapRow[] = [
  {
    capability: 'business concept → application semantic anchors',
    existingImplementation: 'teta-stage4-anchors + lexicon',
    existingEvidence: 'PA registry + concept tokens',
    missingConnection: 'none — implemented',
    stage4Action: 'resolveApplicationAnchors',
  },
  {
    capability: 'ACE traversal control→dataset→BO→TG→Oracle',
    existingImplementation: 'teta-stage4-ace-traverse',
    existingEvidence: 'Stage1 application-code-graph-v2.ndjson',
    missingConnection: 'none — implemented',
    stage4Action: 'traverseApplicationGraph',
  },
  {
    capability: 'Stage 2 canonical Oracle evidence',
    existingImplementation: 'teta-stage4-oracle-expand',
    existingEvidence: 'oracle-live edges + inventory',
    missingConnection: 'column/PK/FK still limited in Stage2 index',
    stage4Action: 'expandOracleEvidence bounded stream',
  },
  {
    capability: 'Stage 3 conditional write-path',
    existingImplementation: 'teta-stage4-planner decideStage3Request',
    existingEvidence: 'analyzeWritePath',
    missingConnection: 'none — optional hook live',
    stage4Action: 'request when DAC/multi-target ambiguity',
  },
  {
    capability: 'evidence → logical role binding',
    existingImplementation: 'teta-stage4-bind + Stage 0',
    existingEvidence: 'ACE attributes, Stage2 join pairs, lookup metadata, Stage3 writers',
    missingConnection: 'none — derived evidence records over canonical facts',
    stage4Action: 'bindEvidenceToRoleGraph',
  },
  {
    capability: 'blind rediscovery',
    existingImplementation: 'discoveryMode blind + no Stage3D in blind',
    existingEvidence: 'ACE+Stage2 only',
    missingConnection: 'none',
    stage4Action: 'mode=blind_physical_rediscovery',
  },
  {
    capability: 'documentation semantic evidence',
    existingImplementation: 'contract pass-through',
    existingEvidence: 'none required for MVP',
    missingConnection: 'no RAG wired',
    stage4Action: 'keep contract-only',
  },
  {
    capability: 'scenario-specific physical branches',
    existingImplementation: 'removed',
    existingEvidence: 'scenarioSpecificPhysicalResolutionBranches=0',
    missingConnection: 'none',
    stage4Action: 'single generic pipeline',
  },
];
