import fs from 'fs';
import path from 'path';
import {
  CanonicalGraphIndexService,
  defaultStage3aPaths,
} from '../teta-plugins/teta-stage3a.index';
import { CanonicalGraphResolverService } from '../teta-plugins/teta-stage3a.resolver';
import type {
  EmployeeViewKeyPreservationAssessment,
  KeyPreservationStatus,
} from './teta-foundation.types';
import { sha256, stableStringify } from './teta-foundation.types';

/** Prior evidence form GUID from Stage 3K packs — application access surface only */
export const REAL_P1_FORM_GUID = '19a5dac6-733f-4801-8a66-f9ee707bb404';
export const REAL_EMPLOYEE_OBJECT_NAME = 'NT_KP_PRC_PRACOWNICY';
export const REAL_EMPLOYEE_OBJECT_OWNER = 'TETA_ADMIN';

export interface FoundationGraphRead {
  available: boolean;
  graphSourceHash: string | null;
  formResolved: boolean;
  formNodeId: string | null;
  employeeObjectResolved: boolean;
  employeeObjectNodeId: string | null;
  employeeObjectType: 'VIEW' | 'TABLE' | null;
  employeeHasBaseTablePkViaDependsOn: boolean;
  employeeDependsOnCount: number;
  hasColumnCount: number;
  trainingApplicationAnchorFound: boolean;
  trainingFormNodeId: string | null;
  viewKeyPreservation: EmployeeViewKeyPreservationAssessment | null;
  readCount: number;
  errors: string[];
}

export function assessViewKeyPreservation(input: {
  sourceObjectRef: string;
  sourceObjectType: string | null;
  baseTablePkViaDependsOn: boolean;
  dependsOnCount: number;
  projectedTechnicalKey: string | null;
  keyPreservingJoinEvidence: boolean;
  authoritativeGrainEvidence: boolean;
  viewDefinitionAvailable: boolean;
}): EmployeeViewKeyPreservationAssessment {
  const isTable = (input.sourceObjectType ?? '').toUpperCase() === 'TABLE';
  let keyPreservationStatus: KeyPreservationStatus = 'unproven';
  const evidenceRefs: string[] = [];

  if (isTable && input.baseTablePkViaDependsOn) {
    keyPreservationStatus = 'proven';
    evidenceRefs.push('direct_employee_master_table_pk');
  } else if (input.projectedTechnicalKey && input.keyPreservingJoinEvidence) {
    keyPreservationStatus = 'proven';
    evidenceRefs.push('projected_employee_key', 'key_preserving_relation');
  } else if (input.authoritativeGrainEvidence) {
    keyPreservationStatus = 'proven';
    evidenceRefs.push('authoritative_gateway_or_application_grain');
  } else if (input.projectedTechnicalKey && input.baseTablePkViaDependsOn) {
    keyPreservationStatus = 'supported_partial';
    evidenceRefs.push(
      'projected_employee_key_partial',
      'base_table_pk_via_depends_on_insufficient_alone',
    );
  } else if (input.baseTablePkViaDependsOn) {
    keyPreservationStatus = 'unproven';
    evidenceRefs.push('base_table_pk_via_depends_on_alone_insufficient_for_view_grain');
  }

  return {
    viewSourceRef: input.sourceObjectRef,
    baseEmployeeSourceRefs: input.baseTablePkViaDependsOn
      ? [`${input.sourceObjectRef}→DEPENDS_ON→base`]
      : [],
    projectedIdentityFacets: input.projectedTechnicalKey ? [input.projectedTechnicalKey] : [],
    projectedTechnicalKey: input.projectedTechnicalKey,
    joinEvidence:
      input.dependsOnCount > 1
        ? 'multiple_depends_on_neighbors'
        : input.dependsOnCount === 1
          ? 'single_depends_on_neighbor'
          : 'no_depends_on',
    joinCardinalities: 'unchecked_without_view_definition',
    rowMultiplyingRelations:
      keyPreservationStatus === 'proven' ? [] : ['view_row_multiplication_unproven'],
    filters: [],
    aggregations: [],
    distinctUsage: false,
    unionUsage: false,
    groupingUsage: false,
    duplicateRisk:
      keyPreservationStatus === 'proven' ? null : 'view_row_multiplication_unproven',
    keyPreservationStatus,
    evidenceRefs,
    unresolvedRisks:
      keyPreservationStatus === 'proven'
        ? []
        : ['key_preservation_unproven', 'view_definition_evidence_unavailable'],
    viewDefinitionEvidenceStatus: input.viewDefinitionAvailable
      ? 'available'
      : 'view_definition_evidence_unavailable',
    baseTablePkViaDependsOnAlone:
      Boolean(input.baseTablePkViaDependsOn) &&
      !input.keyPreservingJoinEvidence &&
      !input.authoritativeGrainEvidence &&
      !isTable,
  };
}

export function tryFoundationGraphRead(repoRoot: string): FoundationGraphRead {
  const paths = defaultStage3aPaths(repoRoot);
  const result: FoundationGraphRead = {
    available: false,
    graphSourceHash: null,
    formResolved: false,
    formNodeId: null,
    employeeObjectResolved: false,
    employeeObjectNodeId: null,
    employeeObjectType: null,
    employeeHasBaseTablePkViaDependsOn: false,
    employeeDependsOnCount: 0,
    hasColumnCount: 0,
    trainingApplicationAnchorFound: false,
    trainingFormNodeId: null,
    viewKeyPreservation: null,
    readCount: 0,
    errors: [],
  };

  if (!fs.existsSync(paths.indexPath)) {
    result.errors.push('stage3a_index_missing');
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null;
  try {
    const index = new CanonicalGraphIndexService(paths);
    const status = index.status();
    result.graphSourceHash = status.sourceHash ?? 'unknown';
    result.available = true;
    db = index.openReadonly();
    const resolver = new CanonicalGraphResolverService(db);

    const form = resolver.resolveForm({ guid: REAL_P1_FORM_GUID });
    result.readCount += 1;
    result.formResolved = form.status === 'resolved';
    result.formNodeId = form.selectedNodeId ?? form.candidates?.[0]?.nodeId ?? null;

    const emp = resolver.traceOracleObject({
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      name: REAL_EMPLOYEE_OBJECT_NAME,
      objectType: 'VIEW',
    });
    result.readCount += 1;
    result.employeeObjectResolved = emp.status === 'resolved' || emp.status === 'ambiguous';
    result.employeeObjectNodeId =
      emp.selectedNodeId ?? emp.candidates?.[0]?.nodeId ?? null;
    result.employeeObjectType = 'VIEW';

    const edges = emp.edges ?? [];
    result.employeeDependsOnCount = edges.filter((e) => e.type === 'DEPENDS_ON').length;
    result.hasColumnCount = edges.filter((e) => e.type === 'HAS_COLUMN').length;

    let pkHit = edges.some(
      (e) => e.type === 'PRIMARY_KEY_OF' || e.type === 'UNIQUE_KEY_OF',
    );
    if (!pkHit && result.employeeObjectNodeId && db) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM kg_edges e
           JOIN kg_edges e2 ON (
             e2.from_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
             OR e2.to_id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           )
           WHERE (e.from_id = ? OR e.to_id = ?) AND e.type = 'DEPENDS_ON'
             AND e2.type IN ('PRIMARY_KEY_OF','UNIQUE_KEY_OF')`,
        )
        .get(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as { c: number };
      result.readCount += 1;
      if (row?.c > 0) pkHit = true;
    }
    result.employeeHasBaseTablePkViaDependsOn = pkHit;

    let projectedKey: string | null = null;
    if (result.employeeObjectNodeId && db) {
      const cols = db
        .prepare(
          `SELECT n.name FROM kg_edges e
           JOIN kg_nodes n ON n.id = CASE WHEN e.from_id = ? THEN e.to_id ELSE e.from_id END
           WHERE (e.from_id = ? OR e.to_id = ?) AND e.type = 'HAS_COLUMN'
           LIMIT 200`,
        )
        .all(
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
          result.employeeObjectNodeId,
        ) as Array<{ name: string | null }>;
      result.readCount += 1;
      const hint = cols.find((c) => {
        const n = (c.name ?? '').toLowerCase();
        return n.includes('id_prac') || n.includes('pracownik') || n === 'id' || n.includes('nr_ewid');
      });
      projectedKey = hint?.name ? `column_name_hint:${hint.name}` : null;
    }

    // No verified training application form GUID in offline pilot → missing anchor.
    result.trainingApplicationAnchorFound = false;
    result.trainingFormNodeId = null;

    result.viewKeyPreservation = assessViewKeyPreservation({
      sourceObjectRef: `${REAL_EMPLOYEE_OBJECT_OWNER}.${REAL_EMPLOYEE_OBJECT_NAME}`,
      sourceObjectType: result.employeeObjectType,
      baseTablePkViaDependsOn: pkHit,
      dependsOnCount: result.employeeDependsOnCount,
      projectedTechnicalKey: projectedKey,
      keyPreservingJoinEvidence: false,
      authoritativeGrainEvidence: false,
      viewDefinitionAvailable: false,
    });

    const outDir = path.join(repoRoot, '.local', 'stage3k2b2b1', 'real-graph-traces');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'foundation-graph-read.json'),
      JSON.stringify(
        {
          available: result.available,
          graphSourceHash: result.graphSourceHash,
          employeeObjectType: result.employeeObjectType,
          dependsOnCount: result.employeeDependsOnCount,
          pkViaDependsOn: result.employeeHasBaseTablePkViaDependsOn,
          trainingApplicationAnchorFound: result.trainingApplicationAnchorFound,
          keyPreservation: result.viewKeyPreservation?.keyPreservationStatus,
          viewDefinition: result.viewKeyPreservation?.viewDefinitionEvidenceStatus,
          pathFingerprintSample: sha256(
            stableStringify({
              type: result.employeeObjectType,
              depends: result.employeeDependsOnCount,
            }),
          ),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (err) {
    result.errors.push(`graph_read_failed:${err instanceof Error ? err.message : String(err)}`);
    result.available = false;
  } finally {
    try {
      db?.close?.();
    } catch {
      /* ignore */
    }
  }
  return result;
}
