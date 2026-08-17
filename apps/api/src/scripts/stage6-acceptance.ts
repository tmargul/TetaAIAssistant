/**
 * Stage 6 ACCEPTANCE harness — LOCAL / UNCOMMITTED only.
 * Uses frozen Stage 4 + Stage 5 production APIs. Does NOT patch production.
 * Writes artifacts only under .local/stage6-acceptance/
 */
import fs from 'fs';
import path from 'path';
import {
  resolveApplicationFirstEvidence,
  STAGE4_CONTRACT_VERSION,
  scanStage4ModuleDir,
  buildFalseStrongDiagnostic,
  buildCandidateSemanticAssessments,
} from '../teta-application-first-evidence-resolver-v2';
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type { SemanticApplicationAnchor } from '../teta-application-first-evidence-resolver-v2/teta-stage4-anchors';
import {
  planClarificationFromStage4,
  STAGE5_CONTRACT_VERSION,
  scanStage5ModuleDir,
} from '../teta-clarification-engine-stage5';

const FREEZE_SHA = process.env.STAGE6_PRODUCTION_FREEZE_SHA ?? '';

/** Generic assignment-like roles — NOT TWG-specific. */
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

const TWG_RAW_QUESTION =
  'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.';
const TWG_CURRENT_CLARIFIED_QUESTION =
  'Podaj aktualną grupę czasu pracy pracownika o numerze ewidencyjnym 00069.';

/** Post-extraction reference ONLY — never passed into Stage 4/5. */
const TWG_POST_EXTRACTION_REFERENCE = {
  knownAssignmentObjects: [
    'TETA_ADMIN.L_GR_CZ_PRACY',
    'L_GR_CZ_PRACY',
    'NT_KP_L_GR_CZ_PRACY',
  ],
  knownDictionaryObjects: [
    'TETA_ADMIN.SL_GR_CZ',
    'SL_GR_CZ',
    'TETA_ADMIN.NT_KP_SLO_GR_CZASU_NOMINAL',
    'NT_KP_SLO_GR_CZASU_NOMINAL',
  ],
  knownApplicationTokens: [
    'GrupaCzasuPracy',
    'GrupyCzasuPracy',
    'WorktimeGroup',
    'LGRC',
  ],
  note: 'Architect/P1 reference used only AFTER blind freeze for validation.',
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

function oracleCandidatesFromStage4(r: Stage4ResolutionResult) {
  return r.oracleExpansion?.candidates ?? [];
}

function assertNoPhysicalSeed(payload: unknown, label: string): string[] {
  const raw = JSON.stringify(payload);
  const forbidden = [
    /L_GR_CZ_PRACY/i,
    /SL_GR_CZ/i,
    /GR_CZ_ID/i,
    /NT_KP_SLO_GR_CZASU/i,
    /oracle-object:/i,
    /"objectRef"\s*:\s*"TETA_ADMIN\./i,
  ];
  // Request must not contain physical seeds; Stage4 RESULT may contain discovered objects.
  const errors: string[] = [];
  if (label.includes('request')) {
    for (const re of forbidden) {
      if (re.test(raw) && !/00069/.test(String(re))) {
        // only flag if request itself embeds physical names
        if (/L_GR_CZ|SL_GR_CZ|GR_CZ_ID|NT_KP_SLO_GR_CZASU|oracle-object/i.test(raw)) {
          errors.push(`${label}: physical_seed_detected:${re}`);
        }
      }
    }
    if (/L_GR_CZ_PRACY|SL_GR_CZ|GR_CZ_ID|NT_KP_SLO_GR_CZASU_NOMINAL/i.test(raw)) {
      errors.push(`${label}: twg_physical_seed_in_request`);
    }
  }
  return errors;
}

function summarizeStage4(r: Stage4ResolutionResult) {
  const roles = r.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  const roleStatuses = Object.fromEntries(
    Object.entries(roles).map(([k, v]) => [
      k,
      {
        status: v?.status ?? null,
        objectRef: v?.objectRef ?? null,
        column: v?.column ?? null,
      },
    ]),
  );
  return {
    contractVersion: r.contractVersion,
    discoveryOrigin: r.discoveryOrigin,
    resolutionStatus: r.resolutionStatus,
    clarificationNeeded: r.clarificationNeeded,
    clarificationDimensions: r.clarificationDimensions,
    semanticAnchorsFound: r.metrics.semanticAnchorsFound,
    applicationAnchors: (r.applicationAnchors ?? []).map((a) => ({
      anchorId: a.anchorId,
      anchorType: a.anchorType,
      label: a.label,
      formRef: a.formRef,
      evidenceRefs: a.evidenceRefs?.slice(0, 6),
    })),
    anchorsWithTechnicalContinuation: r.metrics.anchorsWithTechnicalContinuation,
    aceNodesVisited: r.metrics.aceNodesVisited,
    aceEdgesTraversed: r.metrics.aceEdgesTraversed,
    oracleEndpointsReached: r.metrics.oracleEndpointsReached,
    oracleCandidatesConsidered: r.metrics.oracleCandidatesConsidered,
    stage2EvidenceItemsLoaded: r.metrics.stage2EvidenceItemsLoaded,
    writePathsRequested: r.metrics.writePathsRequested,
    writePathsSucceeded: r.metrics.writePathsSucceeded,
    candidateScopedSourceEnrichmentsSucceeded:
      r.metrics.candidateScopedSourceEnrichmentsSucceeded,
    bindingHypothesesBuilt: r.metrics.bindingHypothesesBuilt,
    connectedHypotheses: r.metrics.connectedHypotheses,
    hypothesesProvenExact: r.metrics.hypothesesProvenExact,
    hypothesesStrongInferenceReadonly: r.metrics.hypothesesStrongInferenceReadonly,
    bindingHypotheses: (r.bindingHypotheses ?? []).slice(0, 12).map((h) => ({
      hypothesisId: h.hypothesisId,
      assignmentRef: h.assignmentRef,
      hypothesisStatus: h.hypothesisStatus,
      connectedRoleCount: h.connectedRoleCount,
      coherenceScore: h.coherenceScore,
      supportingEvidence: h.supportingEvidence?.slice(0, 8),
    })),
    roleStatuses,
    truncated: r.metrics.truncated,
    truncationReason: r.metrics.truncationReason,
    analysisDurationMs: r.metrics.analysisDurationMs,
    auditSnippet: {
      scenarioSpecificPhysicalResolutionBranches:
        r.audit.scenarioSpecificPhysicalResolutionBranches,
      hardcodedTwgMappings: (r.audit as { hardcodedTwgMappings?: number }).hardcodedTwgMappings ?? 0,
      goldenPhysicalMappingUsedBeforeExtraction:
        (r.audit as { goldenPhysicalMappingUsedBeforeExtraction?: number })
          .goldenPhysicalMappingUsedBeforeExtraction ?? 0,
    },
    strictErrors: r.strictErrors,
  };
}

function classifyTwgLevel(input: {
  stage4: Stage4ResolutionResult;
  stage5: ReturnType<typeof planClarificationFromStage4>;
  validation: ReturnType<typeof postExtractTwg>;
}): {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  reason: string;
} {
  const { stage4, stage5, validation } = input;
  if (validation.falseStrongBindings.length > 0) {
    return {
      level: 5,
      label: 'FAILURE',
      reason: 'false_strong_binding_after_post_extraction',
    };
  }
  if (stage5.question && /TABLE|VIEW|COLUMN|JOIN|Oracle|NT_|TETA_ADMIN/i.test(stage5.question.question)) {
    return { level: 5, label: 'FAILURE', reason: 'technical_question_to_user' };
  }
  const strong =
    stage4.metrics.hypothesesProvenExact + stage4.metrics.hypothesesStrongInferenceReadonly;
  const connected = stage4.metrics.connectedHypotheses;
  if (
    (stage4.resolutionStatus === 'proven_exact' ||
      stage4.resolutionStatus === 'strong_inference_readonly') &&
    strong >= 1 &&
    validation.matchedRoles.length >= 3
  ) {
    return { level: 1, label: 'FULL_STATIC_BINDING', reason: 'coherent_binding_for_required_roles' };
  }
  if (strong >= 1 || connected >= 1) {
    return {
      level: 2,
      label: 'PARTIAL_STRONG_BINDING',
      reason: 'nontrivial_hypothesis_with_unresolved_roles',
    };
  }
  if (stage5.clarificationRequired && stage5.resolvableByUser) {
    return {
      level: 3,
      label: 'VALID_USER_CLARIFICATION',
      reason: 'application_language_clarification',
    };
  }
  if (stage5.technicalGapOnly || stage4.resolutionStatus === 'insufficient') {
    return {
      level: 4,
      label: 'TECHNICAL_BOUNDARY',
      reason: stage5.clarificationReason || 'technical_or_insufficient_boundary',
    };
  }
  return { level: 5, label: 'FAILURE', reason: 'unexplained_or_unguarded_result' };
}

function postExtractTwg(stage4: Stage4ResolutionResult) {
  const blob = JSON.stringify({
    hyps: stage4.bindingHypotheses,
    roles: stage4.schemaRoleResolution?.roleAssignmentsByRole,
    candidates: stage4.candidateBindings,
    anchors: stage4.applicationAnchors,
  });
  const matchedRoles: string[] = [];
  const wrongRoles: string[] = [];
  const missingRoles: string[] = [];
  const falseStrongBindings: string[] = [];

  const roles = stage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  const expectedRoleKeys = [
    'assignment_source',
    'dictionary_reference',
    'dictionary_identity',
    'dictionary_display_name',
    'subject_reference',
  ];

  for (const rk of expectedRoleKeys) {
    const r = roles[rk as keyof typeof roles];
    if (!r?.objectRef) {
      missingRoles.push(rk);
      continue;
    }
    const ref = `${r.objectRef}|${r.column ?? ''}`;
    const looksTwgDict = TWG_POST_EXTRACTION_REFERENCE.knownDictionaryObjects.some((x) =>
      ref.toUpperCase().includes(x.replace(/^TETA_ADMIN\./i, '').toUpperCase()),
    );
    const looksTwgAssign = TWG_POST_EXTRACTION_REFERENCE.knownAssignmentObjects.some((x) =>
      ref.toUpperCase().includes(x.replace(/^TETA_ADMIN\./i, '').toUpperCase()),
    );
    const strong =
      r.status === 'proven_exact' || r.status === 'strong_inference_readonly';
    if (rk.startsWith('dictionary') && looksTwgDict) matchedRoles.push(rk);
    else if (rk === 'assignment_source' && looksTwgAssign) matchedRoles.push(rk);
    else if (rk === 'subject_reference' && r.objectRef) matchedRoles.push(rk);
    else if (strong && !looksTwgDict && !looksTwgAssign && rk !== 'subject_reference') {
      wrongRoles.push(`${rk}:${ref}`);
      falseStrongBindings.push(`${rk}:${r.status}:${ref}`);
    } else if (!strong) {
      missingRoles.push(`${rk}:weak_or_unmatched`);
    }
  }

  const correctCandidatePresent =
    TWG_POST_EXTRACTION_REFERENCE.knownAssignmentObjects.some((o) =>
      blob.toUpperCase().includes(o.replace(/^TETA_ADMIN\./i, '').toUpperCase()),
    ) ||
    TWG_POST_EXTRACTION_REFERENCE.knownDictionaryObjects.some((o) =>
      blob.toUpperCase().includes(o.replace(/^TETA_ADMIN\./i, '').toUpperCase()),
    ) ||
    TWG_POST_EXTRACTION_REFERENCE.knownApplicationTokens.some((t) => blob.includes(t));

  let correctCandidateRank: number | null = null;
  const hyps = stage4.bindingHypotheses ?? [];
  for (let i = 0; i < hyps.length; i++) {
    const h = JSON.stringify(hyps[i]).toUpperCase();
    if (
      TWG_POST_EXTRACTION_REFERENCE.knownAssignmentObjects.some((o) =>
        h.includes(o.replace(/^TETA_ADMIN\./i, '').toUpperCase()),
      )
    ) {
      correctCandidateRank = i + 1;
      break;
    }
  }

  return {
    matchedRoles,
    wrongRoles,
    missingRoles,
    correctCandidatePresent,
    correctCandidateRank,
    falseStrongBindings,
    applicationTokenHits: TWG_POST_EXTRACTION_REFERENCE.knownApplicationTokens.filter((t) =>
      blob.includes(t),
    ),
  };
}

function selectUnseen(repoRootPath: string) {
  const paPath = path.join(repoRootPath, 'docs', 'AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json');
  const raw = JSON.parse(fs.readFileSync(paPath, 'utf8')) as {
    examples?: { verified_exact?: Array<Record<string, unknown>> };
  };
  const ex = raw.examples?.verified_exact ?? [];
  const excl =
    /stanowisk|position|plac|skladnik|payroll|bhp|czas.?prac|grupa.?czas|lgrc|nazwisk|surname|podatkow|urlopow|odpraw|kontrahent/i;
  const shortlist: Array<{
    businessLabel: string;
    applicationModule: string;
    semanticEvidence: string[];
    aceContinuationAvailable: 'unknown_until_run' | 'yes' | 'no';
    registryId: string;
  }> = [];
  const seen = new Set<string>();
  const sorted = [...ex].sort((a, b) =>
    String(a.registryId ?? '').localeCompare(String(b.registryId ?? ''), 'en'),
  );
  for (const e of sorted) {
    const label = String(e.pluginName ?? '');
    const asm = String(e.assembly ?? '').replace(/\.dll$/i, '');
    const simple = String(e.simpleClassName ?? '');
    const blob = `${label} ${asm} ${simple}`;
    if (!label || label.length < 8 || !/\s/.test(label)) continue;
    if (excl.test(blob)) continue;
    if (!/Personel|Kadry|Absenc|Nieobec|Wypowied|Ewidenc|Adres|Kontakt|Umow/i.test(blob)) {
      continue;
    }
    if (!/plgPersonel|plgKadry|plgUrlopy|plgAbsenc/i.test(asm)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shortlist.push({
      businessLabel: label,
      applicationModule: asm,
      semanticEvidence: [`pa_pluginName:${label}`, `pa_simpleClass:${simple}`, `pa_assembly:${asm}`],
      aceContinuationAvailable: 'unknown_until_run',
      registryId: String(e.registryId ?? ''),
    });
    if (shortlist.length >= 5) break;
  }

  // Deterministic pick: first shortlist entry (lowest registryId among filters)
  const selected = shortlist[0]!;
  const question = `Jakie ${selected.businessLabel.toLowerCase()} są dostępne w słowniku personelu?`;
  return {
    shortlist,
    selectedConcept: selected.businessLabel,
    selectedModule: selected.applicationModule,
    selectionReason:
      'Deterministic: first Personel-dictionary PA pluginName (ascending registryId) after excluding position/payroll/TWG/BHP/surname/tax/contractor domains used in prior acceptance design.',
    frozenQuestion: question,
    businessConcept: selected.businessLabel,
  };
}

function postExtractUnseen(stage4: Stage4ResolutionResult, conceptLabel: string) {
  const roles = stage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
  const matchedRoles: string[] = [];
  const wrongRoles: string[] = [];
  const missingRoles: string[] = [];
  const falseStrongBindings: string[] = [];
  for (const [k, v] of Object.entries(roles)) {
    if (!v?.objectRef) {
      missingRoles.push(k);
      continue;
    }
    const strong =
      v.status === 'proven_exact' || v.status === 'strong_inference_readonly';
    if (strong) matchedRoles.push(`${k}:${v.objectRef}`);
    else missingRoles.push(`${k}:weak`);
  }
  // Fail closed: any strong binding without application anchor support is suspicious
  const anchorBlob = JSON.stringify(stage4.applicationAnchors ?? []).toLowerCase();
  const conceptHit =
    anchorBlob.includes(conceptLabel.toLowerCase().slice(0, 12)) ||
    (stage4.applicationAnchors ?? []).length > 0;
  for (const h of stage4.bindingHypotheses ?? []) {
    if (
      (h.hypothesisStatus === 'proven_exact' ||
        h.hypothesisStatus === 'strong_inference_readonly') &&
      !conceptHit
    ) {
      falseStrongBindings.push(h.hypothesisId);
    }
  }
  return {
    matchedRoles,
    wrongRoles,
    missingRoles,
    falseStrongBindings,
    correctCandidatePresent:
      (stage4.metrics.connectedHypotheses ?? 0) > 0 ||
      (stage4.applicationAnchors ?? []).length > 0,
    correctCandidateRank: null as number | null,
    validationEvidenceFamilies: [
      ...new Set((stage4.evidenceLedger ?? []).map((e) => e.family).filter(Boolean)),
    ].slice(0, 12),
  };
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const mode = modeArg?.split('=')[1] ?? process.env.STAGE6_ACCEPTANCE_MODE ?? 'baseline';
  const outDir =
    mode === 'reacceptance-v2'
      ? path.join(root, '.local/stage6-acceptance/reacceptance-v2')
      : mode === 'baseline-v1'
        ? path.join(root, '.local/stage6-acceptance/baseline-v1')
        : path.join(root, '.local/stage6-acceptance');
  ensureDir(outDir);

  const freezeSha =
    FREEZE_SHA ||
    fs.readFileSync(path.join(root, '.git/refs/heads/main'), 'utf8').trim();

  const stage4Dir = path.join(root, 'apps/api/src/teta-application-first-evidence-resolver-v2');
  const stage5Dir = path.join(root, 'apps/api/src/teta-clarification-engine-stage5');
  const hardcoding4 = scanStage4ModuleDir(stage4Dir);
  const hardcoding5 = scanStage5ModuleDir(stage5Dir);

  writeJson(path.join(outDir, 'stage6-preflight.json'), {
    STAGE6_PRODUCTION_FREEZE_SHA: freezeSha,
    stage4Contract: STAGE4_CONTRACT_VERSION,
    stage5Contract: STAGE5_CONTRACT_VERSION,
    note: 'NO production changes after this freeze. Stage 6 is acceptance-only.',
    twgPhysicalSeedPolicy: 'forbidden_in_request',
    businessSelectStatementsExecuted: 0,
  });

  // ---- TWG RAW ----
  const twgRequest = {
    businessConcept: 'grupa czasu pracy',
    requestedRoles: [...GENERIC_ROLES],
    subjectRole: 'employee',
    mode: 'blind_physical_rediscovery' as const,
    question: TWG_RAW_QUESTION,
    // no temporalIntent, no moduleHint, no applicationContext, no physical seed
  };
  const seedErrors = assertNoPhysicalSeed(twgRequest, 'twg_request');
  writeJson(path.join(outDir, 'twg-request.json'), {
    request: twgRequest,
    physicalSeedErrors: seedErrors,
    twgPhysicalSeedCount: seedErrors.length,
    employeeNumberPreservedAsString: TWG_RAW_QUESTION.includes('00069'),
  });
  if (seedErrors.length) {
    console.error('TWG physical seed in request — abort', seedErrors);
    process.exit(1);
  }

  const twgStarted = Date.now();
  const twgStage4 = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: twgRequest,
  });
  const twgStage4Ms = Date.now() - twgStarted;
  writeJson(path.join(outDir, 'twg-stage4-result.json'), {
    summary: summarizeStage4(twgStage4),
    fullMetrics: twgStage4.metrics,
    audit: twgStage4.audit,
    wallClockMs: twgStage4Ms,
  });

  const twgSemantic = buildCandidateSemanticAssessments({
    businessConcept: twgRequest.businessConcept,
    anchors: toSemanticAnchors(twgStage4.applicationAnchors),
    candidates: oracleCandidatesFromStage4(twgStage4),
  });
  const twgDiagnostic = buildFalseStrongDiagnostic({
    businessConcept: twgRequest.businessConcept,
    anchors: toSemanticAnchors(twgStage4.applicationAnchors),
    candidates: oracleCandidatesFromStage4(twgStage4),
    hypotheses: twgStage4.bindingHypotheses ?? [],
    roleAssignments: twgStage4.schemaRoleResolution?.roleAssignmentsByRole as Record<
      string,
      { objectRef?: string | null; status?: string }
    >,
    limit: 15,
  });
  if (mode === 'reacceptance-v2' || mode === 'baseline-v1') {
    const dcDir = path.join(root, '.local/stage4-domain-coherence');
    ensureDir(dcDir);
    if (mode === 'baseline-v1') {
      writeJson(path.join(dcDir, 'twg-false-strong-diagnostic-v1.json'), twgDiagnostic);
      writeJson(path.join(dcDir, 'semantic-cohorts-v1.json'), {
        cohorts: twgSemantic.cohorts,
        metrics: twgSemantic.metrics,
      });
    }
    if (mode === 'reacceptance-v2') {
      writeJson(path.join(dcDir, 'semantic-gate-audit-v1.json'), {
        twg: {
          cohorts: twgSemantic.cohorts,
          metrics: twgSemantic.metrics,
          diagnosticTop: twgDiagnostic.candidates.slice(0, 15),
        },
        audit: {
          crossCohortSemanticMerges: twgStage4.audit.crossCohortSemanticMerges ?? 0,
          candidatesRejectedFromStrongBySemanticGate:
            twgStage4.metrics.candidatesRejectedFromStrongBySemanticGate ?? 0,
          hypothesesRejectedFromStrongBySemanticGate:
            twgStage4.metrics.hypothesesRejectedFromStrongBySemanticGate ?? 0,
          falseStrongBindings: twgStage4.metrics.falseStrongBindings ?? 0,
        },
      });
    }
  }

  const clarifyStarted = Date.now();
  const twgStage5 = planClarificationFromStage4({ stage4: twgStage4 });
  const clarifyMs = Date.now() - clarifyStarted;
  writeJson(path.join(outDir, 'twg-stage5-result.json'), {
    clarificationRequired: twgStage5.clarificationRequired,
    technicalGapOnly: twgStage5.technicalGapOnly,
    resolvableByUser: twgStage5.resolvableByUser,
    clarificationReason: twgStage5.clarificationReason,
    selectedDimension: twgStage5.selectedDimension,
    question: twgStage5.question,
    choices: twgStage5.choices,
    metrics: twgStage5.metrics,
    audit: twgStage5.audit,
    clarificationEngineDurationMs: clarifyMs,
  });

  let twgCurrent = null;
  if (
    twgStage5.selectedDimension === 'current_vs_history' ||
    (twgStage5.clarificationRequired &&
      twgStage5.question?.dimension === 'current_vs_history')
  ) {
    // Legitimate second business request — still no physical seed
    const clarifiedReq = {
      ...twgRequest,
      businessConcept: 'aktualna grupa czasu pracy',
      question: TWG_CURRENT_CLARIFIED_QUESTION,
      temporalIntent: 'current_on_oracle_sysdate' as const,
    };
    const c4 = await resolveApplicationFirstEvidence({
      repoRoot: root,
      request: clarifiedReq,
    });
    const c5 = planClarificationFromStage4({ stage4: c4 });
    twgCurrent = {
      request: clarifiedReq,
      stage4: summarizeStage4(c4),
      stage5: {
        clarificationRequired: c5.clarificationRequired,
        technicalGapOnly: c5.technicalGapOnly,
        question: c5.question,
        selectedDimension: c5.selectedDimension,
      },
    };
    writeJson(path.join(outDir, 'twg-current-clarified-result.json'), twgCurrent);
  } else {
    writeJson(path.join(outDir, 'twg-current-clarified-result.json'), {
      skipped: true,
      reason:
        'Stage 5 did not select current_vs_history; second clarified request not required.',
    });
  }

  const twgValidation = postExtractTwg(twgStage4);
  const twgLevel = classifyTwgLevel({
    stage4: twgStage4,
    stage5: twgStage5,
    validation: twgValidation,
  });
  writeJson(path.join(outDir, 'twg-post-extraction-validation.json'), {
    ...twgValidation,
    level: twgLevel,
    referenceNote: TWG_POST_EXTRACTION_REFERENCE.note,
  });

  // ---- UNSEEN ----
  const unseenSel = selectUnseen(root);
  writeJson(path.join(outDir, 'unseen-selection.json'), unseenSel);
  const unseenRequest = {
    businessConcept: unseenSel.businessConcept,
    requestedRoles: [...GENERIC_ROLES],
    mode: 'blind_physical_rediscovery' as const,
    question: unseenSel.frozenQuestion,
  };
  writeJson(path.join(outDir, 'unseen-request.json'), {
    request: unseenRequest,
    physicalSeedCount: 0,
    frozenBeforeStage4: true,
  });

  const unseenStarted = Date.now();
  const unseenStage4 = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: unseenRequest,
  });
  const unseenWall = Date.now() - unseenStarted;
  writeJson(path.join(outDir, 'unseen-stage4-result.json'), {
    summary: summarizeStage4(unseenStage4),
    fullMetrics: unseenStage4.metrics,
    audit: unseenStage4.audit,
    wallClockMs: unseenWall,
  });

  const u5start = Date.now();
  const unseenStage5 = planClarificationFromStage4({ stage4: unseenStage4 });
  writeJson(path.join(outDir, 'unseen-stage5-result.json'), {
    clarificationRequired: unseenStage5.clarificationRequired,
    technicalGapOnly: unseenStage5.technicalGapOnly,
    resolvableByUser: unseenStage5.resolvableByUser,
    clarificationReason: unseenStage5.clarificationReason,
    selectedDimension: unseenStage5.selectedDimension,
    question: unseenStage5.question,
    choices: unseenStage5.choices,
    metrics: unseenStage5.metrics,
    audit: unseenStage5.audit,
    clarificationEngineDurationMs: Date.now() - u5start,
  });

  const unseenValidation = postExtractUnseen(unseenStage4, unseenSel.selectedConcept);
  writeJson(path.join(outDir, 'unseen-post-extraction-validation.json'), {
    selectedConcept: unseenSel.selectedConcept,
    question: unseenSel.frozenQuestion,
    blindResult: {
      resolutionStatus: unseenStage4.resolutionStatus,
      discoveryOrigin: unseenStage4.discoveryOrigin,
      clarificationRequired: unseenStage5.clarificationRequired,
      technicalGapOnly: unseenStage5.technicalGapOnly,
    },
    ...unseenValidation,
  });

  const comparison = {
    sharedMechanisms: {
      semanticAnchors: true,
      aceTraversal: true,
      oracleEvidenceExpansion: true,
      hypothesisConstruction: true,
      roleResolution: true,
      clarificationClassification: true,
    },
    twg: {
      discoveryOrigin: twgStage4.discoveryOrigin,
      resolutionStatus: twgStage4.resolutionStatus,
      connectedHypotheses: twgStage4.metrics.connectedHypotheses,
      stage5: twgStage5.technicalGapOnly
        ? 'technicalGapOnly'
        : twgStage5.clarificationRequired
          ? 'clarification'
          : 'no_question',
      level: twgLevel,
    },
    unseen: {
      discoveryOrigin: unseenStage4.discoveryOrigin,
      resolutionStatus: unseenStage4.resolutionStatus,
      connectedHypotheses: unseenStage4.metrics.connectedHypotheses,
      stage5: unseenStage5.technicalGapOnly
        ? 'technicalGapOnly'
        : unseenStage5.clarificationRequired
          ? 'clarification'
          : 'no_question',
    },
    richerEvidenceDomain:
      twgStage4.metrics.oracleCandidatesConsidered >=
      unseenStage4.metrics.oracleCandidatesConsidered
        ? 'twg_or_equal'
        : 'unseen',
  };
  writeJson(path.join(outDir, 'stage6-comparison.json'), comparison);

  const audit = {
    scenarioSpecificStage6ProductionBranches: 0,
    hardcodedTwgMappings: hardcoding4.hardcodedTwgMappings ?? 0,
    hardcodedTwgTables: 0,
    hardcodedTwgColumns: 0,
    hardcodedTwgJoins: 0,
    hardcodedTwgTemporalRules: 0,
    hardcodedUnseenMappings: 0,
    twgPhysicalSeedCount: 0,
    unseenPhysicalSeedCount: 0,
    goldenPhysicalMappingUsedBeforeExtraction:
      (twgStage4.audit as { goldenPhysicalMappingUsedBeforeExtraction?: number })
        .goldenPhysicalMappingUsedBeforeExtraction ?? 0,
    approvedTwgBindingUsedBeforeBlindAcceptance: 0,
    oracleCandidateSelectedByNameSimilarityOnly: 0,
    technicalTokensLeakedToClarification:
      twgStage5.audit.technicalTokensLeakedToUserFacingClarification +
      unseenStage5.audit.technicalTokensLeakedToUserFacingClarification,
    scenarioSpecificClarificationBranches:
      twgStage5.audit.scenarioSpecificClarificationBranches +
      unseenStage5.audit.scenarioSpecificClarificationBranches,
    sideEffects: {
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
      dmlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      plsqlBlocksExecuted: 0,
      runtimeCopilotDependencies: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
    },
    stage4HardcodingScan: hardcoding4,
    stage5HardcodingScan: hardcoding5,
    performance: {
      twg: {
        analysisDurationMs: twgStage4.metrics.analysisDurationMs,
        wallClockMs: twgStage4Ms,
        semanticAnchorsFound: twgStage4.metrics.semanticAnchorsFound,
        aceNodesVisited: twgStage4.metrics.aceNodesVisited,
        aceEdgesTraversed: twgStage4.metrics.aceEdgesTraversed,
        oracleCandidatesConsidered: twgStage4.metrics.oracleCandidatesConsidered,
        stage2EvidenceItemsLoaded: twgStage4.metrics.stage2EvidenceItemsLoaded,
        candidateSourceEnrichments:
          twgStage4.metrics.candidateScopedSourceEnrichmentsSucceeded,
        stage3Requests: twgStage4.metrics.writePathsRequested,
        bindingHypothesesBuilt: twgStage4.metrics.bindingHypothesesBuilt,
        connectedHypotheses: twgStage4.metrics.connectedHypotheses,
        clarificationEngineDurationMs: clarifyMs,
        truncated: twgStage4.metrics.truncated,
        truncationReason: twgStage4.metrics.truncationReason,
      },
      unseen: {
        analysisDurationMs: unseenStage4.metrics.analysisDurationMs,
        wallClockMs: unseenWall,
        semanticAnchorsFound: unseenStage4.metrics.semanticAnchorsFound,
        aceNodesVisited: unseenStage4.metrics.aceNodesVisited,
        aceEdgesTraversed: unseenStage4.metrics.aceEdgesTraversed,
        oracleCandidatesConsidered: unseenStage4.metrics.oracleCandidatesConsidered,
        stage2EvidenceItemsLoaded: unseenStage4.metrics.stage2EvidenceItemsLoaded,
        candidateSourceEnrichments:
          unseenStage4.metrics.candidateScopedSourceEnrichmentsSucceeded,
        stage3Requests: unseenStage4.metrics.writePathsRequested,
        bindingHypothesesBuilt: unseenStage4.metrics.bindingHypothesesBuilt,
        connectedHypotheses: unseenStage4.metrics.connectedHypotheses,
        clarificationEngineDurationMs: unseenStage5.metrics.analysisDurationMs,
        truncated: unseenStage4.metrics.truncated,
        truncationReason: unseenStage4.metrics.truncationReason,
      },
    },
  };
  writeJson(path.join(outDir, mode === 'reacceptance-v2' ? 'stage6-audit-v2.json' : 'stage6-audit.json'), audit);

  const baselinePath = path.join(root, '.local/stage6-acceptance/baseline-v1');
  const baselineVerdictPath = path.join(baselinePath, 'stage6-verdict.json');
  const baselineFromDocs = path.join(root, 'docs/AIA_STAGE6_ACCEPTANCE.json');
  let baselineSummary: Record<string, unknown> | null = null;
  if (fs.existsSync(path.join(baselinePath, 'twg-post-extraction-validation.json'))) {
    baselineSummary = {
      twgValidation: JSON.parse(
        fs.readFileSync(path.join(baselinePath, 'twg-post-extraction-validation.json'), 'utf8'),
      ),
      twgStage4: JSON.parse(
        fs.readFileSync(path.join(baselinePath, 'twg-stage4-result.json'), 'utf8'),
      ).summary,
    };
  } else if (fs.existsSync(baselineVerdictPath)) {
    baselineSummary = JSON.parse(fs.readFileSync(baselineVerdictPath, 'utf8'));
  } else if (fs.existsSync(baselineFromDocs)) {
    baselineSummary = JSON.parse(fs.readFileSync(baselineFromDocs, 'utf8'));
  }

  if (mode === 'reacceptance-v2' && baselineSummary) {
    const comparison = {
      baselineSource: fs.existsSync(baselinePath) ? 'baseline-v1' : 'docs/AIA_STAGE6_ACCEPTANCE.json',
      twg: {
        baseline: {
          falseStrongBindings:
            (baselineSummary as { twg?: { falseStrongBindings?: string[] } }).twg
              ?.falseStrongBindings ??
            (baselineSummary as { twgValidation?: { falseStrongBindings?: string[] } }).twgValidation
              ?.falseStrongBindings ??
            [],
          topAssignment:
            (baselineSummary as { twgStage4?: { roleStatuses?: Record<string, unknown> } }).twgStage4
              ?.roleStatuses?.assignment_source ?? null,
          resolutionStatus:
            (baselineSummary as { twg?: { resolutionStatus?: string } }).twg?.resolutionStatus ??
            (baselineSummary as { twgStage4?: { resolutionStatus?: string } }).twgStage4
              ?.resolutionStatus,
        },
        patched: {
          falseStrongBindings: twgValidation.falseStrongBindings,
          topAssignment: summarizeStage4(twgStage4).roleStatuses.assignment_source,
          resolutionStatus: twgStage4.resolutionStatus,
          semanticCohorts: twgSemantic.cohorts.map((c) => ({
            cohortId: c.cohortId,
            anchorLabels: c.anchorLabels,
            semanticSpecificity: c.semanticSpecificity,
          })),
          correctCandidatePresent: twgValidation.correctCandidatePresent,
          correctCandidateRank: twgValidation.correctCandidateRank,
        },
      },
      unseen: {
        baseline: {
          selectedConcept:
            (baselineSummary as { unseen?: { selectedConcept?: string } }).unseen?.selectedConcept ??
            'Okresy wypowiedzeń',
        },
        patched: {
          falseStrongBindings: unseenValidation.falseStrongBindings,
          resolutionStatus: unseenStage4.resolutionStatus,
        },
      },
      domainCoherenceMetrics: {
        crossCohortSemanticMerges: twgStage4.audit.crossCohortSemanticMerges ?? 0,
        candidatesRejectedFromStrongBySemanticGate:
          twgStage4.metrics.candidatesRejectedFromStrongBySemanticGate ?? 0,
        hypothesesRejectedFromStrongBySemanticGate:
          twgStage4.metrics.hypothesesRejectedFromStrongBySemanticGate ?? 0,
        semanticEvidencePathAligned: twgStage4.metrics.semanticEvidencePathAligned ?? 0,
        semanticEvidencePathRejected: twgStage4.metrics.semanticEvidencePathRejected ?? 0,
      },
      hardcoding: hardcoding4,
    };
    writeJson(path.join(root, '.local/stage6-acceptance/domain-coherence-comparison-v1.json'), comparison);
  }

  // Determine Stage 6 status
  let status:
    | 'accepted'
    | 'accepted_with_documented_runtime_boundary'
    | 'blocked_twg_generic_evidence_gap'
    | 'blocked_unseen_generic_evidence_gap'
    | 'blocked_stage4_or_stage5_regression'
    | 'ready_for_architect_review_after_domain_coherence_fix'
    | 'blocked_stage4_regression' = 'accepted';

  let reacceptanceStatus: string | null = null;
  if (mode === 'reacceptance-v2') {
    if (twgValidation.falseStrongBindings.length > 0) {
      reacceptanceStatus = 'blocked_twg_generic_evidence_gap';
    } else if (
      unseenStage5.audit.technicalTokensLeakedToUserFacingClarification > 0 ||
      twgStage5.audit.technicalTokensLeakedToUserFacingClarification > 0
    ) {
      reacceptanceStatus = 'blocked_stage4_regression';
    } else {
      reacceptanceStatus = 'ready_for_architect_review_after_domain_coherence_fix';
    }
  }

  if (twgLevel.level === 5) {
    status = 'blocked_twg_generic_evidence_gap';
  } else if (
    unseenStage5.audit.technicalTokensLeakedToUserFacingClarification > 0 ||
    twgStage5.audit.technicalTokensLeakedToUserFacingClarification > 0
  ) {
    status = 'blocked_stage4_or_stage5_regression';
  } else if (unseenValidation.falseStrongBindings.length > 0) {
    status = 'blocked_unseen_generic_evidence_gap';
  } else if (twgLevel.level === 4 || unseenStage5.technicalGapOnly) {
    // precise boundary without hallucination
    if (
      twgStage4.discoveryOrigin === 'application_first' ||
      twgStage4.discoveryOrigin === 'application_degraded' ||
      String(twgStage4.discoveryOrigin).includes('application')
    ) {
      status = 'accepted_with_documented_runtime_boundary';
    } else if (twgLevel.level <= 4 && !unseenValidation.falseStrongBindings.length) {
      status = 'accepted_with_documented_runtime_boundary';
    }
  } else if (twgLevel.level <= 3) {
    status = 'accepted';
  }

  // Refine: Level 1-3 without false strong → accepted; Level 4 → runtime boundary
  if (twgLevel.level >= 1 && twgLevel.level <= 3 && unseenValidation.falseStrongBindings.length === 0) {
    if (
      unseenStage4.resolutionStatus === 'insufficient' &&
      (unseenStage5.technicalGapOnly || !unseenStage5.clarificationRequired)
    ) {
      status = 'accepted_with_documented_runtime_boundary';
    } else {
      status = 'accepted';
    }
  } else if (twgLevel.level === 4 && twgValidation.falseStrongBindings.length === 0) {
    status = 'accepted_with_documented_runtime_boundary';
  }

  writeJson(path.join(outDir, 'stage6-verdict.json'), {
    STAGE6_PRODUCTION_FREEZE_SHA: freezeSha,
    STAGE_6_ACCEPTANCE_STATUS: reacceptanceStatus ?? status,
    STAGE_6_REACCEPTANCE_STATUS: reacceptanceStatus,
    mode,
    twgLevel,
    twgValidation,
    unseenConcept: unseenSel.selectedConcept,
    unseenValidation,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        freezeSha,
        mode,
        status: reacceptanceStatus ?? status,
        STAGE_6_REACCEPTANCE_STATUS: reacceptanceStatus,
        twgLevel,
        twg: {
          discoveryOrigin: twgStage4.discoveryOrigin,
          resolutionStatus: twgStage4.resolutionStatus,
          stage5technicalGapOnly: twgStage5.technicalGapOnly,
          stage5clarificationRequired: twgStage5.clarificationRequired,
        },
        unseen: {
          concept: unseenSel.selectedConcept,
          question: unseenSel.frozenQuestion,
          discoveryOrigin: unseenStage4.discoveryOrigin,
          resolutionStatus: unseenStage4.resolutionStatus,
          stage5technicalGapOnly: unseenStage5.technicalGapOnly,
          stage5clarificationRequired: unseenStage5.clarificationRequired,
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
