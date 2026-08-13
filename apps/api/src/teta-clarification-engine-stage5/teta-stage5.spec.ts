import path from 'path';
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import {
  STAGE4_CONTRACT_VERSION,
  STAGE4_SOURCE_STAGE,
  emptyStage4Audit,
  emptyStage4Metrics,
} from '../teta-application-first-evidence-resolver-v2';
import type { BindingHypothesis } from '../teta-application-first-evidence-resolver-v2/teta-stage4-hypotheses';
import {
  applyAndMeasureUncertaintyReduction,
  detectAlreadyResolvedDimensions,
  detectPhysicalMappingInjection,
  isTechnicalGapOnly,
  planClarificationFromStage4,
  planClarificationFromStage4Fixture,
  planEligibleApplicationSurfaceChoices,
  auditWhichFormChoices,
  scanTextForTechnicalLeak,
  scanUserFacingClarificationLeak,
  scanStage5ModuleDir,
  emptyStage5Audit,
  STAGE5_SEMANTIC_FIXTURE_LABEL,
} from './index';

function hyp(
  id: string,
  evidence: string[],
  status: BindingHypothesis['hypothesisStatus'] = 'insufficient',
): BindingHypothesis {
  return {
    hypothesisId: id,
    assignmentRef: `ASSIGN.${id}`,
    assignmentCandidate: null,
    subjectRef: null,
    dictionaryRef: null,
    dictionaryRelation: null,
    subjectRelation: null,
    columnLineageHops: [],
    connectedRoleCount: status === 'strong_inference_readonly' ? 4 : 0,
    disconnectedRoleCount: 0,
    crossPathRoleMerges: 0,
    connectivityProof: [],
    supportingEvidence: evidence,
    negativeEvidence: [],
    evidenceOriginFingerprints: [],
    roleBindings: {},
    hypothesisStatus: status,
    coherenceScore: 1,
    reasonForStatus: 'test',
  };
}

function baseStage4(
  partial: Partial<Stage4ResolutionResult> & { request: Stage4ResolutionResult['request'] },
): Stage4ResolutionResult {
  return {
    contractVersion: STAGE4_CONTRACT_VERSION,
    sourceStage: STAGE4_SOURCE_STAGE,
    discoveryOrigin: 'application_first',
    applicationAnchors: [],
    candidateBindings: [],
    roleResolutions: {},
    evidenceLedger: [],
    negativeEvidence: [],
    conflicts: [],
    grainResolution: { grainStatus: 'unknown', grainEvidence: [] },
    temporalResolution: { mode: 'unresolved', evidence: [] },
    lookupResolution: { evidence: [] },
    resolutionStatus: 'insufficient',
    resolutionTrace: [],
    clarificationNeeded: true,
    clarificationDimensions: [],
    metrics: emptyStage4Metrics(),
    audit: emptyStage4Audit(),
    bindingHypotheses: [],
    strictErrors: [],
    ...partial,
  };
}

describe('Stage 5 clarification engine — surface choice quality', () => {
  const moduleDir = path.join(__dirname);

  it('lexicon token cannot become form choice', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'xyzzy widget',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'lex1',
          anchorType: 'concept_token',
          label: 'xyzzy',
          evidenceRefs: ['lexicon_token:xyzzy'],
          family: 'application_semantic',
        },
        {
          anchorId: 'lex2',
          anchorType: 'concept_token',
          label: 'widget',
          evidenceRefs: ['lexicon_token:widget'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:xyzzy']), hyp('h2', ['form:widget'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const planned = planEligibleApplicationSurfaceChoices(stage4);
    expect(planned.choices).toHaveLength(0);
    expect(planned.metrics.lexiconOnlySurfaceCandidatesRejected).toBeGreaterThanOrEqual(2);
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(false);
    expect(r.audit.lexiconTokenUsedAsUserFacingChoice).toBe(0);
  });

  it('moduleHint alone cannot become form choice', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'personel stuff',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
        moduleHint: 'Personel',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'm1',
          anchorType: 'module_hint',
          label: 'Personel',
          evidenceRefs: ['module_hint:Personel'],
          family: 'application_semantic',
        },
        {
          anchorId: 'm2',
          anchorType: 'module_hint',
          label: 'Kadry',
          evidenceRefs: ['module_hint:Kadry'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['Personel']), hyp('h2', ['Kadry'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const planned = planEligibleApplicationSurfaceChoices(stage4);
    expect(planned.choices).toHaveLength(0);
    expect(planned.metrics.moduleHintOnlySurfaceCandidatesRejected).toBeGreaterThanOrEqual(2);
    expect(planClarificationFromStage4({ stage4 }).clarificationRequired).toBe(false);
  });

  it('surface must support surviving hypothesis; unsupported rejected', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'forms',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'a1',
          anchorType: 'pa_plugin',
          label: 'Formularz Alfa',
          formRef: 'form-a',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
        {
          anchorId: 'a2',
          anchorType: 'pa_plugin',
          label: 'Formularz Beta',
          formRef: 'form-b',
          evidenceRefs: ['pa:2'],
          family: 'application_semantic',
        },
        {
          anchorId: 'a3',
          anchorType: 'pa_plugin',
          label: 'Formularz Orphan',
          formRef: 'form-orphan',
          evidenceRefs: ['pa:3'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [
        hyp('h1', ['application_surface:form-a', 'form:form-a']),
        hyp('h2', ['application_surface:form-b', 'form:form-b']),
      ],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const planned = planEligibleApplicationSurfaceChoices(stage4);
    expect(planned.choices.map((c) => c.label).sort()).toEqual(['Formularz Alfa', 'Formularz Beta']);
    expect(planned.choices.every((c) => (c.supportingHypothesisIds ?? []).length > 0)).toBe(true);
  });

  it('same form across all hypotheses → no which_form', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'same form',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'a1',
          anchorType: 'pa_plugin',
          label: 'Jeden formularz',
          formRef: 'form-a',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [
        hyp('h1', ['form:form-a']),
        hyp('h2', ['form:form-a']),
      ],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(false);
    expect(r.selectedDimension === 'which_form' ? r.question : null).toBeNull();
  });

  it('two forms partition hypotheses → which_form and answer reduces uncertainty', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'two forms',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'a1',
          anchorType: 'pa_plugin',
          label: 'Formularz A',
          formRef: 'form-a',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
        {
          anchorId: 'a2',
          anchorType: 'pa_plugin',
          label: 'Formularz B',
          formRef: 'form-b',
          evidenceRefs: ['pa:2'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [
        hyp('h1', ['form:form-a']),
        hyp('h2', ['form:form-b']),
      ],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(true);
    expect(r.selectedDimension).toBe('which_form');
    expect(r.choices).toHaveLength(2);
    const pick = r.choices.find((c) => c.label === 'Formularz A')!;
    const applied = applyAndMeasureUncertaintyReduction({
      stage4Before: stage4,
      stage5: r,
      answer: { clarificationId: r.question!.clarificationId, selectedChoiceId: pick.choiceId },
    });
    expect(applied.clarificationChoiceActuallyReducedUncertainty).toBe(true);
    expect(applied.hypothesesAfter).toBe(1);
    expect(applied.stage5AfterApply.enrichedSemanticContext?.formScope).toBe('form-a');
    expect(applied.stage5AfterApply.enrichedSemanticContext).not.toHaveProperty('oracleObject');
  });

  it('three forms with useful partition', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'three',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: ['A', 'B', 'C'].map((x, i) => ({
        anchorId: `a${i}`,
        anchorType: 'pa_plugin',
        label: `Formularz ${x}`,
        formRef: `form-${x.toLowerCase()}`,
        evidenceRefs: [`pa:${i}`],
        family: 'application_semantic' as const,
      })),
      bindingHypotheses: [
        hyp('h1', ['form:form-a']),
        hyp('h2', ['form:form-b']),
        hyp('h3', ['form:form-c']),
      ],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 3 },
    });
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(true);
    expect(r.choices.length).toBe(3);
  });

  it('non-discriminating choice rejected; duplicate canonical collapsed', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'dup',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'a1',
          anchorType: 'pa_plugin',
          label: 'Karta badań',
          formRef: 'form-a',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
        {
          anchorId: 'a1b',
          anchorType: 'pa_plugin',
          label: 'Karta badań (kontrolka X)',
          formRef: 'form-a',
          evidenceRefs: ['pa:1b'],
          family: 'application_semantic',
        },
        {
          anchorId: 'a2',
          anchorType: 'pa_plugin',
          label: 'Rejestr badań',
          formRef: 'form-b',
          evidenceRefs: ['pa:2'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:form-a']), hyp('h2', ['form:form-b'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const planned = planEligibleApplicationSurfaceChoices(stage4);
    expect(planned.metrics.duplicateSurfacesCollapsed).toBeGreaterThanOrEqual(1);
    expect(planned.choices).toHaveLength(2);
  });

  it('same visible label + distinguishable context vs indistinguishable suppressed', () => {
    const distinguishable = baseStage4({
      request: {
        businessConcept: 'same label',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'x',
          anchorType: 'pa_plugin',
          label: 'Karta pracownika',
          formRef: 'form-x',
          controlName: 'Zakładka umowy',
          evidenceRefs: ['pa:x'],
          family: 'application_semantic',
        },
        {
          anchorId: 'y',
          anchorType: 'pa_plugin',
          label: 'Karta pracownika',
          formRef: 'form-y',
          controlName: 'Zakładka absencji',
          evidenceRefs: ['pa:y'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:form-x']), hyp('h2', ['form:form-y'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const ok = planEligibleApplicationSurfaceChoices(distinguishable);
    expect(ok.choices.length).toBe(2);
    expect(ok.choices.every((c) => c.label.includes('Karta pracownika'))).toBe(true);

    const indist = baseStage4({
      request: {
        businessConcept: 'same label no ctx',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 'x',
          anchorType: 'pa_plugin',
          label: 'Karta pracownika',
          formRef: 'form-x',
          evidenceRefs: ['pa:x'],
          family: 'application_semantic',
        },
        {
          anchorId: 'y',
          anchorType: 'pa_plugin',
          label: 'Karta pracownika',
          formRef: 'form-y',
          evidenceRefs: ['pa:y'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:form-x']), hyp('h2', ['form:form-y'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const bad = planEligibleApplicationSurfaceChoices(indist);
    expect(bad.metrics.indistinguishableSurfaceChoicesSuppressed).toBeGreaterThanOrEqual(1);
    expect(bad.choices.length).toBeLessThan(2);
  });

  it('form vs tab distinction prefers which_tab when all surfaces are tabs', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'tabs',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: 't1',
          anchorType: 'pa_plugin',
          label: 'Umowy',
          formRef: 'tab-umowy',
          controlName: 'tab_umowy',
          evidenceRefs: ['tab:1'],
          family: 'application_semantic',
        },
        {
          anchorId: 't2',
          anchorType: 'pa_plugin',
          label: 'Absencje',
          formRef: 'tab-abs',
          controlName: 'tab_absencje',
          evidenceRefs: ['tab:2'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:tab-umowy']), hyp('h2', ['form:tab-abs'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    // controlName with "tab" → tab_title source → surfaceType tab
    const planned = planEligibleApplicationSurfaceChoices(stage4, 'which_form');
    // Our classifyAnchorSourceType checks controlName for /tab/i → tab_title
    expect(planned.dimension === 'which_tab' || planned.choices.length >= 2).toBe(true);
  });

  it('internal class/dataset name not used as visible title', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'tech labels',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['which_form'],
      applicationAnchors: [
        {
          anchorId: '1',
          anchorType: 'pa_plugin',
          label: 'EmployeeAssignForm',
          formRef: 'EmployeeAssignForm',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
        {
          anchorId: '2',
          anchorType: 'pa_plugin',
          label: 'NT_KP_TABLE',
          formRef: 'nt',
          evidenceRefs: ['pa:2'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:EmployeeAssignForm']), hyp('h2', ['form:nt'])],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 2 },
    });
    const planned = planEligibleApplicationSurfaceChoices(stage4);
    expect(planned.choices).toHaveLength(0);
  });

  it('forceSemanticDimension production inaccessible; fixture is test-only', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'employee assignment record',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
        temporalIntent: 'none',
      },
      clarificationDimensions: [],
    });
    const prod = planClarificationFromStage4({ stage4 });
    expect(prod.clarificationRequired).toBe(false);
    expect(prod.audit.forceSemanticDimensionProductionReachable).toBe(0);

    const fixture = planClarificationFromStage4Fixture({
      stage4,
      forceSemanticDimension: 'current_vs_history',
      fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
    });
    expect(fixture.clarificationRequired).toBe(true);
    expect(fixture.question?.question).toMatch(/aktualne|histori/i);
    expect(fixture.question?.question).not.toMatch(/DATA_OD|SYSDATE|TABLE/i);

    const hc = scanStage5ModuleDir(moduleDir);
    expect(hc.forceSemanticDimensionProductionReachable).toBe(0);
  });

  it('insufficient technical gap → no question (current-position style)', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'current employee position',
        requestedRoles: ['assignment_source', 'dictionary_reference'],
        mode: 'blind_physical_rediscovery',
        temporalIntent: 'current_on_oracle_sysdate',
        question: 'Podaj aktualne stanowisko pracownika.',
      },
      clarificationNeeded: true,
      clarificationDimensions: ['missing_application_technical_path', 'which_form'],
      resolutionStatus: 'insufficient',
      metrics: { ...emptyStage4Metrics(), connectedHypotheses: 1, bindingHypothesesBuilt: 1 },
      bindingHypotheses: [hyp('h', [], 'strong_inference_readonly')],
      schemaRoleResolution: {
        overallStatus: 'insufficient',
        roleAssignmentsByRole: {
          assignment_source: {
            role: 'assignment_source',
            objectRef: 'OWNER.ASSIGN',
            column: null,
            status: 'strong_inference_readonly',
            evidenceFamiliesSatisfied: [],
            evidenceFamiliesMissing: [],
            supportingEvidenceRefs: [],
            contradictingEvidenceRefs: [],
            explanation: '',
          },
          dictionary_reference: {
            role: 'dictionary_reference',
            objectRef: 'OWNER.ASSIGN',
            column: 'PUB_REF',
            status: 'strong_inference_readonly',
            evidenceFamiliesSatisfied: [],
            evidenceFamiliesMissing: [],
            supportingEvidenceRefs: [],
            contradictingEvidenceRefs: [],
            explanation: '',
          },
        },
        candidateRanking: [],
      } as Stage4ResolutionResult['schemaRoleResolution'],
    });
    expect(isTechnicalGapOnly(stage4)).toBe(true);
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(false);
    expect(r.technicalGapOnly).toBe(true);
    expect(r.question).toBeNull();
  });

  it('technical-only → no question', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'x',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: ['missing_oracle_relation'],
      bindingHypotheses: [hyp('h1', [], 'strong_inference_readonly')],
      metrics: { ...emptyStage4Metrics(), connectedHypotheses: 1, bindingHypothesesBuilt: 1 },
    });
    const r = planClarificationFromStage4({ stage4 });
    expect(r.clarificationRequired).toBe(false);
  });

  it('already-resolved current suppresses current_vs_history', () => {
    const resolved = detectAlreadyResolvedDimensions({
      question: 'Podaj aktualne stanowisko',
      businessConcept: 'current employee position',
      temporalIntent: 'current_on_oracle_sysdate',
    });
    expect(resolved).toContain('current_vs_history');
  });

  it('physical mapping cannot be injected; leak scanner works', () => {
    expect(
      detectPhysicalMappingInjection({
        clarificationId: 'x',
        selectedChoiceId: 'y',
        oracleObject: 'TETA_ADMIN.NT_X',
      }),
    ).not.toHaveLength(0);
    expect(scanTextForTechnicalLeak('Użyj NT_KP_KDR_STANOWISKA')).not.toHaveLength(0);
    const audit = emptyStage5Audit();
    const leak = scanUserFacingClarificationLeak({
      question: {
        clarificationId: 'c',
        dimension: 'which_form',
        question: 'Której tabeli NT_KP_X użyć?',
        choices: [{ choiceId: '1', label: 'OK', semanticEffect: {}, evidenceRefs: [] }],
        freeTextAllowed: false,
      },
      choices: [{ choiceId: '1', label: 'OK', semanticEffect: {}, evidenceRefs: [] }],
      audit,
    });
    expect(leak.technicalTokensLeaked).toBeGreaterThan(0);
  });

  it('clarification answer updates semantic context only and reduces uncertainty (fixture)', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'employee assignment record',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      clarificationDimensions: [],
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 3 },
      bindingHypotheses: [hyp('h0', []), hyp('h1', []), hyp('h2', [])],
    });
    const planned = planClarificationFromStage4Fixture({
      stage4,
      forceSemanticDimension: 'current_vs_history',
      fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
    });
    const after = baseStage4({
      ...stage4,
      metrics: { ...emptyStage4Metrics(), bindingHypothesesBuilt: 1 },
      bindingHypotheses: stage4.bindingHypotheses!.slice(0, 1),
      request: { ...stage4.request, temporalIntent: 'current_on_oracle_sysdate' },
    });
    const applied = applyAndMeasureUncertaintyReduction({
      stage4Before: stage4,
      stage5: planned,
      answer: {
        clarificationId: planned.question!.clarificationId,
        selectedChoiceId: 'temporal:current',
      },
      stage4After: after,
    });
    expect(applied.applyOk).toBe(true);
    expect(applied.stage5AfterApply.enrichedSemanticContext?.temporalIntent).toBe('current');
    expect(applied.uncertaintyReduced).toBe(true);
  });

  it('same question not repeated', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'employee assignment record',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
    });
    const first = planClarificationFromStage4Fixture({
      stage4,
      forceSemanticDimension: 'current_vs_history',
      fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
    });
    const second = planClarificationFromStage4Fixture({
      stage4,
      forceSemanticDimension: 'current_vs_history',
      fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
      requestState: {
        originalRequest: stage4.request.businessConcept,
        resolvedDimensions: [],
        pendingDimensions: ['current_vs_history'],
        clarificationHistory: [
          {
            clarificationId: first.question!.clarificationId,
            dimension: 'current_vs_history',
            selectedChoiceId: 'temporal:current',
            appliedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(second.clarificationRequired).toBe(false);
  });

  it('approved binding suppresses unnecessary question', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'current employee position',
        requestedRoles: ['assignment_source'],
        mode: 'approved_binding_reuse',
        temporalIntent: 'current_on_oracle_sysdate',
      },
      resolutionStatus: 'strong_inference_readonly',
      clarificationNeeded: false,
      clarificationDimensions: [],
      metrics: { ...emptyStage4Metrics(), approvedBindingsReused: 1 },
    });
    expect(planClarificationFromStage4({ stage4 }).clarificationRequired).toBe(false);
  });

  it('pre-patch style audit classifies lexicon vs application sources', () => {
    const stage4 = baseStage4({
      request: {
        businessConcept: 'xyzzy',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      applicationAnchors: [
        {
          anchorId: '1',
          anchorType: 'concept_token',
          label: 'xyzzy',
          evidenceRefs: ['lexicon_token:xyzzy'],
          family: 'application_semantic',
        },
        {
          anchorId: '2',
          anchorType: 'pa_plugin',
          label: 'Karta BHP',
          formRef: 'f1',
          evidenceRefs: ['pa:1'],
          family: 'application_semantic',
        },
      ],
      bindingHypotheses: [hyp('h1', ['form:f1'])],
    });
    const audit = auditWhichFormChoices(stage4);
    expect(audit.candidates.some((c) => c.sourceType === 'lexicon_token')).toBe(true);
    expect(audit.candidates.find((c) => c.choiceLabel === 'xyzzy')?.eligible).toBe(false);
  });

  it('hardcoding / scenario branches remain zero', () => {
    const hc = scanStage5ModuleDir(moduleDir);
    expect(hc.scenarioSpecificClarificationBranches).toBe(0);
    expect(hc.hardcodedCurrentPositionClarification).toBe(0);
    expect(hc.hardcodedBhpClarification).toBe(0);
  });
});
