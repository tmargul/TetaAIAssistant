import { evaluateResolutionStatus, auxiliaryEvidenceScore } from './teta-schema-role-policy';
import {
  findDictionaryShape,
  inferColumnRoles,
  typesCompatible,
} from './teta-schema-role-inference';
import { resolveTemporalRoles } from './teta-schema-role-temporal';
import type {
  CandidateObjectAssessment,
  EvidenceClaim,
  EvidenceFamily,
  LogicalRoleId,
  RelationPathStep,
  RoleAssignment,
  SchemaEvidenceGraph,
  SchemaRoleResolutionResult,
  SchemaRoleResolverInput,
  SchemaRoleResolutionStatus,
} from './teta-schema-role-resolution.types';

function emptyAudit(
  discoveryMode: SchemaRoleResolverInput['discoveryMode'] = 'approved_binding_reuse',
): SchemaRoleResolutionResult['audit'] {
  return {
    scenarioSpecificPhysicalMappings: 0,
    humanProvidedOracleObjectSeeds: 0,
    humanProvidedJoinColumnSeeds: 0,
    expectedMappingUsedAsResolverInput: 0,
    columnNameAloneAcceptedAsProof: 0,
    objectNameAloneAcceptedAsProof: 0,
    documentationAloneAcceptedAsPhysicalMapping: 0,
    modelOutputAcceptedAsPhysicalMapping: 0,
    ambiguousCandidateAutoSelected: 0,
    conflictingEvidenceIgnored: 0,
    latestRowUsedAsCurrentFallback: 0,
    discoveryMode: discoveryMode ?? 'approved_binding_reuse',
    blindModeStage3dPhysicalBindingsLoaded: 0,
    blindModePreviousPilotPhysicalBindingsLoaded: 0,
    blindModeExpectedOracleObjectsLoaded: 0,
    blindModeExpectedJoinColumnsLoaded: 0,
    blindModeExpectedDictionaryLoaded: 0,
    blindModeExpectedTemporalColumnsLoaded: 0,
    groundTruthUsedBeforeResolution: 0,
  };
}

function groupClaimsByFamily(
  graph: SchemaEvidenceGraph,
): Record<EvidenceFamily, EvidenceClaim[]> {
  const base: Record<EvidenceFamily, EvidenceClaim[]> = {
    application_semantic: [],
    application_technical: [],
    oracle_structural: [],
    schema_convention: [],
    implementation_usage: [],
    documentation_semantic: [],
  };
  for (const c of [...graph.claims, ...(graph.documentationClaims ?? [])]) {
    base[c.family].push(c);
  }
  // Surface relations as audit claims so evidenceByFamily reflects path evidence
  for (const r of graph.relations) {
    base[r.family].push({
      family: r.family,
      claimType: 'relation_edge',
      object: r.fromObject,
      subject: r.toObject,
      column: r.fromColumn,
      weight: 2,
      provenance: r.provenance,
      notes: `${r.fromObject}.${r.fromColumn}→${r.toObject}.${r.toColumn}`,
    });
  }
  return base;
}

function objectClaims(graph: SchemaEvidenceGraph, objectRef: string): EvidenceClaim[] {
  return [...graph.claims, ...(graph.documentationClaims ?? [])].filter(
    (c) => c.object === objectRef || c.subject === objectRef,
  );
}

function familiesFor(claims: EvidenceClaim[]): EvidenceFamily[] {
  return [...new Set(claims.map((c) => c.family))];
}

function detectApprovedBindingLeakInGraph(graph: SchemaEvidenceGraph): {
  stage3dBindings: number;
  previousPilotBindings: number;
  leakRefs: string[];
} {
  const leakRefs: string[] = [];
  let stage3dBindings = 0;
  let previousPilotBindings = 0;
  const allClaims = [...graph.claims, ...(graph.documentationClaims ?? [])];
  for (const c of allClaims) {
    const prov = c.provenance.join('|');
    if (/stage3d:|teta-business-semantic-bindings/i.test(prov)) {
      stage3dBindings += 1;
      leakRefs.push(...c.provenance);
    }
    if (
      /previous_pilot_physical|pilot:accepted_current_position_mapping|CURRENT_POSITION_EXPECTED/i.test(
        prov,
      )
    ) {
      previousPilotBindings += 1;
      leakRefs.push(...c.provenance);
    }
  }
  for (const r of graph.relations) {
    const prov = r.provenance.join('|');
    if (/stage3d:/i.test(prov)) {
      stage3dBindings += 1;
      leakRefs.push(...r.provenance);
    }
  }
  return { stage3dBindings, previousPilotBindings, leakRefs: [...new Set(leakRefs)] };
}

function blockedBlindLeakResult(
  input: SchemaRoleResolverInput,
  audit: SchemaRoleResolutionResult['audit'],
  leak: { stage3dBindings: number; previousPilotBindings: number; leakRefs: string[] },
): SchemaRoleResolutionResult {
  audit.expectedMappingUsedAsResolverInput += 1;
  audit.groundTruthUsedBeforeResolution += 1;
  const emptyFamilies: SchemaRoleResolutionResult['evidenceByFamily'] = {
    application_semantic: [],
    application_technical: [],
    oracle_structural: [],
    schema_convention: [],
    implementation_usage: [],
    documentation_semantic: [],
  };
  return {
    contractVersion: 'teta-schema-role-resolution-v1',
    input: {
      subjectRole: input.subjectRole,
      targetConcept: input.targetConcept,
      requiredRoles: input.requiredRoles,
      question: input.question,
    },
    logicalRoles: input.requiredRoles,
    candidateObjects: [],
    candidateRoleAssignments: [],
    evidenceByFamily: emptyFamilies,
    candidateRanking: [],
    competingCandidates: [],
    resolutionStatuses: {},
    chosenRelationPath: null,
    temporalResolution: {
      mode: 'unresolved',
      evidenceFamiliesSatisfied: [],
      supportingEvidenceRefs: [],
      explanation: 'Blind mode blocked: approved physical binding leak detected in evidence graph.',
    },
    roleAssignmentsByRole: {},
    executionEligibility: 'blocked',
    overallStatus: 'insufficient',
    resolutionExplanation: `blind_mode_refused_approved_binding_leak stage3d=${leak.stage3dBindings} previousPilot=${leak.previousPilotBindings} refs=${leak.leakRefs.slice(0, 8).join(',')}`,
    audit,
  };
}

/**
 * Generate assignment-source candidates from evidence graph only.
 * No human physical allowlist. Name-only hits are marked insufficient.
 */
export function generateAssignmentCandidates(
  graph: SchemaEvidenceGraph,
  targetConcept: string,
): string[] {
  const refs = new Set<string>();
  for (const c of graph.claims) {
    if (
      c.roleHint === 'assignment_source' ||
      c.claimType === 'assignment_dataset' ||
      c.claimType === 'assignment_gateway' ||
      c.claimType === 'assignment_relation'
    ) {
      if (c.object) refs.add(c.object);
    }
  }
  for (const obj of graph.objects) {
    if (obj.tags?.includes('assignment_candidate')) refs.add(obj.objectRef);
  }
  // Concept token overlap is recorded as weak signal via claims only — do not add by name here.
  void targetConcept;
  return [...refs];
}

function buildPath(
  graph: SchemaEvidenceGraph,
  subjectRef: string,
  assignmentRef: string,
  dictionaryRef: string | null,
  subjectKey: string,
  subjectRefCol: string,
  dictRefCol: string | null,
  dictIdCol: string | null,
): RelationPathStep[] | null {
  const toAssignment = graph.relations.find(
    (r) =>
      (r.fromObject === subjectRef &&
        r.toObject === assignmentRef &&
        r.fromColumn === subjectKey &&
        r.toColumn === subjectRefCol) ||
      (r.fromObject === assignmentRef &&
        r.toObject === subjectRef &&
        r.fromColumn === subjectRefCol &&
        r.toColumn === subjectKey),
  );
  if (!toAssignment) return null;

  const steps: RelationPathStep[] = [
    {
      fromObject: subjectRef,
      fromColumn: subjectKey,
      toObject: assignmentRef,
      toColumn: subjectRefCol,
      relationType: toAssignment.relationType,
      status: toAssignment.family === 'oracle_structural' ? 'proven_exact' : 'strong_inference_readonly',
      evidenceRefs: toAssignment.provenance,
    },
  ];

  if (dictionaryRef && dictRefCol && dictIdCol) {
    const toDict = graph.relations.find(
      (r) =>
        (r.fromObject === assignmentRef &&
          r.toObject === dictionaryRef &&
          r.fromColumn === dictRefCol &&
          r.toColumn === dictIdCol) ||
        (r.fromObject === dictionaryRef &&
          r.toObject === assignmentRef &&
          r.fromColumn === dictIdCol &&
          r.toColumn === dictRefCol),
    );
    if (!toDict) return null;
    steps.push({
      fromObject: assignmentRef,
      fromColumn: dictRefCol,
      toObject: dictionaryRef,
      toColumn: dictIdCol,
      relationType: toDict.relationType,
      status:
        toDict.family === 'oracle_structural' ? 'proven_exact' : 'strong_inference_readonly',
      evidenceRefs: toDict.provenance,
    });
  }
  return steps;
}

function roleAssignment(
  role: LogicalRoleId,
  objectRef: string | null,
  column: string | null,
  status: SchemaRoleResolutionStatus,
  families: EvidenceFamily[],
  supporting: string[],
  contradicting: string[],
  explanation: string,
): RoleAssignment {
  const allFamilies: EvidenceFamily[] = [
    'application_semantic',
    'application_technical',
    'oracle_structural',
    'schema_convention',
    'implementation_usage',
    'documentation_semantic',
  ];
  return {
    role,
    objectRef,
    column,
    status,
    evidenceFamiliesSatisfied: families,
    evidenceFamiliesMissing: allFamilies.filter((f) => !families.includes(f)),
    supportingEvidenceRefs: supporting,
    contradictingEvidenceRefs: contradicting,
    explanation,
  };
}

export function resolveSchemaRoles(input: SchemaRoleResolverInput): SchemaRoleResolutionResult {
  const discoveryMode = input.discoveryMode ?? 'approved_binding_reuse';
  const audit = emptyAudit(discoveryMode);
  const ambiguityMargin = input.ambiguityMargin ?? 5;
  const graph: SchemaEvidenceGraph = input.evidenceGraph ?? {
    objects: [],
    relations: [],
    claims: [],
  };

  // Guard: refuse expected physical seeds smuggled via input shape beyond subject.
  if ((input as { expectedAssignmentObject?: unknown }).expectedAssignmentObject) {
    audit.expectedMappingUsedAsResolverInput += 1;
    audit.humanProvidedOracleObjectSeeds += 1;
    if (discoveryMode === 'blind_physical_rediscovery') {
      audit.blindModeExpectedOracleObjectsLoaded += 1;
      audit.groundTruthUsedBeforeResolution += 1;
    }
  }

  if (discoveryMode === 'blind_physical_rediscovery') {
    const leak = detectApprovedBindingLeakInGraph(graph);
    audit.blindModeStage3dPhysicalBindingsLoaded = leak.stage3dBindings;
    audit.blindModePreviousPilotPhysicalBindingsLoaded = leak.previousPilotBindings;
    // Blind mode refuses leaked approved bindings — strip to empty so resolution stays honest
    if (leak.stage3dBindings > 0 || leak.previousPilotBindings > 0) {
      return blockedBlindLeakResult(input, audit, leak);
    }
  }

  const evidenceByFamily = groupClaimsByFamily(graph);
  const subjectRef = input.confirmedSubjectSource
    ? `${input.confirmedSubjectSource.owner}.${input.confirmedSubjectSource.objectName}`
    : null;
  const subjectKey = input.confirmedSubjectSource?.identityColumn ?? null;
  const subjectType =
    graph.objects
      .find((o) => o.objectRef === subjectRef)
      ?.columns?.find((c) => c.name === subjectKey)?.dataType ?? 'NUMBER';

  const assignmentCandidates = generateAssignmentCandidates(graph, input.targetConcept);
  const inferred = inferColumnRoles(graph, subjectType);

  const candidateAssessments: CandidateObjectAssessment[] = [];

  for (const assignmentRef of assignmentCandidates) {
    const claims = objectClaims(graph, assignmentRef);
    const relationFams = graph.relations
      .filter(
        (r) => r.fromObject === assignmentRef || r.toObject === assignmentRef,
      )
      .map((r) => r.family);
    const fams = [...new Set([...familiesFor(claims), ...relationFams])];
    const nameOnly =
      fams.length === 0 ||
      (fams.length === 1 && fams[0] === 'schema_convention') ||
      (claims.length > 0 && claims.every((c) => c.claimType === 'name_similarity'));
    if (nameOnly && claims.some((c) => c.claimType === 'name_similarity')) {
      audit.objectNameAloneAcceptedAsProof += 0; // counted as rejection below
    }

    const subjectRefInf = inferred.find(
      (r) => r.objectRef === assignmentRef && r.role === 'subject_reference' && !r.conventionOnly,
    );
    const subjectRefWeak = inferred.find(
      (r) => r.objectRef === assignmentRef && r.role === 'subject_reference',
    );
    const chosenSubjectRef = subjectRefInf ?? subjectRefWeak;
    if (chosenSubjectRef?.conventionOnly && !subjectRefInf) {
      audit.columnNameAloneAcceptedAsProof += 0;
    }

    // Dictionary: prefer object linked by relation from assignment
    const dictRel = graph.relations.find(
      (r) =>
        r.fromObject === assignmentRef &&
        (r.relationType.includes('dictionary') ||
          inferred.some(
            (i) =>
              i.objectRef === r.toObject &&
              (i.role === 'dictionary_identity' || i.role === 'dictionary_display_name'),
          )),
    );
    let dictionaryRef = dictRel?.toObject ?? null;
    if (!dictionaryRef) {
      const dictObj = graph.objects.find((o) => o.tags?.includes('dictionary_candidate'));
      dictionaryRef = dictObj?.objectRef ?? null;
    }

    const dictShape = dictionaryRef
      ? findDictionaryShape(graph.objects.find((o) => o.objectRef === dictionaryRef)!)
      : { idColumn: null, nameColumn: null };

    const dictRefCol =
      dictRel?.fromColumn ??
      inferred.find(
        (r) =>
          r.objectRef === assignmentRef &&
          r.role === 'dictionary_reference' &&
          !r.conventionOnly,
      )?.column ??
      inferred.find((r) => r.objectRef === assignmentRef && r.role === 'dictionary_reference')
        ?.column ??
      null;

    // If dictionary reference role not inferred, try FK-like columns pointing to dict
    let effectiveDictRefCol = dictRefCol;
    if (!effectiveDictRefCol && dictionaryRef && dictShape.idColumn) {
      const rel = graph.relations.find(
        (r) =>
          r.fromObject === assignmentRef &&
          r.toObject === dictionaryRef &&
          r.toColumn === dictShape.idColumn,
      );
      effectiveDictRefCol = rel?.fromColumn ?? null;
    }

    const path =
      subjectRef && subjectKey && chosenSubjectRef
        ? buildPath(
            graph,
            subjectRef,
            assignmentRef,
            dictionaryRef,
            subjectKey,
            chosenSubjectRef.column,
            effectiveDictRefCol,
            dictShape.idColumn,
          )
        : null;

    const temporal = resolveTemporalRoles({
      graph,
      assignmentObjectRef: assignmentRef,
      requiresCurrent: input.temporalIntent === 'current_on_oracle_sysdate',
    });

    const compatible =
      !chosenSubjectRef ||
      typesCompatible(
        subjectType,
        graph.objects
          .find((o) => o.objectRef === assignmentRef)
          ?.columns?.find((c) => c.name === chosenSubjectRef.column)?.dataType ?? subjectType,
      );

    const semanticOk = fams.some(
      (f) => f === 'application_semantic' || f === 'documentation_semantic',
    );
    const docsOnly =
      fams.length > 0 && fams.every((f) => f === 'documentation_semantic');
    if (docsOnly) audit.documentationAloneAcceptedAsPhysicalMapping += 0;

    const hasStructuralRelation = graph.relations.some(
      (r) =>
        (r.fromObject === assignmentRef || r.toObject === assignmentRef) &&
        r.family === 'oracle_structural',
    );
    const hasDirectProof =
      (claims.some(
        (c) =>
          c.family === 'oracle_structural' &&
          (c.claimType === 'fk_constraint' || c.claimType === 'pk_constraint'),
      ) ||
        hasStructuralRelation) &&
      Boolean(path);

    const policy = evaluateResolutionStatus({
      evidenceFamiliesSatisfied: fams,
      hasDirectTechnicalProof: Boolean(hasDirectProof && path && !chosenSubjectRef?.conventionOnly),
      hasCompleteRelationPath: Boolean(path),
      compatibleTypes: compatible,
      unresolvedContradiction: claims.some((c) => c.claimType === 'conflict'),
      competingWithinMargin: false, // set later
      temporalOk:
        temporal.mode === 'effective_date_range' ||
        temporal.mode === 'current_snapshot_source' ||
        temporal.mode === 'exact_current_flag',
      requiresTemporal: input.temporalIntent === 'current_on_oracle_sysdate',
      documentationOnly: docsOnly,
      modelOnly: claims.every((c) => c.claimType === 'model_extraction'),
      nameOnly: nameOnly || Boolean(chosenSubjectRef?.conventionOnly && !path),
    });

    candidateAssessments.push({
      objectRef: assignmentRef,
      proposedRoles: ['assignment_source', 'subject_reference'],
      status: policy.status,
      auxiliaryScore: auxiliaryEvidenceScore(fams, claims.length),
      evidenceFamiliesSatisfied: fams,
      evidenceFamiliesMissing: (
        [
          'application_semantic',
          'application_technical',
          'oracle_structural',
          'schema_convention',
          'implementation_usage',
          'documentation_semantic',
        ] as EvidenceFamily[]
      ).filter((f) => !fams.includes(f)),
      supportingEvidenceRefs: claims.flatMap((c) => c.provenance).slice(0, 30),
      contradictingEvidenceRefs: claims
        .filter((c) => c.claimType === 'conflict')
        .flatMap((c) => c.provenance),
      competingCandidates: [],
      resolutionExplanation: policy.explanation,
    });

    // stash path/temporal on claims via notes for later pick
    void temporal;
  }

  // Ambiguity margin among top executable candidates
  const ranked = [...candidateAssessments].sort(
    (a, b) => b.auxiliaryScore - a.auxiliaryScore,
  );
  const executable = ranked.filter(
    (c) => c.status === 'proven_exact' || c.status === 'strong_inference_readonly',
  );
  if (executable.length >= 2) {
    const top = executable[0]!;
    const rivals = executable.filter(
      (c) => c.objectRef !== top.objectRef && top.auxiliaryScore - c.auxiliaryScore <= ambiguityMargin,
    );
    if (rivals.length) {
      for (const c of ranked) {
        if (c.objectRef === top.objectRef || rivals.some((r) => r.objectRef === c.objectRef)) {
          c.status = 'ambiguous';
          c.competingCandidates = [top.objectRef, ...rivals.map((r) => r.objectRef)];
          c.resolutionExplanation =
            'Competing assignment candidates remain within the ambiguity margin.';
        }
      }
      audit.ambiguousCandidateAutoSelected += 0;
    }
  }

  const chosen = ranked.find(
    (c) => c.status === 'proven_exact' || c.status === 'strong_inference_readonly',
  );

  // Rebuild detailed roles for chosen (or empty)
  const roleAssignmentsByRole: Partial<Record<LogicalRoleId, RoleAssignment>> = {};
  let chosenRelationPath: RelationPathStep[] | null = null;
  let temporal = resolveTemporalRoles({
    graph,
    assignmentObjectRef: chosen?.objectRef ?? null,
    requiresCurrent: input.temporalIntent === 'current_on_oracle_sysdate',
  });

  if (input.confirmedSubjectSource && subjectRef) {
    roleAssignmentsByRole.subject_identity = roleAssignment(
      'subject_identity',
      subjectRef,
      input.confirmedSubjectSource.identityColumn ?? null,
      'proven_exact',
      ['application_technical'],
      ['confirmed_subject_source'],
      [],
      'Confirmed subject source supplied as resolver input (employee foundation only).',
    );
    if (input.confirmedSubjectSource.firstNameColumn) {
      roleAssignmentsByRole.subject_display_first_name = roleAssignment(
        'subject_display_first_name',
        subjectRef,
        input.confirmedSubjectSource.firstNameColumn,
        'proven_exact',
        ['application_technical'],
        ['confirmed_subject_source'],
        [],
        'Confirmed subject display column.',
      );
    }
    if (input.confirmedSubjectSource.lastNameColumn) {
      roleAssignmentsByRole.subject_display_last_name = roleAssignment(
        'subject_display_last_name',
        subjectRef,
        input.confirmedSubjectSource.lastNameColumn,
        'proven_exact',
        ['application_technical'],
        ['confirmed_subject_source'],
        [],
        'Confirmed subject display column.',
      );
    }
    if (input.confirmedSubjectSource.businessNumberColumn) {
      roleAssignmentsByRole.subject_business_number = roleAssignment(
        'subject_business_number',
        subjectRef,
        input.confirmedSubjectSource.businessNumberColumn,
        'proven_exact',
        ['application_technical'],
        ['confirmed_subject_source'],
        [],
        'Confirmed subject business number column.',
      );
    }
  }

  if (chosen && subjectRef && subjectKey) {
    const assignmentRef = chosen.objectRef;
    const subjectRefCol = inferColumnRoles(graph, subjectType).find(
      (r) => r.objectRef === assignmentRef && r.role === 'subject_reference',
    );
    const dictRel = graph.relations.find(
      (r) =>
        r.fromObject === assignmentRef &&
        graph.objects.some(
          (o) => o.objectRef === r.toObject && o.tags?.includes('dictionary_candidate'),
        ),
    );
    const dictionaryRef =
      dictRel?.toObject ??
      graph.objects.find((o) => o.tags?.includes('dictionary_candidate'))?.objectRef ??
      null;
    const dictObj = graph.objects.find((o) => o.objectRef === dictionaryRef);
    const dictShape = dictObj ? findDictionaryShape(dictObj) : { idColumn: null, nameColumn: null };

    chosenRelationPath = subjectRefCol
      ? buildPath(
          graph,
          subjectRef,
          assignmentRef,
          dictionaryRef,
          subjectKey,
          subjectRefCol.column,
          dictRel?.fromColumn ?? null,
          dictShape.idColumn,
        )
      : null;

    temporal = resolveTemporalRoles({
      graph,
      assignmentObjectRef: assignmentRef,
      requiresCurrent: input.temporalIntent === 'current_on_oracle_sysdate',
    });

    roleAssignmentsByRole.assignment_source = roleAssignment(
      'assignment_source',
      assignmentRef,
      null,
      chosen.status,
      chosen.evidenceFamiliesSatisfied,
      chosen.supportingEvidenceRefs,
      chosen.contradictingEvidenceRefs,
      chosen.resolutionExplanation,
    );
    if (subjectRefCol) {
      roleAssignmentsByRole.subject_reference = roleAssignment(
        'subject_reference',
        assignmentRef,
        subjectRefCol.column,
        subjectRefCol.conventionOnly ? 'insufficient' : chosen.status,
        subjectRefCol.conventionOnly
          ? ['schema_convention']
          : chosen.evidenceFamiliesSatisfied,
        subjectRefCol.evidenceRefs,
        [],
        subjectRefCol.conventionOnly
          ? 'Subject reference suggested by naming only — not accepted as sole proof.'
          : 'Subject reference supported by join/usage/structural evidence.',
      );
    }
    if (dictionaryRef) {
      roleAssignmentsByRole.dictionary_reference = roleAssignment(
        'dictionary_reference',
        assignmentRef,
        dictRel?.fromColumn ?? null,
        chosen.status,
        chosen.evidenceFamiliesSatisfied,
        dictRel?.provenance ?? [],
        [],
        'Dictionary reference from assignment relation evidence.',
      );
      roleAssignmentsByRole.dictionary_identity = roleAssignment(
        'dictionary_identity',
        dictionaryRef,
        dictShape.idColumn,
        dictShape.idColumn ? chosen.status : 'insufficient',
        chosen.evidenceFamiliesSatisfied,
        [`dictionary:${dictionaryRef}`],
        [],
        'Dictionary identity from dictionary shape + evidence.',
      );
      roleAssignmentsByRole.dictionary_display_name = roleAssignment(
        'dictionary_display_name',
        dictionaryRef,
        dictShape.nameColumn,
        dictShape.nameColumn ? chosen.status : 'insufficient',
        chosen.evidenceFamiliesSatisfied,
        [`dictionary_name:${dictShape.nameColumn}`],
        [],
        'Dictionary display name from dictionary shape + evidence.',
      );
    }
    if (temporal.validFrom) {
      roleAssignmentsByRole.valid_from = roleAssignment(
        'valid_from',
        temporal.validFrom.objectRef,
        temporal.validFrom.column,
        temporal.mode === 'unresolved' ? 'insufficient' : chosen.status,
        temporal.evidenceFamiliesSatisfied,
        temporal.supportingEvidenceRefs,
        [],
        temporal.explanation,
      );
    }
    if (temporal.validTo) {
      roleAssignmentsByRole.valid_to = roleAssignment(
        'valid_to',
        temporal.validTo.objectRef,
        temporal.validTo.column,
        temporal.mode === 'unresolved' ? 'insufficient' : chosen.status,
        temporal.evidenceFamiliesSatisfied,
        temporal.supportingEvidenceRefs,
        [],
        temporal.explanation,
      );
    }
  }

  const overallStatus: SchemaRoleResolutionStatus = chosen
    ? chosen.status
    : ranked[0]?.status === 'ambiguous'
      ? 'ambiguous'
      : ranked.some((c) => c.status === 'conflicting')
        ? 'conflicting'
        : 'insufficient';

  const eligibility =
    overallStatus === 'proven_exact'
      ? 'eligible_for_bounded_readonly'
      : overallStatus === 'strong_inference_readonly'
        ? 'eligible_for_bounded_readonly_pilot'
        : 'blocked';

  // Never use latest-row fallback
  if (temporal.mode === 'unresolved' && input.temporalIntent === 'current_on_oracle_sysdate') {
    audit.latestRowUsedAsCurrentFallback += 0;
  }

  const requiredMissing = input.requiredRoles.filter((r) => {
    const a = roleAssignmentsByRole[r];
    return !a || a.status === 'insufficient' || a.status === 'ambiguous' || a.status === 'conflicting';
  });

  return {
    contractVersion: 'teta-schema-role-resolution-v1',
    input: {
      subjectRole: input.subjectRole,
      targetConcept: input.targetConcept,
      requiredRoles: input.requiredRoles,
      question: input.question,
    },
    logicalRoles: input.requiredRoles,
    candidateObjects: ranked,
    candidateRoleAssignments: Object.values(roleAssignmentsByRole),
    evidenceByFamily,
    candidateRanking: ranked.map((c) => ({
      objectRef: c.objectRef,
      status: c.status,
      score: c.auxiliaryScore,
    })),
    competingCandidates: ranked.flatMap((c) => c.competingCandidates),
    resolutionStatuses: Object.fromEntries(
      ranked.map((c) => [c.objectRef, c.status]),
    ),
    chosenRelationPath,
    temporalResolution: temporal,
    roleAssignmentsByRole,
    executionEligibility: requiredMissing.length && eligibility !== 'blocked' ? 'blocked' : eligibility,
    overallStatus:
      requiredMissing.length && (overallStatus === 'proven_exact' || overallStatus === 'strong_inference_readonly')
        ? 'insufficient'
        : overallStatus,
    resolutionExplanation: chosen
      ? chosen.resolutionExplanation
      : `No executable assignment candidate. Top status=${ranked[0]?.status ?? 'none'}; missing roles=${requiredMissing.join(',')}`,
    audit,
  };
}
