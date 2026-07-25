/**
 * Stage 3D unit tests — fixture graphs + fixture bindings only.
 * Live Oracle names are not hardcoded in production TypeScript; fixtures may use sample IDs.
 */
import path from 'path';
import {
  defaultOntologyPath,
  getOntologySubject,
  loadBusinessOntology,
} from './teta-business-ontology-loader';
import {
  defaultBindingsPath,
  defaultLanguagePath,
  getSubjectBindings,
  loadBusinessLanguage,
  loadSemanticBindings,
} from './teta-semantic-bindings-loader';
import { discoverCandidates } from './teta-semantic-candidate-discovery';
import { validateRegistry, validateSubjectBindings } from './teta-semantic-binding-validator';
import { TetaBusinessRoleResolver } from './teta-business-role-resolver';
import {
  applyValuePathToProjection,
  resolveValuePath,
} from './teta-semantic-value-path-resolver';
import { resolveTemporalRule } from './teta-semantic-temporal-rule-resolver';
import {
  buildStage3cSemanticPackage,
  columnFromSemanticBinding,
  joinFromSemanticRelation,
  sourceFromSemanticBinding,
} from './teta-stage3c-semantic-adapter';
import {
  STAGE3D_BINDINGS_VERSION,
  STAGE3D_CONTRACT_VERSION,
  STAGE3D_IDENTITY_VERSION,
  STAGE3D_LANGUAGE_VERSION,
  STAGE3D_ONTOLOGY_VERSION,
  isFilterOnlyRelation,
  isFilterOnlySource,
  type BusinessOntologyFile,
  type SemanticBindingsFile,
  type Stage3dGraphClient,
} from './teta-business-semantics.types';
import { createFixtureGraphClient, type FixtureGraph } from '../teta-query-planner/teta-query-graph-client';
import type { GraphEdgeView, GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import {
  defaultReportTemplatePath,
  loadReportTemplates,
} from '../teta-query-planner/teta-report-template-loader';
import {
  defaultSafetyPolicyPath,
  loadSafetyPolicy,
} from '../teta-query-planner/teta-query-safety-policy';
import { TetaReadOnlyQueryPlannerService } from '../teta-query-planner/teta-readonly-query-planner.service';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
} from '../teta-query-planner/teta-query-plan.types';
import { minimalReadyEvidencePlan } from '../teta-query-planner/teta-stage3c-fixtures';
import { sourcesAreConnected } from '../teta-query-planner/teta-query-join-planner';

const apiRoot = path.resolve(__dirname, '..', '..');
const HASH = 'fixture-semantics-hash-v1';
const SUBJECT = 'occupational_health_examinations';

function n(
  partial: Partial<GraphNodeView> & { id: string; type: string; name: string },
): GraphNodeView {
  return {
    domain: partial.domain ?? 'oracle',
    canonicalName: partial.canonicalName ?? partial.name,
    owner: partial.owner ?? null,
    objectType: partial.objectType ?? null,
    confidence: partial.confidence ?? 'confirmed',
    sourceStages: partial.sourceStages ?? ['fixture'],
    attributes: partial.attributes ?? {},
    evidence: partial.evidence ?? [],
    semanticNormalization: partial.semanticNormalization ?? null,
    ...partial,
  };
}

function e(type: string, from: string, to: string): GraphEdgeView {
  return {
    id: `edge:${type}:${from}:${to}`,
    type,
    from,
    to,
    confidence: 'confirmed',
    sourceStages: ['fixture'],
    attributes: {},
    evidence: [],
  };
}

function buildFixtureGraph(): FixtureGraph {
  const emp = 'oracle-object:FX_ADMIN:VIEW:FX_EMP';
  const empAccess = 'oracle-object:FX_ADMIN_P:VIEW:FX_EMP';
  const exam = 'oracle-object:FX_ADMIN:VIEW:FX_EXAM';
  const examType = 'oracle-object:FX_ADMIN:VIEW:FX_EXAM_TYPE';
  const pos = 'oracle-object:FX_ADMIN:VIEW:FX_POS';
  const posDict = 'oracle-object:FX_ADMIN:VIEW:FX_POS_DICT';
  const org = 'oracle-object:FX_ADMIN:VIEW:FX_ORG';
  const empContract = 'oracle-object:FX_ADMIN:VIEW:FX_CONTRACT';
  const form = 'form:fixture-guid:FixtureExamForm';
  const joinEmp = 'join:fixture:EXAM:EMP:abc123';
  const nodes: GraphNodeView[] = [
    n({ id: form, type: 'application_form', domain: 'application', name: 'FixtureExamForm' }),
    n({
      id: emp,
      type: 'oracle_object',
      name: 'FX_EMP',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['pracownicy', 'pracownik'], semanticTags: ['employee_master'] },
    }),
    n({
      id: empAccess,
      type: 'oracle_object',
      name: 'FX_EMP',
      owner: 'FX_ADMIN_P',
      objectType: 'VIEW',
      attributes: { searchTerms: ['pracownicy'], semanticTags: ['employee_master'] },
    }),
    n({
      id: exam,
      type: 'oracle_object',
      name: 'FX_EXAM',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['badania BHP'], semanticTags: ['health_examination'] },
    }),
    n({
      id: examType,
      type: 'oracle_object',
      name: 'FX_EXAM_TYPE',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['rodzaje badań BHP'], semanticTags: ['examination_type_dictionary'] },
    }),
    n({
      id: pos,
      type: 'oracle_object',
      name: 'FX_POS',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['stanowisko'], semanticTags: ['current_position'] },
    }),
    n({
      id: posDict,
      type: 'oracle_object',
      name: 'FX_POS_DICT',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['słownik stanowisk'], semanticTags: ['position_dictionary'] },
    }),
    n({
      id: org,
      type: 'oracle_object',
      name: 'FX_ORG',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: {
        searchTerms: ['jednostka organizacyjna'],
        semanticTags: ['organizational_unit'],
      },
    }),
    n({
      id: empContract,
      type: 'oracle_object',
      name: 'FX_CONTRACT',
      owner: 'FX_ADMIN',
      objectType: 'VIEW',
      attributes: { searchTerms: ['umowy o pracę'], semanticTags: ['active_employment'] },
    }),
    n({ id: joinEmp, type: 'join', name: 'EXAM_EMP', owner: null, objectType: null }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EMP:EMP_NO',
      type: 'oracle_column',
      name: 'EMP_NO',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'EMP_NO', objectName: 'FX_EMP' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EMP:FIRST_NAME',
      type: 'oracle_column',
      name: 'FIRST_NAME',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'FIRST_NAME', objectName: 'FX_EMP' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EMP:LAST_NAME',
      type: 'oracle_column',
      name: 'LAST_NAME',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'LAST_NAME', objectName: 'FX_EMP' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EMP:ID',
      type: 'oracle_column',
      name: 'ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'ID', objectName: 'FX_EMP' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM:VALID_FROM',
      type: 'oracle_column',
      name: 'VALID_FROM',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'VALID_FROM', objectName: 'FX_EXAM' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM:VALID_TO',
      type: 'oracle_column',
      name: 'VALID_TO',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'VALID_TO', objectName: 'FX_EXAM' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM:EMP_ID',
      type: 'oracle_column',
      name: 'EMP_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'EMP_ID', objectName: 'FX_EXAM' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM:TYPE_ID',
      type: 'oracle_column',
      name: 'TYPE_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'TYPE_ID', objectName: 'FX_EXAM' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:ID',
      type: 'oracle_column',
      name: 'ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'ID', objectName: 'FX_EXAM_TYPE' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME',
      type: 'oracle_column',
      name: 'NAME',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'NAME', objectName: 'FX_EXAM_TYPE' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS:EMP_ID',
      type: 'oracle_column',
      name: 'EMP_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'EMP_ID', objectName: 'FX_POS' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS:POS_DICT_ID',
      type: 'oracle_column',
      name: 'POS_DICT_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'POS_DICT_ID', objectName: 'FX_POS' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS:ORG_ID',
      type: 'oracle_column',
      name: 'ORG_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'ORG_ID', objectName: 'FX_POS' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS:DATE_FROM',
      type: 'oracle_column',
      name: 'DATE_FROM',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'DATE_FROM', objectName: 'FX_POS' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS:DATE_TO',
      type: 'oracle_column',
      name: 'DATE_TO',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'DATE_TO', objectName: 'FX_POS' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS_DICT:ID',
      type: 'oracle_column',
      name: 'ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'ID', objectName: 'FX_POS_DICT' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_POS_DICT:NAME',
      type: 'oracle_column',
      name: 'NAME',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'NAME', objectName: 'FX_POS_DICT' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_ORG:ID',
      type: 'oracle_column',
      name: 'ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'ID', objectName: 'FX_ORG' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_ORG:NAME',
      type: 'oracle_column',
      name: 'NAME',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'NAME', objectName: 'FX_ORG' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_CONTRACT:EMP_ID',
      type: 'oracle_column',
      name: 'EMP_ID',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'EMP_ID', objectName: 'FX_CONTRACT' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_FROM',
      type: 'oracle_column',
      name: 'DATE_FROM',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'DATE_FROM', objectName: 'FX_CONTRACT' },
    }),
    n({
      id: 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_TO',
      type: 'oracle_column',
      name: 'DATE_TO',
      owner: 'FX_ADMIN',
      attributes: { columnName: 'DATE_TO', objectName: 'FX_CONTRACT' },
    }),
    n({
      id: 'oracle-object:HRM:TABLE:FX_BAD',
      type: 'oracle_object',
      name: 'FX_BAD',
      owner: 'HRM',
      objectType: 'TABLE',
      attributes: { searchTerms: ['pracownicy'], semanticTags: ['employee_master'] },
    }),
  ];
  const edges = [
    e('HAS_COLUMN', emp, 'oracle-column:FX_ADMIN:FX_EMP:EMP_NO'),
    e('HAS_COLUMN', emp, 'oracle-column:FX_ADMIN:FX_EMP:FIRST_NAME'),
    e('HAS_COLUMN', emp, 'oracle-column:FX_ADMIN:FX_EMP:LAST_NAME'),
    e('HAS_COLUMN', emp, 'oracle-column:FX_ADMIN:FX_EMP:ID'),
    e('HAS_COLUMN', exam, 'oracle-column:FX_ADMIN:FX_EXAM:VALID_FROM'),
    e('HAS_COLUMN', exam, 'oracle-column:FX_ADMIN:FX_EXAM:VALID_TO'),
    e('HAS_COLUMN', exam, 'oracle-column:FX_ADMIN:FX_EXAM:EMP_ID'),
    e('HAS_COLUMN', exam, 'oracle-column:FX_ADMIN:FX_EXAM:TYPE_ID'),
    e('HAS_COLUMN', examType, 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:ID'),
    e('HAS_COLUMN', examType, 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME'),
    e('HAS_COLUMN', pos, 'oracle-column:FX_ADMIN:FX_POS:EMP_ID'),
    e('HAS_COLUMN', pos, 'oracle-column:FX_ADMIN:FX_POS:POS_DICT_ID'),
    e('HAS_COLUMN', pos, 'oracle-column:FX_ADMIN:FX_POS:ORG_ID'),
    e('HAS_COLUMN', pos, 'oracle-column:FX_ADMIN:FX_POS:DATE_FROM'),
    e('HAS_COLUMN', pos, 'oracle-column:FX_ADMIN:FX_POS:DATE_TO'),
    e('HAS_COLUMN', posDict, 'oracle-column:FX_ADMIN:FX_POS_DICT:ID'),
    e('HAS_COLUMN', posDict, 'oracle-column:FX_ADMIN:FX_POS_DICT:NAME'),
    e('HAS_COLUMN', org, 'oracle-column:FX_ADMIN:FX_ORG:ID'),
    e('HAS_COLUMN', org, 'oracle-column:FX_ADMIN:FX_ORG:NAME'),
    e('HAS_COLUMN', empContract, 'oracle-column:FX_ADMIN:FX_CONTRACT:EMP_ID'),
    e('HAS_COLUMN', empContract, 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_FROM'),
    e('HAS_COLUMN', empContract, 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_TO'),
    e('MAPS_TO_ORACLE_OBJECT', form, emp),
    e('MAPS_TO_ORACLE_OBJECT', form, exam),
    e('JOINS_TO', exam, joinEmp),
    e('MAPS_TO_ORACLE_OBJECT', joinEmp, emp),
  ];
  return { nodes, edges };
}

function fixtureBindings(): SemanticBindingsFile {
  return {
    version: STAGE3D_BINDINGS_VERSION,
    identityVersion: STAGE3D_IDENTITY_VERSION,
    graphSourceHash: HASH,
    subjects: [
      {
        subject: SUBJECT,
        sources: [
          {
            role: 'employee',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_EMP',
            accessObjectNodeId: 'oracle-object:FX_ADMIN_P:VIEW:FX_EMP',
            businessReason: 'Fixture employee master',
            formNodeIds: ['form:fixture-guid:FixtureExamForm'],
          },
          {
            role: 'health_examination',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_EXAM',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_EXAM',
            businessReason: 'Fixture examination card',
          },
          {
            role: 'examination_type',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_EXAM_TYPE',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_EXAM_TYPE',
            businessReason: 'Fixture exam type dictionary',
          },
          {
            role: 'current_position',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_POS',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_POS',
            businessReason: 'Fixture position assignment',
            enrichment: true,
          },
          {
            role: 'organizational_unit',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_ORG',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_ORG',
            businessReason: 'Fixture org unit dictionary',
            enrichment: true,
          },
          {
            role: 'active_employment',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_CONTRACT',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_CONTRACT',
            businessReason: 'Fixture employment contracts',
            supporting: true,
            sourceUsage: 'filter_only',
          },
          {
            role: 'position_dictionary',
            status: 'approved',
            logicalObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_POS_DICT',
            accessObjectNodeId: 'oracle-object:FX_ADMIN:VIEW:FX_POS_DICT',
            businessReason: 'Fixture position dictionary',
            supporting: true,
          },
        ],
        projections: [
          {
            role: 'employee_number',
            status: 'approved',
            sourceRole: 'employee',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:EMP_NO',
            businessReason: 'emp number',
          },
          {
            role: 'employee_first_name',
            status: 'approved',
            sourceRole: 'employee',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:FIRST_NAME',
            businessReason: 'first name',
          },
          {
            role: 'employee_last_name',
            status: 'approved',
            sourceRole: 'employee',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:LAST_NAME',
            businessReason: 'last name',
          },
          {
            role: 'examination_type_name',
            status: 'approved',
            sourceRole: 'examination_type',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME',
            viaValuePathRole: 'examination_type_name',
            businessReason: 'exam type display',
          },
          {
            role: 'examination_valid_from',
            status: 'approved',
            sourceRole: 'health_examination',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:VALID_FROM',
            businessReason: 'valid from',
          },
          {
            role: 'examination_valid_to',
            status: 'approved',
            sourceRole: 'health_examination',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:VALID_TO',
            businessReason: 'valid to',
          },
          {
            role: 'position_name',
            status: 'approved',
            sourceRole: 'current_position',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:NAME',
            viaValuePathRole: 'position_name',
            businessReason: 'position display via dictionary',
          },
          {
            role: 'organizational_unit_name',
            status: 'approved',
            sourceRole: 'organizational_unit',
            oracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:NAME',
            viaValuePathRole: 'organizational_unit_name',
            businessReason: 'org display',
          },
        ],
        relations: [
          {
            role: 'health_examination_to_employee',
            status: 'approved',
            leftSourceRole: 'health_examination',
            rightSourceRole: 'employee',
            joinType: 'inner',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:EMP_ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:ID',
              },
            ],
            evidenceType: 'vendor_confirmed_relation',
            joinNodeId: 'join:fixture:EXAM:EMP:abc123',
            businessReason: 'exam to employee',
            required: true,
          },
          {
            role: 'health_examination_to_examination_type',
            status: 'approved',
            leftSourceRole: 'health_examination',
            rightSourceRole: 'examination_type',
            joinType: 'inner',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:TYPE_ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:ID',
              },
            ],
            evidenceType: 'vendor_confirmed_relation',
            businessReason: 'exam to type',
            required: true,
          },
          {
            role: 'employee_to_current_position',
            status: 'approved',
            leftSourceRole: 'employee',
            rightSourceRole: 'current_position',
            joinType: 'left',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:EMP_ID',
              },
            ],
            evidenceType: 'vendor_confirmed_relation',
            businessReason: 'employee to position',
            required: true,
            enrichment: true,
          },
          {
            role: 'current_position_to_position_dictionary',
            status: 'approved',
            leftSourceRole: 'current_position',
            rightSourceRole: 'position_dictionary',
            joinType: 'left',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:POS_DICT_ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:ID',
              },
            ],
            evidenceType: 'reconstructed_sql_join',
            businessReason: 'position to dictionary',
            enrichment: true,
          },
          {
            role: 'current_position_to_organizational_unit',
            status: 'approved',
            leftSourceRole: 'current_position',
            rightSourceRole: 'organizational_unit',
            joinType: 'left',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:ORG_ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:ID',
              },
            ],
            evidenceType: 'reconstructed_sql_join',
            businessReason: 'position to org',
            required: true,
            enrichment: true,
          },
          {
            role: 'employee_to_organizational_unit',
            status: 'approved',
            leftSourceRole: 'employee',
            rightSourceRole: 'organizational_unit',
            joinType: 'left',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:EMP_ID',
              },
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:ORG_ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:ID',
              },
            ],
            evidenceType: 'reconstructed_sql_join',
            businessReason:
              'Supporting structural bridge; not used for organizational_unit_name projection',
            required: false,
            enrichment: true,
            projectionUsage: 'not_used_for_this_projection',
          },
          {
            role: 'employee_to_active_employment',
            status: 'approved',
            leftSourceRole: 'employee',
            rightSourceRole: 'active_employment',
            joinType: 'inner',
            predicates: [
              {
                leftOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_EMP:ID',
                operator: 'equals',
                rightOracleColumnNodeId: 'oracle-column:FX_ADMIN:FX_CONTRACT:EMP_ID',
              },
            ],
            evidenceType: 'vendor_confirmed_relation',
            businessReason: 'employee to contract',
            required: true,
            usage: 'filter_only',
            rowSemantics: 'exists',
            preservesReportGrain: true,
          },
        ],
        valuePaths: [
          {
            role: 'position_name',
            status: 'approved',
            projectionRole: 'position_name',
            steps: [
              {
                sourceRole: 'current_position',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_POS:POS_DICT_ID',
              },
              {
                sourceRole: 'position_dictionary',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:ID',
              },
              {
                sourceRole: 'position_dictionary',
                displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:NAME',
              },
            ],
            displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:NAME',
            displaySourceRole: 'position_dictionary',
            businessReason: 'position name path',
          },
          {
            role: 'examination_type_name',
            status: 'approved',
            projectionRole: 'examination_type_name',
            steps: [
              {
                sourceRole: 'health_examination',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:TYPE_ID',
              },
              {
                sourceRole: 'examination_type',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:ID',
              },
              {
                sourceRole: 'examination_type',
                displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME',
              },
            ],
            displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME',
            displaySourceRole: 'examination_type',
            businessReason: 'exam type name path',
          },
          {
            role: 'organizational_unit_name',
            status: 'approved',
            projectionRole: 'organizational_unit_name',
            steps: [
              {
                sourceRole: 'current_position',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_POS:ORG_ID',
              },
              {
                sourceRole: 'organizational_unit',
                columnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:ID',
              },
              {
                sourceRole: 'organizational_unit',
                displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:NAME',
              },
            ],
            displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_ORG:NAME',
            displaySourceRole: 'organizational_unit',
            authoritativeStartSourceRole: 'current_position',
            businessReason:
              'Authoritative org unit is from current_position.ORG_ID → FX_ORG.NAME',
          },
        ],
        temporals: [
          {
            role: 'examination_valid_to_in_current_month',
            status: 'approved',
            type: 'half_open_date_interval',
            clock: 'oracle_sysdate',
            columnBusinessRole: 'examination_valid_to',
            columnOracleNodeId: 'oracle-column:FX_ADMIN:FX_EXAM:VALID_TO',
            businessReason: 'month window',
          },
          {
            role: 'employee_active_on_oracle_sysdate',
            status: 'approved',
            type: 'effective_on_date',
            clock: 'oracle_sysdate',
            sourceRole: 'active_employment',
            validFromColumnNodeId: 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_FROM',
            validToColumnNodeId: 'oracle-column:FX_ADMIN:FX_CONTRACT:DATE_TO',
            openEndedEndAllowed: true,
            businessReason: 'active contract',
          },
          {
            role: 'current_position_on_oracle_sysdate',
            status: 'approved',
            type: 'effective_on_date',
            clock: 'oracle_sysdate',
            sourceRole: 'current_position',
            validFromColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:DATE_FROM',
            validToColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS:DATE_TO',
            openEndedEndAllowed: true,
            startInclusive: true,
            endInclusive: true,
            assertionKind: 'vendor_business_assertion',
            businessReason: 'current position dating for report-as-of sysdate',
          },
        ],
        forms: [
          {
            role: 'fixture_exam_form',
            status: 'approved',
            formNodeId: 'form:fixture-guid:FixtureExamForm',
            businessReason: 'fixture form',
          },
        ],
      },
    ],
  };
}

function fixtureOntology(): BusinessOntologyFile {
  return loadBusinessOntology(defaultOntologyPath(apiRoot));
}

function asStage3dClient(graph: FixtureGraph): Stage3dGraphClient {
  return createFixtureGraphClient(graph);
}

function buildResolver(opts?: { hash?: string; bindings?: SemanticBindingsFile }) {
  return new TetaBusinessRoleResolver({
    ontology: fixtureOntology(),
    bindings: opts?.bindings ?? fixtureBindings(),
    language: loadBusinessLanguage(defaultLanguagePath(apiRoot)),
    resolver: asStage3dClient(buildFixtureGraph()),
    graphSourceHash: opts?.hash ?? HASH,
  });
}

describe('Stage 3D business semantics', () => {
  test('1. loads ontology with expected version', () => {
    const o = loadBusinessOntology(defaultOntologyPath(apiRoot));
    expect(o.version).toBe(STAGE3D_ONTOLOGY_VERSION);
    expect(o.identityVersion).toBe(STAGE3D_IDENTITY_VERSION);
  });

  test('2. ontology contains BHP subject', () => {
    expect(getOntologySubject(fixtureOntology(), SUBJECT)?.intent).toBe('build_employee_report');
  });

  test('3. ontology lists supporting active_employment', () => {
    const s = getOntologySubject(fixtureOntology(), SUBJECT)!;
    expect(s.sourceRoles.some((r) => r.role === 'active_employment' && r.kind === 'supporting')).toBe(
      true,
    );
  });

  test('4. loads language PL version', () => {
    const lang = loadBusinessLanguage(defaultLanguagePath(apiRoot));
    expect(lang.version).toBe(STAGE3D_LANGUAGE_VERSION);
    expect(lang.labels.employee).toBeTruthy();
  });

  test('5. loads live bindings file version', () => {
    const b = loadSemanticBindings(defaultBindingsPath(apiRoot));
    expect(b.version).toBe(STAGE3D_BINDINGS_VERSION);
    expect(b.graphSourceHash).toHaveLength(64);
  });

  test('6. live bindings subject present', () => {
    const b = loadSemanticBindings(defaultBindingsPath(apiRoot));
    expect(getSubjectBindings(b, SUBJECT)?.sources.length).toBeGreaterThan(0);
  });

  test('7. fixture bindings validate against fixture graph', () => {
    const v = validateRegistry(fixtureBindings(), asStage3dClient(buildFixtureGraph()), HASH);
    expect(v.ok).toBe(true);
    expect(v.stale).toBe(false);
  });

  test('8. hash mismatch marks stale', () => {
    const v = validateRegistry(fixtureBindings(), asStage3dClient(buildFixtureGraph()), 'other-hash');
    expect(v.stale).toBe(true);
    expect(v.ok).toBe(false);
  });

  test('9. missing businessReason is invalid', () => {
    const b = fixtureBindings();
    b.subjects[0]!.sources[0]!.businessReason = '';
    const v = validateSubjectBindings(
      b.subjects[0]!,
      b,
      asStage3dClient(buildFixtureGraph()),
      HASH,
    );
    expect(v.issues.some((i) => i.code === 'missing_business_reason')).toBe(true);
  });

  test('10. missing node id is invalid', () => {
    const b = fixtureBindings();
    b.subjects[0]!.sources[0]!.logicalObjectNodeId = 'oracle-object:FX_ADMIN:VIEW:MISSING';
    const v = validateSubjectBindings(
      b.subjects[0]!,
      b,
      asStage3dClient(buildFixtureGraph()),
      HASH,
    );
    expect(v.ok).toBe(false);
  });

  test('11. HRM owner rejected', () => {
    const b = fixtureBindings();
    b.subjects[0]!.sources[0]!.logicalObjectNodeId = 'oracle-object:HRM:TABLE:FX_BAD';
    const v = validateSubjectBindings(
      b.subjects[0]!,
      b,
      asStage3dClient(buildFixtureGraph()),
      HASH,
    );
    expect(v.issues.some((i) => i.code === 'forbidden_owner_auto_binding')).toBe(true);
  });

  test('12. value path ending on ID is invalid', () => {
    const b = fixtureBindings();
    b.subjects[0]!.valuePaths[0]!.displayColumnNodeId = 'oracle-column:FX_ADMIN:FX_POS_DICT:ID';
    const v = validateSubjectBindings(
      b.subjects[0]!,
      b,
      asStage3dClient(buildFixtureGraph()),
      HASH,
    );
    expect(v.issues.some((i) => i.code === 'value_path_ends_on_id')).toBe(true);
  });

  test('13. resolveSubject ready for fixture', () => {
    const r = buildResolver().resolveSubject(SUBJECT);
    expect(r.contractVersion).toBe(STAGE3D_CONTRACT_VERSION);
    expect(r.status).toBe('ready');
  });

  test('14. getApprovedSource returns employee', () => {
    const s = buildResolver().getApprovedSource(SUBJECT, 'employee');
    expect(s?.logicalObjectNodeId).toContain('FX_EMP');
  });

  test('15. getApprovedProjection returns employee_number', () => {
    expect(buildResolver().getApprovedProjection(SUBJECT, 'employee_number')?.oracleColumnNodeId).toContain(
      'EMP_NO',
    );
  });

  test('16. getApprovedRelation exam→employee', () => {
    const rel = buildResolver().getApprovedRelation(SUBJECT, 'health_examination_to_employee');
    expect(rel?.predicates[0]?.leftOracleColumnNodeId).toContain('EMP_ID');
  });

  test('17. getApprovedTemporal active employee', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'employee_active_on_oracle_sysdate');
    expect(t?.openEndedEndAllowed).toBe(true);
  });

  test('18. getApprovedValuePath position_name', () => {
    const vp = buildResolver().getApprovedValuePath(SUBJECT, 'position_name');
    expect(vp?.displayColumnNodeId).toContain('NAME');
  });

  test('19. stale hash flips approved to stale', () => {
    const s = buildResolver({ hash: 'other' }).getApprovedSource(SUBJECT, 'employee');
    expect(s?.status).toBe('stale');
  });

  test('20. unknown subject unresolved', () => {
    expect(buildResolver().resolveSubject('unknown_subject').status).toBe('unresolved');
  });

  test('21. discovery finds employee candidates', () => {
    const ont = getOntologySubject(fixtureOntology(), SUBJECT)!;
    const d = discoverCandidates(asStage3dClient(buildFixtureGraph()), ont, 'employee');
    expect(d.candidates.length).toBeGreaterThan(0);
    expect(d.candidates.every((c) => c.owner !== 'HRM')).toBe(true);
  });

  test('22. discovery never auto-approves', () => {
    const d = buildResolver().discoverCandidates(SUBJECT, 'employee');
    expect(['discovered', 'ambiguous', 'unresolved']).toContain(d.status);
    expect(d.status).not.toBe('approved');
  });

  test('23. discovery without resolver unresolved', () => {
    const ont = getOntologySubject(fixtureOntology(), SUBJECT)!;
    expect(discoverCandidates(null, ont, 'employee').status).toBe('unresolved');
  });

  test('24. non-source discovery stays unresolved', () => {
    const d = buildResolver().discoverCandidates(SUBJECT, 'position_name');
    expect(d.status).toBe('unresolved');
  });

  test('25. resolveValuePath position_name', () => {
    const vp = buildResolver().getApprovedValuePath(SUBJECT, 'position_name');
    const r = resolveValuePath(vp);
    expect(r.status).toBe('resolved');
    expect(r.pathSummary.join('→')).toContain('POS_DICT_ID');
    expect(r.pathSummary.join('→')).toContain('NAME');
  });

  test('26. resolveValuePath examination_type_name', () => {
    const r = resolveValuePath(buildResolver().getApprovedValuePath(SUBJECT, 'examination_type_name'));
    expect(r.status).toBe('resolved');
    expect(r.displayColumnNodeId).toContain('FX_EXAM_TYPE:NAME');
  });

  test('27. resolveValuePath rejects ID display', () => {
    const vp = buildResolver().getApprovedValuePath(SUBJECT, 'position_name')!;
    const bad = { ...vp, displayColumnNodeId: 'oracle-column:FX_ADMIN:FX_POS_DICT:ID' };
    expect(resolveValuePath(bad).status).toBe('invalid');
  });

  test('28. applyValuePathToProjection updates column', () => {
    const resolver = buildResolver();
    const proj = resolver.getApprovedProjection(SUBJECT, 'position_name')!;
    const vp = resolver.getApprovedValuePath(SUBJECT, 'position_name');
    const applied = applyValuePathToProjection(proj, vp);
    expect(applied.oracleColumnNodeId).toContain('FX_POS_DICT:NAME');
    expect(applied.sourceRole).toBe('position_dictionary');
  });

  test('29. half_open temporal resolved', () => {
    const r = resolveTemporalRule(
      buildResolver().getApprovedTemporal(SUBJECT, 'examination_valid_to_in_current_month'),
    );
    expect(r.type).toBe('half_open_date_interval');
    expect(r.status).toBe('resolved');
  });

  test('30. effective_on_date open ended', () => {
    const r = resolveTemporalRule(
      buildResolver().getApprovedTemporal(SUBJECT, 'employee_active_on_oracle_sysdate'),
    );
    expect(r.type).toBe('effective_on_date');
    if (r.type === 'effective_on_date') {
      expect(r.openEndedEndAllowed).toBe(true);
      expect(r.resolvedPredicates.some((p) => p.operator === 'greater_or_null')).toBe(true);
    }
  });

  test('31. current_position temporal resolved', () => {
    const r = resolveTemporalRule(
      buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate'),
    );
    expect(r.status).toBe('resolved');
  });

  test('32. missing temporal binding', () => {
    expect(resolveTemporalRule(null).status).toBe('missing');
  });

  test('33. adapter builds semantic package', () => {
    const pkg = buildStage3cSemanticPackage(buildResolver(), SUBJECT);
    expect(pkg.sourcesByRole.has('employee')).toBe(true);
    expect(pkg.additionalSourceRoles).toEqual(
      expect.arrayContaining(['active_employment', 'position_dictionary']),
    );
  });

  test('34. sourceFromSemanticBinding resolved', () => {
    const s = sourceFromSemanticBinding(buildResolver().getApprovedSource(SUBJECT, 'employee')!);
    expect(s.status).toBe('resolved');
    expect(s.logicalObject?.objectName).toBe('FX_EMP');
  });

  test('35. columnFromSemanticBinding resolved', () => {
    const c = columnFromSemanticBinding(buildResolver().getApprovedProjection(SUBJECT, 'employee_number')!);
    expect(c.status).toBe('resolved');
    expect(c.columnName).toBe('EMP_NO');
  });

  test('36. joinFromSemanticRelation maps vendor evidence', () => {
    const j = joinFromSemanticRelation(
      buildResolver().getApprovedRelation(SUBJECT, 'health_examination_to_employee')!,
    );
    expect(j.status).toBe('resolved');
    expect(j.evidenceType).toBe('confirmed_gateway_join');
    expect(j.predicates).toHaveLength(1);
  });

  test('37. Stage 3C planner with semanticResolver ready', () => {
    const semanticResolver = buildResolver();
    const templates = loadReportTemplates(defaultReportTemplatePath(apiRoot));
    const safety = loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot));
    const planner = new TetaReadOnlyQueryPlannerService({
      templates,
      safety,
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.contractVersion).toBe(STAGE3C_CONTRACT_VERSION);
    expect(plan.planStatus).toBe('ready_for_compilation');
  });

  test('38. semantic plan includes supporting sources', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.sources.some((s) => s.sourceRole === 'active_employment' && s.status === 'resolved')).toBe(
      true,
    );
    expect(plan.sources.some((s) => s.sourceRole === 'position_dictionary' && s.status === 'resolved')).toBe(
      true,
    );
  });

  test('39. position_name uses dictionary display column', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const pos = plan.projections.find((p) => p.businessRole === 'position_name');
    expect(pos?.oracleColumnNodeId).toBe('oracle-column:FX_ADMIN:FX_POS_DICT:NAME');
  });

  test('40. examination_type_name uses dictionary display column', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const p = plan.projections.find((x) => x.businessRole === 'examination_type_name');
    expect(p?.oracleColumnNodeId).toBe('oracle-column:FX_ADMIN:FX_EXAM_TYPE:NAME');
  });

  test('41. active employee filter resolved via semantic temporal', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const f = plan.filters.find((x) => x.filterRole === 'employee_active_on_oracle_sysdate');
    expect(f?.status).toBe('resolved');
    expect(f?.type).toBe('effective_on_date');
  });

  test('42. enrichment joins remain left', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    const posJoin = plan.joins.find(
      (j) => j.leftSourceRole === 'employee' && j.rightSourceRole === 'current_position',
    );
    expect(posJoin?.joinType).toBe('left');
  });

  test('43. planner without semanticResolver still works (Stage 3C baseline)', () => {
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver: null,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.contractVersion).toBe(STAGE3C_CONTRACT_VERSION);
    // Without semantic tags matching Stage 3C template, likely needs_graph_resolution — not ready required.
    expect(['ready_for_compilation', 'needs_graph_resolution', 'needs_selection']).toContain(
      plan.planStatus,
    );
  });

  test('44. no SQL side effects in semantic plan audit', () => {
    const semanticResolver = buildResolver();
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    const plan = planner.plan({
      evidencePlan: minimalReadyEvidencePlan(HASH),
      expectedIntent: STAGE3C_SUPPORTED_INTENT,
      expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    });
    expect(plan.audit.finalSqlGenerated).toBe(0);
    expect(plan.audit.sqlExecuted).toBe(0);
    expect(plan.audit.oracleConnections).toBe(0);
    expect(plan.audit.llmCalls).toBe(0);
  });

  test('45. relation without predicates invalid', () => {
    const b = fixtureBindings();
    b.subjects[0]!.relations[0]!.predicates = [];
    const v = validateSubjectBindings(
      b.subjects[0]!,
      b,
      asStage3dClient(buildFixtureGraph()),
      HASH,
    );
    expect(v.issues.some((i) => i.code === 'relation_without_predicates')).toBe(true);
  });

  test('46. rejected binding not returned by getApproved*', () => {
    const b = fixtureBindings();
    b.subjects[0]!.sources[0]!.status = 'rejected';
    expect(buildResolver({ bindings: b }).getApprovedSource(SUBJECT, 'employee')).toBeNull();
  });

  test('47. form binding present', () => {
    expect(buildResolver().getApprovedForm(SUBJECT, 'fixture_exam_form')?.formNodeId).toContain(
      'FixtureExamForm',
    );
  });

  test('48. package projections use value paths', () => {
    const pkg = buildStage3cSemanticPackage(buildResolver(), SUBJECT);
    expect(pkg.projectionsByRole.get('position_name')?.oracleColumnNodeId).toContain('POS_DICT:NAME');
  });

  test('49. ontology value path roles declared', () => {
    const s = getOntologySubject(fixtureOntology(), SUBJECT)!;
    expect(s.valuePathRoles.map((v) => v.role).sort()).toEqual(
      ['examination_type_name', 'organizational_unit_name', 'position_name'].sort(),
    );
  });

  test('50. ontology temporal roles declared', () => {
    const s = getOntologySubject(fixtureOntology(), SUBJECT)!;
    expect(s.temporalRoles.map((t) => t.role)).toEqual(
      expect.arrayContaining([
        'examination_valid_to_in_current_month',
        'employee_active_on_oracle_sysdate',
        'current_position_on_oracle_sysdate',
      ]),
    );
  });

  test('51. reconstructed_sql_join evidence maps correctly', () => {
    const j = joinFromSemanticRelation(
      buildResolver().getApprovedRelation(SUBJECT, 'current_position_to_position_dictionary')!,
    );
    expect(j.evidenceType).toBe('reconstructed_sql_join');
  });

  test('52. validateRegistry counts approved bindings', () => {
    const v = buildResolver().validateRegistry();
    expect(v.approvedBindingCount).toBeGreaterThan(10);
  });

  test('53. half_open lower/upper boundaries', () => {
    const r = resolveTemporalRule(
      buildResolver().getApprovedTemporal(SUBJECT, 'examination_valid_to_in_current_month'),
    );
    if (r.type === 'half_open_date_interval') {
      expect(r.lowerBoundary.transform).toBe('month_start');
      expect(r.upperBoundary.transform).toBe('next_month_start');
      expect(r.upperBoundary.inclusive).toBe(false);
    }
  });

  test('54. resolveSubject warnings empty when ready', () => {
    const r = buildResolver().resolveSubject(SUBJECT);
    expect(r.warnings).toEqual([]);
  });

  test('55. live bindings identity matches Stage 3A identity', () => {
    const b = loadSemanticBindings(defaultBindingsPath(apiRoot));
    expect(b.identityVersion).toBe(STAGE3D_IDENTITY_VERSION);
  });

  function planWithSemantics(bindings?: SemanticBindingsFile) {
    const semanticResolver = buildResolver(bindings ? { bindings } : undefined);
    const planner = new TetaReadOnlyQueryPlannerService({
      templates: loadReportTemplates(defaultReportTemplatePath(apiRoot)),
      safety: loadSafetyPolicy(defaultSafetyPolicyPath(apiRoot)),
      graph: createFixtureGraphClient(buildFixtureGraph()),
      graphSourceHash: HASH,
      semanticResolver,
    });
    return {
      semanticResolver,
      plan: planner.plan({
        evidencePlan: minimalReadyEvidencePlan(HASH),
        expectedIntent: STAGE3C_SUPPORTED_INTENT,
        expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
      }),
    };
  }

  test('56. current_position requires temporal binding', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate');
    expect(t).not.toBeNull();
    expect(t!.sourceRole).toBe('current_position');
    expect(t!.validFromColumnNodeId).toBeTruthy();
    expect(t!.validToColumnNodeId).toBeTruthy();
  });

  test('57. missing current_position temporal blocks ready_for_compilation', () => {
    const b = fixtureBindings();
    b.subjects[0]!.temporals = b.subjects[0]!.temporals.filter(
      (t) => t.role !== 'current_position_on_oracle_sysdate',
    );
    const { plan } = planWithSemantics(b);
    expect(plan.planStatus).not.toBe('ready_for_compilation');
    expect(
      plan.filters.find((f) => f.filterRole === 'current_position_on_oracle_sysdate')?.status,
    ).not.toBe('resolved');
  });

  test('58. temporal binding uses current_position source', () => {
    const r = resolveTemporalRule(
      buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate'),
    );
    expect(r.type).toBe('effective_on_date');
    if (r.type === 'effective_on_date') {
      expect(r.sourceRole).toBe('current_position');
    }
  });

  test('59. start/end columns have canonical IDs', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate')!;
    expect(t.validFromColumnNodeId).toMatch(/^oracle-column:/);
    expect(t.validToColumnNodeId).toMatch(/^oracle-column:/);
  });

  test('60. open ended end allowed on current position', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate')!;
    expect(t.openEndedEndAllowed).toBe(true);
  });

  test('61. start inclusive on current position temporal', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate')!;
    expect(t.startInclusive).toBe(true);
    const r = resolveTemporalRule(t);
    if (r.type === 'effective_on_date') expect(r.startInclusive).toBe(true);
  });

  test('62. end inclusive on current position temporal', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate')!;
    expect(t.endInclusive).toBe(true);
    const r = resolveTemporalRule(t);
    if (r.type === 'effective_on_date') expect(r.endInclusive).toBe(true);
  });

  test('63. clock oracle_sysdate on current position temporal', () => {
    const t = buildResolver().getApprovedTemporal(SUBJECT, 'current_position_on_oracle_sysdate')!;
    expect(t.clock).toBe('oracle_sysdate');
  });

  test('64. semantic BHP plan has three resolved filters', () => {
    const { plan } = planWithSemantics();
    expect(plan.filters.map((f) => f.filterRole)).toEqual([
      'examination_valid_to_in_current_month',
      'employee_active_on_oracle_sysdate',
      'current_position_on_oracle_sysdate',
    ]);
    expect(plan.filters.every((f) => f.status === 'resolved')).toBe(true);
  });

  test('65. historical position cannot enter without temporal filter', () => {
    const b = fixtureBindings();
    const temporal = b.subjects[0]!.temporals.find(
      (t) => t.role === 'current_position_on_oracle_sysdate',
    )!;
    temporal.status = 'discovered';
    const { plan } = planWithSemantics(b);
    expect(plan.planStatus).not.toBe('ready_for_compilation');
  });

  test('66. organizational unit comes from current_position', () => {
    const vp = buildResolver().getApprovedValuePath(SUBJECT, 'organizational_unit_name')!;
    expect(vp.authoritativeStartSourceRole).toBe('current_position');
    expect(vp.steps[0]?.sourceRole).toBe('current_position');
    const { plan } = planWithSemantics();
    expect(
      plan.joins.some(
        (j) =>
          j.leftSourceRole === 'current_position' &&
          j.rightSourceRole === 'organizational_unit' &&
          j.status === 'resolved',
      ),
    ).toBe(true);
  });

  test('67. employee→organizational_unit is not a competing projection path', () => {
    const rel = buildResolver().getApprovedRelation(SUBJECT, 'employee_to_organizational_unit')!;
    expect(rel.projectionUsage).toBe('not_used_for_this_projection');
    const { plan } = planWithSemantics();
    expect(
      plan.joins.some(
        (j) => j.leftSourceRole === 'employee' && j.rightSourceRole === 'organizational_unit',
      ),
    ).toBe(false);
  });

  test('68. one authoritative value path for organizational_unit_name', () => {
    const paths = buildResolver()
      .resolveSubject(SUBJECT)
      .valuePaths.filter((v) => v.role === 'organizational_unit_name' && v.status === 'approved');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.authoritativeStartSourceRole).toBe('current_position');
  });

  test('69. Stage 3C contractVersion unchanged', () => {
    const { plan } = planWithSemantics();
    expect(plan.contractVersion).toBe(STAGE3C_CONTRACT_VERSION);
    expect(STAGE3C_CONTRACT_VERSION).toBe('teta-aia-readonly-query-plan-v1');
  });

  test('70. side-effect counters remain zero', () => {
    const { plan } = planWithSemantics();
    expect(plan.audit.finalSqlGenerated).toBe(0);
    expect(plan.audit.sqlExecuted).toBe(0);
    expect(plan.audit.oracleConnections).toBe(0);
    expect(plan.audit.qdrantCalls).toBe(0);
    expect(plan.audit.embeddingCalls).toBe(0);
    expect(plan.audit.llmCalls).toBe(0);
    expect(plan.audit.agentCalls).toBe(0);
  });

  test('71. ready plan includes current_position temporal filter', () => {
    const { plan } = planWithSemantics();
    expect(plan.planStatus).toBe('ready_for_compilation');
    const f = plan.filters.find((x) => x.filterRole === 'current_position_on_oracle_sysdate');
    expect(f?.status).toBe('resolved');
    expect(f?.type).toBe('effective_on_date');
    if (f?.type === 'effective_on_date') {
      expect(f.sourceRole).toBe('current_position');
    }
  });

  test('72. active employment is bound as a qualifying filter, not a row source', () => {
    const relation = buildResolver().getApprovedRelation(SUBJECT, 'employee_to_active_employment')!;
    expect(relation.usage).toBe('filter_only');
    expect(relation.rowSemantics).toBe('exists');
    expect(relation.preservesReportGrain).toBe(true);
    expect(isFilterOnlyRelation(relation)).toBe(true);

    const source = buildResolver()
      .resolveSubject(SUBJECT)
      .sources.find((s) => s.role === 'active_employment')!;
    expect(source.sourceUsage).toBe('filter_only');
    expect(isFilterOnlySource(source)).toBe(true);
  });

  test('73. relations without an explicit usage stay row-producing', () => {
    const relation = buildResolver().getApprovedRelation(SUBJECT, 'employee_to_current_position')!;
    expect(relation.usage).toBeUndefined();
    expect(isFilterOnlyRelation(relation)).toBe(false);
  });

  test('74. the live bindings mark active employment filter-only too', () => {
    const bindings = loadSemanticBindings(defaultBindingsPath(apiRoot));
    const subject = bindings.subjects.find((s) => s.subject === SUBJECT)!;
    expect(subject.sources.find((s) => s.role === 'active_employment')?.sourceUsage).toBe(
      'filter_only',
    );
    const relation = subject.relations.find((r) => r.role === 'employee_to_active_employment')!;
    expect(relation.usage).toBe('filter_only');
    expect(relation.rowSemantics).toBe('exists');
    expect(relation.preservesReportGrain).toBe(true);
    expect(relation.businessReason).toContain('zwielokrotniać');
  });

  test('75. the filter-only source stays out of the join tree', () => {
    const { plan } = planWithSemantics();
    expect(plan.sources.find((s) => s.sourceRole === 'active_employment')?.sourceUsage).toBe(
      'filter_only',
    );
    expect(
      plan.joins.some(
        (j) => j.leftSourceRole === 'active_employment' || j.rightSourceRole === 'active_employment',
      ),
    ).toBe(false);
    // Connectivity is judged over row-producing sources only, so the plan is still ready.
    expect(sourcesAreConnected(plan.sources, plan.joins).connected).toBe(true);
    expect(plan.planStatus).toBe('ready_for_compilation');
    expect(plan.joins.length).toBe(
      plan.sources.filter((s) => s.sourceUsage !== 'filter_only').length - 1,
    );
  });

  test('76. the plan carries an existence filter for the qualifying relation', () => {
    const { plan } = planWithSemantics();
    expect(plan.existenceFilters).toHaveLength(1);
    const existence = plan.existenceFilters![0]!;
    expect(existence.status).toBe('resolved');
    expect(existence.filterRole).toBe('employee_active_on_oracle_sysdate');
    expect(existence.relationRole).toBe('employee_to_active_employment');
    expect(existence.correlatedSourceRole).toBe('employee');
    expect(existence.filterOnlySourceRole).toBe('active_employment');
    expect(existence.temporalFilterRole).toBe('employee_active_on_oracle_sysdate');
    expect(existence.preservesReportGrain).toBe(true);
    expect(existence.correlationPredicates).toHaveLength(1);
    // Correlation is oriented outer (employee) → inner (contract) regardless of storage order.
    expect(existence.correlationPredicates[0]!.outerOracleColumnNodeId).toBe(
      'oracle-column:FX_ADMIN:FX_EMP:ID',
    );
    expect(existence.correlationPredicates[0]!.innerOracleColumnNodeId).toBe(
      'oracle-column:FX_ADMIN:FX_CONTRACT:EMP_ID',
    );
    expect(existence.correlationPredicates[0]!.operator).toBe('equals');
  });

  test('77. the temporal filter stays in plan.filters for the AST', () => {
    const { plan } = planWithSemantics();
    const temporal = plan.filters.find(
      (f) => f.filterRole === 'employee_active_on_oracle_sysdate',
    );
    expect(temporal?.status).toBe('resolved');
    expect(temporal?.type).toBe('effective_on_date');
    if (temporal?.type === 'effective_on_date') {
      expect(temporal.sourceRole).toBe('active_employment');
    }
  });

  test('78. the plan declares the report grain one row stands for', () => {
    const { plan } = planWithSemantics();
    expect(plan.reportGrain).toBe('health_examination');
  });

  test('79. a filter-only source with no existence coverage is not ready', () => {
    const b = fixtureBindings();
    const temporal = b.subjects[0]!.temporals.find(
      (t) => t.role === 'employee_active_on_oracle_sysdate',
    )!;
    temporal.status = 'discovered';
    const { plan } = planWithSemantics(b);
    expect(plan.planStatus).not.toBe('ready_for_compilation');
    expect(
      plan.warnings.some((w) => w.code === 'filter_only_source_without_existence_filter'),
    ).toBe(true);
  });
});
