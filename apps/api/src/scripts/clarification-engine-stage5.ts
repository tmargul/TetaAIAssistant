/**
 * Stage 5 — Clarification Engine CLI (acceptance freeze v2 — surface choice quality).
 * Consumes Stage 4 results; does not rediscover physical mappings.
 * Do NOT commit Stage 5 without architect review.
 */
import fs from 'fs';
import path from 'path';
import {
  resolveApplicationFirstEvidence,
  STAGE4_CONTRACT_VERSION,
} from '../teta-application-first-evidence-resolver-v2';
import {
  applyAndMeasureUncertaintyReduction,
  auditWhichFormChoices,
  planClarificationFromStage4,
  planClarificationFromStage4Fixture,
  planEligibleApplicationSurfaceChoices,
  STAGE5_CONTRACT_VERSION,
  STAGE5_GAP_MATRIX,
  STAGE5_SEMANTIC_FIXTURE_LABEL,
  scanStage5ModuleDir,
} from '../teta-clarification-engine-stage5';
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';

const CURRENT_POSITION_ROLES = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
] as const;

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

function choiceReport(clarify: ReturnType<typeof planClarificationFromStage4>) {
  return (clarify.choices ?? []).map((c) => ({
    visibleLabel: c.label,
    surfaceCanonicalId: c.applicationSurfaceCanonicalId ?? c.canonicalApplicationId ?? null,
    supportingHypothesisIds: c.supportingHypothesisIds ?? [],
    supportingApplicationEvidence: c.supportingApplicationEvidenceIds ?? c.evidenceRefs,
    hypothesesRetainedByChoice: c.hypothesesRetained ?? [],
    hypothesesEliminated: c.hypothesesEliminated ?? [],
    choiceEvidenceQuality: c.choiceEvidenceQuality ?? null,
  }));
}

function multiFormSynthetic(stage4Template: Stage4ResolutionResult): {
  partition: ReturnType<typeof planClarificationFromStage4>;
  sameForm: ReturnType<typeof planClarificationFromStage4>;
} {
  const withPartition: Stage4ResolutionResult = {
    ...stage4Template,
    request: {
      businessConcept: 'controlled multi-form partition',
      requestedRoles: ['assignment_source'],
      mode: 'blind_physical_rediscovery',
    },
    clarificationNeeded: true,
    clarificationDimensions: ['which_form'],
    resolutionStatus: 'insufficient',
    applicationAnchors: [
      {
        anchorId: 'synth-a',
        anchorType: 'pa_plugin',
        label: 'Formularz Alfa',
        formRef: 'synth-form-a',
        evidenceRefs: ['pa:synth-a'],
        family: 'application_semantic',
      },
      {
        anchorId: 'synth-b',
        anchorType: 'pa_plugin',
        label: 'Formularz Beta',
        formRef: 'synth-form-b',
        evidenceRefs: ['pa:synth-b'],
        family: 'application_semantic',
      },
    ],
    bindingHypotheses: [
      {
        hypothesisId: 'H1',
        assignmentRef: 'SYNTH.A',
        assignmentCandidate: null,
        subjectRef: null,
        dictionaryRef: null,
        dictionaryRelation: null,
        subjectRelation: null,
        columnLineageHops: [],
        connectedRoleCount: 0,
        disconnectedRoleCount: 0,
        crossPathRoleMerges: 0,
        connectivityProof: [],
        supportingEvidence: ['form:synth-form-a'],
        negativeEvidence: [],
        evidenceOriginFingerprints: [],
        roleBindings: {},
        hypothesisStatus: 'insufficient',
        coherenceScore: 1,
        reasonForStatus: 'controlled',
      },
      {
        hypothesisId: 'H2',
        assignmentRef: 'SYNTH.B',
        assignmentCandidate: null,
        subjectRef: null,
        dictionaryRef: null,
        dictionaryRelation: null,
        subjectRelation: null,
        columnLineageHops: [],
        connectedRoleCount: 0,
        disconnectedRoleCount: 0,
        crossPathRoleMerges: 0,
        connectivityProof: [],
        supportingEvidence: ['form:synth-form-b'],
        negativeEvidence: [],
        evidenceOriginFingerprints: [],
        roleBindings: {},
        hypothesisStatus: 'insufficient',
        coherenceScore: 1,
        reasonForStatus: 'controlled',
      },
    ],
    metrics: {
      ...stage4Template.metrics,
      bindingHypothesesBuilt: 2,
      connectedHypotheses: 0,
    },
  };

  const sameForm: Stage4ResolutionResult = {
    ...withPartition,
    request: {
      businessConcept: 'controlled same-form non-partition',
      requestedRoles: ['assignment_source'],
      mode: 'blind_physical_rediscovery',
    },
    applicationAnchors: [
      {
        anchorId: 'synth-a',
        anchorType: 'pa_plugin',
        label: 'Formularz Alfa',
        formRef: 'synth-form-a',
        evidenceRefs: ['pa:synth-a'],
        family: 'application_semantic',
      },
    ],
    bindingHypotheses: withPartition.bindingHypotheses!.map((h) => ({
      ...h,
      supportingEvidence: ['form:synth-form-a'],
    })),
  };

  return {
    partition: planClarificationFromStage4({ stage4: withPartition }),
    sameForm: planClarificationFromStage4({ stage4: sameForm }),
  };
}

async function main(): Promise<void> {
  const root = repoRoot();
  loadDotEnv(path.join(root, 'apps/api/.env'));
  const outDir = path.join(root, '.local/clarification-engine-stage5');
  ensureDir(outDir);
  const moduleDir = path.join(root, 'apps/api/src/teta-clarification-engine-stage5');
  const hardcoding = scanStage5ModuleDir(moduleDir);

  // A. current-position
  const currentPosition = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'current employee position',
      requestedRoles: [...CURRENT_POSITION_ROLES],
      subjectRole: 'employee',
      mode: 'blind_physical_rediscovery',
      temporalIntent: 'current_on_oracle_sysdate',
      question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
    },
  });
  const clarifyCurrent = planClarificationFromStage4({
    stage4: currentPosition,
    moduleDirForHardcodingScan: moduleDir,
  });

  // B. ambiguity
  const ambiguity = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'xyzzy unknown frobbish widget',
      requestedRoles: ['assignment_source', 'subject_reference'],
      mode: 'blind_physical_rediscovery',
    },
  });
  const ambiguityAudit = auditWhichFormChoices(ambiguity);
  const clarifyAmbiguity = planClarificationFromStage4({ stage4: ambiguity });

  // C. current-vs-history — TEST-ONLY semantic fixture
  const historyAmbiguity = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'employee assignment record',
      requestedRoles: ['assignment_source'],
      mode: 'blind_physical_rediscovery',
      temporalIntent: 'none',
      question: 'Pokaż stanowisko pracownika',
    },
  });
  const clarifyHistory = planClarificationFromStage4Fixture({
    stage4: historyAmbiguity,
    forceSemanticDimension: 'current_vs_history',
    fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
  });
  let historyAfter = null;
  if (clarifyHistory.question) {
    historyAfter = applyAndMeasureUncertaintyReduction({
      stage4Before: historyAmbiguity,
      stage5: clarifyHistory,
      answer: {
        clarificationId: clarifyHistory.question.clarificationId,
        selectedChoiceId: 'temporal:current',
      },
      stage4After: {
        ...historyAmbiguity,
        request: {
          ...historyAmbiguity.request,
          temporalIntent: 'current_on_oracle_sysdate',
        },
        metrics: {
          ...historyAmbiguity.metrics,
          bindingHypothesesBuilt: Math.max(1, historyAmbiguity.metrics.bindingHypothesesBuilt - 1),
        },
        bindingHypotheses: (historyAmbiguity.bindingHypotheses ?? []).slice(0, 1),
      },
    });
  }

  // D. technical-only
  const technicalOnly = clarifyCurrent;

  // E. unseen BHP
  const unseen = await resolveApplicationFirstEvidence({
    repoRoot: root,
    request: {
      businessConcept: 'occupational health prophylactic examinations',
      requestedRoles: ['assignment_source', 'dictionary_display_name'],
      mode: 'blind_physical_rediscovery',
      moduleHint: 'Personel',
    },
  });
  const unseenAudit = auditWhichFormChoices(unseen);
  const unseenSurfaces = planEligibleApplicationSurfaceChoices(unseen, 'which_form');
  const clarifyUnseen = planClarificationFromStage4({ stage4: unseen });

  // F. multi-form controlled
  const multi = multiFormSynthetic(currentPosition);
  let multiApply = null;
  if (multi.partition.question) {
    const pick = multi.partition.choices.find((c) => c.label === 'Formularz Alfa')!;
    multiApply = applyAndMeasureUncertaintyReduction({
      stage4Before: {
        ...currentPosition,
        bindingHypotheses: [
          {
            hypothesisId: 'H1',
            assignmentRef: 'SYNTH.A',
            assignmentCandidate: null,
            subjectRef: null,
            dictionaryRef: null,
            dictionaryRelation: null,
            subjectRelation: null,
            columnLineageHops: [],
            connectedRoleCount: 0,
            disconnectedRoleCount: 0,
            crossPathRoleMerges: 0,
            connectivityProof: [],
            supportingEvidence: ['form:synth-form-a'],
            negativeEvidence: [],
            evidenceOriginFingerprints: [],
            roleBindings: {},
            hypothesisStatus: 'insufficient',
            coherenceScore: 1,
            reasonForStatus: 'controlled',
          },
          {
            hypothesisId: 'H2',
            assignmentRef: 'SYNTH.B',
            assignmentCandidate: null,
            subjectRef: null,
            dictionaryRef: null,
            dictionaryRelation: null,
            subjectRelation: null,
            columnLineageHops: [],
            connectedRoleCount: 0,
            disconnectedRoleCount: 0,
            crossPathRoleMerges: 0,
            connectivityProof: [],
            supportingEvidence: ['form:synth-form-b'],
            negativeEvidence: [],
            evidenceOriginFingerprints: [],
            roleBindings: {},
            hypothesisStatus: 'insufficient',
            coherenceScore: 1,
            reasonForStatus: 'controlled',
          },
        ],
        metrics: { ...currentPosition.metrics, bindingHypothesesBuilt: 2 },
      },
      stage5: multi.partition,
      answer: {
        clarificationId: multi.partition.question.clarificationId,
        selectedChoiceId: pick.choiceId,
      },
    });
  }

  writeJson(path.join(outDir, 'which-form-choice-audit-v1.json'), {
    ambiguity: ambiguityAudit,
    unseen: unseenAudit,
    rootCause:
      'Legacy which_form enumerated all Stage4 applicationAnchors including concept_token lexicon labels and module_hint / broad PA hits without requiring surviving-hypothesis partitions.',
    sourceTypesObserved: [
      ...new Set([
        ...ambiguityAudit.candidates.map((c) => c.sourceType),
        ...unseenAudit.candidates.map((c) => c.sourceType),
      ]),
    ],
  });

  writeJson(path.join(outDir, 'surface-choice-partitions-v1.json'), {
    ambiguity: planEligibleApplicationSurfaceChoices(ambiguity).metrics,
    unseen: unseenSurfaces.metrics,
    multiFormPartition: planEligibleApplicationSurfaceChoices({
      ...currentPosition,
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'synth-a',
          anchorType: 'pa_plugin',
          label: 'Formularz Alfa',
          formRef: 'synth-form-a',
          evidenceRefs: ['pa:synth-a'],
          family: 'application_semantic',
        },
        {
          anchorId: 'synth-b',
          anchorType: 'pa_plugin',
          label: 'Formularz Beta',
          formRef: 'synth-form-b',
          evidenceRefs: ['pa:synth-b'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [
        {
          hypothesisId: 'H1',
          assignmentRef: 'SYNTH.A',
          assignmentCandidate: null,
          subjectRef: null,
          dictionaryRef: null,
          dictionaryRelation: null,
          subjectRelation: null,
          columnLineageHops: [],
          connectedRoleCount: 0,
          disconnectedRoleCount: 0,
          crossPathRoleMerges: 0,
          connectivityProof: [],
          supportingEvidence: ['form:synth-form-a'],
          negativeEvidence: [],
          evidenceOriginFingerprints: [],
          roleBindings: {},
          hypothesisStatus: 'insufficient',
          coherenceScore: 1,
          reasonForStatus: 'controlled',
        },
        {
          hypothesisId: 'H2',
          assignmentRef: 'SYNTH.B',
          assignmentCandidate: null,
          subjectRef: null,
          dictionaryRef: null,
          dictionaryRelation: null,
          subjectRelation: null,
          columnLineageHops: [],
          connectedRoleCount: 0,
          disconnectedRoleCount: 0,
          crossPathRoleMerges: 0,
          connectivityProof: [],
          supportingEvidence: ['form:synth-form-b'],
          negativeEvidence: [],
          evidenceOriginFingerprints: [],
          roleBindings: {},
          hypothesisStatus: 'insufficient',
          coherenceScore: 1,
          reasonForStatus: 'controlled',
        },
      ],
      metrics: { ...currentPosition.metrics, bindingHypothesesBuilt: 2 },
    } as Stage4ResolutionResult).metrics,
  });

  writeJson(path.join(outDir, 'current-position-acceptance-v2.json'), {
    stage4ResolutionStatus: currentPosition.resolutionStatus,
    stage4ConnectedHypotheses: currentPosition.metrics.connectedHypotheses,
    clarificationRequired: clarifyCurrent.clarificationRequired,
    technicalGapOnly: clarifyCurrent.technicalGapOnly,
    resolvableByUser: clarifyCurrent.resolvableByUser,
    clarificationReason: clarifyCurrent.clarificationReason,
    question: clarifyCurrent.question,
    metrics: clarifyCurrent.metrics,
    audit: clarifyCurrent.audit,
  });

  writeJson(path.join(outDir, 'ambiguity-acceptance-v2.json'), {
    stage4Dimensions: ambiguity.clarificationDimensions,
    clarificationRequired: clarifyAmbiguity.clarificationRequired,
    technicalGapOnly: clarifyAmbiguity.technicalGapOnly,
    selectedDimension: clarifyAmbiguity.selectedDimension,
    question: clarifyAmbiguity.question,
    choices: choiceReport(clarifyAmbiguity),
    rejectedClarifications: clarifyAmbiguity.rejectedClarifications,
    metrics: clarifyAmbiguity.metrics,
    note: 'Question only if evidence-backed partitions exist; otherwise suppress.',
  });

  writeJson(path.join(outDir, 'current-vs-history-v2.json'), {
    fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
    proves: 'Stage 5 planning behavior only — NOT Stage 4 natural discovery of current_vs_history',
    clarificationRequired: clarifyHistory.clarificationRequired,
    question: clarifyHistory.question,
    choices: clarifyHistory.choices,
    afterApply: historyAfter,
  });

  writeJson(path.join(outDir, 'technical-only-v2.json'), {
    clarificationRequired: technicalOnly.clarificationRequired,
    technicalGapOnly: technicalOnly.technicalGapOnly,
    reason: technicalOnly.clarificationReason,
  });

  writeJson(path.join(outDir, 'unseen-bhp-v2.json'), {
    concept: 'occupational health prophylactic examinations',
    clarificationRequired: clarifyUnseen.clarificationRequired,
    technicalGapOnly: clarifyUnseen.technicalGapOnly,
    selectedDimension: clarifyUnseen.selectedDimension,
    question: clarifyUnseen.question,
    choices: choiceReport(clarifyUnseen),
    rejectedClarifications: clarifyUnseen.rejectedClarifications,
    surfaceMetrics: unseenSurfaces.metrics,
    note: 'Suppression is acceptable when former which_form choices were lexicon/module/PA-only.',
  });

  writeJson(path.join(outDir, 'multi-form-acceptance-v1.json'), {
    partitionCase: {
      clarificationRequired: multi.partition.clarificationRequired,
      selectedDimension: multi.partition.selectedDimension,
      eligibleChoiceCount: multi.partition.choices.length,
      choices: choiceReport(multi.partition),
      afterSelectFormA: multiApply,
    },
    sameFormCase: {
      clarificationRequired: multi.sameForm.clarificationRequired,
      question: multi.sameForm.question,
      expected: 'no which_form because form does not partition hypotheses',
    },
  });

  const audit = {
    contractVersion: STAGE5_CONTRACT_VERSION,
    stage4Contract: STAGE4_CONTRACT_VERSION,
    hardcoding,
    gapMatrixRowCount: STAGE5_GAP_MATRIX.length,
    forceSemanticDimensionProductionReachable:
      clarifyCurrent.audit.forceSemanticDimensionProductionReachable,
    syntheticDimensionInjectedIntoProduction:
      clarifyCurrent.audit.syntheticDimensionInjectedIntoProduction,
    lexiconTokenUsedAsUserFacingChoice: Math.max(
      clarifyAmbiguity.audit.lexiconTokenUsedAsUserFacingChoice,
      clarifyUnseen.audit.lexiconTokenUsedAsUserFacingChoice,
    ),
    moduleHintOnlyChoices: Math.max(
      clarifyAmbiguity.audit.moduleHintOnlyChoices,
      clarifyUnseen.audit.moduleHintOnlyChoices,
    ),
    stage4RediscoveryCallsFromStage5: clarifyCurrent.metrics.stage4RediscoveryCallsFromStage5,
    oracleCallsFromStage5: clarifyCurrent.metrics.oracleCallsFromStage5,
    sideEffects: {
      localModelCalls: clarifyCurrent.audit.localModelCalls,
      remoteModelCalls: clarifyCurrent.audit.remoteModelCalls,
      runtimeCopilotDependencies: clarifyCurrent.audit.runtimeCopilotDependencies,
      businessSelectStatementsExecuted: clarifyCurrent.audit.businessSelectStatementsExecuted,
      businessRowsRead: clarifyCurrent.audit.businessRowsRead,
      dmlStatementsExecuted: clarifyCurrent.audit.dmlStatementsExecuted,
      ddlStatementsExecuted: clarifyCurrent.audit.ddlStatementsExecuted,
      plsqlBlocksExecuted: clarifyCurrent.audit.plsqlBlocksExecuted,
    },
    strictErrors: [
      ...clarifyCurrent.strictErrors,
      ...clarifyAmbiguity.strictErrors,
      ...clarifyHistory.strictErrors,
      ...clarifyUnseen.strictErrors,
      ...multi.partition.strictErrors,
    ],
  };

  writeJson(path.join(outDir, 'stage5-audit-v2.json'), audit);

  const canonical = {
    stage5ClarificationEngine: 'surface_choice_quality_closed_awaiting_final_review',
    contractVersion: STAGE5_CONTRACT_VERSION,
    STAGE_5_IMPLEMENTATION_STATUS: 'surface_choice_quality_closed_awaiting_final_review',
    doNotCommit: true,
    doNotStart: ['stage6', 'b3a_restore'],
    surfaceChoicePolicy: {
      lexiconTokenUsedAsUserFacingChoice: 0,
      moduleHintOnlyChoices: 0,
      choicesMustPartitionSurvivingHypotheses: true,
      forceSemanticDimension: 'fixture_test_only',
    },
    acceptance: {
      currentPosition: {
        clarificationRequired: clarifyCurrent.clarificationRequired,
        technicalGapOnly: clarifyCurrent.technicalGapOnly,
      },
      ambiguity: {
        clarificationRequired: clarifyAmbiguity.clarificationRequired,
        selectedDimension: clarifyAmbiguity.selectedDimension,
        eligibleChoices: clarifyAmbiguity.choices.length,
      },
      currentVsHistory: {
        fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
        clarificationRequired: clarifyHistory.clarificationRequired,
        question: clarifyHistory.question?.question ?? null,
        uncertaintyReduced: historyAfter?.uncertaintyReduced ?? false,
      },
      technicalOnly: {
        clarificationRequired: technicalOnly.clarificationRequired,
        technicalGapOnly: technicalOnly.technicalGapOnly,
      },
      unseen: {
        clarificationRequired: clarifyUnseen.clarificationRequired,
        technicalGapOnly: clarifyUnseen.technicalGapOnly,
        selectedDimension: clarifyUnseen.selectedDimension,
        eligibleChoices: clarifyUnseen.choices.length,
      },
      multiForm: {
        partitionClarificationRequired: multi.partition.clarificationRequired,
        sameFormClarificationRequired: multi.sameForm.clarificationRequired,
        uncertaintyReduced: multiApply?.clarificationChoiceActuallyReducedUncertainty ?? false,
      },
    },
    audit: { ...hardcoding, ...clarifyCurrent.audit },
    strictErrors: audit.strictErrors,
  };
  writeJson(path.join(root, 'docs/AIA_CLARIFICATION_ENGINE_STAGE5.json'), canonical);

  console.log(JSON.stringify({ ok: true, outDir, ...canonical }, null, 2));
  if (audit.strictErrors.length > 0) process.exit(1);
  if (clarifyCurrent.clarificationRequired) {
    console.error('FAIL: current-position must not ask clarification');
    process.exit(1);
  }
  if (multi.partition.clarificationRequired !== true || multi.sameForm.clarificationRequired !== false) {
    console.error('FAIL: multi-form controlled acceptance');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
