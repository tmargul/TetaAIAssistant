import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  CandidateApplicability,
  CandidateStageManifestV1,
  KnowledgeCandidateKind,
  KnowledgeCandidateOccurrenceV1,
} from '../teta-knowledge-candidates/teta-knowledge-candidate.types';
import { STAGE3J2C_EXTRACTOR_VERSION } from '../teta-knowledge-candidates/teta-topic-section.types';

function emptyHints() {
  return {
    formLabels: [] as string[],
    fieldLabels: [] as string[],
    actionLabels: [] as string[],
    statusLabels: [] as string[],
    parameterNames: [] as string[],
    componentCodes: [] as string[],
    functionNames: [] as string[],
    oracleIdentifiers: [] as string[],
    helpSearchTerms: [] as string[],
  };
}

function baseApplicability(over: Partial<CandidateApplicability> = {}): CandidateApplicability {
  return {
    platformId: 'teta_platform',
    productFamilyIds: ['teta_hr'],
    productSurfaceIds: [],
    domainIds: ['place'],
    businessAreaIds: [],
    productVersionHints: [],
    documentDateHints: [],
    scopeStatus: 'global_candidate',
    currentnessStatus: 'not_verified',
    clientSpecificRisk: 'low',
    ...over,
  };
}

export function makeOccurrence(input: {
  id: string;
  kind: KnowledgeCandidateKind;
  label: string;
  predicate: string;
  object?: string | null;
  statement: string;
  payload?: Record<string, unknown>;
  applicability?: Partial<CandidateApplicability>;
  source?: string;
  sectionId?: string;
  hints?: Partial<ReturnType<typeof emptyHints>>;
  warnings?: string[];
  signature?: string;
}): KnowledgeCandidateOccurrenceV1 {
  const normalizedLabel = input.label.normalize('NFKC').trim().toLowerCase();
  const applicability = baseApplicability(input.applicability);
  const signature =
    input.signature ??
    sha256(
      stableStringify({
        kind: input.kind,
        label: normalizedLabel,
        predicate: input.predicate,
        object: input.object ?? null,
        payload: input.payload ?? {},
        applicability,
      }),
    );
  return {
    contractVersion: 'teta-knowledge-candidate-v1',
    candidateOccurrenceId: input.id,
    candidateSignatureSha256: signature,
    candidateKind: input.kind,
    status: 'candidate',
    canonicalSubjectProposal: {
      label: input.label,
      normalizedLabel,
      proposedCanonicalKey: null,
    },
    predicate: input.predicate,
    object: input.object ?? null,
    candidateStatement: input.statement,
    structuredPayload: input.payload ?? {},
    applicability,
    evidence: [
      {
        sectionId: input.sectionId ?? `section:${input.id}`,
        contentUnitRefs: [`cu:${input.id}`],
        assetRefs: [],
        evidenceStrength: 'explicit_statement',
      },
    ],
    correlationHints: { ...emptyHints(), ...(input.hints ?? {}) },
    extraction: { method: 'deterministic', extractorVersion: 'fixture', modelRunId: null },
    warnings: input.warnings ?? [],
    logicalSourceId: input.source ?? 'fixture:source-a',
    sourceRevisionId: 'rev:fixture',
    sectionId: input.sectionId ?? `section:${input.id}`,
  };
}

export function buildFixtureManifest(occurrences: KnowledgeCandidateOccurrenceV1[]): CandidateStageManifestV1 {
  const sorted = [...occurrences].sort((a, b) => a.candidateOccurrenceId.localeCompare(b.candidateOccurrenceId));
  return {
    contractVersion: 'teta-candidate-stage-manifest-v1',
    stageVersion: STAGE3J2C_EXTRACTOR_VERSION,
    inputManifestFingerprintSha256: sha256('fixture-input'),
    fingerprintSha256: sha256(stableStringify(sorted.map((o) => o.candidateOccurrenceId))),
    batches: [
      {
        contractVersion: 'teta-candidate-batch-v1',
        candidateBatchId: 'batch:fixture',
        logicalSourceId: 'fixture:batch',
        sourceRevisionId: 'rev:fixture',
        sectionFingerprintSetSha256: sha256('sections'),
        candidateExtractorVersion: 'fixture',
        modelConfigurationFingerprint: null,
        sections: [],
        noiseBuckets: [],
        candidateOccurrences: sorted,
        correlationHintRecords: [],
        warnings: [],
      },
    ],
    stats: { candidateOccurrencesCreated: sorted.length },
  };
}

/** Synthetic fixture packs A–V */
export function fixturePackA_ExactDuplicate(): CandidateStageManifestV1 {
  const a = makeOccurrence({
    id: 'occ:a1',
    kind: 'validation_rule',
    label: 'Data końcowa',
    predicate: 'oznacza',
    object: 'brak ograniczenia końcowego',
    statement: 'Pusta data końcowa oznacza brak ograniczenia końcowego.',
    payload: { condition: 'pusta_data_koncowa', effect: 'brak_ograniczenia' },
    source: 'fixture:doc-a',
  });
  const b = makeOccurrence({
    id: 'occ:a2',
    kind: 'validation_rule',
    label: 'Data końcowa',
    predicate: 'oznacza',
    object: 'brak ograniczenia końcowego',
    statement: 'Pusta data końcowa oznacza brak ograniczenia końcowego!',
    payload: { condition: 'pusta_data_koncowa', effect: 'brak_ograniczenia' },
    source: 'fixture:doc-b',
    signature: a.candidateSignatureSha256,
  });
  return buildFixtureManifest([a, b]);
}

export function fixturePackB_SemanticDuplicate(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:b1',
      kind: 'validation_rule',
      label: 'Data do',
      predicate: 'oznacza',
      object: 'obowiązywanie bezterminowe',
      statement: 'Brak daty do oznacza obowiązywanie bezterminowe.',
      payload: { condition: 'brak_daty_do', effect: 'bezterminowe', status: 'OPEN_END' },
      source: 'fixture:doc-a',
    }),
    makeOccurrence({
      id: 'occ:b2',
      kind: 'validation_rule',
      label: 'Data do',
      predicate: 'oznacza',
      object: 'obowiązywanie bezterminowe',
      statement: 'Jeżeli pole Data do jest puste, reguła obowiązuje bezterminowo.',
      payload: { condition: 'brak_daty_do', effect: 'bezterminowe', status: 'OPEN_END' },
      source: 'fixture:doc-b',
    }),
  ]);
}

export function fixturePackC_Enrichment(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:c1',
      kind: 'business_concept',
      label: 'Składnik okresowy',
      predicate: 'może dotyczyć',
      object: 'premii',
      statement: 'Składnik okresowy może dotyczyć premii rocznej.',
      payload: { examples: ['premia_roczna'] },
      source: 'fixture:doc-a',
      applicability: { domainIds: ['place'] },
    }),
    makeOccurrence({
      id: 'occ:c2',
      kind: 'business_concept',
      label: 'Składnik okresowy',
      predicate: 'może dotyczyć',
      object: 'premii',
      statement: 'Składnik okresowy może dotyczyć premii rocznej i kwartalnej.',
      payload: { examples: ['premia_roczna'], alsoAllowed: ['premia_kwartalna'] },
      source: 'fixture:doc-b',
      applicability: { domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackD_ProductVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:d1',
      kind: 'procedure',
      label: 'Zatrudnienie',
      predicate: 'przebiega',
      statement: 'Zatrudnienie w Teta HR wymaga autoryzacji umowy.',
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['kadry'] },
      source: 'fixture:hr',
    }),
    makeOccurrence({
      id: 'occ:d2',
      kind: 'procedure',
      label: 'Zatrudnienie',
      predicate: 'przebiega',
      statement: 'Zatrudnienie w Teta Edu wymaga autoryzacji umowy edukacyjnej.',
      applicability: { productFamilyIds: ['teta_edu'], domainIds: ['kadry'] },
      source: 'fixture:edu',
    }),
  ]);
}

export function fixturePackE_ProductSurfaceVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:e1',
      kind: 'action',
      label: 'Edycja formularza',
      predicate: 'dostępna',
      statement: 'Edycja formularza dostępna w Teta HR desktop.',
      applicability: { productFamilyIds: ['teta_hr'], productSurfaceIds: ['desktop'], domainIds: ['kadry'] },
    }),
    makeOccurrence({
      id: 'occ:e2',
      kind: 'action',
      label: 'Edycja formularza',
      predicate: 'dostępna',
      statement: 'Edycja formularza dostępna w Teta ME.',
      applicability: { productFamilyIds: ['teta_hr'], productSurfaceIds: ['teta_me'], domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackF_VersionVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:f1',
      kind: 'parameter',
      label: 'Parametr X',
      predicate: 'wymaga',
      statement: 'Parametr X w wersji 30.5.',
      payload: { value: 'A' },
      applicability: { productVersionHints: ['30.5'], domainIds: ['place'] },
    }),
    makeOccurrence({
      id: 'occ:f2',
      kind: 'parameter',
      label: 'Parametr X',
      predicate: 'wymaga',
      statement: 'Parametr X w wersji 33.5.',
      payload: { value: 'A' },
      applicability: { productVersionHints: ['33.5'], domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackG_TemporalVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:g1',
      kind: 'temporal_rule',
      label: 'Przełom roku',
      predicate: 'wymaga',
      statement: 'Instrukcja przełomu roku 2025.',
      applicability: { documentDateHints: ['2025'], domainIds: ['kadry'] },
    }),
    makeOccurrence({
      id: 'occ:g2',
      kind: 'temporal_rule',
      label: 'Przełom roku',
      predicate: 'wymaga',
      statement: 'Instrukcja przełomu roku 2026.',
      applicability: { documentDateHints: ['2026'], domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackH_ConfigurationVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:h1',
      kind: 'parameter',
      label: 'Flaga limitu',
      predicate: 'ustawiona',
      statement: 'Flaga limitu = false.',
      payload: { configurationValue: false, parameterName: 'LIMIT_FLAG' },
      hints: { parameterNames: ['LIMIT_FLAG'] },
    }),
    makeOccurrence({
      id: 'occ:h2',
      kind: 'parameter',
      label: 'Flaga limitu',
      predicate: 'ustawiona',
      statement: 'Flaga limitu = true.',
      payload: { configurationValue: true, parameterName: 'LIMIT_FLAG' },
      hints: { parameterNames: ['LIMIT_FLAG'] },
    }),
  ]);
}

export function fixturePackI_ProcessVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:i1',
      kind: 'procedure',
      label: 'Zatrudnienie',
      predicate: 'ścieżka',
      statement: 'Zwykłe zatrudnienie pracownika.',
      payload: { processVariant: 'standard_hire' },
      applicability: { domainIds: ['kadry'] },
    }),
    makeOccurrence({
      id: 'occ:i2',
      kind: 'procedure',
      label: 'Zatrudnienie',
      predicate: 'ścieżka',
      statement: 'Przyjęcie pracownika z ofert pracy.',
      payload: { processVariant: 'hire_from_job_offer' },
      applicability: { domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackJ_ClientVariant(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:j1',
      kind: 'procedure',
      label: 'Mailing powitalny',
      predicate: 'wysyła',
      statement: 'Globalny workflow mailingu.',
      applicability: { scopeStatus: 'global_candidate', domainIds: ['kadry'] },
      source: 'fixture:global',
    }),
    makeOccurrence({
      id: 'occ:j2',
      kind: 'procedure',
      label: 'Mailing powitalny',
      predicate: 'wysyła',
      statement: 'Dedykowany mailing klienta.',
      applicability: {
        scopeStatus: 'client_specific_candidate',
        clientSpecificRisk: 'high',
        domainIds: ['kadry'],
      },
      source: 'fixture:client-x',
    }),
  ]);
}

export function fixturePackK_Conflict(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:k1',
      kind: 'parameter',
      label: 'Parametr obowiązkowy',
      predicate: 'musi być',
      object: 'true',
      statement: 'Parametr obowiązkowy musi być true.',
      payload: { condition: 'always', value: 'true' },
    }),
    makeOccurrence({
      id: 'occ:k2',
      kind: 'parameter',
      label: 'Parametr obowiązkowy',
      predicate: 'musi być',
      object: 'false',
      statement: 'Parametr obowiązkowy musi być false.',
      payload: { condition: 'always', value: 'false' },
    }),
  ]);
}

export function fixturePackL_UnknownApplicability(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:l1',
      kind: 'business_concept',
      label: 'Dataset',
      predicate: 'jest',
      statement: 'Dataset przechowuje dane formularza.',
      applicability: {
        productFamilyIds: [],
        domainIds: [],
        scopeStatus: 'requires_review',
      },
    }),
    makeOccurrence({
      id: 'occ:l2',
      kind: 'business_concept',
      label: 'Dataset',
      predicate: 'jest',
      statement: 'Dataset to zbiór danych powiązany z formularzem.',
      applicability: {
        productFamilyIds: [],
        domainIds: [],
        scopeStatus: 'requires_review',
      },
    }),
  ]);
}

export function fixturePackM_SharedSignature(): CandidateStageManifestV1 {
  const sig = sha256('shared-sig-m');
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:m1',
      kind: 'status',
      label: 'Status otwarty',
      predicate: 'oznacza',
      statement: 'Status otwarty.',
      signature: sig,
      source: 'fixture:s1',
      sectionId: 'section:m1',
    }),
    makeOccurrence({
      id: 'occ:m2',
      kind: 'status',
      label: 'Status otwarty',
      predicate: 'oznacza',
      statement: 'Status otwarty.',
      signature: sig,
      source: 'fixture:s2',
      sectionId: 'section:m2',
    }),
  ]);
}

export function fixturePackN_Regulatory(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:n1',
      kind: 'document_type',
      label: 'Instrukcja KSeF',
      predicate: 'opisuje',
      statement: 'Instrukcja KSeF e-faktury.',
      payload: { regulatory: 'ksef' },
      applicability: { domainIds: ['finanse'], currentnessStatus: 'not_verified' },
    }),
  ]);
}

export function fixturePackO_PayrollLeadingZero(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:o1',
      kind: 'calculation_rule',
      label: 'Składnik 0010',
      predicate: 'używa',
      statement: 'Składnik 0010 uczestniczy w wyliczeniu.',
      payload: { componentCode: '0010', functionName: 'F_PL_OKRES' },
      hints: { componentCodes: ['0010'], functionNames: ['F_PL_OKRES'] },
      applicability: { domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackP_HelpExact(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:p1',
      kind: 'procedure',
      label: 'Zatrudnienie',
      predicate: 'używa',
      statement: 'Formularz zatrudnienia w procesie HR.',
      hints: { formLabels: ['Formularz zatrudnienia'] },
      applicability: { domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackQ_HelpAmbiguous(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:q1',
      kind: 'parameter',
      label: 'Data do',
      predicate: 'pole',
      statement: 'Pole data do na formularzu.',
      hints: { fieldLabels: ['Pole data do'] },
      applicability: { domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackR_GoldenSupported(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:r1',
      kind: 'business_concept',
      label: 'Składnik okresowy',
      predicate: 'jest',
      statement: 'Składnik okresowy to składnik płacowy cykliczny.',
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackS_GoldenPartial(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:s1',
      kind: 'procedure',
      label: 'Konfiguracja składnika okresowego',
      predicate: 'opisuje',
      statement: 'Jak skonfigurować składnik okresowy — kroki podstawowe.',
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackT_GoldenUnsupported(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:t1',
      kind: 'warning',
      label: 'Uwaga UI',
      predicate: 'pokazuje',
      statement: 'Komunikat niezwiązany z pytaniami golden.',
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['kadry'] },
    }),
  ]);
}

export function fixturePackU_GoldenConflict(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:u1',
      kind: 'business_concept',
      label: 'Składnik okresowy',
      predicate: 'jest',
      object: 'A',
      statement: 'Składnik okresowy jest typem A.',
      payload: { condition: 'def', value: 'A' },
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['place'] },
    }),
    makeOccurrence({
      id: 'occ:u2',
      kind: 'business_concept',
      label: 'Składnik okresowy',
      predicate: 'jest',
      object: 'B',
      statement: 'Składnik okresowy jest typem B.',
      payload: { condition: 'def', value: 'B' },
      applicability: { productFamilyIds: ['teta_hr'], domainIds: ['place'] },
    }),
  ]);
}

export function fixturePackV_TetaMe(): CandidateStageManifestV1 {
  return buildFixtureManifest([
    makeOccurrence({
      id: 'occ:v1',
      kind: 'technical_relation',
      label: 'Teta ME',
      predicate: 'jest',
      statement: 'Teta ME jest powierzchnią webową Teta HR ze wspólną bazą danych.',
      payload: { productSurface: 'teta_me', sharedDatabase: 'teta_hr' },
      applicability: {
        productFamilyIds: ['teta_hr'],
        productSurfaceIds: ['teta_me'],
        domainIds: [],
      },
    }),
    makeOccurrence({
      id: 'occ:v2',
      kind: 'business_concept',
      label: 'Teta ME baza',
      predicate: 'nie jest',
      statement: 'Teta ME nie jest osobnym systemem z osobną bazą danych.',
      applicability: {
        productFamilyIds: ['teta_hr'],
        productSurfaceIds: ['teta_me'],
        domainIds: [],
      },
    }),
  ]);
}

export function allFixturePacks(): Array<{ name: string; manifest: CandidateStageManifestV1 }> {
  return [
    { name: 'A_exact', manifest: fixturePackA_ExactDuplicate() },
    { name: 'B_semantic', manifest: fixturePackB_SemanticDuplicate() },
    { name: 'C_enrich', manifest: fixturePackC_Enrichment() },
    { name: 'D_product', manifest: fixturePackD_ProductVariant() },
    { name: 'E_surface', manifest: fixturePackE_ProductSurfaceVariant() },
    { name: 'F_version', manifest: fixturePackF_VersionVariant() },
    { name: 'G_temporal', manifest: fixturePackG_TemporalVariant() },
    { name: 'H_config', manifest: fixturePackH_ConfigurationVariant() },
    { name: 'I_process', manifest: fixturePackI_ProcessVariant() },
    { name: 'J_client', manifest: fixturePackJ_ClientVariant() },
    { name: 'K_conflict', manifest: fixturePackK_Conflict() },
    { name: 'L_unknown', manifest: fixturePackL_UnknownApplicability() },
    { name: 'M_shared_sig', manifest: fixturePackM_SharedSignature() },
    { name: 'N_regulatory', manifest: fixturePackN_Regulatory() },
    { name: 'O_payroll', manifest: fixturePackO_PayrollLeadingZero() },
    { name: 'P_help_exact', manifest: fixturePackP_HelpExact() },
    { name: 'Q_help_ambiguous', manifest: fixturePackQ_HelpAmbiguous() },
    { name: 'R_golden_supported', manifest: fixturePackR_GoldenSupported() },
    { name: 'S_golden_partial', manifest: fixturePackS_GoldenPartial() },
    { name: 'T_golden_unsupported', manifest: fixturePackT_GoldenUnsupported() },
    { name: 'U_golden_conflict', manifest: fixturePackU_GoldenConflict() },
    { name: 'V_teta_me', manifest: fixturePackV_TetaMe() },
  ];
}

export function combinedFixtureManifest(): CandidateStageManifestV1 {
  const all = allFixturePacks().flatMap((p) => p.manifest.batches[0].candidateOccurrences);
  return buildFixtureManifest(all);
}
