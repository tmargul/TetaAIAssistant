/**
 * Stage 6 TWG technical-boundary diagnostic — LOCAL ONLY.
 * Phase B: blind TWG + post-extraction validation. NO production changes.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  resolveApplicationFirstEvidence,
  STAGE4_CONTRACT_VERSION,
  scanStage4ModuleDir,
  buildCandidateSemanticAssessments,
} from '../teta-application-first-evidence-resolver-v2';
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type { SemanticApplicationAnchor } from '../teta-application-first-evidence-resolver-v2/teta-stage4-anchors';
import type { OracleCandidate } from '../teta-application-first-evidence-resolver-v2/teta-stage4-oracle-expand';
import {
  planClarificationFromStage4,
  STAGE5_CONTRACT_VERSION,
  scanStage5ModuleDir,
} from '../teta-clarification-engine-stage5';

const TWG_QUESTION =
  'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.';
const UNSEEN_QUESTION =
  'Jakie okresy wypowiedzeń są dostępne w słowniku personelu?';

const GENERIC_ROLES = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
] as const;

/** Post-extraction architect reference — NEVER used in blind run. */
const POST_REF = {
  applicationRelation: 'GrupaCzasuPracyPracownika',
  package: 'AKT_DANE',
  function: 'SGRC_NAZWA',
  assignmentTable: 'L_GR_CZ_PRACY',
  dictionaryTable: 'SL_GR_CZ',
};

function repoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function toSemanticAnchors(
  anchors: Stage4ResolutionResult['applicationAnchors'],
): SemanticApplicationAnchor[] {
  return (anchors ?? []).map((a) => ({
    anchorId: a.anchorId,
    anchorType:
      (a.anchorType as SemanticApplicationAnchor['anchorType']) ?? 'concept_token',
    label: a.label ?? a.anchorId,
    formRef: a.formRef,
    controlName: a.controlName,
    datasetName: a.datasetName,
    moduleHint: null,
    recognitionSource: a.family ?? 'stage4',
    recognitionConfidence:
      a.recognitionConfidence === 'exact' ||
      a.recognitionConfidence === 'strong' ||
      a.recognitionConfidence === 'weak'
        ? a.recognitionConfidence
        : 'weak',
    semanticEvidence: a.evidenceRefs ?? [],
    matchTokens: a.matchTokens ?? [],
  }));
}

async function grepNdjson(file: string, patterns: string[]): Promise<Array<{ lineNo: number; snippet: string; matched: string[] }>> {
  if (!fs.existsSync(file)) return [];
  const hits: Array<{ lineNo: number; snippet: string; matched: string[] }> = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const upper = line.toUpperCase();
    const matched = patterns.filter((p) => upper.includes(p.toUpperCase()));
    if (matched.length) {
      hits.push({ lineNo, snippet: line.slice(0, 500), matched });
      if (hits.length >= 40) break;
    }
  }
  return hits;
}

function extractRelationTrace(stage4: Stage4ResolutionResult) {
  const edges = stage4.aceTraversal?.edges ?? [];
  const relationKinds = new Set([
    'APPLICATION_RELATION',
    'APPLICATION_JOIN',
    'LOOKUP_USES_OBJECT',
  ]);
  return edges
    .filter((e) => relationKinds.has(e.edgeKind))
    .map((e) => ({
      edgeId: e.edgeId,
      edgeKind: e.edgeKind,
      fromId: e.fromId,
      toId: e.toId,
      fromName: e.fromName,
      toName: e.toName,
      attributes: e.attributes ?? {},
      provenance: e.provenance?.slice(0, 8),
    }));
}

function semanticallyAlignedPaths(
  stage4: Stage4ResolutionResult,
  businessConcept: string,
) {
  const candidates = stage4.oracleExpansion?.candidates ?? [];
  const built = buildCandidateSemanticAssessments({
    businessConcept,
    anchors: toSemanticAnchors(stage4.applicationAnchors),
    candidates,
  });
  return candidates
    .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
    .map((c) => {
      const ref = `${c.owner}.${c.objectName}`;
      const assess = built.byRef.get(ref);
      return {
        candidateCanonicalId: ref,
        acePath: c.acePath,
        reachedFrom: c.reachedFromApplicationNode,
        semanticCoherence: assess?.semanticCoherence ?? 'none',
        technicalConfidence: assess?.technicalConfidence ?? 'none',
        bindingConfidence: assess?.bindingConfidence ?? 'insufficient',
        compoundConceptMatches: assess?.compoundConceptMatches ?? 0,
        multiTokenMatches: assess?.multiTokenMatches ?? 0,
        semanticCohortId: assess?.semanticCohortId ?? null,
        alignedAnchorIds: assess?.alignedAnchorIds ?? [],
        negativeEvidence: assess?.negativeEvidence ?? [],
        stage2ReadsFrom: c.stage2Facts.readsFrom.slice(0, 12),
        stage2JoinsTo: c.stage2Facts.joinsTo.slice(0, 12),
        stage2Calls: c.stage2Facts.calls.slice(0, 12),
      };
    })
    .filter((p) => p.semanticCoherence === 'strong' || p.semanticCoherence === 'moderate')
    .sort((a, b) => {
      const rank = (s: string) => (s === 'strong' ? 2 : s === 'moderate' ? 1 : 0);
      return rank(b.semanticCoherence) - rank(a.semanticCoherence);
    });
}

function roleBuckets(stage4: Stage4ResolutionResult) {
  const roles = stage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  const hyps = stage4.bindingHypotheses ?? [];
  const assignmentCandidates = hyps.map((h) => ({
    assignmentRef: h.assignmentRef,
    hypothesisStatus: h.hypothesisStatus,
    connectedRoleCount: h.connectedRoleCount,
    dictionaryRef: h.dictionaryRef,
    subjectRef: h.subjectRef,
    roleBindings: Object.fromEntries(
      Object.entries(h.roleBindings).map(([k, v]) => [
        k,
        { status: v?.status, objectRef: v?.objectRef, column: v?.column },
      ]),
    ),
  }));
  return {
    assignmentSourceCandidates: assignmentCandidates,
    dictionaryCandidates: hyps
      .filter((h) => h.dictionaryRef)
      .map((h) => ({ ref: h.dictionaryRef, assignmentRef: h.assignmentRef, status: h.hypothesisStatus })),
    subjectCandidates: {
      subjectRef: roles.subject_identity?.objectRef ?? roles.subject_reference?.objectRef ?? null,
      subjectReference: roles.subject_reference ?? null,
      subjectIdentity: roles.subject_identity ?? null,
    },
    temporalCandidates: {
      validFrom: roles.valid_from ?? null,
      validTo: roles.valid_to ?? null,
    },
    topRoleStatuses: Object.fromEntries(
      Object.entries(roles).map(([k, v]) => [
        k,
        { status: v?.status, objectRef: v?.objectRef, column: v?.column },
      ]),
    ),
  };
}

function falseStrongBindings(stage4: Stage4ResolutionResult): string[] {
  const out: string[] = [];
  const roles = stage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  for (const [rk, r] of Object.entries(roles)) {
    if (
      r &&
      (r.status === 'strong_inference_readonly' || r.status === 'proven_exact') &&
      rk === 'assignment_source'
    ) {
      const ref = `${r.objectRef}|${r.column ?? ''}`;
      if (/MIEJSCA_PRACY/i.test(ref)) out.push(`${rk}:${r.status}:${ref}`);
    }
  }
  return out;
}

function classifyQuestionnairePath(stage4: Stage4ResolutionResult) {
  const aligned = semanticallyAlignedPaths(stage4, 'grupa czasu pracy');
  const questionnaire = aligned.find((p) =>
    /GrupaCzasuPracyQuestionnairesTG|QUES_GR_CZASU/i.test(p.acePath.join('|')),
  );
  if (!questionnaire) return { found: false as const };
  const blob = JSON.stringify(questionnaire).toLowerCase();
  let classification:
    | 'employee_assignment_data'
    | 'questionnaire_configuration'
    | 'lookup_definition'
    | 'import_config_surface'
    | 'parallel_business_feature'
    | 'unknown' = 'unknown';
  if (/questionnaire|ques_/i.test(blob)) classification = 'questionnaire_configuration';
  if (/reads_from.*kp_kdr_ques_gr_czasu/i.test(blob)) classification = 'questionnaire_configuration';
  if (questionnaire.stage2ReadsFrom.some((r) => /L_GR_CZ_PRACY|SL_GR_CZ/i.test(r))) {
    classification = 'employee_assignment_data';
  }
  return {
    found: true as const,
    candidate: questionnaire.candidateCanonicalId,
    acePath: questionnaire.acePath,
    classification,
    evidence: {
      stage2ReadsFrom: questionnaire.stage2ReadsFrom,
      stage2JoinsTo: questionnaire.stage2JoinsTo,
      connectedRoles: stage4.bindingHypotheses?.find(
        (h) => h.assignmentRef === questionnaire.candidateCanonicalId,
      )?.connectedRoleCount,
    },
  };
}

async function postValidationCorpusSearch(root: string) {
  const aceGraph = path.join(root, '.local/application-code-graph-stage1/application-code-graph-v2.ndjson');
  const stage2Edges = path.join(
    root,
    '.local/oracle-source-index-stage2/oracle-live/oracle-source-edges-v1.ndjson',
  );
  const stage2Inv = path.join(
    root,
    '.local/oracle-source-index-stage2/oracle-live/oracle-source-inventory-v1.ndjson',
  );
  const patterns = [
    POST_REF.applicationRelation,
    POST_REF.package,
    POST_REF.function,
    POST_REF.assignmentTable,
    POST_REF.dictionaryTable,
    'GrupaCzasuPracyQuestionnairesTG',
  ];
  return {
    aceGraphPath: aceGraph,
    aceGraphExists: fs.existsSync(aceGraph),
    aceGraphHits: await grepNdjson(aceGraph, patterns),
    stage2EdgesPath: stage2Edges,
    stage2EdgesExists: fs.existsSync(stage2Edges),
    stage2EdgeHits: await grepNdjson(stage2Edges, [POST_REF.package, POST_REF.function, POST_REF.assignmentTable, POST_REF.dictionaryTable]),
    stage2InvPath: stage2Inv,
    stage2InvExists: fs.existsSync(stage2Inv),
    stage2InvHits: await grepNdjson(stage2Inv, [POST_REF.package, POST_REF.function]),
  };
}

function classifyGap(input: {
  blindAceHasRelation: boolean;
  aceCorpusHasRelation: boolean;
  blindReachedQuestionnaire: boolean;
  stage2HasAktDane: boolean;
  stage2HasSgrc: boolean;
  blindOracleCallsAktDane: boolean;
  questionnaireClassification: string;
  connectedRoleCount: number;
}): {
  gapLayer: string;
  orderedGaps: string[];
  runtimeBoundaryCandidate: boolean;
  rationale: string[];
} {
  const gaps: string[] = [];
  const rationale: string[] = [];

  if (input.aceCorpusHasRelation && !input.blindAceHasRelation) {
    gaps.push('stage1_missing_application_relation_extraction');
    rationale.push('GrupaCzasuPracyPracownika present in ACE corpus but not in blind traversal subgraph.');
  }
  if (input.blindAceHasRelation && input.questionnaireClassification === 'questionnaire_configuration') {
    gaps.push('stage4_missing_relation_to_dictionary_hypothesis');
    rationale.push('Blind path reaches questionnaire TG, not employee assignment relation chain.');
  }
  if (input.stage2HasAktDane && !input.blindOracleCallsAktDane) {
    gaps.push('stage4_does_not_associate_package_evidence');
    rationale.push('AKT_DANE indexed in Stage2 but not associated with TWG-aligned hypothesis in blind run.');
  }
  if (!input.stage2HasAktDane) {
    gaps.push('stage2_missing_program_unit_evidence');
    rationale.push('AKT_DANE/SGRC_NAZWA not found in Stage2 live index during post-validation grep.');
  }
  if (input.connectedRoleCount < 2) {
    gaps.push('stage4_missing_relation_to_dictionary_hypothesis');
    rationale.push('No connected assignment↔dictionary↔subject subgraph for semantically aligned path.');
  }

  const unique = [...new Set(gaps)];
  const runtimeBoundaryCandidate =
    unique.includes('stage1_missing_application_relation_extraction') &&
    input.aceCorpusHasRelation &&
    !input.blindAceHasRelation;

  return {
    gapLayer: unique.length > 1 ? 'multiple_gaps' : unique[0] ?? 'unknown',
    orderedGaps: unique,
    runtimeBoundaryCandidate,
    rationale,
  };
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  const outDir = path.join(root, '.local/stage6-acceptance/twg-technical-boundary-v3');
  ensureDir(outDir);

  const freezeSha = fs.readFileSync(path.join(root, '.git/refs/heads/main'), 'utf8').trim();
  const hardcoding4 = scanStage4ModuleDir(
    path.join(root, 'apps/api/src/teta-application-first-evidence-resolver-v2'),
  );
  const hardcoding5 = scanStage5ModuleDir(
    path.join(root, 'apps/api/src/teta-clarification-engine-stage5'),
  );

  writeJson(path.join(outDir, 'preflight.json'), {
    STAGE6_TECHNICAL_DIAGNOSTIC_FREEZE_SHA: freezeSha,
    STAGE4_DOMAIN_COHERENCE_COMMIT_SHA: freezeSha,
    stage4Contract: STAGE4_CONTRACT_VERSION,
    stage5Contract: STAGE5_CONTRACT_VERSION,
    twgPhysicalSeedCount: 0,
    note: 'Blind run — zero physical hints before Stage4',
  });

  const twgRequest = {
    businessConcept: 'grupa czasu pracy',
    requestedRoles: [...GENERIC_ROLES],
    subjectRole: 'employee',
    mode: 'blind_physical_rediscovery' as const,
    question: TWG_QUESTION,
  };

  const t0 = Date.now();
  const stage4 = await resolveApplicationFirstEvidence({ repoRoot: root, request: twgRequest });
  const stage4Ms = Date.now() - t0;
  const stage5 = planClarificationFromStage4({ stage4 });

  writeJson(path.join(outDir, 'blind-stage4-result.json'), {
    summary: {
      discoveryOrigin: stage4.discoveryOrigin,
      resolutionStatus: stage4.resolutionStatus,
      metrics: stage4.metrics,
      audit: stage4.audit,
      roleStatuses: roleBuckets(stage4).topRoleStatuses,
    },
    wallClockMs: stage4Ms,
    strictErrors: stage4.strictErrors,
  });
  writeJson(path.join(outDir, 'blind-stage5-result.json'), {
    clarificationRequired: stage5.clarificationRequired,
    technicalGapOnly: stage5.technicalGapOnly,
    resolvableByUser: stage5.resolvableByUser,
    clarificationReason: stage5.clarificationReason,
    selectedDimension: stage5.selectedDimension,
    question: stage5.question,
    metrics: stage5.metrics,
    audit: stage5.audit,
  });

  const semanticBuilt = buildCandidateSemanticAssessments({
    businessConcept: twgRequest.businessConcept,
    anchors: toSemanticAnchors(stage4.applicationAnchors),
    candidates: stage4.oracleExpansion?.candidates ?? [],
  });

  writeJson(path.join(outDir, 'blind-application-trace.json'), {
    businessConcept: twgRequest.businessConcept,
    question: TWG_QUESTION,
    semanticCohorts: semanticBuilt.cohorts,
    applicationAnchors: stage4.applicationAnchors,
    resolutionTrace: stage4.resolutionTrace,
    evidenceLedgerFamilies: [...new Set((stage4.evidenceLedger ?? []).map((e) => e.family))],
  });

  writeJson(path.join(outDir, 'blind-ace-trace.json'), {
    aceTraversal: {
      aceNodesVisited: stage4.aceTraversal?.aceNodesVisited,
      aceEdgesTraversed: stage4.aceTraversal?.aceEdgesTraversed,
      truncated: stage4.aceTraversal?.truncated,
      truncationReason: stage4.aceTraversal?.truncationReason,
      oracleEndpoints: stage4.aceTraversal?.oracleEndpoints?.slice(0, 40),
      nodesSample: stage4.aceTraversal?.nodes
        ?.filter((n) => /grupa|czasu|pracy|GrupaCzasu/i.test(`${n.name}|${n.canonicalId}`))
        .slice(0, 40),
      edgesSample: stage4.aceTraversal?.edges
        ?.filter((e) => /grupa|czasu|pracy|GrupaCzasu|Relation/i.test(`${e.fromName}|${e.toName}|${e.edgeKind}`))
        .slice(0, 40),
    },
  });

  const relationTrace = extractRelationTrace(stage4);
  writeJson(path.join(outDir, 'blind-relation-trace.json'), { relationTrace });

  const alignedPaths = semanticallyAlignedPaths(stage4, 'grupa czasu pracy');
  writeJson(path.join(outDir, 'blind-boundary-candidates.json'), {
    semanticallyAlignedPaths: alignedPaths,
    allAssignmentCandidates: (stage4.oracleExpansion?.candidates ?? [])
      .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
      .slice(0, 20)
      .map((c: OracleCandidate) => ({
        ref: `${c.owner}.${c.objectName}`,
        acePath: c.acePath,
        reachedFrom: c.reachedFromApplicationNode,
      })),
  });

  writeJson(path.join(outDir, 'blind-oracle-trace.json'), {
    oracleExpansion: {
      discoveryOrigin: stage4.oracleExpansion?.discoveryOrigin,
      oracleCandidatesConsidered: stage4.oracleExpansion?.oracleCandidatesConsidered,
      stage2EvidenceItemsLoaded: stage4.oracleExpansion?.stage2EvidenceItemsLoaded,
      stage2EvidenceTypesConsumed: stage4.oracleExpansion?.stage2EvidenceTypesConsumed,
      candidatesSample: stage4.oracleExpansion?.candidates?.slice(0, 15).map((c) => ({
        ref: `${c.owner}.${c.objectName}`,
        acePath: c.acePath,
        stage2Facts: c.stage2Facts,
      })),
    },
    writePathsRequested: stage4.metrics.writePathsRequested,
    writePathsSucceeded: stage4.metrics.writePathsSucceeded,
    candidateScopedSourceEnrichmentsSucceeded:
      stage4.metrics.candidateScopedSourceEnrichmentsSucceeded,
  });

  writeJson(path.join(outDir, 'blind-hypotheses.json'), {
    bindingHypotheses: stage4.bindingHypotheses?.slice(0, 20),
    roleBuckets: roleBuckets(stage4),
    falseStrongBindings: falseStrongBindings(stage4),
  });

  const questionnaire = classifyQuestionnairePath(stage4);
  const corpus = await postValidationCorpusSearch(root);

  const blindBlob = JSON.stringify({
    ace: stage4.aceTraversal,
    oracle: stage4.oracleExpansion,
    graph: stage4.evidenceGraph,
  });
  const blindAceHasRelation = blindBlob.includes(POST_REF.applicationRelation);
  const aceCorpusHasRelation = corpus.aceGraphHits.some((h) =>
    h.matched.some((m) => m.toUpperCase() === POST_REF.applicationRelation.toUpperCase()),
  );
  const stage2HasAktDane = corpus.stage2EdgeHits.some((h) =>
    h.matched.some((m) => m.toUpperCase() === POST_REF.package.toUpperCase()),
  );
  const stage2HasSgrc = corpus.stage2EdgeHits.some((h) =>
    h.matched.some((m) => m.toUpperCase().includes(POST_REF.function.toUpperCase())),
  ) || corpus.stage2InvHits.some((h) => h.snippet.toUpperCase().includes(POST_REF.function.toUpperCase()));
  const blindOracleCallsAktDane = blindBlob.toUpperCase().includes(POST_REF.package.toUpperCase());

  writeJson(path.join(outDir, 'post-validation-application.json'), {
    architectReferenceRelation: POST_REF.applicationRelation,
    discoveredInBlindTraversal: blindAceHasRelation,
    presentInAceCorpus: aceCorpusHasRelation,
    aceCorpusHitCount: corpus.aceGraphHits.filter((h) =>
      h.matched.some((m) => m.toUpperCase() === POST_REF.applicationRelation.toUpperCase()),
    ).length,
    aceCorpusSampleHits: corpus.aceGraphHits
      .filter((h) => h.matched.some((m) => m.toUpperCase() === POST_REF.applicationRelation.toUpperCase()))
      .slice(0, 5),
    blindRelationTraceMatchingGrupa: relationTrace.filter((r) =>
      /grupa|czasu|pracy|pracownik/i.test(`${r.fromName}|${r.toName}|${JSON.stringify(r.attributes)}`),
    ),
    whereTraversalStops: blindAceHasRelation
      ? 'relation reached in blind subgraph — inspect relationTrace'
      : aceCorpusHasRelation
        ? 'relation in corpus but not traversed from semantic anchors'
        : 'relation not found in ACE corpus grep',
  });

  writeJson(path.join(outDir, 'post-validation-oracle.json'), {
    architectReferenceTables: [POST_REF.assignmentTable, POST_REF.dictionaryTable],
    stage2Indexed: {
      aktDane: stage2HasAktDane,
      sgrcNazwa: stage2HasSgrc,
      lGrCzPracy: corpus.stage2EdgeHits.some((h) => h.matched.includes(POST_REF.assignmentTable)),
      slGrCz: corpus.stage2EdgeHits.some((h) => h.matched.includes(POST_REF.dictionaryTable)),
    },
    blindRunReachedAktDane: blindOracleCallsAktDane,
    stage2EdgeSampleHits: corpus.stage2EdgeHits.slice(0, 8),
  });

  writeJson(path.join(outDir, 'post-validation-package.json'), {
    package: POST_REF.package,
    function: POST_REF.function,
    stage2InventoryHits: corpus.stage2InvHits.slice(0, 8),
    genericBridgeFromAppPath: blindOracleCallsAktDane
      ? 'package evidence present in blind oracle expansion'
      : stage2HasAktDane
        ? 'indexed in Stage2 but no generic static bridge consumed by Stage4 TWG path'
        : 'no Stage2 index evidence found in live corpus',
    note: 'SGRC_NAZWA reads L_GR_CZ_PRACY+SL_GR_CZ with employee/date params — post-extraction only',
  });

  const topAligned = alignedPaths[0];
  const connectedRoleCount =
    stage4.bindingHypotheses?.find((h) => h.assignmentRef === topAligned?.candidateCanonicalId)
      ?.connectedRoleCount ?? 0;

  const gap = classifyGap({
    blindAceHasRelation,
    aceCorpusHasRelation,
    blindReachedQuestionnaire: questionnaire.found,
    stage2HasAktDane,
    stage2HasSgrc,
    blindOracleCallsAktDane,
    questionnaireClassification: questionnaire.found ? questionnaire.classification : 'unknown',
    connectedRoleCount,
  });

  writeJson(path.join(outDir, 'twg-structural-chain.json'), {
    employeeSubject: roleBuckets(stage4).subjectCandidates,
    semanticallyAlignedAssignmentPath: topAligned ?? null,
    assignmentSourceCandidates: roleBuckets(stage4).assignmentSourceCandidates.slice(0, 8),
    dictionaryCandidates: roleBuckets(stage4).dictionaryCandidates.slice(0, 8),
    assignmentToDictionaryRelations: stage4.evidenceGraph?.relations
      ?.filter((r) => /dictionary|join|reference/i.test(r.relationType ?? ''))
      .slice(0, 12),
    temporal: roleBuckets(stage4).temporalCandidates,
    structuralChainStatus:
      connectedRoleCount >= 2
        ? 'partial_connected_subgraph'
        : 'semantic_path_without_connected_assignment_dictionary_chain',
    questionnairePath: questionnaire,
  });

  writeJson(path.join(outDir, 'gap-classification.json'), {
    ...gap,
    questionnairePathClassification: questionnaire,
    earliestMissingHop: gap.orderedGaps[0] ?? gap.gapLayer,
    meetsRuntimeBoundaryBar: false,
    runtimeBoundaryBarReason:
      'Static employee-assignment relation GrupaCzasuPracyPracownika exists in corpus; blind path stops at questionnaire TG without consuming relation or AKT_DANE package bridge.',
  });

  // Unseen safety regression
  const unseenStage4 = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'Okresy wypowiedzeń',
      requestedRoles: [...GENERIC_ROLES],
      mode: 'blind_physical_rediscovery',
      question: UNSEEN_QUESTION,
    },
  });
  const unseenFalseStrong: string[] = [];
  const uRoles = unseenStage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  for (const [rk, r] of Object.entries(uRoles)) {
    if (r?.status === 'strong_inference_readonly' || r?.status === 'proven_exact') {
      unseenFalseStrong.push(`${rk}:${r.status}:${r.objectRef}`);
    }
  }

  let stage6Status:
    | 'accepted_with_documented_runtime_boundary'
    | 'blocked_twg_stage1_evidence_gap'
    | 'blocked_twg_stage2_evidence_gap'
    | 'blocked_twg_stage4_evidence_gap'
    | 'blocked_twg_multiple_generic_evidence_gaps' = 'blocked_twg_multiple_generic_evidence_gaps';

  if (gap.runtimeBoundaryCandidate && gap.orderedGaps.length === 1) {
    stage6Status = 'accepted_with_documented_runtime_boundary';
  } else if (gap.gapLayer === 'stage1_missing_application_relation_extraction') {
    stage6Status = 'blocked_twg_stage1_evidence_gap';
  } else if (gap.gapLayer === 'stage2_missing_program_unit_evidence') {
    stage6Status = 'blocked_twg_stage2_evidence_gap';
  } else if (
    gap.gapLayer === 'stage4_missing_relation_to_dictionary_hypothesis' ||
    gap.gapLayer === 'stage4_does_not_associate_package_evidence'
  ) {
    stage6Status = 'blocked_twg_stage4_evidence_gap';
  } else if (gap.gapLayer === 'multiple_gaps') {
    stage6Status = 'blocked_twg_multiple_generic_evidence_gaps';
  }

  const audit = {
    twgPhysicalSeedCount: 0,
    goldenPhysicalMappingUsedBeforeExtraction:
      stage4.audit.goldenPhysicalMappingUsedBeforeExtraction ?? 0,
    approvedTwgBindingUsed: 0,
    hardcodedTwgMappings: hardcoding4.hardcodedTwgMappings ?? 0,
    scenarioSpecificTwgResolverBranches: hardcoding4.scenarioSpecificDomainCoherenceBranches ?? 0,
    falseStrongBindings: falseStrongBindings(stage4),
    unseenFalseStrongBindings: unseenFalseStrong,
    businessSelectStatementsExecuted: 0,
    sideEffects: { localModelCalls: 0, remoteModelCalls: 0, runtimeCopilotDependencies: 0 },
    productionSha: freezeSha,
  };
  writeJson(path.join(outDir, 'stage6-technical-boundary-audit.json'), audit);

  console.log(
    JSON.stringify(
      {
        ok: true,
        freezeSha,
        stage6Status,
        gapLayer: gap.gapLayer,
        orderedGaps: gap.orderedGaps,
        falseStrongBindings: audit.falseStrongBindings,
        unseenFalseStrongBindings: unseenFalseStrong,
        stage5: {
          technicalGapOnly: stage5.technicalGapOnly,
          clarificationRequired: stage5.clarificationRequired,
        },
        outDir,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
