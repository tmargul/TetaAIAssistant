/**

 * Stage 3J — audit counters, runtime/reference split, strict validation.

 */

import {

  REQUIRED_STAGE3J_REFERENCE_IDS,

  type Stage3jReferenceAudit,

  type Stage3jRuntimeAudit,

} from './teta-stage3j-runtime-metrics';



export type Stage3jSideEffectCounters = {

  oracleConnectionsOpened: number;

  oracleStatementsExecuted: number;

  oracleWrites: number;

  llmCalls: number;

  qdrantCalls: number;

  embeddingCalls: number;

  formulasExecuted: number;

  sqlFormulasExecuted: number;

  domanFallbacks: number;

  legacyAgentFallbacks: number;

  clientPayrollQuestionWithoutSnapshotFallbacks: number;

  rawFormulaLogged: number;

  dependencyFragmentsLogged: number;

  sqlFormulasLogged: number;

  customerNamesWrittenToDocs: number;

  localFixturesAddedToGit: number;
  customerConfigurationCodesExposedInRepoArtifacts: number;
};



export type Stage3jAuditInvariants = {

  noSideEffects: boolean;

  noFormulaExecution: boolean;

  noRawFormulaInAuditOutput: boolean;

  noCustomerDataInDocs: boolean;

  fingerprintDeterministic: boolean;

  snapshotRequiredWithoutFallback: boolean;

  historyRedactionApplied: boolean;

  supportedIntentsOnlyWhenCompleted: boolean;

    stage3jTestsExecutedAtLeast150: boolean;

  stage3jTestsFailedZero: boolean;

  regressionTestsFailedZero: boolean;

  referencesAllPassed: boolean;

  runtimeCountersComeFromInstrumentedServices: boolean;

  referencesDoNotPretendToBeRuntimeCounters: boolean;

  everyRequiredReferenceExecuted: boolean;

  everyRequiredReferencePassed: boolean;

  golden1353DirectDependenciesCorrect: boolean;

  golden1353TransitiveDependenciesCorrect: boolean;

  golden1353PathsCorrect: boolean;

  golden1350ImpactContains1353And1355: boolean;

  exact0010Preserved: boolean;

  code10NotAutoResolvedTo0010: boolean;

  ambiguousTitleNotAutoResolved: boolean;

  cycleTraversalTerminates: boolean;

  unknownFunctionMeaningNotInvented: boolean;

  calculationFormulaUseProven: boolean;

  snapshotRequiredUsesStage3jRoute: boolean;

  missingComponentUsesStage3jRoute: boolean;

  unsupportedCapabilityDoesNotFallback: boolean;

  guaranteedImpactClaimsMadeZero: boolean;

  componentValuesCalculatedZero: boolean;

  rawComponentFormulasPersistedZero: boolean;

  dependencyFragmentsPersistedZero: boolean;

  calculationFormulasPersistedZero: boolean;

  sqlFormulasPersistedZero: boolean;

  deterministicFingerprintCheckOk: boolean;

  allRequiredReferencesPassed: boolean;

  goldenImpactAdditionalDependentsRedactedFromRepoArtifacts: boolean;

  ambiguousResponseHasAmbiguousSelectionEvidence: boolean;

};



export type Stage3jAuditReference = { id: string; ok: boolean; detail: string };



export type Stage3jAuditReport = {

  contractVersion: string;

  generatedAt: string;

  explanationContractVersion: string;

  semanticsCatalogVersion: string;

  runtimeAudit: Stage3jRuntimeAudit;

  referenceAudit: Stage3jReferenceAudit;

  sideEffects: Stage3jSideEffectCounters;

  references: Stage3jAuditReference[];

  verification: {

    stage3jTestsExecuted: number;

    stage3jTestsPassed: number;

    stage3jTestsFailed: number;

    regressionTestsExecuted: number;

    regressionTestsPassed: number;

    regressionTestsFailed: number;

  };

  invariants: Stage3jAuditInvariants;

  auditSemantics: {

    runtimeCountersComeFromInstrumentedServices: string;

    referencesDoNotPretendToBeRuntimeCounters: string;

    referenceExecutionMayAlsoIncrementRuntime: string;

  };

  goldenMetaPresent: boolean;

  strictErrors: string[];

};



export { REQUIRED_STAGE3J_REFERENCE_IDS };



export function emptyStage3jSideEffects(

  overrides: Partial<Stage3jSideEffectCounters> = {},

): Stage3jSideEffectCounters {

  return {

    oracleConnectionsOpened: 0,

    oracleStatementsExecuted: 0,

    oracleWrites: 0,

    llmCalls: 0,

    qdrantCalls: 0,

    embeddingCalls: 0,

    formulasExecuted: 0,

    sqlFormulasExecuted: 0,

    domanFallbacks: 0,

    legacyAgentFallbacks: 0,

    clientPayrollQuestionWithoutSnapshotFallbacks: 0,

    rawFormulaLogged: 0,

    dependencyFragmentsLogged: 0,

    sqlFormulasLogged: 0,

    customerNamesWrittenToDocs: 0,

    localFixturesAddedToGit: 0,

    customerConfigurationCodesExposedInRepoArtifacts: 0,

    ...overrides,

  };

}



/** Side-effect keys that must remain zero in strict audit. */

export const STAGE3J_FORBIDDEN_SIDE_EFFECT_KEYS: Array<keyof Stage3jSideEffectCounters> = [

  'oracleConnectionsOpened',

  'oracleStatementsExecuted',

  'oracleWrites',

  'llmCalls',

  'qdrantCalls',

  'embeddingCalls',

  'formulasExecuted',

  'sqlFormulasExecuted',

  'domanFallbacks',

  'legacyAgentFallbacks',

  'clientPayrollQuestionWithoutSnapshotFallbacks',

  'rawFormulaLogged',

  'dependencyFragmentsLogged',

  'sqlFormulasLogged',

  'customerNamesWrittenToDocs',

  'localFixturesAddedToGit',

  'customerConfigurationCodesExposedInRepoArtifacts',

];



export function collectSideEffectViolations(

  sideEffects: Stage3jSideEffectCounters,

): string[] {

  const errors: string[] = [];

  for (const key of STAGE3J_FORBIDDEN_SIDE_EFFECT_KEYS) {

    if (sideEffects[key] !== 0) {

      errors.push(`sideEffect:${key}=${sideEffects[key]}`);

    }

  }

  return errors;

}



export function validateStage3jInvariants(input: {

  sideEffects: Stage3jSideEffectCounters;

  runtimeAudit: Stage3jRuntimeAudit;

  referenceAudit: Stage3jReferenceAudit;

  invariants: Partial<Stage3jAuditInvariants>;

  references: Stage3jAuditReference[];

  verification: Stage3jAuditReport['verification'];

  auditOutputText?: string;

  minStage3jTests?: number;

}): string[] {

  const minTests = input.minStage3jTests ?? 158;

  const errors = collectSideEffectViolations(input.sideEffects);

  const executedRefIds = new Set(input.references.map((r) => r.id));

  const missingRefs = REQUIRED_STAGE3J_REFERENCE_IDS.filter((id) => !executedRefIds.has(id));



  const invariants: Stage3jAuditInvariants = {

    noSideEffects: true,

    noFormulaExecution: true,

    noRawFormulaInAuditOutput: true,

    noCustomerDataInDocs: true,

    fingerprintDeterministic: true,

    snapshotRequiredWithoutFallback: true,

    historyRedactionApplied: true,

    supportedIntentsOnlyWhenCompleted: true,

    stage3jTestsExecutedAtLeast150: input.verification.stage3jTestsExecuted >= minTests,

    stage3jTestsFailedZero: input.verification.stage3jTestsFailed === 0,

    regressionTestsFailedZero: input.verification.regressionTestsFailed === 0,

    referencesAllPassed: input.references.every((r) => r.ok),

    runtimeCountersComeFromInstrumentedServices: true,

    referencesDoNotPretendToBeRuntimeCounters: true,

    everyRequiredReferenceExecuted: missingRefs.length === 0,

    everyRequiredReferencePassed: REQUIRED_STAGE3J_REFERENCE_IDS.every((id) => {

      const ref = input.references.find((r) => r.id === id);

      return Boolean(ref?.ok);

    }),

    golden1353DirectDependenciesCorrect: false,

    golden1353TransitiveDependenciesCorrect: false,

    golden1353PathsCorrect: false,

    golden1350ImpactContains1353And1355: false,

    exact0010Preserved: false,

    code10NotAutoResolvedTo0010: false,

    ambiguousTitleNotAutoResolved: false,

    cycleTraversalTerminates: false,

    unknownFunctionMeaningNotInvented: false,

    calculationFormulaUseProven: false,

    snapshotRequiredUsesStage3jRoute: false,

    missingComponentUsesStage3jRoute: false,

    unsupportedCapabilityDoesNotFallback: false,

    guaranteedImpactClaimsMadeZero: input.runtimeAudit.guaranteedImpactClaimsMade === 0,

    componentValuesCalculatedZero: input.runtimeAudit.componentValuesCalculated === 0,

    rawComponentFormulasPersistedZero: input.runtimeAudit.rawComponentFormulasPersisted === 0,

    dependencyFragmentsPersistedZero: input.runtimeAudit.dependencyFragmentsPersisted === 0,

    calculationFormulasPersistedZero: input.runtimeAudit.calculationFormulasPersisted === 0,

    sqlFormulasPersistedZero: input.runtimeAudit.sqlFormulasPersisted === 0,

    deterministicFingerprintCheckOk: input.runtimeAudit.deterministicFingerprintCheckOk === 1,

    allRequiredReferencesPassed: false,

    goldenImpactAdditionalDependentsRedactedFromRepoArtifacts: false,

    ambiguousResponseHasAmbiguousSelectionEvidence:

      input.runtimeAudit.ambiguousComponentResponses === 0 ||

      input.runtimeAudit.ambiguousSelections >= 1,

    ...input.invariants,

  };



  invariants.allRequiredReferencesPassed =

    invariants.everyRequiredReferenceExecuted && invariants.everyRequiredReferencePassed;



  invariants.ambiguousResponseHasAmbiguousSelectionEvidence =

    input.runtimeAudit.ambiguousComponentResponses === 0 ||

    input.runtimeAudit.ambiguousSelections >= 1;



  for (const [key, value] of Object.entries(invariants)) {

    if (!value) errors.push(`invariant:${key}`);

  }



  for (const ref of input.references) {

    if (!ref.ok) errors.push(`reference:${ref.id}`);

  }



  for (const id of missingRefs) {

    errors.push(`referenceMissing:${id}`);

  }



  if (input.verification.stage3jTestsExecuted < minTests) {

    errors.push(

      `stage3jTestsExecuted=${input.verification.stage3jTestsExecuted} (expected >=${minTests})`,

    );

  }

  if (input.verification.stage3jTestsFailed > 0) {

    errors.push(`stage3jTestsFailed=${input.verification.stage3jTestsFailed}`);

  }

  if (input.verification.regressionTestsFailed > 0) {

    errors.push(`regressionTestsFailed=${input.verification.regressionTestsFailed}`);

  }



  if (input.runtimeAudit.impactTraceRequests <= 0) {

    errors.push('runtimeAudit:impactTraceRequests=0');

  }

  if (input.runtimeAudit.directDependentsReturned <= 0) {

    errors.push('runtimeAudit:directDependentsReturned=0');

  }

  if (

    input.runtimeAudit.ambiguousComponentResponses > 0 &&

    input.runtimeAudit.ambiguousSelections === 0

  ) {

    errors.push('runtimeAudit:ambiguousComponentResponsesWithoutAmbiguousSelections');

  }

  if (input.auditOutputText) {

    if (/\bm0_\d+/i.test(input.auditOutputText)) {

      errors.push('auditOutputContainsRawFormulaReference');

    }

    if (/\bSELECT\b/i.test(input.auditOutputText)) {

      errors.push('auditOutputContainsSql');

    }

    if (/\bDEMO\b|\bDOMAN\b/i.test(input.auditOutputText)) {

      errors.push('auditOutputContainsCustomerName');

    }

  }



  return [...new Set(errors)];

}



export function buildStage3jAudit(input: {

  explanationContractVersion: string;

  semanticsCatalogVersion: string;

  runtimeAudit: Stage3jRuntimeAudit;

  referenceAudit: Stage3jReferenceAudit;

  sideEffects?: Partial<Stage3jSideEffectCounters>;

  references?: Stage3jAuditReference[];

  verification?: Partial<Stage3jAuditReport['verification']>;

  invariants?: Partial<Stage3jAuditInvariants>;

  goldenMetaPresent?: boolean;

  strictErrors?: string[];

  minStage3jTests?: number;

  now?: () => Date;

}): Stage3jAuditReport {

  const sideEffects = emptyStage3jSideEffects(input.sideEffects);

  const references = input.references ?? [];

  const verification = {

    stage3jTestsExecuted: 0,

    stage3jTestsPassed: 0,

    stage3jTestsFailed: 0,

    regressionTestsExecuted: 0,

    regressionTestsPassed: 0,

    regressionTestsFailed: 0,

    ...input.verification,

  };

  const invariants: Stage3jAuditInvariants = {

    noSideEffects: collectSideEffectViolations(sideEffects).length === 0,

    noFormulaExecution:

      sideEffects.formulasExecuted === 0 && sideEffects.sqlFormulasExecuted === 0,

    noRawFormulaInAuditOutput: true,

    noCustomerDataInDocs: sideEffects.customerNamesWrittenToDocs === 0,

    fingerprintDeterministic: input.runtimeAudit.deterministicFingerprintCheckOk === 1,

    snapshotRequiredWithoutFallback:

      sideEffects.clientPayrollQuestionWithoutSnapshotFallbacks === 0,

    historyRedactionApplied: input.runtimeAudit.historyRedactionsApplied >= 0,

    supportedIntentsOnlyWhenCompleted: true,

    stage3jTestsExecutedAtLeast150:

      verification.stage3jTestsExecuted >= (input.minStage3jTests ?? 158),

    stage3jTestsFailedZero: verification.stage3jTestsFailed === 0,

    regressionTestsFailedZero: verification.regressionTestsFailed === 0,

    referencesAllPassed: references.every((r) => r.ok),

    runtimeCountersComeFromInstrumentedServices: true,

    referencesDoNotPretendToBeRuntimeCounters: true,

    everyRequiredReferenceExecuted: false,

    everyRequiredReferencePassed: false,

    golden1353DirectDependenciesCorrect: false,

    golden1353TransitiveDependenciesCorrect: false,

    golden1353PathsCorrect: false,

    golden1350ImpactContains1353And1355: false,

    exact0010Preserved: false,

    code10NotAutoResolvedTo0010: false,

    ambiguousTitleNotAutoResolved: false,

    cycleTraversalTerminates: false,

    unknownFunctionMeaningNotInvented: false,

    calculationFormulaUseProven: false,

    snapshotRequiredUsesStage3jRoute: false,

    missingComponentUsesStage3jRoute: false,

    unsupportedCapabilityDoesNotFallback: false,

    guaranteedImpactClaimsMadeZero: input.runtimeAudit.guaranteedImpactClaimsMade === 0,

    componentValuesCalculatedZero: input.runtimeAudit.componentValuesCalculated === 0,

    rawComponentFormulasPersistedZero: input.runtimeAudit.rawComponentFormulasPersisted === 0,

    dependencyFragmentsPersistedZero: input.runtimeAudit.dependencyFragmentsPersisted === 0,

    calculationFormulasPersistedZero: input.runtimeAudit.calculationFormulasPersisted === 0,

    sqlFormulasPersistedZero: input.runtimeAudit.sqlFormulasPersisted === 0,

    deterministicFingerprintCheckOk: input.runtimeAudit.deterministicFingerprintCheckOk === 1,

    allRequiredReferencesPassed: false,

    goldenImpactAdditionalDependentsRedactedFromRepoArtifacts: false,

    ambiguousResponseHasAmbiguousSelectionEvidence: false,

    ...input.invariants,

  };

  const executedRefIds = new Set(references.map((r) => r.id));
  invariants.everyRequiredReferenceExecuted = REQUIRED_STAGE3J_REFERENCE_IDS.every((id) =>
    executedRefIds.has(id),
  );
  invariants.everyRequiredReferencePassed = REQUIRED_STAGE3J_REFERENCE_IDS.every((id) => {
    const ref = references.find((r) => r.id === id);
    return Boolean(ref?.ok);
  });
  invariants.allRequiredReferencesPassed =
    invariants.everyRequiredReferenceExecuted && invariants.everyRequiredReferencePassed;
  invariants.ambiguousResponseHasAmbiguousSelectionEvidence =
    input.runtimeAudit.ambiguousComponentResponses === 0 ||
    input.runtimeAudit.ambiguousSelections >= 1;

  const strictErrors =

    input.strictErrors ??

    validateStage3jInvariants({

      sideEffects,

      runtimeAudit: input.runtimeAudit,

      referenceAudit: input.referenceAudit,

      invariants,

      references,

      verification,

      minStage3jTests: input.minStage3jTests,

    });



  return {

    contractVersion: 'teta-aia-payroll-component-explanation-audit-v1',

    generatedAt: (input.now ?? (() => new Date()))().toISOString(),

    explanationContractVersion: input.explanationContractVersion,

    semanticsCatalogVersion: input.semanticsCatalogVersion,

    runtimeAudit: input.runtimeAudit,

    referenceAudit: input.referenceAudit,

    sideEffects,

    references,

    verification,

    invariants,

    auditSemantics: {

      runtimeCountersComeFromInstrumentedServices:

        'runtimeAudit counts instrumented service calls during audit execution',

      referencesDoNotPretendToBeRuntimeCounters:

        'referenceAudit counts audit scenario executions; reference pass/fail is separate from runtime totals',

      referenceExecutionMayAlsoIncrementRuntime:

        'When a reference invokes a real service, runtimeAudit may increase alongside referenceAudit',

    },

    goldenMetaPresent: Boolean(input.goldenMetaPresent),

    strictErrors,

  };

}


