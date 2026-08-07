import type { SchemaEvidenceGraph } from './teta-schema-role-resolution.types';

/** Synthetic schema with non-Teta names — proves generic role inference. */
export function buildSyntheticTimeGroupEvidenceGraph(): SchemaEvidenceGraph {
  return {
    objects: [
      {
        objectRef: 'HR.PERSON',
        owner: 'HR',
        objectType: 'TABLE',
        objectName: 'PERSON',
        columns: [
          { name: 'PERSON_KEY', dataType: 'NUMBER', isPk: true },
          { name: 'GIVEN_NAME', dataType: 'VARCHAR2' },
          { name: 'FAMILY_NAME', dataType: 'VARCHAR2' },
          { name: 'BADGE_NO', dataType: 'VARCHAR2' },
        ],
        tags: ['subject'],
      },
      {
        objectRef: 'HR.WORKER_GROUP_ASSIGN',
        owner: 'HR',
        objectType: 'TABLE',
        objectName: 'WORKER_GROUP_ASSIGN',
        columns: [
          { name: 'ASSIGN_ID', dataType: 'NUMBER', isPk: true },
          { name: 'WORKER_REF', dataType: 'NUMBER', isFk: true, references: 'HR.PERSON' },
          { name: 'GROUP_KEY', dataType: 'NUMBER', isFk: true, references: 'HR.WORK_GROUP_DICT' },
          { name: 'EFFECTIVE_FROM', dataType: 'DATE' },
          { name: 'EFFECTIVE_UNTIL', dataType: 'DATE', nullable: true },
        ],
        tags: ['assignment_candidate'],
      },
      {
        objectRef: 'HR.WORK_GROUP_DICT',
        owner: 'HR',
        objectType: 'TABLE',
        objectName: 'WORK_GROUP_DICT',
        columns: [
          { name: 'GROUP_KEY', dataType: 'NUMBER', isPk: true },
          { name: 'DESCRIPTION', dataType: 'VARCHAR2' },
        ],
        tags: ['dictionary_candidate'],
      },
    ],
    relations: [
      {
        fromObject: 'HR.WORKER_GROUP_ASSIGN',
        fromColumn: 'WORKER_REF',
        toObject: 'HR.PERSON',
        toColumn: 'PERSON_KEY',
        relationType: 'fk_subject',
        family: 'oracle_structural',
        provenance: ['synthetic:fk WORKER_REF→PERSON_KEY'],
      },
      {
        fromObject: 'HR.WORKER_GROUP_ASSIGN',
        fromColumn: 'GROUP_KEY',
        toObject: 'HR.WORK_GROUP_DICT',
        toColumn: 'GROUP_KEY',
        relationType: 'fk_dictionary',
        family: 'oracle_structural',
        provenance: ['synthetic:fk GROUP_KEY→WORK_GROUP_DICT'],
      },
      {
        fromObject: 'HR.WORKER_GROUP_ASSIGN',
        fromColumn: 'WORKER_REF',
        toObject: 'HR.PERSON',
        toColumn: 'PERSON_KEY',
        relationType: 'view_join_usage',
        family: 'implementation_usage',
        provenance: ['synthetic:repeated_view_join'],
      },
    ],
    claims: [
      {
        family: 'application_semantic',
        claimType: 'assignment_dataset',
        object: 'HR.WORKER_GROUP_ASSIGN',
        roleHint: 'assignment_source',
        weight: 3,
        provenance: ['synthetic:form WorkGroupAssignmentGrid'],
        notes: 'UI grid labeled current work group assignment',
      },
      {
        family: 'application_technical',
        claimType: 'assignment_gateway',
        object: 'HR.WORKER_GROUP_ASSIGN',
        roleHint: 'assignment_source',
        weight: 3,
        provenance: ['synthetic:gateway TableName=WORKER_GROUP_ASSIGN'],
      },
      {
        family: 'application_semantic',
        claimType: 'temporal_period_labels',
        object: 'HR.WORKER_GROUP_ASSIGN',
        column: 'EFFECTIVE_FROM',
        roleHint: 'valid_from',
        weight: 2,
        provenance: ['synthetic:column_label Effective from'],
      },
      {
        family: 'application_semantic',
        claimType: 'temporal_period_labels',
        object: 'HR.WORKER_GROUP_ASSIGN',
        column: 'EFFECTIVE_UNTIL',
        roleHint: 'valid_to',
        weight: 2,
        provenance: ['synthetic:column_label Effective until'],
      },
      {
        family: 'documentation_semantic',
        claimType: 'period_semantics',
        object: 'HR.WORKER_GROUP_ASSIGN',
        weight: 2,
        provenance: ['synthetic:help Assignment is valid between Effective from and until'],
      },
    ],
    documentationClaims: [
      {
        family: 'documentation_semantic',
        claimType: 'entity_meaning',
        object: 'HR.WORKER_GROUP_ASSIGN',
        weight: 2,
        provenance: ['synthetic:training Work group assignment to a person'],
      },
    ],
  };
}

/** Two competing assignment objects with different business meaning → ambiguous. */
export function buildAmbiguousAssignmentEvidenceGraph(): SchemaEvidenceGraph {
  const base = buildSyntheticTimeGroupEvidenceGraph();
  base.objects.push({
    objectRef: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
    owner: 'HR',
    objectType: 'TABLE',
    objectName: 'QUESTIONNAIRE_GROUP_ASSIGN',
    columns: [
      { name: 'ASSIGN_ID', dataType: 'NUMBER', isPk: true },
      { name: 'WORKER_REF', dataType: 'NUMBER', isFk: true },
      { name: 'GROUP_KEY', dataType: 'NUMBER', isFk: true },
      { name: 'EFFECTIVE_FROM', dataType: 'DATE' },
      { name: 'EFFECTIVE_UNTIL', dataType: 'DATE', nullable: true },
    ],
    tags: ['assignment_candidate'],
  });
  base.relations.push(
    {
      fromObject: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      fromColumn: 'WORKER_REF',
      toObject: 'HR.PERSON',
      toColumn: 'PERSON_KEY',
      relationType: 'fk_subject',
      family: 'oracle_structural',
      provenance: ['synthetic:fk questionnaire'],
    },
    {
      fromObject: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      fromColumn: 'GROUP_KEY',
      toObject: 'HR.WORK_GROUP_DICT',
      toColumn: 'GROUP_KEY',
      relationType: 'fk_dictionary',
      family: 'oracle_structural',
      provenance: ['synthetic:fk questionnaire dict'],
    },
    {
      fromObject: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      fromColumn: 'WORKER_REF',
      toObject: 'HR.PERSON',
      toColumn: 'PERSON_KEY',
      relationType: 'view_join_usage',
      family: 'implementation_usage',
      provenance: ['synthetic:questionnaire usage'],
    },
  );
  base.claims.push(
    {
      family: 'application_semantic',
      claimType: 'assignment_dataset',
      object: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      roleHint: 'assignment_source',
      weight: 3,
      provenance: ['synthetic:form QuestionnaireGroups — different business meaning'],
    },
    {
      family: 'application_technical',
      claimType: 'assignment_gateway',
      object: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      roleHint: 'assignment_source',
      weight: 3,
      provenance: ['synthetic:gateway QUESTIONNAIRE_GROUP_ASSIGN'],
    },
    {
      family: 'application_semantic',
      claimType: 'temporal_period_labels',
      object: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      roleHint: 'valid_from',
      weight: 2,
      provenance: ['synthetic:questionnaire period labels'],
    },
    {
      family: 'documentation_semantic',
      claimType: 'period_semantics',
      object: 'HR.QUESTIONNAIRE_GROUP_ASSIGN',
      weight: 2,
      provenance: ['synthetic:help questionnaire assignment periods'],
    },
  );
  return base;
}

/** Semantic-only evidence — must block. */
export function buildSemanticOnlyEvidenceGraph(): SchemaEvidenceGraph {
  return {
    objects: [
      {
        objectRef: 'HR.MYSTERY',
        objectName: 'MYSTERY',
        columns: [{ name: 'X', dataType: 'NUMBER' }],
        tags: ['assignment_candidate'],
      },
    ],
    relations: [],
    claims: [
      {
        family: 'application_semantic',
        claimType: 'assignment_dataset',
        object: 'HR.MYSTERY',
        roleHint: 'assignment_source',
        weight: 2,
        provenance: ['label only'],
      },
      {
        family: 'documentation_semantic',
        claimType: 'entity_meaning',
        object: 'HR.MYSTERY',
        weight: 2,
        provenance: ['docs only'],
      },
    ],
  };
}
